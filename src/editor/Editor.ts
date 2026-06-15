// Editor — the level editor's central orchestrator. Owns the Pixi app,
// camera, scene layers, the currently edited Level, and the active tool.
//
// Scene graph:
//   stage
//     worldRoot         (pan + zoom applied here)
//       backdropLayer   (holds the rendered Level backdrop sprite)
//       overlayLayer    (handles, polygon previews, spawn icons, etc.)
//     screenLayer       (HUD elements drawn in screen space)
//
// The backdrop is re-rendered on every Level mutation. That's expensive but
// well under a frame budget for the polygon counts a hand-built level has,
// and lets us preview exactly what the game will draw.

import {
  Application, Container, Graphics, Text, TextStyle,
} from "pixi.js";
import type { Level } from "../level/Level";
import { renderLevelBackdrop } from "../level/LevelLoader";
import { LEVELS } from "../level/levels";
import { OverlayRenderer } from "./OverlayRenderer";
import { CameraController } from "./CameraController";
import { ToolManager } from "./tools/ToolManager";
import { mountSidebars } from "./ui";
import { loadDraft, saveDraft } from "./storage";

export class Editor {
  readonly app = new Application();
  worldRoot = new Container();
  backdropLayer = new Container();
  overlayLayer = new Container();
  gridLayer = new Container();

  /** Current level being edited. */
  level: Level;
  /** True while a backdrop re-render is pending (coalesced via rAF). */
  private redrawPending = false;
  private backdropSprite: Container | null = null;

  camera!: CameraController;
  overlay!: OverlayRenderer;
  tools!: ToolManager;

  /** Selection state — what the active tool is currently working with. */
  selection: EditorSelection = { kind: "none" };

  /** Snap step in metres. 0 means no snap. */
  snapStep = 4;

  /** Listeners that fire after any level mutation (UI sync, autosave). */
  private changeListeners: Array<() => void> = [];

  constructor(private mount: HTMLElement) {
    this.level = loadDraft() ?? cloneLevel(LEVELS[0].level);
  }

