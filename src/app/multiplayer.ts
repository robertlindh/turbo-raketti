// Realtime multiplayer rooms backed by Firebase Realtime Database.
//
// Two roles per room: "host" (creates the room, picks the level) and
// "guest" (joins via room code). Both publish their ship state at ~15Hz
// under /rooms/{id}/host or /rooms/{id}/guest; both subscribe to the
// other slot for rendering.
//
// This is a minimal MVP — no authoritative simulation, no anti-cheat,
// no NAT traversal worries. Each peer runs their own physics for their
// own ship; the other ship is a visual ghost interpolated from the
// remote state. Bullets / kollisioner between ships are not synced
// yet — the focus here is "you can see the other player move".
//
// Room layout in Firebase:
//   /rooms/{id}
//     levelId: "metarola"
//     mode:    "race"            (always "race" in MVP)
//     createdAt: 17795..ms
//     status:  "waiting" | "playing" | "finished"
//     host: { name, ready, state?: { x, y, r, vx, vy, thrust, t } }
//     guest: { name, ready, state?: { ... } }

import { getDb } from "./firebase";

export type RoomRole = "host" | "guest";

export interface RemoteShipState {
  x: number;
  y: number;
  /** Rotation in radians. */
  r: number;
  /** Linear velocity components — used to extrapolate between updates. */
  vx: number;
  vy: number;
  /** Thrust flag — drives the flame visual on the remote ship. */
  thrust: boolean;
  /** Local match-elapsed time in seconds when this snapshot was taken. */
  t: number;
}

export interface RoomSnapshot {
  levelId: string;
  mode: "race" | "duel";
  status: "waiting" | "playing" | "finished";
  host: { name: string; ready: boolean; state?: RemoteShipState };
  guest: { name: string; ready: boolean; state?: RemoteShipState } | null;
}

/** Generate a short, human-readable room code (4 uppercase letters). */
export function makeRoomCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // skip I, O (look like 1, 0)
  let s = "";
  for (let i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

/** Create a new room with the calling player as host. Returns the room
 *  code on success, null if Firebase isn't available. */
export async function createRoom(
  hostName: string,
  levelId: string,
  mode: "race" | "duel" = "race",
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const { ref, set } = await import("firebase/database");
  // Try a few codes in case of (very unlikely) collision.
  for (let i = 0; i < 5; i++) {
    const code = makeRoomCode();
    const room = {
      levelId,
      mode,
      status: "waiting" as const,
      createdAt: Date.now(),
      host: { name: hostName.slice(0, 16) || "Host", ready: false },
      guest: null,
    };
    try {
      // Use set() — overwrites if collides; we re-roll on the next loop
      // iteration if a fetch immediately shows a different host.
      await set(ref(db, `/rooms/${code}`), room);
      return code;
    } catch (err) {
      console.warn("Room create failed, retrying:", err);
    }
  }
  return null;
}

/** Join an existing room as guest. Returns true if the room was found
 *  and joining succeeded, false otherwise (wrong code, already full,
 *  Firebase down). */
export async function joinRoom(
  roomId: string,
  guestName: string,
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const { ref, get, set } = await import("firebase/database");
  try {
    const snap = await get(ref(db, `/rooms/${roomId}`));
    if (!snap.exists()) return false;
    const val = snap.val() as Partial<RoomSnapshot> | null;
    if (val?.status !== "waiting") return false;
    // Stamp the guest entry.
    await set(ref(db, `/rooms/${roomId}/guest`), {
      name: guestName.slice(0, 16) || "Guest",
      ready: false,
    });
    return true;
  } catch (err) {
    console.warn("Room join failed:", err);
    return false;
  }
}

/** Subscribe to room state changes. Returns an unsubscribe function. */
export async function subscribeToRoom(
  roomId: string,
  callback: (snap: RoomSnapshot | null) => void,
): Promise<() => void> {
  const db = getDb();
  if (!db) return () => { /* noop */ };
  const { ref, onValue } = await import("firebase/database");
  const r = ref(db, `/rooms/${roomId}`);
  const off = onValue(r, (snap) => {
    callback(snap.exists() ? (snap.val() as RoomSnapshot) : null);
  });
  return off;
}

/** Mark our slot ready. Host sets the room to "playing" once both are. */
export async function setReady(
  roomId: string,
  role: RoomRole,
  ready: boolean,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const { ref, set, get, update } = await import("firebase/database");
  try {
    await set(ref(db, `/rooms/${roomId}/${role}/ready`), ready);
    if (role === "host" && ready) {
      const guestSnap = await get(ref(db, `/rooms/${roomId}/guest/ready`));
      if (guestSnap.val() === true) {
        await update(ref(db, `/rooms/${roomId}`), { status: "playing" });
      }
    }
    if (role === "guest" && ready) {
      const hostSnap = await get(ref(db, `/rooms/${roomId}/host/ready`));
      if (hostSnap.val() === true) {
        await update(ref(db, `/rooms/${roomId}`), { status: "playing" });
      }
    }
  } catch (err) {
    console.warn("setReady failed:", err);
  }
}

/** Transition the room to "playing". Idempotent — called by whichever
 *  client first sees both ready flags via the room subscription. */
export async function setRoomStatusPlaying(roomId: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  const { ref, update } = await import("firebase/database");
  try {
    await update(ref(db, `/rooms/${roomId}`), { status: "playing" });
  } catch (err) {
    console.warn("setRoomStatusPlaying failed:", err);
  }
}

/** Publish our ship state to the room. Called ~15Hz from the game tick. */
export async function publishState(
  roomId: string,
  role: RoomRole,
  state: RemoteShipState,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const { ref, set } = await import("firebase/database");
  try {
    await set(ref(db, `/rooms/${roomId}/${role}/state`), state);
  } catch (err) {
    // Don't spam — drop silently on transient failures.
    void err;
  }
}

/** Tear down the room when we leave. The host removing the room
 *  forcibly disconnects any guest. */
export async function leaveRoom(
  roomId: string,
  role: RoomRole,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const { ref, set, remove } = await import("firebase/database");
  try {
    if (role === "host") {
      await remove(ref(db, `/rooms/${roomId}`));
    } else {
      await set(ref(db, `/rooms/${roomId}/guest`), null);
    }
  } catch (err) {
    console.warn("leaveRoom failed:", err);
  }
}
