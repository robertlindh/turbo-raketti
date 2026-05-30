import { Application, Container } from "pixi.js";
import { PhysicsWorld, PHYS_DT } from "./PhysicsWorld";
import { Ship, SHIP_RADIUS } from "./Ship";
import { Bullet } from "./Bullet";
import { HomingMissile } from "./HomingMissile";
import { Bot } from "./Bot";
import {
  publishState, subscribeToRoom, leaveRoom,
  type RemoteShipState,
} from "../app/multiplayer";
import { Sprite } from "pixi.js";
import { makeShipTexture } from "../render/sprites";
import { Camera } from "./Camera";
import {
  KeyboardInput, GamepadInput, TouchInput, orInputs, hasTouch,
  PLAYER1_KEYS, PLAYER2_KEYS, type KeyBinding,
} from "./Input";
import { GlowLayer, ParticleSystem } from "../render/fx";
import { loadLevel } from "../level/LevelLoader";
import { getLevelById } from "../level/levels";
import { getHighScores, formatTime } from "../app/highscores";
import type { Level } from "../level/Level";
import { SETTINGS, onSettingChange, offSettingChange } from "./Settings";
import { SettingsPanel } from "../ui/SettingsPanel";
import {
  unlockAudio, startVolumeWatcher,
  playShoot, playExplosion, playWallHit, playSpawn, playGateChime,
  setThrust, killThrust,
} from "../audio/Audio";
import { PowerUpSystem } from "./PowerUpSystem";
import { POWERUP_DEFS, type PowerUpType } from "./PowerUp";
import { MineEntity } from "./Mine";
import { RacingSystem } from "./Racing";
import type { Point } from "../level/Level";
import { DecalLayer, WreckageLayer } from "../render/VisualFx";
import { ParallaxStars } from "../render/ParallaxStars";
import { CrtOverlay } from "../ui/CrtOverlay";
import { SplitScreen } from "../render/SplitScreen";
import { Minimap } from "../ui/Minimap";

const KILL_SCORE = 1;
const DUEL_TARGET_FRAGS = 5;
const WAVE_TARGET_KILLS = 5;

export type GameMode = "time-trial" | "duel" | "race" | "wave";

export interface GameConfig {
  mode: GameMode;
  /** Level id; if omitted, falls back to URL hash or "metarola". */
  levelId?: string;
  /** Override the loaded level entirely (e.g. for the editor's draft mode). */
  level?: Level;
  /** Fired when the match ends — exits to the app's postgame screen. */
  onGameEnd?: (result: GameResult) => void;
  /** Online multiplayer room (race-only for now). When set, the game
   *  publishes our ship state to Firebase ~15Hz and renders the remote
   *  player's ship as a ghost interpolated from their published state. */
  online?: { roomId: string; role: "host" | "guest" };
}

/** Ghost-race telemetry the Game ships back with a finished result so the
 *  postgame can include it in the highscore submission. Same shape as the
 *  saved HighScore's `replay` and `gateTimes` fields. */
export interface RaceTelemetry {
  gateTimes: number[];
  replay: Array<{ t: number; x: number; y: number; r: number }>;
}

export type GameResult =
  | { mode: "time-trial"; levelId: string; timeSeconds: number; telemetry?: RaceTelemetry }
  | { mode: "duel"; levelId: string; winnerIndex: 0 | 1; winnerScore: number; loserScore: number }
  | { mode: "race"; levelId: string; winnerIndex: 0 | 1; timeSeconds: number; loserLaps: number; telemetry?: RaceTelemetry }
  | { mode: "wave"; levelId: string; score: number; survivedSeconds: number; telemetry?: RaceTelemetry };

/** Load a draft level saved by the level editor. Falls back to Metarola if
 *  the storage entry is missing or malformed — keeps the test-play link
 *  from breaking the game when the user clears localStorage. */
function loadDraftLevel(): Level {
  try {
    const raw = localStorage.getItem("tr.editor.draft");
    if (raw) return JSON.parse(raw) as Level;
  } catch (err) {
    console.warn("loadDraftLevel failed:", err);
  }
  return getLevelById("metarola");
}

/** Round a number to 3 decimals — cuts JSON payload size for replay
 *  samples without any visible loss of fidelity. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Standard ray-casting point-in-polygon test. */
function pointInPolygon(p: { x: number; y: number }, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Shortest distance from `p` to any edge of the polygon. Used to gate bot
 *  spawns away from walls so the collider has clearance. */
function minDistanceToPolygonEdges(
  p: { x: number; y: number },
  poly: Point[],
): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) {
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      if (d < best) best = d;
      continue;
    }
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < best) best = d;
  }
  return best;
}

interface PlayerCfg {
  index: number;
  color: number;
  binding: KeyBinding;
  /** Gamepad index for this player. 0 = first plugged-in pad, 1 = second. */
  gamepad: number;
  spawn: { x: number; y: number };
}

interface Player {
  cfg: PlayerCfg;
  ship: Ship | null;
  prev: { x: number; y: number; r: number };
  alive: boolean;
  respawnTimer: number;
  fireCooldown: number;
  score: number;
  /** Current HP. Refilled to SETTINGS.shipMaxHealth on spawn / respawn. */
  health: number;
  /** Active timer-based power-ups keyed by type → seconds remaining. */
  activePowerUps: Map<PowerUpType, number>;
  /** Single-use ammunition power-ups (e.g. Mine) keyed by type → uses left. */
  ammo: Map<PowerUpType, number>;
  /** True while the special key is held this tick — for rising-edge detection. */
  specialPrev: boolean;
}

interface ScoreView {
  el: HTMLElement;
  score: HTMLElement;
  status: HTMLElement;
  powerups: HTMLElement;
  hpBar: HTMLElement;
  hpFill: HTMLElement;
}

export class Game {
  readonly app = new Application();
  private physics!: PhysicsWorld;
  /** Receives the camera transform (scale + translate) every frame. */
  private worldRoot = new Container();
  /** Painted by the camera; everything in world coords lives here. */
  private worldLayer = new Container();
  /** Additive bloom layer above gameplay. */
  private glow!: GlowLayer;
  /** Additive particle layer above gameplay. */
  private particles!: ParticleSystem;
  private powerups!: PowerUpSystem;
  private racing: RacingSystem | null = null;
  private decals!: DecalLayer;
  private wreckage!: WreckageLayer;
  private starfield!: ParallaxStars;
  private crt!: CrtOverlay;
  private splitscreen!: SplitScreen;
  private minimap!: Minimap;
  private camera!: Camera;
  private cameraShake = { amp: 0, decay: 6 };
  private input = new KeyboardInput();
  private gamepads = new GamepadInput();
  /** On-screen controls for phones / tablets. Attached only on touch
   *  devices and only feeds P1 — split-screen on a phone is impractical. */
  private touch = new TouchInput();
  private players: Player[] = [];
  private bullets: Bullet[] = [];
  private missiles: HomingMissile[] = [];
  private mines: MineEntity[] = [];
  private waterZones: Point[][] = [];
  /** Maps collider handles to whichever projectile owns them. Bullets and
   *  homing missiles both expose `alive`, `ownerIndex`, `color`, and `body`,
   *  so the collision handler can treat them uniformly. */
  private bulletByHandle = new Map<number, Bullet | HomingMissile>();
  /** Active enemy bots in wave mode. Empty in every other mode. */
  private bots: Bot[] = [];
  /** Look up a Bot by its ship collider handle. Used by handleCollision to
   *  detect bullet-hit-bot events without scanning the bot array. */
  private botHandleToBot = new Map<number, Bot>();
  /** Wave mode: number of bots the player has killed this run. */
  private waveScore = 0;
  /** Wave mode: countdown to the next bot spawn (seconds). */
  private waveSpawnTimer = 1.5;
  /** Elapsed seconds at each checkpoint pass, in the order P1 took them.
   *  Captured for race-style modes so we can save split times alongside
   *  the highscore. */
  private gatePassTimes: number[] = [];
  /** 10Hz position telemetry for P1. Saved with each completed time-trial
   *  / race run for future ghost-race playback. */
  private replaySamples: Array<{ t: number; x: number; y: number; r: number }> = [];
  /** Seconds since the last replay sample was pushed. */
  private replayAccum = 0;

  /** Online state — populated only when config.online is set. */
  private remoteShip: Sprite | null = null;
  /** Latest snapshot received from Firebase. Treated as immutable ground
   *  truth; render-time extrapolation lives separately on `remoteRender`. */
  private remoteState: RemoteShipState | null = null;
  /** Seconds since `remoteState` was received. Used to cap extrapolation
   *  so the ghost ship doesn't fly off to infinity when updates stop. */
  private remoteStateAge = 0;
  private remoteUnsubscribe?: () => void;
  private onlinePublishAccum = 0;
  /** True while a publishState() write is still in flight. Prevents
   *  Firebase writes from piling up if the network stalls — we drop
   *  the new snapshot instead of queueing another async set(). */
  private publishInFlight = false;
  /** True once dispose() has run. Guards async callbacks (Firebase
   *  subscribe resolution, queued microtasks) that can fire after the
   *  Game's Pixi/physics state has been torn down. */
  private disposed = false;
  /** Settings listeners we registered in init(). Removed in dispose so
   *  slider drags after teardown don't reach into freed RAPIER bodies. */
  private settingsListeners: Array<(key: string, value: number) => void> = [];
  /** Window resize listeners we registered. Removed in dispose so we
   *  don't call renderer.resize() on a destroyed renderer. */
  private resizeListeners: Array<() => void> = [];
  private shipHandleToPlayer = new Map<number, number>();
  private accumulator = 0;
  private lastTime = 0;
  private scoreUi: ScoreView[] = [];
  /** Time-trial HUD — populated only when config.mode === "time-trial". */
  private raceHud: { root: HTMLElement; timer: HTMLElement; best: HTMLElement } | null = null;

