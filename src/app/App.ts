// App — top-level orchestrator. Manages the user-visible scene:
//
//   loading  →  menu  ⇄  game  →  postgame  →  menu
//
// Each scene is an HTML overlay that lives in #screens. The game scene is
// special — it creates a Pixi canvas inside #app and tears it down on exit.

import RAPIER from "@dimforge/rapier2d-compat";
import { Game } from "../game/Game";
import type { GameResult, GameMode } from "../game/Game";
import { LEVELS } from "../level/levels";
import {
  getHighScores, qualifies, addScore, formatTime, type HighScore,
} from "./highscores";
import {
  unlockAudio, startMenuMusic, stopMenuMusic, startVolumeWatcher,
  isMusicEnabled, setMusicEnabled,
} from "../audio/Audio";

type Scene = "loading" | "menu" | "game" | "postgame";

export class App {
  private screens: HTMLElement;
  private gameMount: HTMLElement;
  private currentGame: Game | null = null;
  private currentScene: Scene = "loading";

  /** Last-used selections, persisted across sessions for convenience. */
  private selectedMode: GameMode = "duel";
  private selectedLevelId = "metarola";

  constructor() {
    this.screens = ensureElement("screens");
    this.gameMount = ensureElement("app");

    // Restore the most recent selections if available.
    const saved = localStorage.getItem("tr.menu.selection");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { mode?: GameMode; levelId?: string };
        if (parsed.mode === "time-trial" || parsed.mode === "duel" || parsed.mode === "race") this.selectedMode = parsed.mode;
        if (parsed.levelId && LEVELS.some((l) => l.id === parsed.levelId)) {
          this.selectedLevelId = parsed.levelId;
        }
      } catch { /* ignore */ }
    }
  }

  async start() {
    this.showLoading();
    // Kick off Rapier WASM and the music buffer rendering in parallel —
    // we don't await them here so the loading screen can show "press any
    // key" instantly. Browsers won't let us *hear* music until the user
    // interacts, but we can already render the audio buffer offline.
    const rapierReady = RAPIER.init();
    document.body.classList.add("ready");
    await this.waitForUserGesture();
    // Gesture unlocked the audio context — fire up volume + music now,
    // so the music plays over the rest of the loading screen.
    unlockAudio();
    startVolumeWatcher();
    void startMenuMusic();
    // Hold the loading screen for at least 1.6s after the gesture so the
    // music gets to actually play on the splash even when Rapier is
    // cached and would otherwise be ready in milliseconds.
    const minDwellMs = 1600;
    const dwellStart = performance.now();
    await rapierReady;
    const elapsed = performance.now() - dwellStart;
    if (elapsed < minDwellMs) {
      await new Promise((r) => setTimeout(r, minDwellMs - elapsed));
    }
    this.hideLoading();
    this.showMenu();
  }

  private waitForUserGesture(): Promise<void> {
    return new Promise((resolve) => {
      const onAny = (e: Event) => {
        // Ignore modifier-only keypresses so things like alt-tab don't dismiss.
        if (e instanceof KeyboardEvent) {
          if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
        }
        window.removeEventListener("keydown", onAny);
        window.removeEventListener("pointerdown", onAny);
        resolve();
      };
      window.addEventListener("keydown", onAny);
      window.addEventListener("pointerdown", onAny);
    });
  }

  // ── scene transitions ───────────────────────────────────────────────────

  private setScene(scene: Scene): void {
    this.currentScene = scene;
    this.screens.dataset.scene = scene;
  }

  private showLoading(): void {
    // The loading screen markup lives in index.html (animated rocket, stars,
    // CRT scanlines) and is hidden once <body> gets the .loaded class. We
    // only need to make sure no menu/postgame overlay is on top.
    this.setScene("loading");
    this.screens.innerHTML = "";
  }

  private hideLoading(): void {
    // Fade the index.html loading screen and remove it after the transition.
    document.body.classList.add("loaded");
    setTimeout(() => document.getElementById("loading-screen")?.remove(), 800);
  }

  private showMenu(): void {
    this.setScene("menu");
    this.screens.innerHTML = renderMenu(this);
    this.bindMenu();
    // Resume the menu loop on return from postgame / Esc-out-of-match.
    void startMenuMusic();
  }

  private startGame(): void {
    this.persistSelection();
    // Silence the menu loop — the game's own SFX takes over from here.
    stopMenuMusic();
    this.setScene("game");
    this.screens.innerHTML = "";
    this.currentGame = new Game(this.gameMount, {
      mode: this.selectedMode,
      levelId: this.selectedLevelId,
      onGameEnd: (result) => this.showPostgame(result),
    });
    void this.currentGame.init().then(() => this.currentGame?.start());
    // Esc returns to the menu mid-match.
    window.addEventListener("keydown", this.onGameKey);
  }

  private onGameKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.currentScene === "game") {
      window.removeEventListener("keydown", this.onGameKey);
      this.currentGame?.dispose();
      this.currentGame = null;
      this.showMenu();
    }
  };

  private showPostgame(result: GameResult): void {
    // Tear down the game's DOM before drawing the postgame overlay.
    window.removeEventListener("keydown", this.onGameKey);
    this.currentGame?.dispose();
    this.currentGame = null;
    this.setScene("postgame");
    this.screens.innerHTML = renderPostgame(result);
    this.bindPostgame(result);
  }

  // ── event wiring ────────────────────────────────────────────────────────

  private bindMenu(): void {
    this.screens.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedMode = btn.dataset.mode as GameMode;
        this.showMenu(); // re-render so highscores match the new mode
      });
    });
    this.screens.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedLevelId = btn.dataset.level!;
        this.showMenu();
      });
    });
    this.screens.querySelector<HTMLButtonElement>("#start-match")
      ?.addEventListener("click", () => this.startGame());
    this.screens.querySelector<HTMLAnchorElement>("#open-editor")
      ?.addEventListener("click", (e) => {
        // Let the link navigate normally, but persist current selection first.
        this.persistSelection();
        void e; // no-op; default action proceeds
      });
    this.screens.querySelector<HTMLButtonElement>("#music-toggle")
      ?.addEventListener("click", () => {
        const next = !isMusicEnabled();
        setMusicEnabled(next);
        if (next) void startMenuMusic();
        // Re-render the menu so the button label updates.
        this.showMenu();
      });
  }

  private bindPostgame(result: GameResult): void {
    const root = this.screens;

    // Initials prompt — only present when the score qualifies.
    const form = root.querySelector<HTMLFormElement>("#initials-form");
    if (form) {
      const input = form.querySelector<HTMLInputElement>("input[name=initials]");
      input?.focus();
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const initials = (input?.value ?? "AAA").toUpperCase().slice(0, 3) || "AAA";
        const entry =
          result.mode === "time-trial" || result.mode === "race"
            ? { initials, value: result.timeSeconds }
            : { initials, value: result.winnerScore, loser: result.loserScore };
        addScore(result.levelId, result.mode, entry);
        // Re-render so the new score is highlighted in the list.
        root.innerHTML = renderPostgame(result, { recorded: initials });
        this.bindPostgame(result);
      });
    }

    root.querySelector<HTMLButtonElement>("#play-again")
      ?.addEventListener("click", () => this.startGame());
    root.querySelector<HTMLButtonElement>("#back-to-menu")
      ?.addEventListener("click", () => this.showMenu());
  }

  // ── persistence ─────────────────────────────────────────────────────────

  private persistSelection(): void {
    try {
      localStorage.setItem("tr.menu.selection", JSON.stringify({
        mode: this.selectedMode,
        levelId: this.selectedLevelId,
      }));
    } catch { /* ignore */ }
  }

  // Exposed for the menu renderer.
  get mode(): GameMode { return this.selectedMode; }
  get levelId(): string { return this.selectedLevelId; }
}

function ensureElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

// ── scene HTML ────────────────────────────────────────────────────────────

function renderMenu(app: App): string {
  const levels = LEVELS;
  const selectedLevel = levels.find((l) => l.id === app.levelId) ?? levels[0];
  const mode = app.mode;
  const board = getHighScores(selectedLevel.id, mode).slice(0, 5);

  const levelButtons = levels.map((entry) => {
    const active = entry.id === app.levelId;
    return `
      <button class="level-pick ${active ? "active" : ""}" data-level="${entry.id}">
        <span class="level-pick-name">${escapeHtml(entry.level.name)}</span>
        <span class="level-pick-sub">${entry.level.checkpoints?.length ?? 0} checkpoints</span>
      </button>
    `;
  }).join("");

  const modeButtons = `
    <button class="mode-pick ${mode === "time-trial" ? "active" : ""}" data-mode="time-trial">
      <strong>Time Trial</strong>
      <span>1 spelare • race mot klockan</span>
    </button>
    <button class="mode-pick ${mode === "race" ? "active" : ""}" data-mode="race">
      <strong>Race 2P</strong>
      <span>2 spelare • first to finish</span>
    </button>
    <button class="mode-pick ${mode === "duel" ? "active" : ""}" data-mode="duel">
      <strong>Duell</strong>
      <span>2 spelare • first to ${5} frags</span>
    </button>
  `;

  const scoresHtml = board.length
    ? board.map((s, i) => `
        <li>
          <span class="rank">${i + 1}.</span>
          <span class="initials">${escapeHtml(s.initials)}</span>
          <span class="value">${formatScoreValue(mode, s)}</span>
        </li>
      `).join("")
    : `<li class="empty">— inga rekord än —</li>`;

  return `
    <div class="screen menu-screen">
      <div class="menu-header">
        <h1>TurboRaketti</h1>
        <p class="tagline">Caves, rockets, glory.</p>
      </div>

      <div class="menu-body">
        <section>
          <h2>Läge</h2>
          <div class="mode-picks">${modeButtons}</div>
        </section>

        <section>
          <h2>Bana</h2>
          <div class="level-picks">${levelButtons}</div>
        </section>

        <section class="scores">
          <h2>Topp 5 — ${escapeHtml(selectedLevel.level.name)} • ${modeLabel(mode)}</h2>
          <ol class="scoreboard">${scoresHtml}</ol>
        </section>
      </div>

      <div class="menu-footer">
        <a id="open-editor" class="link-btn" href="${import.meta.env.BASE_URL}editor.html">Level editor →</a>
        <button id="music-toggle" class="link-btn" type="button" aria-pressed="${isMusicEnabled()}">
          ${isMusicEnabled() ? "♪ Music: ON" : "♪ Music: OFF"}
        </button>
        <button id="start-match" class="primary">Start</button>
      </div>
    </div>
  `;
}

