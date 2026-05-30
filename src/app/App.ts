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
import { logEvent } from "./firebase";
import { hasTouch as hasTouchDevice } from "../game/Input";
import { BUILD_NUMBER, BUILD_SHA } from "./version";
import {
  createRoom, joinRoom, subscribeToRoom, setReady, leaveRoom,
  setRoomStatusPlaying,
  type RoomSnapshot, type RoomRole,
} from "./multiplayer";
import {
  getHighScores, qualifies, addScore, fetchHighScoresAsync,
  formatTime, type HighScore,
} from "./highscores";
import {
  unlockAudio, startMenuMusic, stopMenuMusic, startVolumeWatcher,
  isMusicEnabled, setMusicEnabled, prebuildMusicBuffer,
} from "../audio/Audio";

type Scene = "loading" | "menu" | "game" | "postgame" | "instructions" | "lobby" | "highscores";

export class App {
  private screens: HTMLElement;
  private gameMount: HTMLElement;
  private currentGame: Game | null = null;
  private currentScene: Scene = "loading";

  /** Last-used selections, persisted across sessions for convenience. */
  private selectedMode: GameMode = "duel";
  private selectedLevelId = "metarola";

  /** Online-lobby state — set while the user is in a multiplayer room.
   *  Cleared on leave. */
  private lobby: {
    roomId: string;
    role: RoomRole;
    name: string;
    snapshot: RoomSnapshot | null;
    unsubscribe?: () => void;
  } | null = null;

  /** rAF handle for the gamepad navigation poll loop. Non-null while
   *  the menu or postgame is visible. */
  private menuNavRaf: number | null = null;
  /** Previously-pressed gamepad buttons + previously-flipped axes, so
   *  we react to rising edges only and don't auto-scroll on hold. */
  private gpPrevButtons: boolean[] = [];
  private gpPrevAxis = { x: 0, y: 0 };

  constructor() {
    this.screens = ensureElement("screens");
    this.gameMount = ensureElement("app");

    // Restore the most recent selections if available.
    const saved = localStorage.getItem("tr.menu.selection");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { mode?: GameMode; levelId?: string };
        if (parsed.mode === "time-trial" || parsed.mode === "duel" || parsed.mode === "race" || parsed.mode === "wave") this.selectedMode = parsed.mode;
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
    // interacts, but we can already render the audio buffer offline so
    // it's sitting in memory the instant they tap.
    const rapierReady = RAPIER.init();
    void prebuildMusicBuffer();
    document.body.classList.add("ready");
    await this.waitForUserGesture();
    // Gesture unlocked the audio context — fire up volume + music now,
    // so the music plays over the rest of the loading screen. The buffer
    // is already rendered so the loop starts within a frame.
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
    logEvent("app_loaded", {
      touch: hasTouchDevice() ? "yes" : "no",
    });
  }