  /** Mode + level + game-end callback configured at construction. */
  private config: GameConfig;
  /** Active level id (string used for highscore keys). */
  private levelId = "metarola";
  /** Elapsed seconds since the match started (time-trial timer). */
  private matchElapsed = 0;
  /** True once a winner / finisher has been determined — gates the callback
   *  so we only fire it once and don't tick further game logic. */
  private matchEnded = false;
  /** Pre-match countdown timer. >0 means "still counting down 3-2-1" —
   *  input is blocked and matchElapsed doesn't tick. The HUD turns this
   *  into a big "3 / 2 / 1 / GO!" overlay. */
  private countdownRemaining = 0;
  /** Seconds the "GO!" splash stays visible after the count hits zero.
   *  Input is unblocked the moment this starts, so the player can take off
   *  the instant they see GO!. */
  private goLinger = 0;
  /** DOM element for the countdown overlay, populated while it counts. */
  private countdownEl: HTMLElement | null = null;

  constructor(private mount: HTMLElement, config?: GameConfig) {
    // Default to duel from the URL hash so older bookmarks still work.
    this.config = config ?? { mode: "duel" };
  }

  async init() {
    await this.app.init({
      background: 0x05070d,
      // No `resizeTo` — we manage size manually below so we control exactly
      // when Pixi reads window dimensions (it sometimes measured too early).
      width: window.innerWidth,
      height: window.innerHeight,
      antialias: false, // pixel art prefers nearest-neighbour
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    this.mount.appendChild(this.app.canvas);
    // Force canvas to fill the viewport regardless of what Pixi thinks.
    const canvas = this.app.canvas;
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.display = "block";

    // Resize on window changes — explicitly tell Pixi the new pixel size.
    const onResize = () => {
      if (this.disposed) return;
      this.app.renderer.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    this.resizeListeners.push(onResize);
    // Run once after layout in case the initial measurement was wrong.
    requestAnimationFrame(onResize);

    // Scene graph:
    //   stage
    //     worldRoot       (receives shake offset)
    //       worldLayer    (receives camera scale/translate)
    //         backdrop (z=0)
    //         cave decorations (z=1)
    //         ships (z=2)
    //         bullets (z=3)
    //         glow + particles (z=4, additive)
    this.app.stage.addChild(this.worldRoot);
    this.worldRoot.addChild(this.worldLayer);

    // Camera viewport = the canvas's actual CSS size (matches what the user
    // sees). Reading from `renderer.width / resolution` was unreliable when
    // Pixi locked in a stale devicePixelRatio at init.
    this.camera = new Camera(this.worldLayer, () => ({
      width: this.app.canvas.clientWidth,
      height: this.app.canvas.clientHeight,
    }));
    this.camera.zoom = 28;
    // Wide camera only for 2P race (so both pilots can see the whole
    // course at once). Time-trial uses the close-in single-target
    // follow-zoom so the solo pilot feels their speed and reads gates
    // through the minimap. Wave (combat solo) is also close-in.
    this.camera.setWideMode(this.config.mode === "race");

    this.physics = new PhysicsWorld({ x: 0, y: SETTINGS.gravity });

    // Live-update gravity when the slider moves. Other settings are read
    // every frame so they don't need explicit hooks.
    const physicsListener = (key: string, value: number) => {
      if (this.disposed) return;
      if (key === "gravity") {
        this.physics.world.gravity = { x: 0, y: value };
      }
      if (key === "shipLinearDamping" || key === "shipAngularDamping") {
        for (const p of this.players) {
          if (!p.ship) continue;
          if (key === "shipLinearDamping") p.ship.body.setLinearDamping(value);
          else p.ship.body.setAngularDamping(value);
        }
      }
    };
    onSettingChange(physicsListener);
    this.settingsListeners.push(physicsListener);

    const renderer = this.app.renderer;

    // 1. Resolve which level to load. Priority:
    //    1. explicit `config.level` (used when the editor test-plays)
    //    2. explicit `config.levelId`
    //    3. URL hash for legacy bookmarks
    //    4. "metarola" as a last resort.
    let levelId = this.config.levelId
      ?? window.location.hash.replace(/^#/, "")
      ?? "metarola";
    if (!levelId) levelId = "metarola";
    const level = this.config.level
      ?? (levelId === "__draft" ? loadDraftLevel() : getLevelById(levelId));
    this.levelId = levelId;
    loadLevel(renderer, this.physics, this.worldLayer, level);
    this.camera.setLevelBounds(level.bounds);
    this.waterZones = level.waterZones ?? [];
    // Keep a reference for the bot spawner — Game itself doesn't otherwise
    // need to know the full Level after init.
    this._cachedLevel = level;

    // 2. Decal layer sits under ships so scorch marks read as on the wall.
    this.decals = new DecalLayer();
    this.worldLayer.addChild(this.decals);

    // 3. Effects layers added last so they render on top.
    this.glow = new GlowLayer(renderer);
    this.particles = new ParticleSystem(renderer);
    this.wreckage = new WreckageLayer();
    this.worldLayer.addChild(this.glow);
    this.worldLayer.addChild(this.particles);
    this.worldLayer.addChild(this.wreckage);

    // Power-up system shares the world layer so pickups bob in cave space.
    // Both race-style modes (time-trial and 2P race) get a speed-only
    // pickup pool — combat items are noise when you're racing checkpoints.
    const raceLike = this.config.mode === "time-trial" || this.config.mode === "race";
    const allowedPowerUps = raceLike
      ? (["speed"] as const).slice()
      : undefined;
    this.powerups = new PowerUpSystem(this.worldLayer, level, allowedPowerUps);

    // Racing — always on for race-style modes. For duel only, the legacy
    // gameMode setting can turn checkpoints on. Wave (combat solo)
    // never gets racing, regardless of the setting — the player is
    // hunting bots, not chasing gates.
    const numPlayersForRacing = this.config.mode === "time-trial" ? 1 : 2;
    const wantRacing = raceLike ||
      (this.config.mode === "duel" && SETTINGS.gameMode > 0.5);
    if (wantRacing && level.checkpoints && level.checkpoints.length > 0) {
      this.racing = new RacingSystem(this.worldLayer, level, numPlayersForRacing);
    }

    // Parallax stars live on the stage *behind* the world container, with
    // their own slower camera offset. They sit at z=0 so the world's backdrop
    // covers most of them — they only peek through at the edges and between
    // cave openings, giving a sense of depth.
    const vp0 = this.app.canvas;
    this.starfield = new ParallaxStars(vp0.clientWidth || window.innerWidth, vp0.clientHeight || window.innerHeight);
    this.starfield.parallaxFactor = 0.18;
    this.app.stage.addChildAt(this.starfield, 0);

    // CRT overlay — togglable via settings.
    this.crt = new CrtOverlay();
    this.crt.setEnabled(SETTINGS.crtEnabled > 0.5);
    const crtListener = (key: string, value: number) => {
      if (this.disposed) return;
      if (key === "crtEnabled") this.crt.setEnabled(value > 0.5);
    };
    onSettingChange(crtListener);
    this.settingsListeners.push(crtListener);

    // Splitscreen — two RTs + display sprites attached to the stage at top
    // level (above the parallax stars but rendered in their own pass).
    const cv = this.app.canvas;
    const w = cv.clientWidth || window.innerWidth;
    const h = cv.clientHeight || window.innerHeight;
    this.splitscreen = new SplitScreen(this.app.renderer.resolution, w, h);
    this.app.stage.addChild(this.splitscreen.root);

    // Recreate split-screen render textures when the window resizes.
    const onResizeSplit = () => {
      if (this.disposed) return;
      const cv2 = this.app.canvas;
      this.splitscreen.resize(cv2.clientWidth || window.innerWidth,
                              cv2.clientHeight || window.innerHeight);
    };
    window.addEventListener("resize", onResizeSplit);
    this.resizeListeners.push(onResizeSplit);

    // Minimap — shows the whole arena, players, power-ups and mines.
    this.minimap = new Minimap();
    this.minimap.setLevel(level);

    // 3. Players spawn at the level's authored spawn points. Single-
    //    player modes (time-trial, wave) only spawn P1; duel and race
    //    both spawn both ships.
    const isSinglePlayer =
      this.config.mode === "time-trial" || this.config.mode === "wave";
    this.players.push(this.makePlayer({
      index: 0, color: 0x6cc0ff, binding: PLAYER1_KEYS, gamepad: 0,
      spawn: { x: level.spawns[0].x, y: level.spawns[0].y },
    }));
    if (!isSinglePlayer) {
      this.players.push(this.makePlayer({
        index: 1, color: 0xff7a7a, binding: PLAYER2_KEYS, gamepad: 1,
        spawn: { x: level.spawns[1].x, y: level.spawns[1].y },
      }));
    }

    this.buildScoreboard();
    if (this.config.mode === "time-trial"
        || this.config.mode === "race"
        || this.config.mode === "wave") {
      this.buildRaceHud();
    }
    if (this.config.online) this.setupOnline();
    new SettingsPanel();
    this.input.attach();
    this.gamepads.attach();
    if (hasTouch()) this.touch.attach();

    // Audio: unlock the audio context on the first user interaction so the
    // browser autoplay policy is satisfied. Volume slider feeds master gain.
    const unlockOnce = () => {
      unlockAudio();
      window.removeEventListener("keydown", unlockOnce);
      window.removeEventListener("pointerdown", unlockOnce);
    };
    window.addEventListener("keydown", unlockOnce);
    window.addEventListener("pointerdown", unlockOnce);
    startVolumeWatcher();
  }

  private makePlayer(cfg: PlayerCfg): Player {
    const ship = new Ship(this.physics, this.app.renderer, this.worldLayer, {
      x: cfg.spawn.x, y: cfg.spawn.y, color: cfg.color, angle: -Math.PI / 2,
    });
    this.shipHandleToPlayer.set(ship.collider.handle, cfg.index);
    return {
      cfg,
      ship,
      prev: ship.snapshot(),
      alive: true,
      respawnTimer: 0,
      fireCooldown: 0,
      score: 0,
      health: SETTINGS.shipMaxHealth,
      activePowerUps: new Map<PowerUpType, number>(),
      ammo: new Map<PowerUpType, number>(),
      specialPrev: false,
    };
  }

  /** Builds the time-trial HUD: a large monospace timer, the lap counter,
   *  and the best recorded time on the current level (or "—" if none). */
  private buildRaceHud() {
    const root = document.createElement("div");
    root.id = "race-hud";
    root.style.cssText = `
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(10, 4, 20, 0.78);
      border: 1px solid rgba(255, 209, 102, 0.4);
      border-radius: 8px;
      padding: 12px 28px;
      color: #ffd166;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      letter-spacing: 0.2em;
      user-select: none;
      pointer-events: none;
      text-align: center;
      box-shadow: 0 0 24px rgba(255, 209, 102, 0.15);
    `;
    const timer = document.createElement("div");
    timer.textContent = "00:00.00";
    timer.style.cssText =
      "font-size: 38px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums;";
    const best = document.createElement("div");
    best.textContent = "BEST: —";
    best.style.cssText =
      "font-size: 11px; opacity: 0.65; margin-top: 6px; color: #aef0ff;";
    root.append(timer, best);
    document.body.appendChild(root);
    this.raceHud = { root, timer, best };

    // Show the player's existing best so they know the target. Wave mode
    // uses a different sub-line: a live "X / 5 bottar" counter that
    // updates each kill.
    if (this.config.mode === "wave") {
      this.raceHud.best.textContent = `0 / ${WAVE_TARGET_KILLS} bottar`;
      this.raceHud.best.style.color = "#ff8a8a";
    } else {
      const board = this.config.mode === "race"
        ? getHighScores(this.levelId, "race")
        : getHighScores(this.levelId, "time-trial");
      const top = board[0];
      if (top) {
        this.raceHud.best.textContent = `BEST: ${top.initials} ${formatTime(top.value)}`;
      }
    }
  }

  private buildScoreboard() {
    const root = document.createElement("div");
    root.id = "scoreboard";
    root.style.cssText =
      "position:fixed;top:12px;right:12px;display:flex;gap:10px;font-family:system-ui,sans-serif;user-select:none;pointer-events:none;";
    for (const p of this.players) {
      const el = document.createElement("div");
      el.style.cssText =
        `background:rgba(0,0,0,0.55);padding:10px 14px;border-radius:6px;border-left:4px solid #${p.cfg.color.toString(16).padStart(6, "0")};min-width:90px;text-align:center;color:#fff;`;
      const label = document.createElement("div");
      label.textContent = `P${p.cfg.index + 1}`;
      label.style.cssText = "font-size:11px;opacity:0.7;letter-spacing:1px;";
      const score = document.createElement("div");
      score.textContent = "0";
      score.style.cssText = "font-size:24px;font-weight:600;line-height:1;margin-top:2px;";
      const status = document.createElement("div");
      status.textContent = "ALIVE";
      status.style.cssText = "font-size:10px;opacity:0.6;margin-top:4px;letter-spacing:1px;";
      // HP bar — coloured by current health.
      const hpBar = document.createElement("div");
      hpBar.style.cssText =
        "margin-top:6px;height:5px;width:100%;background:#1a1a22;border-radius:3px;overflow:hidden;";
      const hpFill = document.createElement("div");
      hpFill.style.cssText =
        "height:100%;width:100%;background:#5ed884;transition:width 0.12s ease-out, background-color 0.2s ease-out;";
      hpBar.appendChild(hpFill);
      const powerups = document.createElement("div");
      powerups.style.cssText =
        "display:flex;gap:4px;justify-content:center;margin-top:6px;min-height:14px;";
      el.append(label, score, status, hpBar, powerups);
      root.appendChild(el);
      this.scoreUi.push({ el, score, status, powerups, hpBar, hpFill });
    }
    document.body.appendChild(root);
  }

  private updateScoreboard() {
    // Live race-timer. Frozen once the match ends so the finishing time
    // stays visible during the postgame transition. Wave mode also tracks
    // the kill counter live in the sub-line so the player feels progress
    // on every bot taken down.
    if (this.raceHud) {
      this.raceHud.timer.textContent = formatTime(this.matchElapsed);
      if (this.config.mode === "wave") {
        this.raceHud.best.textContent =
          `${this.waveScore} / ${WAVE_TARGET_KILLS} bottar`;
      }
      // Once finished, flash the timer briefly to feedback completion.
      if (this.matchEnded) {
        this.raceHud.timer.style.color = "#ffffff";
        this.raceHud.timer.style.textShadow = "0 0 16px rgba(255,209,102,0.9)";
      }
    }
    const racing = this.racing;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const ui = this.scoreUi[i];
      if (racing) {
        const laps = racing.laps[p.cfg.index];
        const target = Math.max(1, Math.round(SETTINGS.raceTargetLaps));
        const nextIdx = racing.nextFor(p.cfg.index);
        ui.score.textContent = `${laps}/${target}`;
        ui.score.style.fontSize = "20px";
        const _gpSuffix = this.gamepads.isConnected(p.cfg.gamepad) ? " · GP" : "";
        if (p.alive) {
          ui.status.textContent = `NEXT CP ${nextIdx + 1}${_gpSuffix}`;
          ui.status.style.color = "#9be39b";
        } else {
          ui.status.textContent = `RESPAWN ${p.respawnTimer.toFixed(1)}s${_gpSuffix}`;
          ui.status.style.color = "#ff9b9b";
        }
      } else {
        ui.score.textContent = String(p.score);
        ui.score.style.fontSize = "24px";
        const gpSuffix = this.gamepads.isConnected(p.cfg.gamepad) ? " · GP" : "";
        if (p.alive) {
          ui.status.textContent = `ALIVE${gpSuffix}`;
          ui.status.style.color = "#9be39b";
        } else {
          ui.status.textContent = `RESPAWN ${p.respawnTimer.toFixed(1)}s${gpSuffix}`;
          ui.status.style.color = "#ff9b9b";
        }
      }
      this.renderPowerUpBadges(ui.powerups, p);

      // HP bar — width and colour based on % health.
      const pct = p.alive
        ? Math.max(0, Math.min(1, p.health / SETTINGS.shipMaxHealth))
        : 0;
      ui.hpFill.style.width = `${pct * 100}%`;
      ui.hpFill.style.backgroundColor =
        pct > 0.6 ? "#5ed884" : pct > 0.3 ? "#e8c84e" : "#e85844";
    }
  }

  /** Render small coloured badges for each active power-up + each ammo. */
  private renderPowerUpBadges(host: HTMLElement, p: Player) {
    // Build a compact key of current state so we can short-circuit DOM updates.
    let key = "";
    for (const [type, t] of p.activePowerUps) key += `${type}:${t.toFixed(1)};`;
    for (const [type, n] of p.ammo) key += `${type}:#${n};`;
    if (host.dataset.key === key) return;
    host.dataset.key = key;
    host.innerHTML = "";
    const append = (type: PowerUpType, content: string, title: string) => {
      const def = POWERUP_DEFS[type];
      const badge = document.createElement("div");
      const hex = def.color.toString(16).padStart(6, "0");
      badge.title = title;
      badge.style.cssText = `
        background: #${hex};
        color: #0a0a0d;
        font-size: 9px;
        font-weight: 700;
        padding: 2px 5px;
        border-radius: 3px;
        letter-spacing: 0.5px;
      `;
      badge.textContent = content;
      host.appendChild(badge);
    };
    for (const [type, t] of p.activePowerUps) {
      const def = POWERUP_DEFS[type];
      append(type, def.label[0].toUpperCase() + Math.ceil(t).toString(),
        `${def.label} ${t.toFixed(1)}s`);
    }
    for (const [type, n] of p.ammo) {
      const def = POWERUP_DEFS[type];
      append(type, `${def.label[0].toUpperCase()}×${n}`,
        `${def.label}: ${n} charge${n === 1 ? "" : "s"} (press special)`);
    }
  }

  start() {
    this.lastTime = performance.now();
    // Pre-match countdown — 3 seconds total. Input is blocked and
    // matchElapsed stays at 0 until it hits zero ("GO!"). Each second a
    // pitched chime plays; the "GO!" gets a brighter chime.
    this.countdownRemaining = 3.0;
    this.buildCountdownOverlay();
    this.app.ticker.add(this.tick);
  }

  stop() {
    this.app.ticker.remove(this.tick);
    this.input.detach();
    this.gamepads.detach();
    this.touch.detach();
    // Silence the thrust loop on every ship — when the ticker stops, the
    // ship's applyInput() can no longer ramp the gain down, so the loop
    // would otherwise keep humming through the postgame screen.
    for (const p of this.players) killThrust(p.cfg.index);
  }

  /** Create the centred 3-2-1-GO overlay. The DOM lives outside Pixi so we
   *  can use crisp browser-native typography at any DPR. */
  private buildCountdownOverlay(): void {
    const el = document.createElement("div");
    el.id = "countdown";
    el.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(1);
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 180px;
      font-weight: 800;
      color: #ffd166;
      text-shadow: 0 6px 0 #0a0414, 0 0 32px rgba(255,209,102,0.55),
                   0 0 64px rgba(255,209,102,0.3);
      letter-spacing: 0.05em;
      user-select: none;
      pointer-events: none;
      z-index: 70;
      will-change: transform, opacity;
      transition: transform .25s cubic-bezier(.2,.8,.25,1), opacity .25s ease-out;
    `;
    el.textContent = "3";
    document.body.appendChild(el);
    this.countdownEl = el;
  }

  /** Advance the 3-2-1 countdown. When the remaining time crosses zero we
   *  flip into the "GO!" linger phase, which is owned by `updateGoLinger`. */
  private updateCountdown(dt: number): void {
    const prevWhole = Math.ceil(this.countdownRemaining);
    this.countdownRemaining -= dt;
    const el = this.countdownEl;
    if (!el) return;

    if (this.countdownRemaining <= 0) {
      // Transition into the GO! splash. Set a short linger; the next
      // tick will drive its fade-out through updateGoLinger.
      el.textContent = "GO!";
      el.style.color = "#9eff8e";
      el.style.fontSize = "220px";
      el.style.transform = "translate(-50%, -50%) scale(1.2)";
      requestAnimationFrame(() => {
        el.style.transform = "translate(-50%, -50%) scale(1)";
      });
      playSpawn();
      this.countdownRemaining = 0;
      this.goLinger = 0.7;
      return;
    }

    const nextWhole = Math.ceil(this.countdownRemaining);
    // Tick — when the integer second changes, swap the number and pop
    // the scale so each count lands punchier.
    if (nextWhole !== prevWhole && nextWhole > 0) {
      el.textContent = String(nextWhole);
      el.style.transform = "translate(-50%, -50%) scale(1.4)";
      requestAnimationFrame(() => {
        el.style.transform = "translate(-50%, -50%) scale(1)";
      });
      playWallHit();
    }
  }

  /** Fade out and remove the GO! splash after a short linger so the player
   *  registers it but isn't stuck looking at it. */
  private updateGoLinger(dt: number): void {
    this.goLinger -= dt;
    const el = this.countdownEl;
    if (!el) {
      this.goLinger = 0;
      return;
    }
    if (this.goLinger <= 0) {
      el.style.opacity = "0";
      // Capture for the timeout so a re-entrant call doesn't double-remove.
      const toRemove = el;
      this.countdownEl = null;
      setTimeout(() => toRemove.remove(), 300);
    }
  }

  /** Set up the online multiplayer subscription. Spawns a ghost ship for
   *  the remote player and starts listening for their state updates. */
  private setupOnline(): void {
    const online = this.config.online;
    if (!online) return;
    // Spawn the remote ghost sprite. Use the opposing player's colour so
    // the host (blue P1) sees the guest as red, and vice versa.
    const remoteColor = online.role === "host" ? 0xff7a7a : 0x6cc0ff;
    const texture = makeShipTexture(this.app.renderer, remoteColor);
    this.remoteShip = new Sprite(texture);
    this.remoteShip.anchor.set(0.5, 0.5);
    this.remoteShip.scale.set(2 / 13);
    this.remoteShip.alpha = 0.75; // slightly translucent so it reads as a remote ghost
    this.remoteShip.visible = false; // hidden until first state arrives
    this.worldLayer.addChild(this.remoteShip);

    // Subscribe to room updates so we can pull the remote player's state.
    // `disposed` guard inside the callback covers two races:
    //   1. dispose() runs before subscribe() resolves — when the promise
    //      lands we'd otherwise have a live Firebase listener pointed at a
    //      destroyed Game. We unsubscribe immediately in that case.
    //   2. A snapshot arrives between dispose() and the unsubscribe taking
    //      effect — the guard drops it instead of touching remoteShip.
    const otherRole = online.role === "host" ? "guest" : "host";
    void subscribeToRoom(online.roomId, (snap) => {
      if (this.disposed) return;
      if (!snap) return;
      const slot = otherRole === "host" ? snap.host : snap.guest;
      if (slot?.state) {
        this.remoteState = slot.state;
        this.remoteStateAge = 0;
        if (this.remoteShip) this.remoteShip.visible = true;
      }
    }).then((unsub) => {
      if (this.disposed) { unsub(); return; }
      this.remoteUnsubscribe = unsub;
    });
  }

  /** Push our ship state to Firebase at ~15Hz (every 66ms). Called from
   *  the render loop when online. If a previous write is still pending
   *  we skip — fresh state will go out on the next free tick. Without
   *  this guard a slow network would accumulate unresolved promises and
   *  eventually stall the tab. */
  private publishLocalStateIfNeeded(dt: number): void {
    const online = this.config.online;
    if (!online) return;
    const p1 = this.players[0];
    if (!p1?.ship) return;
    this.onlinePublishAccum += dt;
    if (this.onlinePublishAccum < 0.066) return;
    this.onlinePublishAccum = 0;
    if (this.publishInFlight) return; // backpressure: drop, not queue
    const pos = p1.ship.body.translation();
    const rot = p1.ship.body.rotation();
    const vel = p1.ship.body.linvel();
    this.publishInFlight = true;
    publishState(online.roomId, online.role, {
      x: pos.x, y: pos.y, r: rot,
      vx: vel.x, vy: vel.y,
      thrust: p1.ship.thrustOn,
      t: this.matchElapsed,
    }).finally(() => { this.publishInFlight = false; });
  }

  /** Update the visible position of the remote ghost ship. Extrapolates
   *  from the last received snapshot — `remoteState` is treated as
   *  immutable ground truth, with `remoteStateAge` tracking how long
   *  we've been extrapolating. Capping the age stops the ghost from
   *  flying off to infinity when Firebase updates stop. */
  private updateRemoteGhost(dt: number): void {
    if (!this.remoteShip || !this.remoteState) return;
    this.remoteStateAge += dt;
    // Cap extrapolation at 0.5s — beyond that we'd be predicting wildly
    // without any real signal. Hold the last predicted position instead.
    const t = Math.min(0.5, this.remoteStateAge);
    this.remoteShip.x = this.remoteState.x + this.remoteState.vx * t;
    this.remoteShip.y = this.remoteState.y + this.remoteState.vy * t;
    this.remoteShip.rotation = this.remoteState.r + Math.PI / 2;
  }

  /** Tear down the Pixi canvas + all DOM the game added (scoreboard, settings
   *  panel, etc.) so the menu can render a clean slate. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Unsubscribe + leave the online room before tearing down Pixi. The
    // unsubscribe may still be undefined if the subscribe() promise hasn't
    // resolved yet — the `disposed` guard inside the subscribe callback
    // handles that race.
    this.remoteUnsubscribe?.();
    this.remoteUnsubscribe = undefined;
    if (this.config.online) {
      void leaveRoom(this.config.online.roomId, this.config.online.role);
    }
    this.stop();
    // Settings + resize listeners — remove BEFORE we destroy the renderer /
    // physics world, otherwise a stray resize or slider drag during teardown
    // would hit freed objects.
    for (const fn of this.settingsListeners) offSettingChange(fn);
    this.settingsListeners.length = 0;
    for (const fn of this.resizeListeners) window.removeEventListener("resize", fn);
    this.resizeListeners.length = 0;
    // Free the Rapier wasm world — every collider/body the level created
    // lives here, and without an explicit free() it stays on the wasm heap
    // for the rest of the page session.
    try { this.physics?.free(); } catch { /* ignore */ }
    // Pixi app removal — destroys the canvas + GL context.
    // NB: { texture: true } destroys textures owned by sprites, which can
    // include the module-cached ship/bullet/missile/glow textures. Those
    // caches check `.destroyed` and re-create lazily on the next match.
    try { this.app.destroy(true, { children: true, texture: true }); } catch { /* ignore */ }
    // DOM cruft that Game appends to <body>.
    for (const id of ["scoreboard", "settings-panel", "settings-launcher", "race-hud", "countdown", "touch-controls"]) {
      document.getElementById(id)?.remove();
    }
  }

  private tick = () => {
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.25) dt = 0.25;

    // Countdown phase — while > 0 we block input + matchElapsed and pulse
    // the digits. Once it hits zero the GO! splash lingers briefly while
    // the match itself starts ticking.
    if (this.countdownRemaining > 0) {
      this.updateCountdown(dt);
    } else {
      if (this.goLinger > 0) this.updateGoLinger(dt);
      if (!this.matchEnded) {
        this.matchElapsed += dt;
        this.sampleReplay(dt);
      }
    }

    this.accumulator += dt;
    while (this.accumulator >= PHYS_DT) {
      this.fixedUpdate();
      this.accumulator -= PHYS_DT;
    }
    const alpha = this.accumulator / PHYS_DT;
    this.render(alpha, dt);
    // Online: push our state + animate the remote ghost.
    this.publishLocalStateIfNeeded(dt);
    this.updateRemoteGhost(dt);
    this.updateScoreboard();
    this.updateMinimap(dt);
    this.checkWinCondition();
  };

  /** Sample P1's position + rotation at 10Hz so a completed race-style
   *  run can be saved as ghost-replay data. Only sampled when the local
   *  player is alive and time-trial / race / wave mode is active —
   *  duel doesn't need replays. */
  private sampleReplay(dt: number): void {
    if (this.config.mode === "duel") return;
    this.replayAccum += dt;
    if (this.replayAccum < 0.1) return;
    this.replayAccum = 0;
    const p1 = this.players[0];
    if (!p1 || !p1.alive || !p1.ship) return;
    const pos = p1.ship.body.translation();
    const rot = p1.ship.body.rotation();
    this.replaySamples.push({
      t: round3(this.matchElapsed),
      x: round3(pos.x),
      y: round3(pos.y),
      r: round3(rot),
    });
  }

  /** Decide whether the match is over.  Time-trial finishes the moment P1
   *  completes their target lap count; duel finishes when either player
   *  reaches DUEL_TARGET_FRAGS. Called every frame but no-ops once the
   *  match has already ended. */
  private checkWinCondition(): void {
    if (this.matchEnded) return;
    // Snapshot of the run's telemetry, attached to race-style results so
    // the postgame can ship it to Firebase for future ghost-races.
    const telemetry = (): RaceTelemetry => ({
      gateTimes: this.gatePassTimes.slice(),
      replay: this.replaySamples.slice(),
    });

    if (this.config.mode === "wave") {
      // Wave / combat solo — race to take down WAVE_TARGET_KILLS bots as
      // fast as possible. Match ends when the target kill count is hit
      // (score = elapsed time, lower = better) OR when P1 dies (score
      // still recorded so the run isn't lost).
      const p1 = this.players[0];
      if (this.waveScore >= WAVE_TARGET_KILLS || (p1 && !p1.alive)) {
        this.finishMatch({
          mode: "wave",
          levelId: this.levelId,
          score: this.waveScore,
          survivedSeconds: this.matchElapsed,
          telemetry: telemetry(),
        });
      }
      return;
    }
    if (this.config.mode === "time-trial") {
      const target = Math.max(1, Math.round(SETTINGS.raceTargetLaps));
      if (this.racing && this.racing.laps[0] >= target) {
        this.finishMatch({
          mode: "time-trial",
          levelId: this.levelId,
          timeSeconds: this.matchElapsed,
          telemetry: telemetry(),
        });
      }
    } else if (this.config.mode === "race") {
      // Race: first player to N laps wins. Record the winner's time and
      // the loser's lap count so the postgame can show "P1 won by 1 lap".
      const target = Math.max(1, Math.round(SETTINGS.raceTargetLaps));
      if (!this.racing) return;
      for (let i = 0; i < 2; i++) {
        if (this.racing.laps[i] >= target) {
          const winnerIndex = i as 0 | 1;
          const loserIdx = winnerIndex === 0 ? 1 : 0;
          this.finishMatch({
            mode: "race",
            levelId: this.levelId,
            winnerIndex,
            timeSeconds: this.matchElapsed,
            loserLaps: this.racing.laps[loserIdx] ?? 0,
            // Only P1's telemetry is captured; for 2P race that's the
            // local pilot. Ghost-races still work because we have a
            // recording of at least one perspective.
            telemetry: telemetry(),
          });
          return;
        }
      }
    } else {
      // Duel: first to N frags wins.
      for (const p of this.players) {
        if (p.score >= DUEL_TARGET_FRAGS) {
          const winnerIndex = p.cfg.index as 0 | 1;
          const opponent = this.players[winnerIndex === 0 ? 1 : 0];
          this.finishMatch({
            mode: "duel",
            levelId: this.levelId,
            winnerIndex,
            winnerScore: p.score,
            loserScore: opponent?.score ?? 0,
          });
          return;
        }
      }
    }
  }

  private finishMatch(result: GameResult): void {
    if (this.matchEnded) return;
    this.matchEnded = true;
    // Stop the ticker and detach inputs so the menu can take over.
    this.stop();
    // Let the next paint flush before signalling — keeps the final frame
    // visible briefly even after we tear down.
    queueMicrotask(() => this.config.onGameEnd?.(result));
  }

  private updateMinimap(dt: number) {
    const players = this.players.map((p) => {
      const pos = p.ship ? p.ship.body.translation() : p.cfg.spawn;
      return { x: pos.x, y: pos.y, color: p.cfg.color, alive: p.alive };
    });
    const powerups = this.powerups["active"].map((pu) => ({
      x: pu.x, y: pu.y,
      color: this.powerupColor(pu.type),
    }));
    const mines = this.mines.map((m) => ({
      x: m.x, y: m.y,
      ownerColor: this.players[m.ownerIndex]?.cfg.color ?? 0xffffff,
    }));
    // Pass each player's next-checkpoint index so the minimap can
    // highlight the gate they're racing toward.
    const nextCps = this.racing
      ? this.players.map((p) =>
          p.alive ? this.racing!.nextFor(p.cfg.index) : null,
        )
      : undefined;
    this.minimap.update(dt, players, powerups, mines, nextCps);
  }

  private powerupColor(type: string): number {
    return POWERUP_DEFS[type as PowerUpType]?.color ?? 0xffffff;
  }

  private tailScratch = { x: 0, y: 0 };

  private fixedUpdate() {
    for (const p of this.players) {
      if (!p.alive) {
        p.respawnTimer -= PHYS_DT;
        if (p.respawnTimer <= 0) this.respawn(p);
        continue;
      }
      const ship = p.ship!;
      p.prev = ship.snapshot();
      // Keyboard + gamepad + (P1 only) touch — any device can drive the
      // ship. Input is fully ignored while the pre-match countdown is
      // running so players can't drift off the start line during "3-2-1".
      const liveInput = this.countdownRemaining > 0
        ? { thrust: false, rotateLeft: false, rotateRight: false, fire: false, special: false }
        : (() => {
            const combo = orInputs(
              this.input.read(p.cfg.binding),
              this.gamepads.read(p.cfg.gamepad),
            );
            return p.cfg.index === 0 ? orInputs(combo, this.touch.read()) : combo;
          })();
      const input = liveInput;
      ship.applyInput(input);

      p.fireCooldown = Math.max(0, p.fireCooldown - PHYS_DT);
      if (input.fire && p.fireCooldown <= 0) {
        this.fireBullet(p);
        const cd = p.activePowerUps.has("rapid")
          ? SETTINGS.fireCooldown * 0.5
          : SETTINGS.fireCooldown;
        p.fireCooldown = cd;
      }

      // ---- power-ups ----
      // Decay active timers.
      for (const [type, t] of p.activePowerUps) {
        const t2 = t - PHYS_DT;
        if (t2 <= 0) p.activePowerUps.delete(type);
        else p.activePowerUps.set(type, t2);
      }
      // Pickup test against any nearby power-up.
      {
        const pos = ship.body.translation();
        const picked = this.powerups.pickupAt(pos.x, pos.y);
        if (picked) {
          const def = POWERUP_DEFS[picked];
          if (def.ammo) {
            // Single-use: add one charge to the ammo map.
            p.ammo.set(picked, (p.ammo.get(picked) ?? 0) + 1);
          } else {
            // Passive timer: (re-)set duration in the active power-ups map.
            p.activePowerUps.set(picked, def.durationSec);
          }
          // Much bigger feedback burst than before — the user couldn't
          // tell pickups were happening at the old volume. ~3× the glow
          // radius and 28 particles (was 10) with longer lifetimes so
          // the moment reads even mid-thrust.
          this.glow.burst(pos.x, pos.y, 3.2, def.color, 0.55);
          this.particles.explode(pos.x, pos.y, 28, def.color, {
            speedMin: 8, speedMax: 34, lifeMin: 0.3, lifeMax: 0.75,
            sizeMin: 1.4, sizeMax: 2.4,
          });
          playSpawn();
        }
      }
      // Shield visual follows the active power-up state.
      ship.setShieldActive(p.activePowerUps.has("shield"));

      // Generic powerup aura — coloured ring around the ship for any
      // non-shield/non-cloak passive that's currently active. Iterating
      // the Map preserves insertion order, so the latest pickup wins
      // when multiple are stacked.
      let auraOn = false;
      let auraColor = 0xffffff;
      for (const [type] of p.activePowerUps) {
        if (type === "shield" || type === "cloak") continue;
        const def2 = POWERUP_DEFS[type];
        if (def2 && !def2.ammo) {
          auraOn = true;
          auraColor = def2.color;
        }
      }
      ship.setPowerUpAura(auraOn, auraColor);

      // Cloak — ship goes mostly transparent while active.
      ship.view.alpha = p.activePowerUps.has("cloak") ? 0.25 : 1.0;

      // Anti-grav — disable gravity for this ship while active.
      const wantsGrav = p.activePowerUps.has("antigrav") ? 0 : 1;
      if (ship.body.gravityScale() !== wantsGrav) {
        ship.body.setGravityScale(wantsGrav, true);
      }

      // Mine drop — rising edge of the special key drops one mine behind
      // the ship from the player's ammo pool.
      const specialNow = input.special;
      if (specialNow && !p.specialPrev && (p.ammo.get("mine") ?? 0) > 0) {
        const a = ship.body.rotation();
        const sx = ship.body.translation().x - Math.cos(a) * (SHIP_RADIUS + 0.9);
        const sy = ship.body.translation().y - Math.sin(a) * (SHIP_RADIUS + 0.9);
        this.mines.push(new MineEntity(this.worldLayer, sx, sy, p.cfg.index));
        p.ammo.set("mine", (p.ammo.get("mine") ?? 0) - 1);
        if ((p.ammo.get("mine") ?? 0) <= 0) p.ammo.delete("mine");
        playWallHit(); // re-use the doof sound as a placement thunk
      }
      p.specialPrev = specialNow;

      // Water — if the ship's centre is inside any water polygon, drag it
      // down: multiply velocity by 0.93 per tick (≈ 60% slowdown per sec).
      if (this.waterZones.length > 0) {
        const pos = ship.body.translation();
        let inWater = false;
        for (const poly of this.waterZones) {
          if (pointInPolygon(pos, poly)) { inWater = true; break; }
        }
        if (inWater) {
          const v = ship.body.linvel();
          ship.body.setLinvel({ x: v.x * 0.93, y: v.y * 0.93 }, true);
          // Bubble particles trailing behind the ship — wide spread.
          if (Math.random() < 0.5) {
            this.particles.thrust(
              pos.x + (Math.random() - 0.5) * 1.5,
              pos.y + (Math.random() - 0.5) * 0.5,
              (Math.random() - 0.5) * 4, -3 - Math.random() * 2,
              0xa0d8ff,
            );
          }
        }
      }

      // Speed boost — doubles the base thrust by adding a 1.0× impulse
      // on top of the ship's own thrust (so effective thrust = 2× while
      // the boost is active).
      if (ship.thrustOn && p.activePowerUps.has("speed")) {
        const a = ship.body.rotation();
        const fx = Math.cos(a) * SETTINGS.shipThrust * 1.0 * PHYS_DT;
        const fy = Math.sin(a) * SETTINGS.shipThrust * 1.0 * PHYS_DT;
        const mass = ship.body.mass();
        ship.body.applyImpulse({ x: fx * mass, y: fy * mass }, true);
      }

      // Thrust audio follows ship.thrustOn — call every tick (the function
      // ramps the gain smoothly so repeated calls are harmless).
      setThrust(p.cfg.index, ship.thrustOn);

      // Thrust eld-svans — streak particles that fade from white-hot to dark
      // ember along their life, oriented along their velocity. Length is
      // controlled by SETTINGS.trailLife + trailDrag so the user can tune it.
      if (ship.thrustOn) {
        ship.tailPosition(this.tailScratch);
        const v = ship.body.linvel();
        const a = ship.body.rotation();
        const exitSpeed = 9;
        const exitX = -Math.cos(a) * exitSpeed;
        const exitY = -Math.sin(a) * exitSpeed;
        const emits = Math.max(1, Math.floor(SETTINGS.trailEmitsPerTick));
        for (let i = 0; i < emits; i++) {
          this.particles.thrustStreak(
            this.tailScratch.x, this.tailScratch.y,
            v.x + exitX, v.y + exitY,
            0xfff8c8,
            0x6a1410,
            {
              life: SETTINGS.trailLife,
              size: SETTINGS.trailSize,
              drag: Math.pow(SETTINGS.trailDrag, 60),
            },
          );
        }
      }
    }

    for (const b of this.bullets) {
      b.ttl -= PHYS_DT;
      b.prev = b.snapshot();
      // Optional bullet trail — short streak particle behind each bullet.
      if (SETTINGS.bulletTrail > 0.5) {
        // Subtle trail — short life and small particles so the trail
        // hints at the bullet's path without becoming a comet.
        const v = b.body.linvel();
        const p = b.body.translation();
        this.particles.thrustStreak(
          p.x, p.y,
          v.x * 0.2, v.y * 0.2,
          0xffe0a0,
          0x602010,
          { life: 0.12, size: 0.32, drag: Math.pow(0.95, 60) },
        );
      }
    }

    // Homing missiles — snapshot the pre-step position so render
    // interpolation has a starting point, then apply steering. The actual
    // integration happens inside physics.step() right after this loop.
    for (const m of this.missiles) {
      m.snapshotPrev();
      m.step(PHYS_DT);
      const pos = m.body.translation();
      const vel = m.body.linvel();
      this.particles.thrustStreak(
        pos.x, pos.y,
        vel.x * 0.25, vel.y * 0.25,
        0xff8030,
        0x401004,
        { life: 0.45, size: 1.2, drag: Math.pow(0.92, 60) },
      );
    }

    this.physics.step();

    this.physics.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      this.handleCollision(h1, h2);
    });

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (b.alive && b.ttl <= 0) b.alive = false;
      if (!b.alive) {
        this.bulletByHandle.delete(b.collider.handle);
        b.dispose(this.physics);
        this.bullets.splice(i, 1);
      }
    }

    // Missile lifetime + cleanup. `step()` marked the missile dead when its
    // TTL expired; this loop reaps the corpses.
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      if (!m.alive) {
        this.bulletByHandle.delete(m.collider.handle);
        m.dispose(this.physics);
        this.missiles.splice(i, 1);
      }
    }

    this.glow.update(PHYS_DT);
    this.particles.update(PHYS_DT);
    this.powerups.update(PHYS_DT);
    this.decals.update(PHYS_DT);
    this.wreckage.update(PHYS_DT, SETTINGS.gravity);
    this.updateMines();
    if (this.config.mode === "wave") this.updateBots();

    // Racing — visual update + checkpoint progress.
    if (this.racing) {
      const playerSummary = this.players.map((p) => ({
        index: p.cfg.index,
        color: p.cfg.color,
        alive: p.alive,
      }));
      this.racing.update(PHYS_DT, playerSummary);

      const positions = this.players.map((p) =>
        p.alive && p.ship
          ? { index: p.cfg.index, x: p.ship.body.translation().x,
              y: p.ship.body.translation().y, color: p.cfg.color, alive: true }
          : null,
      );
      const progress = this.racing.checkProgress(positions);
      // Per-gate FX: each passed checkpoint blows up in the racer's
      // colour with a chime so the player feels the snap of clearing it.
      for (const hit of progress.hits) {
        // Capture split times for P1 (replay/ghost-race data).
        if (hit.playerIndex === 0) {
          this.gatePassTimes.push(round3(this.matchElapsed));
        }
        this.particles.explode(hit.cpX, hit.cpY, 24, hit.color, {
          speedMin: 6, speedMax: 24, lifeMin: 0.25, lifeMax: 0.5,
          sizeMin: 1.0, sizeMax: 1.8,
        });
        this.particles.explode(hit.cpX, hit.cpY, 14, 0xffd166, {
          speedMin: 4, speedMax: 18, lifeMin: 0.2, lifeMax: 0.4,
          sizeMin: 0.9, sizeMax: 1.6,
        });
        this.glow.burst(hit.cpX, hit.cpY, 2.4, 0xffd166, 0.4);
        this.glow.burst(hit.cpX, hit.cpY, 1.6, hit.color, 0.3);
        this.wreckage.spawn(hit.cpX, hit.cpY, 0xffd166, 6);
        this.cameraShake.amp = Math.max(this.cameraShake.amp, 0.06);
        playGateChime();
      }
      if (progress.lapped >= 0) {
        const p = this.players[progress.lapped];
        // Lap flash on the lapper's position — louder fanfare on top of
        // the gate chime since the lap is a bigger moment.
        if (p.ship) {
          const tp = p.ship.body.translation();
          this.glow.burst(tp.x, tp.y, 2.0, p.cfg.color, 0.35);
          this.particles.explode(tp.x, tp.y, 14, p.cfg.color, {
            speedMin: 5, speedMax: 18, lifeMin: 0.3, lifeMax: 0.55,
            sizeMin: 1.2, sizeMax: 2.0,
          });
        }
        playSpawn();
      }
    }

    // Decay camera shake.
    if (this.cameraShake.amp > 0) {
      this.cameraShake.amp = Math.max(0, this.cameraShake.amp - this.cameraShake.decay * PHYS_DT);
    }
  }

  private fireBullet(p: Player) {
    const ship = p.ship!;
    const pos = ship.body.translation();
    const v = ship.body.linvel();
    const a = ship.body.rotation();

    // Homing missile power-up — consumes one charge per shot and overrides
    // the normal bullet path. Triple still works for follow-up shots once
    // the homing rounds are spent.
    const homingLeft = p.ammo.get("homing") ?? 0;
    if (homingLeft > 0) {
      const offset = SHIP_RADIUS + HomingMissile.radius() + 0.05;
      const fwdX = Math.cos(a);
      const fwdY = Math.sin(a);
      const missile = new HomingMissile(this.physics, this.app.renderer, this.worldLayer, {
        x: pos.x + fwdX * offset,
        y: pos.y + fwdY * offset,
        vx: v.x + fwdX * HomingMissile.speed(),
        vy: v.y + fwdY * HomingMissile.speed(),
        ownerIndex: p.cfg.index,
        color: p.cfg.color,
        targets: {
          candidates: () => this.players
            .filter((pl) => pl.alive && pl.ship)
            .map((pl) => {
              const tr = pl.ship!.body.translation();
              return { index: pl.cfg.index, x: tr.x, y: tr.y };
            }),
        },
      });
      this.missiles.push(missile);
      this.bulletByHandle.set(missile.collider.handle, missile);
      if (homingLeft - 1 <= 0) p.ammo.delete("homing");
      else p.ammo.set("homing", homingLeft - 1);
      // Bigger, warmer muzzle than a bullet so launch reads as a missile.
      this.glow.burst(pos.x + fwdX * offset, pos.y + fwdY * offset,
        0.45, 0xff8030, 0.12);
      this.particles.explode(pos.x + fwdX * offset, pos.y + fwdY * offset,
        4, 0xff8030, {
          speedMin: 4, speedMax: 14, lifeMin: 0.15, lifeMax: 0.3,
          sizeMin: 1.0, sizeMax: 1.6,
        });
      playShoot();
      return;
    }

    const offset = SHIP_RADIUS + Bullet.radius() + 0.05;

    // Triple shot — three bullets almost parallel (±2.5°). Tighter spread
    // so the rounds stay close together instead of fanning out into a cone.
    const triple = p.activePowerUps.has("triple");
    const angles = triple ? [-0.045, 0, 0.045] : [0];
    for (const offsetA of angles) {
      const fireA = a + offsetA;
      const fwdX = Math.cos(fireA);
      const fwdY = Math.sin(fireA);
      const bullet = new Bullet(this.physics, this.app.renderer, this.worldLayer, {
        x: pos.x + fwdX * offset,
        y: pos.y + fwdY * offset,
        vx: v.x + fwdX * Bullet.spawnSpeed(),
        vy: v.y + fwdY * Bullet.spawnSpeed(),
        ownerIndex: p.cfg.index,
        color: p.cfg.color,
      });
      this.bullets.push(bullet);
      this.bulletByHandle.set(bullet.collider.handle, bullet);
    }

    // Muzzle flash (subtle).
    this.glow.burst(
      pos.x + Math.cos(a) * offset, pos.y + Math.sin(a) * offset,
      0.15, 0xffd66e, 0.04,
    );
    playShoot();
  }

  private handleCollision(h1: number, h2: number) {
    const b1 = this.bulletByHandle.get(h1);
    const b2 = this.bulletByHandle.get(h2);
    const bullet = b1 ?? b2;
    if (!bullet || !bullet.alive) return;
    const otherHandle = bullet === b1 ? h2 : h1;

    const otherBullet = this.bulletByHandle.get(otherHandle);
    if (otherBullet && otherBullet.alive) {
      bullet.alive = false;
      otherBullet.alive = false;
      const p = bullet.body.translation();
      this.particles.explode(p.x, p.y, 4, 0xffd66e);
      this.glow.burst(p.x, p.y, 0.3, 0xffe199, 0.06);
      return;
    }

    // Bullet vs bot — one-shot kill in wave mode, scores a point for the
    // shooter regardless of which player fired (in practice always P1).
    const hitBot = this.botHandleToBot.get(otherHandle);
    if (hitBot && hitBot.alive) {
      bullet.alive = false;
      const bp = hitBot.ship.body.translation();
      this.particles.explode(bp.x, bp.y, 12, 0xa86bff, {
        speedMin: 6, speedMax: 22, lifeMin: 0.2, lifeMax: 0.4,
        sizeMin: 1.0, sizeMax: 1.8,
      });
      this.particles.explode(bp.x, bp.y, 8, 0xffd66e, {
        speedMin: 4, speedMax: 14, lifeMin: 0.18, lifeMax: 0.32,
        sizeMin: 1.0, sizeMax: 1.6,
      });
      this.glow.burst(bp.x, bp.y, 1.6, 0xa86bff, 0.22);
      this.wreckage.spawn(bp.x, bp.y, 0xa86bff, 5);
      this.cameraShake.amp = Math.max(this.cameraShake.amp, 0.05);
      playExplosion();
      hitBot.alive = false; // updateBots() will dispose on the next step
      this.waveScore += 1;
      return;
    }

    const otherPlayerIndex = this.shipHandleToPlayer.get(otherHandle);
    if (otherPlayerIndex !== undefined) {
      if (otherPlayerIndex === bullet.ownerIndex) return;
      const victim = this.players[otherPlayerIndex];
      // Shield power-up absorbs the hit — bullet dies, no damage, no death.
      if (victim.activePowerUps.has("shield")) {
        bullet.alive = false;
        const vp = victim.ship!.body.translation();
        this.glow.burst(vp.x, vp.y, 1.4, 0x6cd0ff, 0.18);
        this.particles.explode(vp.x, vp.y, 6, 0x6cd0ff, {
          speedMin: 6, speedMax: 22, lifeMin: 0.15, lifeMax: 0.3,
          sizeMin: 1.0, sizeMax: 1.6,
        });
        return;
      }
      // Otherwise the bullet does damage. If HP drops to zero → kill.
      bullet.alive = false;
      victim.health -= SETTINGS.bulletDamage;
      if (victim.health <= 0) {
        this.killPlayer(victim, bullet.ownerIndex);
      } else {
        // Hit-but-not-killed feedback: a small glow + a few sparks in the
        // bullet's colour, plus a brief screen shake.
        const vp = victim.ship!.body.translation();
        this.glow.burst(vp.x, vp.y, 0.9, bullet.color, 0.12);
        this.particles.explode(vp.x, vp.y, 4, bullet.color, {
          speedMin: 6, speedMax: 18, lifeMin: 0.12, lifeMax: 0.22,
          sizeMin: 0.9, sizeMax: 1.4,
        });
        this.cameraShake.amp = Math.max(this.cameraShake.amp, 0.04);
        playWallHit();
      }
      return;
    }

    // Bullet vs wall — sparks + a persistent scorch decal.
    const p = bullet.body.translation();
    this.particles.explode(p.x, p.y, 2, bullet.color);
    this.glow.burst(p.x, p.y, 0.1, 0xffd66e, 0.05);
    this.decals.spawn(p.x, p.y, bullet.color);
    playWallHit();
    bullet.alive = false;
  }

  private killPlayer(victim: Player, killerIndex: number) {
    if (!victim.alive || !victim.ship) return;
    const pos = victim.ship.body.translation();
    const x = pos.x, y = pos.y;

    victim.alive = false;
    victim.respawnTimer = SETTINGS.respawnDelay;

    this.shipHandleToPlayer.delete(victim.ship.collider.handle);
    victim.ship.dispose(this.physics);
    victim.ship = null;
    victim.activePowerUps.clear();
    victim.ammo.clear();
    killThrust(victim.cfg.index);
    playExplosion();

    if (killerIndex !== victim.cfg.index) {
      this.players[killerIndex].score += KILL_SCORE;
    }

    // Local contained pop — particle counts + glow radius come from SETTINGS
    // so they're tunable from the settings panel.
    const count = Math.max(0, Math.round(SETTINGS.killParticles));
    this.particles.explode(x, y, count, victim.cfg.color, {
      speedMin: 8, speedMax: 28, lifeMin: 0.18, lifeMax: 0.32,
      sizeMin: 1.2, sizeMax: 2.0,
    });
    this.particles.explode(x, y, Math.round(count / 2), 0xffd66e, {
      speedMin: 4, speedMax: 14, lifeMin: 0.14, lifeMax: 0.22,
      sizeMin: 1.0, sizeMax: 1.6,
    });
    this.glow.burst(x, y, SETTINGS.killGlowRadius, 0xffffff, 0.08);
    this.glow.burst(x, y, SETTINGS.killGlowRadius * 0.7, victim.cfg.color, 0.16);
    this.wreckage.spawn(x, y, victim.cfg.color, 6);
    this.cameraShake.amp = Math.max(this.cameraShake.amp, SETTINGS.killShake);
  }

  /** Step + collide all active mines against opposing ships. */
  /** Wave mode: step each bot's AI + spawn new bots up to the cap. Called
   *  from fixedUpdate so spawning happens at a deterministic rate. */
  private updateBots() {
    // 1) Step each bot. The Ship.applyInput call also drives the thrust
    //    audio loop — bots get the same engine sound as the player.
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const input = bot.computeInput();
      bot.ship.applyInput(input);
      // Snapshot prev state so the renderer can interpolate this frame.
      bot.ship.snapshot();
    }

    // 2) Reap dead bots — they were marked dead by handleCollision.
    for (let i = this.bots.length - 1; i >= 0; i--) {
      const b = this.bots[i];
      if (!b.alive) {
        this.botHandleToBot.delete(b.ship.collider.handle);
        b.dispose(this.physics);
        this.bots.splice(i, 1);
      }
    }

    // 3) Spawn new bots up to a soft cap. Cap scales gently with the
    //    player's score so the action ramps up.
    const cap = Math.min(4, 1 + Math.floor(this.waveScore / 4));
    if (this.bots.length < cap) {
      this.waveSpawnTimer -= PHYS_DT;
      if (this.waveSpawnTimer <= 0) {
        this.spawnBot();
        this.waveSpawnTimer = 2.5 + Math.random() * 1.5;
      }
    }
  }

  private spawnBot(): void {
    const level = this.cachedLevelForBots();
    if (!level) return;
    // Pick a spawn point well inside the cave + a comfortable distance
    // from the player so they don't appear on top of P1. We also enforce
    // a 2m gap from every wall + obstacle edge so the bot's 1m collider
    // doesn't end up clipped through the terrain.
    const p1 = this.players[0]?.ship?.body.translation();
    const margin = 6;
    const wallClearance = 2.0;
    let spawn: Point | null = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const b = level.bounds;
      const x = b.minX + margin + Math.random() * (b.maxX - b.minX - margin * 2);
      const y = b.minY + margin + Math.random() * (b.maxY - b.minY - margin * 2);
      const p = { x, y };
      // Inside the cave boundary?
      if (!pointInPolygon(p, level.boundary)) continue;
      // Not inside any obstacle?
      let blocked = false;
      for (const obs of level.obstacles) {
        if (pointInPolygon(p, obs)) { blocked = true; break; }
      }
      if (blocked) continue;
      // Far enough from every polygon edge that the collider clears?
      if (minDistanceToPolygonEdges(p, level.boundary) < wallClearance) continue;
      let nearObstacle = false;
      for (const obs of level.obstacles) {
        if (minDistanceToPolygonEdges(p, obs) < wallClearance) {
          nearObstacle = true;
          break;
        }
      }
      if (nearObstacle) continue;
      // Not on top of the player.
      if (p1) {
        const dx = p.x - p1.x;
        const dy = p.y - p1.y;
        if (Math.hypot(dx, dy) < 18) continue;
      }
      spawn = p;
      break;
    }
    if (!spawn) return;
    const bot = new Bot(this.physics, this.app.renderer, this.worldLayer, level, spawn);
    this.bots.push(bot);
    this.botHandleToBot.set(bot.ship.collider.handle, bot);
    // Small puff on spawn so the player notices the new threat.
    this.glow.burst(spawn.x, spawn.y, 1.0, 0xa86bff, 0.18);
    this.particles.explode(spawn.x, spawn.y, 6, 0xa86bff, {
      speedMin: 4, speedMax: 14, lifeMin: 0.18, lifeMax: 0.32,
      sizeMin: 1.0, sizeMax: 1.6,
    });
  }

  /** Cache + return the active level (Game keeps no direct reference but
   *  the bounds + polygons can be reconstructed from minimap state — we
   *  store the bare Level for bot use to avoid plumbing it through every
   *  call site). */
  private _cachedLevel: Level | null = null;
  private cachedLevelForBots(): Level | null { return this._cachedLevel; }

  private updateMines() {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.update(PHYS_DT);
      if (!m.alive) {
        m.dispose();
        this.mines.splice(i, 1);
        continue;
      }
      // Trigger check: any enemy ship inside trigger radius?
      let detonated = false;
      for (const p of this.players) {
        if (!p.alive || !p.ship) continue;
        if (p.cfg.index === m.ownerIndex) continue; // own mine doesn't trigger
        const t = p.ship.body.translation();
        const dx = t.x - m.x;
        const dy = t.y - m.y;
        if (dx * dx + dy * dy < MineEntity.TRIGGER_RADIUS * MineEntity.TRIGGER_RADIUS) {
          detonated = true;
          break;
        }
      }
      if (detonated) this.detonateMine(m, i);
    }
  }

  /** Run the explosion: damage everyone in blast radius, FX, sound. */
  private detonateMine(m: MineEntity, index: number) {
    // Apply blast damage to every ship in range, regardless of ownership.
    for (const p of this.players) {
      if (!p.alive || !p.ship) continue;
      const t = p.ship.body.translation();
      const dx = t.x - m.x;
      const dy = t.y - m.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < MineEntity.BLAST_RADIUS * MineEntity.BLAST_RADIUS) {
        if (p.activePowerUps.has("shield")) {
          // Shield absorbs the blast.
          continue;
        }
        // Closer = more damage (linear falloff).
        const d = Math.sqrt(d2);
        const falloff = 1 - d / MineEntity.BLAST_RADIUS;
        const dmg = MineEntity.DAMAGE * falloff;
        p.health -= dmg;
        if (p.health <= 0) {
          this.killPlayer(p, m.ownerIndex);
        }
      }
    }
    // Big visual + sound.
    this.glow.burst(m.x, m.y, 3.2, 0xffd0a0, 0.18);
    this.glow.burst(m.x, m.y, 2.0, 0xff5020, 0.25);
    this.particles.explode(m.x, m.y, 30, 0xff8030);
    this.particles.explode(m.x, m.y, 14, 0xffffff);
    this.cameraShake.amp = Math.max(this.cameraShake.amp, 0.18);
    playExplosion(1.2);
    m.dispose();
    this.mines.splice(index, 1);
  }

  private respawn(p: Player) {
    const ship = new Ship(this.physics, this.app.renderer, this.worldLayer, {
      x: p.cfg.spawn.x, y: p.cfg.spawn.y, color: p.cfg.color, angle: -Math.PI / 2,
    });
    p.ship = ship;
    p.prev = ship.snapshot();
    p.alive = true;
    p.health = SETTINGS.shipMaxHealth;
    this.shipHandleToPlayer.set(ship.collider.handle, p.cfg.index);
    // Spawn flash (subtle).
    this.glow.burst(p.cfg.spawn.x, p.cfg.spawn.y, 0.4, p.cfg.color, 0.1);
    playSpawn();
  }

  private render(alpha: number, dt: number) {
    const targets: Array<{ x: number; y: number }> = [];
    for (const p of this.players) {
      if (p.alive && p.ship) {
        p.ship.sync(alpha, p.prev);
        targets.push(p.ship.snapshot());
      } else {
        targets.push(p.cfg.spawn);
      }
    }
    for (const b of this.bullets) b.sync(alpha);
    for (const m of this.missiles) m.sync(alpha);

    // Decide whether to render split-screen this frame. We split when both
    // players are alive AND further apart than the threshold.
    const p1 = this.players[0];
    const p2 = this.players[1];
    let useSplit = false;
    if (
      SETTINGS.splitScreenAuto > 0.5 &&
      p1?.alive && p1.ship && p2?.alive && p2.ship
    ) {
      const a = p1.ship.body.translation();
      const b = p2.ship.body.translation();
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      // Hysteresis: stay split until they're well below the threshold again.
      const dist = Math.sqrt(dx * dx + dy * dy);
      const wasSplit = this.splitscreen.isActive();
      const enter = SETTINGS.splitScreenThreshold;
      const exit = SETTINGS.splitScreenThreshold * 0.75;
      useSplit = wasSplit ? dist > exit : dist > enter;
    }

    const canvas = this.app.canvas;

    if (useSplit) {
      this.splitscreen.setActive(true);
      this.worldRoot.renderable = false;
      this.renderSplit(p1!, p2!);
    } else {
      this.splitscreen.setActive(false);
      this.worldRoot.renderable = true;
      // Dynamic camera — follows the players, auto-zooms.
      this.camera.follow(targets);
      this.camera.apply();
    }

    // Parallax star field — sits behind the world and drifts slower than
    // the camera. Resize-aware so it tracks the actual viewport.
    this.starfield.update(
      this.camera.x, this.camera.y, this.camera.zoom,
      canvas.clientWidth, canvas.clientHeight,
    );

    // Apply camera shake to worldRoot (outside camera transform so screen-space).
    if (this.cameraShake.amp > 0) {
      const a = this.cameraShake.amp;
      this.worldRoot.x = (Math.random() * 2 - 1) * a * 12;
      this.worldRoot.y = (Math.random() * 2 - 1) * a * 12;
    } else {
      this.worldRoot.x = 0;
      this.worldRoot.y = 0;
    }
    void dt;
  }

  /** Renders the world twice — once per player — to the splitscreen RTs.
   *  Each half uses a personal camera centred on its player. */
  private renderSplit(p1: Player, p2: Player) {
    const half = this.splitscreen.halfSize();
    const renderer = this.app.renderer;

    const applyCameraFor = (ship: { x: number; y: number }) => {
      const zoom = 22 * SETTINGS.cameraZoom;
      this.worldLayer.scale.set(zoom, zoom);
      this.worldLayer.x = half.w / 2 - ship.x * zoom;
      this.worldLayer.y = half.h / 2 - ship.y * zoom;
      // Apply shake on worldRoot every render.
      const amp = this.cameraShake.amp;
      this.worldRoot.x = (Math.random() * 2 - 1) * amp * 12;
      this.worldRoot.y = (Math.random() * 2 - 1) * amp * 12;
    };

    // Temporarily make the world renderable for manual render calls; we'll
    // hide it again after so the stage's normal render pass doesn't draw it.
    this.worldRoot.renderable = true;

    this.splitscreen.render(
      renderer, this.worldRoot,
      () => applyCameraFor(p1.ship!.body.translation()),
      () => applyCameraFor(p2.ship!.body.translation()),
    );

    this.worldRoot.renderable = false;
  }
}