  async init() {
    await this.app.init({
      background: 0x05070d,
      width: this.mount.clientWidth,
      height: this.mount.clientHeight,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    this.mount.appendChild(this.app.canvas);
    const canvas = this.app.canvas;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    // Prevent the browser's context menu so we can use right-drag for pan.
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    const onResize = () => {
      this.app.renderer.resize(this.mount.clientWidth, this.mount.clientHeight);
      this.camera.viewportChanged();
    };
    window.addEventListener("resize", onResize);

    // Scene graph.
    this.app.stage.addChild(this.worldRoot);
    this.worldRoot.addChild(this.backdropLayer);
    this.worldRoot.addChild(this.gridLayer);
    this.worldRoot.addChild(this.overlayLayer);

    // Subsystems.
    this.camera = new CameraController(this);
    this.overlay = new OverlayRenderer(this);
    this.tools = new ToolManager(this);

    this.renderBackdrop();
    this.renderGrid();

    // Sidebar UI lives in the HTML page — wire up handlers.
    mountSidebars(this);

    // Listen for changes to push autosave + UI sync.
    this.onChange(() => {
      saveDraft(this.level);
    });

    this.app.ticker.add(() => {
      if (this.redrawPending) {
        this.redrawPending = false;
        this.renderBackdrop();
      }
      this.overlay.draw();
    });

    this.updateStatus();
  }

  /** Schedule a backdrop re-render to coalesce many small edits into one. */
  scheduleRedraw(): void {
    this.redrawPending = true;
  }

  /** Apply a mutation to the current level and notify all listeners. */
  mutate(fn: (level: Level) => void): void {
    fn(this.level);
    this.scheduleRedraw();
    for (const l of this.changeListeners) l();
  }

  /** Replace the current level entirely (e.g. when loading a preset). */
  replaceLevel(level: Level): void {
    this.level = level;
    this.scheduleRedraw();
    this.renderGrid();
    for (const l of this.changeListeners) l();
  }

  onChange(fn: () => void): void {
    this.changeListeners.push(fn);
  }

  private renderBackdrop(): void {
    if (this.backdropSprite) {
      this.backdropLayer.removeChild(this.backdropSprite);
      // Container of sprites + the rock-mesh Graphics — free children and their
      // canvas textures so editor re-renders on every edit don't leak GPU memory.
      this.backdropSprite.destroy({ children: true, texture: true });
    }
    try {
      this.backdropSprite = renderLevelBackdrop(this.level);
      this.backdropLayer.addChild(this.backdropSprite);
    } catch (err) {
      // Polygon may be temporarily invalid (e.g. <3 vertices while drawing).
      console.warn("Backdrop render failed (ignored):", err);
      this.backdropSprite = null;
    }
  }

  private renderGrid(): void {
    this.gridLayer.removeChildren().forEach((c) => c.destroy());
    const g = new Graphics();
    const { minX, maxX, minY, maxY } = this.level.bounds;
    // Major lines every 16m, minor every 4m.
    const minor = 4;
    const major = 16;
    for (let x = Math.ceil(minX / minor) * minor; x <= maxX; x += minor) {
      const isMajor = x % major === 0;
      g.moveTo(x, minY).lineTo(x, maxY)
        .stroke({ color: isMajor ? 0xffffff : 0xaaaaaa, alpha: isMajor ? 0.10 : 0.04, width: isMajor ? 0.15 : 0.08 });
    }
    for (let y = Math.ceil(minY / minor) * minor; y <= maxY; y += minor) {
      const isMajor = y % major === 0;
      g.moveTo(minX, y).lineTo(maxX, y)
        .stroke({ color: isMajor ? 0xffffff : 0xaaaaaa, alpha: isMajor ? 0.10 : 0.04, width: isMajor ? 0.15 : 0.08 });
    }
    // World origin marker.
    g.moveTo(-2, 0).lineTo(2, 0).stroke({ color: 0xff6060, alpha: 0.7, width: 0.2 });
    g.moveTo(0, -2).lineTo(0, 2).stroke({ color: 0x60ff60, alpha: 0.7, width: 0.2 });
    this.gridLayer.addChild(g);

    // Bounds rectangle.
    const bg = new Graphics();
    bg.rect(minX, minY, maxX - minX, maxY - minY)
      .stroke({ color: 0xffc859, alpha: 0.4, width: 0.3 });
    this.gridLayer.addChild(bg);

    const labelStyle = new TextStyle({
      fontFamily: "ui-monospace, monospace",
      fontSize: 4,
      fill: 0xffc859,
    });
    const label = new Text({ text: "world bounds", style: labelStyle });
    label.x = minX + 1;
    label.y = minY + 0.5;
    this.gridLayer.addChild(label);
  }

  /** Snap a world position to the editor grid if snap is enabled. */
  snap(x: number, y: number): { x: number; y: number } {
    if (this.snapStep <= 0) return { x, y };
    const s = this.snapStep;
    return { x: Math.round(x / s) * s, y: Math.round(y / s) * s };
  }

  updateStatus(): void {
    const el = document.getElementById("status");
    if (!el) return;
    // ToolManager calls this from its own constructor before `this.tools`
    // has been assigned, so guard against the undefined.
    const tool = this.tools?.activeTool?.label ?? "(none)";
    const sel = describeSelection(this.selection);
    el.textContent =
      `Tool: ${tool}   Snap: ${this.snapStep || "off"}m   Selection: ${sel}`;
  }
}

/** Selection state — drives the active tool's "what am I editing right now". */
export type EditorSelection =
  | { kind: "none" }
  | { kind: "boundary-vertex"; index: number }
  | { kind: "obstacle-vertex"; obstacle: number; index: number }
  | { kind: "water-vertex"; zone: number; index: number }
  | { kind: "spawn"; index: 0 | 1 }
  | { kind: "checkpoint"; index: number }
  | { kind: "decoration"; index: number };

function describeSelection(sel: EditorSelection): string {
  switch (sel.kind) {
    case "none": return "—";
    case "boundary-vertex": return `boundary v${sel.index}`;
    case "obstacle-vertex": return `obstacle[${sel.obstacle}] v${sel.index}`;
    case "water-vertex": return `water[${sel.zone}] v${sel.index}`;
    case "spawn": return `spawn P${sel.index + 1}`;
    case "checkpoint": return `checkpoint #${sel.index}`;
    case "decoration": return `crystal #${sel.index}`;
  }
}

/** Deep-clone a Level via structured-clone-ish JSON path. */
export function cloneLevel(level: Level): Level {
  return JSON.parse(JSON.stringify(level)) as Level;
}
