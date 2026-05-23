// ToolManager — owns the set of available tools and routes pointer events
// to whichever one is active. Tools see world coordinates only; the manager
// strips off screen→world conversion.

import type { Graphics } from "pixi.js";
import type { Editor } from "../Editor";
import { SelectTool } from "./SelectTool";
import { DrawBoundaryTool, DrawObstacleTool, DrawWaterTool } from "./DrawPolygonTool";
import { SpawnTool } from "./SpawnTool";
import { CheckpointTool } from "./CheckpointTool";
import { CrystalTool } from "./CrystalTool";

export interface ToolContext {
  editor: Editor;
}

export interface PointerEventArgs {
  /** World coords, post-snap. */
  world: { x: number; y: number };
  /** Raw world coords, pre-snap. */
  worldRaw: { x: number; y: number };
  /** The browser event for modifier keys etc. */
  event: PointerEvent;
}

export interface Tool {
  /** Short id used by hotkeys + persistence. */
  id: string;
  /** Human label shown in the toolbar. */
  label: string;
  /** Hotkey 1-9. */
  hotkey: string;

  onActivate?(): void;
  onDeactivate?(): void;
  onPointerDown?(e: PointerEventArgs): void;
  onPointerMove?(e: PointerEventArgs): void;
  onPointerUp?(e: PointerEventArgs): void;
  onKeyDown?(e: KeyboardEvent): void;
  /** Draw any tool-specific in-progress preview (e.g. line to next vertex). */
  drawPreview?(g: Graphics): void;
}

export class ToolManager {
  tools: Tool[];
  activeTool: Tool | null = null;

  constructor(private editor: Editor) {
    const ctx: ToolContext = { editor };
    this.tools = [
      new SelectTool(ctx),
      new DrawBoundaryTool(ctx),
      new DrawObstacleTool(ctx),
      new DrawWaterTool(ctx),
      new SpawnTool(ctx),
      new CheckpointTool(ctx),
      new CrystalTool(ctx),
    ];
    // Set the initial tool directly — calling setActive() here would invoke
    // editor.updateStatus() before `editor.tools` has been assigned.
    this.activeTool = this.tools[0];
    this.activeTool.onActivate?.();
    this.bindCanvas();
    this.bindKeyboard();
  }

  setActive(tool: Tool): void {
    if (this.activeTool === tool) return;
    this.activeTool?.onDeactivate?.();
    this.activeTool = tool;
    tool.onActivate?.();
    this.editor.updateStatus();
    // Sync toolbar buttons.
    const toolbar = document.getElementById("tools");
    if (toolbar) {
      toolbar.querySelectorAll("[data-tool-id]").forEach((el) => {
        el.classList.toggle("active", el.getAttribute("data-tool-id") === tool.id);
      });
    }
  }

  setActiveById(id: string): void {
    const t = this.tools.find((t) => t.id === id);
    if (t) this.setActive(t);
  }

  private toArgs(e: PointerEvent): PointerEventArgs {
    const raw = this.editor.camera.clientToWorld(e.clientX, e.clientY);
    const snapped = this.editor.snap(raw.x, raw.y);
    return { world: snapped, worldRaw: raw, event: e };
  }

  private bindCanvas(): void {
    const canvas = this.editor.app.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      // Left button only — middle/right are reserved for pan.
      if (e.button !== 0) return;
      this.activeTool?.onPointerDown?.(this.toArgs(e));
    });
    canvas.addEventListener("pointermove", (e) => {
      this.activeTool?.onPointerMove?.(this.toArgs(e));
    });
    canvas.addEventListener("pointerup", (e) => {
      if (e.button !== 0) return;
      this.activeTool?.onPointerUp?.(this.toArgs(e));
    });
  }

  private bindKeyboard(): void {
    window.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      // Hotkeys 1-9 select tools.
      const num = parseInt(e.key, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= this.tools.length) {
        this.setActive(this.tools[num - 1]);
        return;
      }
      this.activeTool?.onKeyDown?.(e);
    });
  }
}
