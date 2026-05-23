// CameraController — pan with right-mouse drag or middle-mouse, zoom with
// scroll wheel anchored at the cursor. Stores zoom and centre in world coords
// and applies them to `editor.worldRoot` every frame the camera changes.

import type { Editor } from "./Editor";

const MIN_ZOOM = 2;
const MAX_ZOOM = 100;

export class CameraController {
  /** Pixels per world metre. */
  zoom = 5;
  /** Centre of the view in world coords. */
  cx = 0;
  cy = 0;

  private panning = false;
  private panLastX = 0;
  private panLastY = 0;

  constructor(private editor: Editor) {
    this.bind();
    this.apply();
  }

  resetToLevel(): void {
    const { minX, maxX, minY, maxY } = this.editor.level.bounds;
    this.cx = (minX + maxX) / 2;
    this.cy = (minY + maxY) / 2;
    const padding = 1.1;
    const view = this.viewSize();
    const zx = view.width / ((maxX - minX) * padding);
    const zy = view.height / ((maxY - minY) * padding);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(zx, zy)));
    this.apply();
  }

  viewportChanged(): void {
    this.apply();
  }

  /** Convert client (page) coordinates to world coordinates. */
  clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = this.editor.app.canvas;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return this.screenToWorld(sx, sy);
  }

  /** Screen (canvas-relative CSS px) → world. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const view = this.viewSize();
    return {
      x: (sx - view.width / 2) / this.zoom + this.cx,
      y: (sy - view.height / 2) / this.zoom + this.cy,
    };
  }

  private viewSize(): { width: number; height: number } {
    const canvas = this.editor.app.canvas;
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  }

  private bind(): void {
    const canvas = this.editor.app.canvas;

    canvas.addEventListener("pointerdown", (e) => {
      // Right (2) or middle (1) mouse begins a pan.
      if (e.button === 2 || e.button === 1) {
        this.panning = true;
        this.panLastX = e.clientX;
        this.panLastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.panning) return;
      const dx = e.clientX - this.panLastX;
      const dy = e.clientY - this.panLastY;
      this.panLastX = e.clientX;
      this.panLastY = e.clientY;
      this.cx -= dx / this.zoom;
      this.cy -= dy / this.zoom;
      this.apply();
    });
    const endPan = (e: PointerEvent) => {
      if (this.panning) {
        this.panning = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      }
    };
    canvas.addEventListener("pointerup", endPan);
    canvas.addEventListener("pointercancel", endPan);

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      const before = this.clientToWorld(e.clientX, e.clientY);
      this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
      const after = this.clientToWorld(e.clientX, e.clientY);
      // Anchor zoom under cursor by re-centering on the same world point.
      this.cx += before.x - after.x;
      this.cy += before.y - after.y;
      this.apply();
    }, { passive: false });
  }

  private apply(): void {
    const view = this.viewSize();
    const root = this.editor.worldRoot;
    root.scale.set(this.zoom);
    root.x = view.width / 2 - this.cx * this.zoom;
    root.y = view.height / 2 - this.cy * this.zoom;
  }
}
