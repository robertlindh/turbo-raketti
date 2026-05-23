// Highscores — global leaderboards backed by Firebase Realtime Database,
// with localStorage as an offline-friendly cache for instant UI render.
//
// Leaderboards per level + mode:
//   - "time-trial": lowest time wins. `value` is seconds.
//   - "race":       same — winning racer's time.
//   - "wave":       same — time to take down 5 bots (lower = better).
//   - "duel":       highest score wins. `value` is winning frag count;
//                   `loser` records the opponent's frag count.
//
// Top 10 entries per board. A new score qualifies if either fewer than
// 10 entries exist or it beats the worst current entry.
//
// Sync model:
//   - getHighScores() returns from the local cache (synchronous, fast).
//   - fetchHighScoresAsync() pulls the latest from Firebase + updates the
//     cache. UI calls it after rendering and re-renders when it resolves.
//   - addScore() pushes to Firebase + updates the cache. Falls back to
//     localStorage-only if Firebase is unreachable.

export type GameMode = "time-trial" | "duel" | "race" | "wave";

/** A single ghost-race telemetry sample. Kept small so 10Hz sampling of
 *  a 60s run only adds ~7 KB per highscore entry. */
export interface ReplaySample {
  /** Seconds since match start. */
  t: number;
  x: number;
  y: number;
  /** Ship rotation in radians. */
  r: number;
}

export interface HighScore {
  /** 3-letter initials. */
  initials: string;
  /** Time in seconds (time-trial) or winning frag count (duel). */
  value: number;
  /** Duel only — the opponent's final frag count. */
  loser?: number;
  /** ISO date string at the moment the score was recorded. */
  date: string;
  /** Race / time-trial / wave: elapsed seconds at each checkpoint pass,
   *  in the order the player took them. Used for split times + ghost
   *  pacing. Undefined for duel / older entries. */
  gateTimes?: number[];
  /** Race / time-trial: 10Hz ship telemetry for ghost-replay rendering.
   *  Undefined for non-race modes and for older saved entries. */
  replay?: ReplaySample[];
}

const STORAGE_KEY = "tr.highscores.v1";
const MAX_ENTRIES = 10;

type Table = Record<string /* levelId */, Record<GameMode, HighScore[]>>;

function load(): Table {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Table;
  } catch {
    return {};
  }
}

function save(table: Table): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch (err) {
    console.warn("Highscores save failed:", err);
  }
}

function getBoard(levelId: string, mode: GameMode): HighScore[] {
  return load()[levelId]?.[mode] ?? [];
}

/** Sort so the best entries are first. */
function compare(mode: GameMode): (a: HighScore, b: HighScore) => number {
  // Race-style modes + wave (complete-run time-attack) use time;
  // duel uses frag count.
  const isTimeBased =
    mode === "time-trial" || mode === "race" || mode === "wave";
  return isTimeBased
    ? (a, b) => a.value - b.value          // lower time = better
    : (a, b) => b.value - a.value;          // higher frags = better
}

export function getHighScores(levelId: string, mode: GameMode): HighScore[] {
  return getBoard(levelId, mode).slice().sort(compare(mode));
}

/** Does this value beat the current worst-on-board, or is the board not full? */
export function qualifies(levelId: string, mode: GameMode, value: number): boolean {
  const board = getBoard(levelId, mode);
  if (board.length < MAX_ENTRIES) return true;
  const sorted = board.slice().sort(compare(mode));
  const worst = sorted[sorted.length - 1];
  const isTimeBased =
    mode === "time-trial" || mode === "race" || mode === "wave";
  return isTimeBased ? value < worst.value : value > worst.value;
}

/** Insert a new score and update both the local cache and Firebase. The
 *  local cache is updated immediately so the postgame can show the new
 *  ranking without waiting on the network; Firebase write happens in the
 *  background. Returns the rank inside the local cache. */
export function addScore(
  levelId: string,
  mode: GameMode,
  entry: Omit<HighScore, "date"> & { date?: string },
): { rank: number; board: HighScore[] } {
  if (!qualifies(levelId, mode, entry.value)) {
    return { rank: 0, board: getHighScores(levelId, mode) };
  }
  const table = load();
  table[levelId] = table[levelId] ?? { "time-trial": [], duel: [], race: [], wave: [] };
  const board = table[levelId][mode] ?? [];
  const fullEntry: HighScore = {
    initials: entry.initials.toUpperCase().slice(0, 3).padEnd(3, " ").trim() || "AAA",
    value: entry.value,
    loser: entry.loser,
    date: entry.date ?? new Date().toISOString(),
  };
  board.push(fullEntry);
  board.sort(compare(mode));
  while (board.length > MAX_ENTRIES) board.pop();
  table[levelId][mode] = board;
  save(table);
  const rank = board.indexOf(fullEntry) + 1;

  // Background-push the entry to the shared Firebase board. Errors are
  // swallowed — the local board is already saved so a failed network
  // request doesn't lose the player's run.
  void pushScoreToFirebase(levelId, mode, fullEntry);

  return { rank, board };
}

/** Fetch the latest leaderboard from Firebase, merge it into the local
 *  cache, and return the trimmed top 10. UI code should call this after
 *  rendering and re-render once the promise resolves. Returns the same
 *  cached value as getHighScores on failure so the UI never empties. */
export async function fetchHighScoresAsync(
  levelId: string,
  mode: GameMode,
): Promise<HighScore[]> {
  const remote = await fetchScoresFromFirebase(levelId, mode);
  if (remote === null) return getHighScores(levelId, mode);
  // Replace the local cache for this board with the canonical remote one.
  const table = load();
  table[levelId] = table[levelId] ?? { "time-trial": [], duel: [], race: [], wave: [] };
  table[levelId][mode] = remote;
  save(table);
  return remote;
}

// ── Firebase plumbing ──────────────────────────────────────────────────────

async function pushScoreToFirebase(
  levelId: string,
  mode: GameMode,
  entry: HighScore,
): Promise<void> {
  try {
    const { getDb } = await import("./firebase");
    const db = getDb();
    if (!db) return;
    const { ref, push } = await import("firebase/database");
    // Realtime Database refuses `undefined` properties — strip optional
    // fields if they're not present.
    const clean: Record<string, unknown> = {
      initials: entry.initials,
      value: entry.value,
      date: entry.date,
    };
    if (entry.loser !== undefined) clean.loser = entry.loser;
    if (entry.gateTimes && entry.gateTimes.length > 0) clean.gateTimes = entry.gateTimes;
    if (entry.replay && entry.replay.length > 0) clean.replay = entry.replay;
    await push(ref(db, `/scores/${levelId}/${mode}`), clean);
  } catch (err) {
    console.warn("Firebase push failed:", err);
  }
}

async function fetchScoresFromFirebase(
  levelId: string,
  mode: GameMode,
): Promise<HighScore[] | null> {
  try {
    const { getDb } = await import("./firebase");
    const db = getDb();
    if (!db) return null;
    const { ref, get } = await import("firebase/database");
    const snap = await get(ref(db, `/scores/${levelId}/${mode}`));
    if (!snap.exists()) return [];
    const raw = snap.val() as Record<string, HighScore>;
    const list = Object.values(raw).filter(
      (s) => s && typeof s.value === "number" && typeof s.initials === "string",
    );
    list.sort(compare(mode));
    return list.slice(0, MAX_ENTRIES);
  } catch (err) {
    console.warn("Firebase fetch failed:", err);
    return null;
  }
}

/** Format a time-trial value as MM:SS.cs (centiseconds for tight finishes). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}
