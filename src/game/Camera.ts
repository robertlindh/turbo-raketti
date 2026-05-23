import type { Container } from "pixi.js";
import { SETTINGS } from "./Settings";

export interface CameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Top-down camera. The world stage is scaled (metres -> pixels) and translated
 * so the target world-point lands at screen centre. Auto-zooms to fit the
 * targets given to `follow()`, clamped so the camera can always show the
 * whole level (via `setLevelBounds`) but never zooms wider than the level.
 */
export class Camera {
  /** Pixels per metre. */
  zoom = 32;
  /** World-space focus point. */
  x = 0;
  y = 0;

  private bounds: CameraBounds | null = null;
  /** Extra metres around the level used as the "fit-whole-level" target. */
  private outerPadding = 1;
  /** Hard ceiling on zoom (close-in). Allows getting really close on small
   *  player separation without flipping into per-pixel territory. */
  private maxZoom = 60;
  /** When true (race / time-trial), single-target zoom is pulled way back
   *  so the whole course is visible — the player needs to see the next
   *  gate, not just their own ship. */
  private wideMode = false;

  /** Toggle wide-view zoom. Used by time-trial mode to keep the camera
   *  pulled back instead of glued to the lone ship. */
  setWideMode(on: boolean): void {
    this.wideMode = on;
  }

  constructor(
    private stage: Container,
    private getViewport: () => { width: number; height: number },
  ) {}

  /** Provide the level boundaries so the camera knows the widest it should
   *  zoom (i.e. when it must show the entire arena). */
  setLevelBounds(bounds: CameraBounds): void {
    this.bounds = bounds;
    // Centre on bounds initially so the first frame isn't off-screen.
    this.x = (bounds.minX + bounds.maxX) / 2;
    this.y = (bounds.minY + bounds.maxY) / 2;
  }

  /** Compute the minimum zoom that still fits the entire level in the
   *  viewport with `outerPadding` metres of slack on each side. */
  private fitZoom(): number {
    const b = this.bounds;
    if (!b) return 14;
    const vp = this.getViewport();
    const spanX = (b.maxX - b.minX) + this.outerPadding * 2;
    const spanY = (b.maxY - b.minY) + this.outerPadding * 2;
    return Math.min(vp.width / spanX, vp.height / spanY);
  }

  follow(targets: Array<{ x: number; y: number }>, alpha = 0.18) {
    if (targets.length === 0) return;
    let cx = 0;
    let cy = 0;
    for (const t of targets) {
      cx += t.x;
      cy += t.y;
    }
    cx /= targets.length;
    cy /= targets.length;

    // --- auto-zoom -------------------------------------------------------
    const vp = this.getViewport();
    let targetZoom: number;
    if (targets.length > 1) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const t of targets) {
        if (t.x < minX) minX = t.x;
        if (t.x > maxX) maxX = t.x;
        if (t.y < minY) minY = t.y;
        if (t.y > maxY) maxY = t.y;
      }
      const padding = 6;
      const spanX = (maxX - minX) + padding * 2;
      const spanY = (maxY - minY) + padding * 2;
      targetZoom = Math.min(vp.width / spanX, vp.height / spanY);
    } else if (this.wideMode) {
      // Race / time-trial — target a wide view ≈ 1.3× the fit-whole-level
      // zoom. The player can see most of the course and the next gate,
      // not just the ship. Clamping below still keeps it sane on huge or
      // tiny arenas.
      targetZoom = this.fitZoom() * 1.3;
    } else {
      // Single target on screen (e.g. opponent died mid-duel). Pull back
      // 20% further than the duo close-in zoom so the lone pilot sees
      // more of the cave around them and doesn't feel hemmed in.
      targetZoom = this.maxZoom * 0.7 * 0.8;
    }

    // Apply the user's preferred zoom multiplier from settings.
    targetZoom *= SETTINGS.cameraZoom;

    // Clamp: never narrower than "fit the whole level", never closer than maxZoom.
    const minZoom = this.fitZoom();
    const clamped = Math.max(minZoom, Math.min(this.maxZoom, targetZoom));
    this.zoom += (clamped - this.zoom) * alpha;

    // --- pan -------------------------------------------------------------
    // Clamp pan so the camera never reveals "outside the level" in either
    // axis: the half-viewport on screen translates to vp/(2*zoom) metres.
    let targetX = cx;
    let targetY = cy;
    if (this.bounds) {
      const halfW = vp.width / (2 * this.zoom);
      const halfH = vp.height / (2 * this.zoom);
      const b = this.bounds;
      // If the viewport is wider than the level along an axis, the level is
      // smaller than the screen on that axis: lock the camera to the centre.
      if (b.maxX - b.minX < halfW * 2) {
        targetX = (b.minX + b.maxX) / 2;
      } else {
        targetX = Math.max(b.minX + halfW, Math.min(b.maxX - halfW, targetX));
      }
      if (b.maxY - b.minY < halfH * 2) {
        targetY = (b.minY + b.maxY) / 2;
      } else {
        targetY = Math.max(b.minY + halfH, Math.min(b.maxY - halfH, targetY));
      }
    }
    this.x += (targetX - this.x) * alpha;
    this.y += (targetY - this.y) * alpha;
  }

  apply() {
    const vp = this.getViewport();
    this.stage.scale.set(this.zoom, this.zoom);
    this.stage.x = vp.width / 2 - this.x * this.zoom;
    this.stage.y = vp.height / 2 - this.y * this.zoom;
  }
}
