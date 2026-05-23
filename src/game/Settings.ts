// Centralised tunable game parameters. Everything in this file is meant to
// be live-editable from the in-game settings panel — readers should pull
// values from `SETTINGS` at runtime, not cache them at construction time
// (so a slider drag takes effect on the next frame).

export interface GameSettings {
  // ---- physics ----
  gravity: number;          // m/s² (downward)
  shipThrust: number;       // m/s² along facing direction
  shipRotate: number;       // rad/s
  shipMaxSpeed: number;     // m/s safety cap
  shipLinearDamping: number;
  shipAngularDamping: number;
  shipRestitution: number;

  // ---- health ----
  shipMaxHealth: number;    // total HP per ship
  bulletDamage: number;     // HP removed per bullet hit

  // ---- weapons ----
  bulletSpeed: number;      // m/s relative to ship
  bulletTtl: number;        // seconds
  fireCooldown: number;     // seconds between shots

  // ---- match flow ----
  respawnDelay: number;     // seconds dead → alive

  // ---- effects ----
  killParticles: number;    // primary blast count
  killGlowRadius: number;   // metres
  killShake: number;        // 0..1 shake amplitude
  trailLife: number;        // seconds per streak particle
  trailSize: number;        // base size of streak particles (logical px)
  trailDrag: number;        // per-frame velocity retention 0..1
  trailEmitsPerTick: number; // how many particles per fixed update (1 normal, 2-3 thicker)

  // ---- camera ----
  /** Multiplier on the auto-computed zoom. 1.0 = default behaviour;
   *  >1 zooms in further on the action; <1 keeps the camera pulled out. */
  cameraZoom: number;

  // ---- audio ----
  /** Master volume, 0..1. 0 = muted. */
  masterVolume: number;

  // ---- power-ups ----
  powerupsEnabled: number;   // 0 = off, 1 = on (bool stored as number for slider parity)
  powerupSpawnSec: number;   // average seconds between spawns
  powerupsMax: number;       // maximum simultaneous pickups on the field

  // ---- visuals ----
  crtEnabled: number;        // 0 = off, 1 = scanlines + vignette overlay
  bulletTrail: number;       // 0 = off, 1 = on

  // ---- game mode ----
  /** 0 = Deathmatch (combat, kills = score). 1 = Race (laps win). */
  gameMode: number;
  /** Laps required to win in Race mode. */
  raceTargetLaps: number;

  // ---- camera ----
  /** 0 = always single-view; 1 = auto-split when players are far apart. */
  splitScreenAuto: number;
  /** Distance (metres) between players at which split kicks in. */
  splitScreenThreshold: number;
}

/** Mutable global settings — UI sliders write here, game code reads here. */
export const SETTINGS: GameSettings = {
  gravity: 9.8,
  shipThrust: 22,
  shipRotate: 3.6,
  shipMaxSpeed: 28,
  shipLinearDamping: 0.15,
  shipAngularDamping: 6,
  shipRestitution: 0.25,

  shipMaxHealth: 100,
  bulletDamage: 25,

  bulletSpeed: 48,
  bulletTtl: 1.5,
  fireCooldown: 0.18,

  respawnDelay: 1.5,

  killParticles: 6,
  killGlowRadius: 2.2,
  killShake: 0.12,
  trailLife: 0.9,
  trailSize: 1.6,
  trailDrag: 0.98,
  trailEmitsPerTick: 1,

  cameraZoom: 1.0,

  masterVolume: 0.6,

  powerupsEnabled: 1,
  powerupSpawnSec: 7,
  powerupsMax: 3,

  crtEnabled: 0,
  // Off by default — bullets read better as hard pixel-art points without
  // a trailing comet streak. Players who want the streak can flip it in
  // the settings panel.
  bulletTrail: 0,

  gameMode: 0,
  raceTargetLaps: 3,

  splitScreenAuto: 1,
  splitScreenThreshold: 80,
};

/** Snapshot of the default values, so the "Reset" button can restore them. */
export const DEFAULT_SETTINGS: Readonly<GameSettings> = { ...SETTINGS };

/** Subscribers fire whenever a setting changes (used to sync physics state
 *  that lives in Rapier — gravity, body dampings — outside the SETTINGS
 *  object). */
type Listener = (key: keyof GameSettings, value: number) => void;
const listeners: Listener[] = [];

export function onSettingChange(fn: Listener): void {
  listeners.push(fn);
}

// ──────────────────────────────────────────────────────────────────────────
// Persistence — auto-save to localStorage on every change so the user's
// tweaks survive a page reload. Saves are debounced so dragging a slider
// doesn't slam localStorage 60×/sec.
// ──────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "turbo-rakketti-settings/v1";
let saveTimer: number | null = null;

function scheduleSave(): void {
  if (saveTimer !== null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SETTINGS));
    } catch {
      // Quota or privacy-mode — silently ignore; runtime SETTINGS still work.
    }
  }, 150);
}

/** Load persisted settings into SETTINGS. Called once at module load. */
function loadFromStorage(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  let parsed: Partial<GameSettings>;
  try {
    parsed = JSON.parse(raw) as Partial<GameSettings>;
  } catch {
    return;
  }
  // Only copy keys we recognise and that are finite numbers — defensively
  // ignore garbage if the schema ever changes.
  for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof GameSettings>) {
    const v = parsed[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      SETTINGS[k] = v;
    }
  }
}

loadFromStorage();

export function setSetting<K extends keyof GameSettings>(
  key: K, value: GameSettings[K],
): void {
  SETTINGS[key] = value;
  for (const l of listeners) l(key, value as number);
  scheduleSave();
}

export function resetSettings(): void {
  for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof GameSettings>) {
    setSetting(k, DEFAULT_SETTINGS[k]);
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Manually push the current SETTINGS to storage. Mostly for a "Save"
 *  button or when you want to be sure nothing's pending. */
export function saveSettings(): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SETTINGS));
  } catch {
    // ignore
  }
}

/** Returns true if there's a persisted snapshot in localStorage. */
export function hasPersistedSettings(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