  private waitForUserGesture(): Promise<void> {
    return new Promise((resolve) => {
      let padRaf: number | null = null;
      const cleanup = () => {
        window.removeEventListener("keydown", onAny);
        window.removeEventListener("pointerdown", onAny);
        if (padRaf !== null) cancelAnimationFrame(padRaf);
      };
      const onAny = (e: Event) => {
        // Ignore modifier-only keypresses so things like alt-tab don't dismiss.
        if (e instanceof KeyboardEvent) {
          if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
        }
        cleanup();
        resolve();
      };
      window.addEventListener("keydown", onAny);
      window.addEventListener("pointerdown", onAny);

      // Also accept a gamepad button press as the start gesture so the
      // splash can be dismissed without picking up a keyboard.
      const pollPad = () => {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const pad of pads) {
          if (!pad) continue;
          if (pad.buttons.some((b) => b.pressed)) {
            cleanup();
            resolve();
            return;
          }
        }
        padRaf = requestAnimationFrame(pollPad);
      };
      padRaf = requestAnimationFrame(pollPad);
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
    // Focus the first focusable button so keyboard + gamepad nav have a
    // starting point, and the user immediately sees what's selectable.
    this.focusFirst();
    this.startMenuGamepadNav();
    // Resume the menu loop on return from postgame / Esc-out-of-match.
    void startMenuMusic();
  }

  private showHighscores(): void {
    this.setScene("highscores");
    this.screens.innerHTML = renderHighscores(this);
    this.bindHighscores();
    this.focusFirst();
    this.startMenuGamepadNav();
    // Pull the latest global leaderboard for the current selection and
    // re-render when it arrives. Local cache renders first so the page
    // never blanks out.
    void this.refreshHighscoresAndRender();
    logEvent("highscores_opened", {
      mode: this.selectedMode,
      level: this.selectedLevelId,
    });
  }

  /** Fetch the active level + mode's leaderboard from Firebase and, when
   *  it resolves, re-render the highscores scene if it's still showing
   *  the same selection. */
  private async refreshHighscoresAndRender(): Promise<void> {
    const beforeIds = this.selectedLevelId + "/" + this.selectedMode;
    await fetchHighScoresAsync(this.selectedLevelId, this.selectedMode);
    if (this.currentScene !== "highscores") return;
    if (this.selectedLevelId + "/" + this.selectedMode !== beforeIds) return;
    this.screens.innerHTML = renderHighscores(this);
    this.bindHighscores();
  }

  private showInstructions(): void {
    this.setScene("instructions");
    this.screens.innerHTML = renderInstructions();
    this.screens.querySelector<HTMLButtonElement>("#back-to-menu")
      ?.addEventListener("click", () => this.showMenu());
    this.focusFirst();
    this.startMenuGamepadNav();
    logEvent("instructions_opened");
  }

  // ── online multiplayer lobby ────────────────────────────────────────────

  /** Initial lobby entry — pick "Host" or "Join". */
  private showLobbyEntry(): void {
    this.setScene("lobby");
    const lastName = localStorage.getItem("tr.online.name") ?? "";
    this.screens.innerHTML = `
      <div class="screen lobby-screen">
        <h1>Online race</h1>
        <p class="hint">
          Skapa ett rum och skicka koden till en kompis, eller skriv in
          deras kod för att gå med. Race på vald bana, ${5} laps.
        </p>
        <section>
          <h2>Ditt namn</h2>
          <input id="online-name" type="text" maxlength="16"
            value="${escapeHtml(lastName)}" placeholder="Ange ditt namn" />
        </section>
        <section>
          <h2>Skapa nytt rum</h2>
          <p class="hint">På banan <strong>${escapeHtml(LEVELS.find((l) => l.id === this.selectedLevelId)?.level.name ?? this.selectedLevelId)}</strong>.</p>
          <button id="online-host" class="primary" type="button">🌐 Skapa rum</button>
        </section>
        <section>
          <h2>Gå med i rum</h2>
          <div class="row">
            <input id="online-code" type="text" maxlength="4"
              placeholder="ABCD" autocomplete="off" spellcheck="false"
              style="text-transform: uppercase; letter-spacing: 0.4em;
                     font-size: 22px; padding: 10px; flex: 1;" />
            <button id="online-join" type="button">Gå med</button>
          </div>
          <p id="online-error" class="hint" style="color: #ff8a8a;"></p>
        </section>
        <div class="postgame-actions">
          <button id="back-to-menu" type="button">Tillbaka</button>
        </div>
      </div>
    `;
    this.bindLobbyEntry();
    this.focusFirst();
    this.startMenuGamepadNav();
  }

  private bindLobbyEntry(): void {
    const nameInput = this.screens.querySelector<HTMLInputElement>("#online-name");
    const codeInput = this.screens.querySelector<HTMLInputElement>("#online-code");
    const errorEl = this.screens.querySelector<HTMLElement>("#online-error");
    const getName = (): string => {
      const v = (nameInput?.value ?? "").trim();
      if (v) localStorage.setItem("tr.online.name", v);
      return v;
    };
    this.screens.querySelector<HTMLButtonElement>("#online-host")
      ?.addEventListener("click", async () => {
        const name = getName();
        if (!name) { if (errorEl) errorEl.textContent = "Ange ditt namn först."; return; }
        if (errorEl) errorEl.textContent = "Skapar rum…";
        const code = await createRoom(name, this.selectedLevelId, "race");
        if (!code) {
          if (errorEl) errorEl.textContent = "Kunde inte skapa rum (Firebase otillgängligt).";
          return;
        }
        this.enterLobby(code, "host", name);
      });
    this.screens.querySelector<HTMLButtonElement>("#online-join")
      ?.addEventListener("click", async () => {
        const name = getName();
        if (!name) { if (errorEl) errorEl.textContent = "Ange ditt namn först."; return; }
        const code = (codeInput?.value ?? "").trim().toUpperCase();
        if (code.length !== 4) {
          if (errorEl) errorEl.textContent = "Koden ska vara 4 bokstäver.";
          return;
        }
        if (errorEl) errorEl.textContent = "Går med…";
        const ok = await joinRoom(code, name);
        if (!ok) {
          if (errorEl) errorEl.textContent = "Hittade inte rummet (eller redan fullt).";
          return;
        }
        this.enterLobby(code, "guest", name);
      });
    this.screens.querySelector<HTMLButtonElement>("#back-to-menu")
      ?.addEventListener("click", () => this.showMenu());
  }

  private async enterLobby(roomId: string, role: RoomRole, name: string): Promise<void> {
    // Clean up any previous subscription.
    this.lobby?.unsubscribe?.();
    this.lobby = { roomId, role, name, snapshot: null };
    const unsubscribe = await subscribeToRoom(roomId, (snap) => {
      if (!this.lobby || this.lobby.roomId !== roomId) return;
      this.lobby.snapshot = snap;
      // Race-safe auto-transition: whichever client first sees both
      // sides ready bumps the status. Idempotent — both clients writing
      // "playing" is the same as one. Without this the transition would
      // depend on the exact order setReady calls land.
      if (snap?.host?.ready && snap?.guest?.ready && snap.status === "waiting") {
        void setRoomStatusPlaying(roomId);
      }
      if (snap?.status === "playing" && this.currentScene === "lobby") {
        this.startOnlineMatch();
      } else if (this.currentScene === "lobby") {
        this.renderLobbyWaiting();
      }
    });
    this.lobby.unsubscribe = unsubscribe;
    this.renderLobbyWaiting();
  }

  private renderLobbyWaiting(): void {
    if (!this.lobby) return;
    const { roomId, role, snapshot } = this.lobby;
    const youName = role === "host" ? snapshot?.host?.name : snapshot?.guest?.name;
    const otherName = role === "host" ? snapshot?.guest?.name : snapshot?.host?.name;
    const youReady = role === "host" ? snapshot?.host?.ready : snapshot?.guest?.ready;
    const otherReady = role === "host" ? snapshot?.guest?.ready : snapshot?.host?.ready;
    const levelName = LEVELS.find((l) => l.id === snapshot?.levelId)?.level.name
      ?? snapshot?.levelId ?? "—";
    this.screens.innerHTML = `
      <div class="screen lobby-screen">
        <h1>Rum ${escapeHtml(roomId)}</h1>
        <p class="hint">Bana: <strong>${escapeHtml(levelName)}</strong> · Läge: race</p>
        <section>
          <h2>Spelare</h2>
          <ul class="players-list">
            <li class="${youReady ? "ready" : ""}">
              <strong>${escapeHtml(youName ?? "—")}</strong>
              <span class="role">(${role === "host" ? "host" : "guest"} — du)</span>
              <span class="status">${youReady ? "✓ Ready" : "Väntar"}</span>
            </li>
            <li class="${otherReady ? "ready" : ""}">
              <strong>${otherName ? escapeHtml(otherName) : "väntar på motspelare…"}</strong>
              ${otherName ? `<span class="role">(${role === "host" ? "guest" : "host"})</span>` : ""}
              <span class="status">${otherName ? (otherReady ? "✓ Ready" : "Väntar") : ""}</span>
            </li>
          </ul>
        </section>
        ${role === "host" ? `
          <p class="hint">Dela koden <strong style="color:#ffd166;letter-spacing:0.4em">${escapeHtml(roomId)}</strong> med din motspelare.</p>
        ` : ""}
        <div class="postgame-actions">
          <button id="lobby-leave" type="button">Lämna</button>
          <button id="lobby-ready" class="primary" type="button"
            ${otherName ? "" : "disabled"}>
            ${youReady ? "Avbryt" : "Ready"}
          </button>
        </div>
      </div>
    `;
    this.screens.querySelector<HTMLButtonElement>("#lobby-ready")
      ?.addEventListener("click", () => {
        if (!this.lobby) return;
        void setReady(this.lobby.roomId, this.lobby.role, !youReady);
      });
    this.screens.querySelector<HTMLButtonElement>("#lobby-leave")
      ?.addEventListener("click", () => this.leaveLobby());
    this.focusFirst();
  }

  private async leaveLobby(): Promise<void> {
    if (this.lobby) {
      this.lobby.unsubscribe?.();
      void leaveRoom(this.lobby.roomId, this.lobby.role);
      this.lobby = null;
    }
    this.showMenu();
  }

  private startOnlineMatch(): void {
    if (!this.lobby) return;
    const { roomId, role } = this.lobby;
    const levelId = this.lobby.snapshot?.levelId ?? this.selectedLevelId;
    logEvent("online_match_start", { role, level: levelId });
    stopMenuMusic();
    this.stopMenuGamepadNav();
    this.setScene("game");
    this.screens.innerHTML = "";
    const loader = this.buildInGameLoader();
    this.currentGame = new Game(this.gameMount, {
      mode: "race",
      levelId,
      online: { roomId, role },
      onGameEnd: (result) => this.showPostgame(result),
    });
    void this.currentGame.init()
      .then(() => {
        loader.remove();
        this.currentGame?.start();
      })
      .catch((err) => {
        loader.remove();
        console.error("Online game init failed:", err);
      });
    window.addEventListener("keydown", this.onGameKey);
  }

  private startGame(): void {
    this.persistSelection();
    logEvent("match_start", {
      mode: this.selectedMode,
      level: this.selectedLevelId,
    });
    // Silence the menu loop — the game's own SFX takes over from here.
    stopMenuMusic();
    this.stopMenuGamepadNav();
    this.setScene("game");
    this.screens.innerHTML = "";
    // Show the disk-spinner over a solid black screen while the level
    // renders. game.init() can spend ~1-2s building the backdrop on a
    // cold load; without this overlay the user just sees black.
    const loader = this.buildInGameLoader();
    this.currentGame = new Game(this.gameMount, {
      mode: this.selectedMode,
      levelId: this.selectedLevelId,
      onGameEnd: (result) => this.showPostgame(result),
    });
    void this.currentGame.init()
      .then(() => {
        loader.remove();
        this.currentGame?.start();
      })
      .catch((err) => {
        loader.remove();
        console.error("Game init failed:", err);
      });
    // Esc returns to the menu mid-match.
    window.addEventListener("keydown", this.onGameKey);
  }

  /** Build the in-game floppy-disk loader overlay. Returns the element so
   *  the caller can remove it once the game is ready to display. */
  private buildInGameLoader(): HTMLElement {
    const el = document.createElement("div");
    el.id = "in-game-loader";
    el.innerHTML = `
      <svg class="disk-spinner" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
        <g fill="#1a2a48"><rect x="1" y="1" width="14" height="14"/></g>
        <g fill="#3a5078"><rect x="2" y="2" width="12" height="12"/></g>
        <g fill="#9aa6b8"><rect x="3" y="2" width="10" height="5"/></g>
        <g fill="#5a6478"><rect x="6" y="3" width="4" height="3"/></g>
        <g fill="#e6d488"><rect x="3" y="8" width="10" height="5"/></g>
        <g fill="#a08820"><rect x="3" y="8" width="10" height="1"/></g>
        <g fill="#5a4818">
          <rect x="4" y="10" width="6" height="1"/>
          <rect x="4" y="12" width="4" height="1"/>
        </g>
        <g fill="#ffd166"><rect x="13" y="2" width="1" height="1"/></g>
      </svg>
      <div>Laddar bana...</div>
    `;
    document.body.appendChild(el);
    return el;
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
    this.focusFirst();
    this.startMenuGamepadNav();
    logEvent("match_finish", buildMatchFinishParams(result));
    // Pull the global leaderboard for this mode + level so the postgame
    // shows the latest top 10 once the network responds.
    void this.refreshPostgame(result);
  }

  private async refreshPostgame(result: GameResult): Promise<void> {
    await fetchHighScoresAsync(result.levelId, result.mode);
    if (this.currentScene !== "postgame") return;
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
        logEvent("editor_opened");
        void e; // no-op; default action proceeds
      });
    this.screens.querySelector<HTMLButtonElement>("#open-instructions")
      ?.addEventListener("click", () => this.showInstructions());
    this.screens.querySelector<HTMLButtonElement>("#open-highscores")
      ?.addEventListener("click", () => this.showHighscores());
    this.screens.querySelector<HTMLButtonElement>("#open-online")
      ?.addEventListener("click", () => this.showLobbyEntry());
    this.screens.querySelector<HTMLButtonElement>("#music-toggle")
      ?.addEventListener("click", () => {
        const next = !isMusicEnabled();
        setMusicEnabled(next);
        if (next) void startMenuMusic();
        // Re-render the menu so the button label updates.
        this.showMenu();
      });
  }

  private bindHighscores(): void {
    this.screens.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedMode = btn.dataset.mode as GameMode;
        this.persistSelection();
        this.showHighscores();
      });
    });
    this.screens.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedLevelId = btn.dataset.level!;
        this.persistSelection();
        this.showHighscores();
      });
    });
    this.screens.querySelector<HTMLButtonElement>("#back-to-menu")
      ?.addEventListener("click", () => this.showMenu());
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
        let entry: {
          initials: string; value: number; loser?: number;
          gateTimes?: number[];
          replay?: Array<{ t: number; x: number; y: number; r: number }>;
        };
        if (result.mode === "time-trial" || result.mode === "race") {
          entry = { initials, value: result.timeSeconds };
        } else if (result.mode === "wave") {
          entry = { initials, value: result.survivedSeconds };
        } else {
          entry = { initials, value: result.winnerScore, loser: result.loserScore };
        }
        // Race-style modes: ship the captured telemetry along with the
        // highscore so future ghost-races have full data.
        if ("telemetry" in result && result.telemetry) {
          entry.gateTimes = result.telemetry.gateTimes;
          entry.replay = result.telemetry.replay;
        }
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

  // ── focus + gamepad navigation ──────────────────────────────────────────

  /** Set the keyboard focus to the first focusable element in the current
   *  screen. Used right after rendering menu/postgame so gamepad and
   *  keyboard users immediately see what's selectable. */
  private focusFirst(): void {
    const first = this.screens.querySelector<HTMLElement>(this.focusableSelector());
    first?.focus();
  }

  /** Selector for elements gamepad nav can land on. Excludes text inputs
   *  so they don't steal focus while initials are being typed. */
  private focusableSelector(): string {
    return [
      "button:not([disabled])",
      ".link-btn",
      ".icon-btn",
      ".mode-pick",
      ".level-pick",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
  }

  /** Start polling the first connected gamepad for menu navigation.
   *  Maps D-pad / left-stick to focus moves and the A button to a click
   *  on the currently focused element. Safe to call repeatedly. */
  private startMenuGamepadNav(): void {
    if (this.menuNavRaf !== null) return;
    this.gpPrevButtons = [];
    this.gpPrevAxis = { x: 0, y: 0 };
    const tick = () => {
      // Stop polling once we've left a navigable overlay scene.
      const navigableScenes: Scene[] = ["menu", "postgame", "instructions", "lobby", "highscores"];
      if (!navigableScenes.includes(this.currentScene)) {
        this.menuNavRaf = null;
        return;
      }
      this.pollGamepadOnce();
      this.menuNavRaf = requestAnimationFrame(tick);
    };
    this.menuNavRaf = requestAnimationFrame(tick);
  }

  private stopMenuGamepadNav(): void {
    if (this.menuNavRaf !== null) {
      cancelAnimationFrame(this.menuNavRaf);
      this.menuNavRaf = null;
    }
  }

  private pollGamepadOnce(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const buttons = pad.buttons.map((b) => b.pressed);
      const rising = (i: number) =>
        !!buttons[i] && !this.gpPrevButtons[i];

      // D-pad: 12=up, 13=down, 14=left, 15=right.
      // Treat up/left as "previous", down/right as "next" so focus walks
      // through the DOM in reading order.
      if (rising(13) || rising(15)) this.moveFocus(1);
      if (rising(12) || rising(14)) this.moveFocus(-1);

      // Analog left stick — same effect as D-pad but only on edge crossing
      // a 0.55 deadzone so a tilted stick doesn't auto-scroll.
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const dz = 0.55;
      const xEdge = Math.sign(Math.abs(ax) > dz ? ax : 0);
      const yEdge = Math.sign(Math.abs(ay) > dz ? ay : 0);
      const xPrev = Math.sign(Math.abs(this.gpPrevAxis.x) > dz ? this.gpPrevAxis.x : 0);
      const yPrev = Math.sign(Math.abs(this.gpPrevAxis.y) > dz ? this.gpPrevAxis.y : 0);
      if (xEdge !== xPrev) {
        if (xEdge > 0) this.moveFocus(1);
        else if (xEdge < 0) this.moveFocus(-1);
      }
      if (yEdge !== yPrev) {
        if (yEdge > 0) this.moveFocus(1);
        else if (yEdge < 0) this.moveFocus(-1);
      }
      this.gpPrevAxis = { x: ax, y: ay };

      // A button (0) or Start (9) clicks the focused element.
      if (rising(0) || rising(9)) {
        const active = document.activeElement as HTMLElement | null;
        if (active && this.screens.contains(active)) active.click();
      }

      this.gpPrevButtons = buttons;
      break; // only honour the first connected pad
    }
  }

  private moveFocus(delta: number): void {
    const list = Array.from(
      this.screens.querySelectorAll<HTMLElement>(this.focusableSelector()),
    );
    if (list.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    const idx = current ? list.indexOf(current) : -1;
    const nextIdx = (idx + delta + list.length) % list.length;
    list[nextIdx]?.focus();
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
  const mode = app.mode;

  const levelButtons = levels.map((entry) => {
    const active = entry.id === app.levelId;
    return `
      <button class="level-pick ${active ? "active" : ""}" data-level="${entry.id}"
        title="${escapeHtml(entry.level.name)}">
        ${escapeHtml(entry.level.name)}
      </button>
    `;
  }).join("");

  // Single flat row of 4 mode buttons — colored borders (race=cyan,
  // combat=red) carry the grouping info without verbose labels.
  const modeButtons = `
    <button class="mode-pick race ${mode === "time-trial" ? "active" : ""}" data-mode="time-trial"
      title="Time Trial · 1 spelare mot klockan">🏁 Time Trial</button>
    <button class="mode-pick race ${mode === "race" ? "active" : ""}" data-mode="race"
      title="Race 2P · 2 spelare splitscreen">🏁 Race 2P</button>
    <button class="mode-pick combat ${mode === "wave" ? "active" : ""}" data-mode="wave"
      title="Skjut bottar · 1 spelare score attack">⚔️ Bottar</button>
    <button class="mode-pick combat ${mode === "duel" ? "active" : ""}" data-mode="duel"
      title="Duell · 2 spelare first to 5 frags">⚔️ Duell</button>
  `;

  return `
    <div class="screen menu-screen">
      <div class="menu-header">
        <h1>TurboRaketti</h1>
        <p class="version">build ${escapeHtml(BUILD_NUMBER)} · ${escapeHtml(BUILD_SHA)}</p>
      </div>

      <div class="menu-body">
        <div class="mode-picks">${modeButtons}</div>
        <div class="level-picks">${levelButtons}</div>
      </div>

      <div class="menu-footer">
        <div class="icon-row">
          <button id="open-instructions" class="icon-btn" type="button" title="Instruktioner" aria-label="Instruktioner">📖</button>
          <button id="open-highscores" class="icon-btn" type="button" title="Highscores" aria-label="Highscores">🏆</button>
          <button id="open-online" class="icon-btn" type="button" title="Online race" aria-label="Online race">🌐</button>
          <a id="open-editor" class="icon-btn" href="${import.meta.env.BASE_URL}editor.html"
            title="Level editor" aria-label="Level editor">✏️</a>
          <button id="music-toggle" class="icon-btn" type="button"
            title="${isMusicEnabled() ? "Stäng av musik" : "Spela musik"}"
            aria-label="${isMusicEnabled() ? "Stäng av musik" : "Spela musik"}"
            aria-pressed="${isMusicEnabled()}">
            ${isMusicEnabled() ? "♪" : "♪̸"}
          </button>
        </div>
        <button id="start-match" class="primary">Start</button>
      </div>
    </div>
  `;
}

function renderHighscores(app: App): string {
  const levels = LEVELS;
  const selectedLevel = levels.find((l) => l.id === app.levelId) ?? levels[0];
  const mode = app.mode;
  const board = getHighScores(selectedLevel.id, mode).slice(0, 10);

  const levelButtons = levels.map((entry) => {
    const active = entry.id === app.levelId;
    return `
      <button class="level-pick ${active ? "active" : ""}" data-level="${entry.id}"
        title="${escapeHtml(entry.level.name)}">
        ${escapeHtml(entry.level.name)}
      </button>
    `;
  }).join("");

  const modeButtons = `
    <button class="mode-pick race ${mode === "time-trial" ? "active" : ""}" data-mode="time-trial">🏁 Time Trial</button>
    <button class="mode-pick race ${mode === "race" ? "active" : ""}" data-mode="race">🏁 Race 2P</button>
    <button class="mode-pick combat ${mode === "wave" ? "active" : ""}" data-mode="wave">⚔️ Bottar</button>
    <button class="mode-pick combat ${mode === "duel" ? "active" : ""}" data-mode="duel">⚔️ Duell</button>
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
    <div class="screen highscores-screen">
      <h1>🏆 Highscores</h1>

      <div class="mode-picks">${modeButtons}</div>
      <div class="level-picks">${levelButtons}</div>

      <h2>Topp 10 — ${escapeHtml(selectedLevel.level.name)} • ${modeLabel(mode)}</h2>
      <ol class="scoreboard">${scoresHtml}</ol>

      <div class="postgame-actions">
        <button id="back-to-menu" class="primary">Tillbaka till menyn</button>
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

  if (result.mode === "wave") {
    if (result.score >= 5) {
      title = "Combat avklarad!";
      detail = `5 bottar på <strong>${formatTime(result.survivedSeconds)}</strong>`;
    } else {
      title = "Du dog!";
      detail = `Klarade bara ${result.score} av 5 bottar · överlevde ${formatTime(result.survivedSeconds)}`;
    }
    // Score sparas alltid som överlevnadstiden — högt antal kills i kort
    // tid räknas om till en bra tid (incomplete runs sparas inte i topp 10).
    value = result.survivedSeconds;
  } else if (result.mode === "time-trial") {
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

  // Wave runs only qualify for the leaderboard if the player actually
  // took down all 5 bots — partial runs are shown but not saved.
  const incompleteWave = result.mode === "wave" && result.score < 5;
  const canRecord = !justRecorded && !incompleteWave
    && qualifies(result.levelId, result.mode, value);
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

function renderInstructions(): string {
  return `
    <div class="screen instructions-screen">
      <h1>Instruktioner</h1>

      <section>
        <h2>Kontroller</h2>
        <table class="ctrl-table">
          <thead>
            <tr><th></th><th>P1</th><th>P2</th></tr>
          </thead>
          <tbody>
            <tr><td>Thrust</td><td><kbd>↑</kbd></td><td><kbd>W</kbd></td></tr>
            <tr><td>Rotera</td><td><kbd>←</kbd> <kbd>→</kbd></td><td><kbd>A</kbd> <kbd>D</kbd></td></tr>
            <tr><td>Skjut</td><td><kbd>Space</kbd></td><td><kbd>S</kbd></td></tr>
            <tr><td>Special (mine)</td><td><kbd>↓</kbd></td><td><kbd>Shift</kbd></td></tr>
          </tbody>
        </table>
        <p class="hint">
          🎮 Gamepad: thrust = A, rotera = D-pad / vänster spak,
          skjut = X, special = B. Mobil får automatiskt touch-knappar.
        </p>
        <p class="hint">
          📋 I menyer: D-pad / spak för att flytta fokus, A för att välja.
          <kbd>Esc</kbd> under match → tillbaka till menyn.
        </p>
      </section>

      <section>
        <h2>Lägen</h2>
        <dl class="modes-list">
          <dt>🏁 Time Trial</dt>
          <dd>1 spelare. Race mot klockan genom checkpoint-gates. Endast speed power-ups spawnar.</dd>

          <dt>🏁 Race 2P</dt>
          <dd>2 spelare splitscreen. Först till 3 varv vinner.</dd>

          <dt>⚔️ Skjut bottar</dt>
          <dd>1 spelare. Skjut ner 5 lila AI-bottar så snabbt som möjligt. Du har ett liv.</dd>

          <dt>⚔️ Duell</dt>
          <dd>2 spelare splitscreen. Först till 5 frags vinner. Alla power-ups aktiva.</dd>
        </dl>
      </section>

      <section>
        <h2>Power-ups</h2>
        <ul class="pu-list">
          <li><span class="pu-dot" style="background:#6cd0ff"></span><b>Shield</b> — absorberar ett skott</li>
          <li><span class="pu-dot" style="background:#ff8030"></span><b>Triple</b> — tre skott parallellt</li>
          <li><span class="pu-dot" style="background:#ffd040"></span><b>Rapid</b> — högre eldhastighet</li>
          <li><span class="pu-dot" style="background:#6cff80"></span><b>Speed</b> — kraftigare thrust</li>
          <li><span class="pu-dot" style="background:#a078ff"></span><b>Cloak</b> — semi-transparent</li>
          <li><span class="pu-dot" style="background:#ff6cd0"></span><b>AntiGrav</b> — ingen gravitation</li>
          <li><span class="pu-dot" style="background:#ff4848"></span><b>Mine</b> — lägg en mine bakom dig (special)</li>
          <li><span class="pu-dot" style="background:#ff8030"></span><b>Homing</b> — målsökande missil (ersätter skott)</li>
        </ul>
      </section>

      <div class="postgame-actions">
        <button id="back-to-menu" class="primary">Tillbaka till menyn</button>
      </div>
    </div>
  `;
}

function formatScoreValue(mode: GameMode, s: HighScore): string {
  if (mode === "time-trial" || mode === "race" || mode === "wave") {
    return formatTime(s.value);
  }
  // Duel: "wins–losses" format if both sides are recorded.
  return s.loser !== undefined ? `${s.value}–${s.loser}` : String(s.value);
}

function modeLabel(mode: GameMode): string {
  return mode === "time-trial" ? "Time Trial"
       : mode === "race"       ? "Race 2P"
       : mode === "wave"       ? "Skjut bottar"
       :                         "Duell";
}

/** Build a flat key/value record for Firebase Analytics from a match
 *  result. Analytics events are happiest with primitive values and a
 *  consistent shape, so each mode flattens its own fields. */
function buildMatchFinishParams(
  result: GameResult,
): Record<string, string | number | boolean> {
  const base = { mode: result.mode, level: result.levelId };
  if (result.mode === "time-trial") {
    return { ...base, time_seconds: round2(result.timeSeconds) };
  }
  if (result.mode === "race") {
    return {
      ...base,
      time_seconds: round2(result.timeSeconds),
      winner: result.winnerIndex + 1,
      loser_laps: result.loserLaps,
    };
  }
  if (result.mode === "wave") {
    return {
      ...base,
      kills: result.score,
      survived_seconds: round2(result.survivedSeconds),
      completed: result.score >= 5,
    };
  }
  // Duel
  return {
    ...base,
    winner: result.winnerIndex + 1,
    winner_score: result.winnerScore,
    loser_score: result.loserScore,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}