function renderPostgame(
  result: GameResult,
  opts: { recorded?: string } = {},
): string {
  const level = LEVELS.find((l) => l.id === result.levelId);
  const levelName = level?.level.name ?? result.levelId;

  let title: string;
  let detail: string;
  let value: number;

  if (result.mode === "time-trial") {
    title = "Race avslutat";
    detail = `Tid: <strong>${formatTime(result.timeSeconds)}</strong>`;
    value = result.timeSeconds;
  } else if (result.mode === "race") {
    title = `Spelare ${result.winnerIndex + 1} vinner racet!`;
    detail = `Tid: <strong>${formatTime(result.timeSeconds)}</strong> · motståndaren körde ${result.loserLaps} varv`;
    value = result.timeSeconds;
  } else {
    title = `Spelare ${result.winnerIndex + 1} vinner!`;
    detail = `${result.winnerScore} - ${result.loserScore}`;
    value = result.winnerScore;
  }

  const board = getHighScores(result.levelId, result.mode).slice(0, 10);
  const justRecorded = opts.recorded;

  const canRecord = !justRecorded && qualifies(result.levelId, result.mode, value);
  const initialsForm = canRecord ? `
    <form id="initials-form" class="initials">
      <label>Topp 10! Ange initialer:</label>
      <input name="initials" maxlength="3" pattern="[A-Za-z]{1,3}" autocomplete="off"
        spellcheck="false" required />
      <button type="submit">Spara</button>
    </form>
  ` : "";

  const boardHtml = board.map((s, i) => {
    const isMine = !!justRecorded
      && s.initials === justRecorded
      && Math.abs(s.value - value) < 1e-6;
    return `
      <li class="${isMine ? "highlight" : ""}">
        <span class="rank">${i + 1}.</span>
        <span class="initials">${escapeHtml(s.initials)}</span>
        <span class="value">${formatScoreValue(result.mode, s)}</span>
      </li>
    `;
  }).join("");

  return `
    <div class="screen postgame-screen">
      <h1>${title}</h1>
      <p class="result">${detail} <small>på ${escapeHtml(levelName)}</small></p>
      ${initialsForm}
      <h2>Topp 10</h2>
      <ol class="scoreboard">${boardHtml || "<li class='empty'>—</li>"}</ol>
      <div class="postgame-actions">
        <button id="play-again">Spela igen</button>
        <button id="back-to-menu" class="primary">Till menyn</button>
      </div>
    </div>
  `;
}

function formatScoreValue(mode: GameMode, s: HighScore): string {
  if (mode === "time-trial" || mode === "race") return formatTime(s.value);
  return s.loser !== undefined ? `${s.value}–${s.loser}` : String(s.value);
}

function modeLabel(mode: GameMode): string {
  return mode === "time-trial" ? "Time Trial"
       : mode === "race"       ? "Race 2P"
       :                         "Duell";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}
