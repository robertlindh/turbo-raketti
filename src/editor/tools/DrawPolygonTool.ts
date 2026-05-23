// Polygon drawing tools — share the same "click to add point, enter/double-
// click to finish, esc to cancel" workflow. Specialised subclasses commit the
// finished polygon to the right Level field with the right winding.

import type { Graphics } from "pixi.js";
import type { Tool, ToolContext, PointerEventArgs } from "./ToolManager";
import type { Point } from "../../level/Level";

abstract class DrawPolygonTool implements Tool {
  abstract id: string;
  abstract label: string;
  abstract hotkey: string;
  /** "ccw" for boundary, "cw" for obstacles. Determines auto-orientation. */
  protected abstract requiredWinding: "ccw" | "cw" | "any";
  /** Color used for the in-progress preview. */
  protected abstract previewColor: number;

  protected points: Point[] = [];
  protected hoverPoint: Point | null = null;
  protected justFinishedAt = 0;

  constructor(protected ctx: ToolContext) {}

  onActivate(): void {
    this.points = [];
    this.hoverPoint = null;
  }
  onDeactivate(): void {
    this.points = [];
    this.hoverPoint = null;
  }

  onPointerDown(e: PointerEventArgs): void {
    // Detect double-click: a click within 350ms of finishing should not
    // immediately start a new polygon.
    if (performance.now() - this.justFinishedAt < 200) return;

    // Close on click near first point.
    if (this.points.length >= 3) {
      const first = this.points[0];
      const dx = first.x - e.world.x;
      const dy = first.y - e.world.y;
      if (Math.hypot(dx, dy) < 2) {
        this.commit();
        return;
      }
    }
    this.points.push({ x: e.world.x, y: e.world.y });
  }

  onPointerMove(e: PointerEventArgs): void {
    this.hoverPoint = e.world;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      if (this.points.length >= 3) this.commit();
      e.preventDefault();
    } else if (e.key === "Escape") {
      this.points = [];
      this.hoverPoint = null;
    } else if (e.key === "Backspace" && this.points.length > 0) {
      this.points.pop();
      e.preventDefault();
    }
  }

  drawPreview(g: Graphics): void {
    if (this.points.length === 0) return;
    // Solid lines between confirmed points, dashed from last to cursor.
    g.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      g.lineTo(this.points[i].x, this.points[i].y);
    }
    g.stroke({ color: this.previewColor, alpha: 0.9, width: 0.3 });

    if (this.hoverPoint) {
      const last = this.points[this.points.length - 1];
      g.moveTo(last.x, last.y)
        .lineTo(this.hoverPoint.x, this.hoverPoint.y)
        .stroke({ color: this.previewColor, alpha: 0.5, width: 0.2 });
      // Closing hint when near first vertex.
      if (this.points.length >= 3) {
        const first = this.points[0];
        const dx = first.x - this.hoverPoint.x;
        const dy = first.y - this.hoverPoint.y;
        if (Math.hypot(dx, dy) < 2) {
          g.circle(first.x, first.y, 1.5)
            .stroke({ color: 0xffffff, alpha: 0.9, width: 0.2 });
        }
      }
    }

    // Handles for in-progress points.
    for (const p of this.points) {
      g.circle(p.x, p.y, 0.6)
        .fill({ color: 0x000000, alpha: 0.9 })
        .stroke({ color: this.previewColor, alpha: 1, width: 0.18 });
    }
  }

  protected commit(): void {
    if (this.points.length < 3) return;
    let poly = this.points.slice();
    // Force winding to required direction. Pixi's +Y is down, but the
    // codebase treats "screen-CCW" as the boundary winding — that
    // corresponds to a NEGATIVE signed area under standard math y-up
    // convention, i.e. positive area in y-down. So:
    //   "ccw on screen" == positive signedArea in y-down coords.
    if (this.requiredWinding !== "any") {
      const area = signedArea(poly);
      const isCcwOnScreen = area > 0;
      const want = this.requiredWinding === "ccw";
      if (isCcwOnScreen !== want) poly = poly.reverse();
    }
    this.commitPoly(poly);
    this.points = [];
    this.hoverPoint = null;
    this.justFinishedAt = performance.now();
  }

  protected abstract commitPoly(poly: Point[]): void;
}

export class DrawBoundaryTool extends DrawPolygonTool {
  id = "boundary";
  label = "Boundary";
  hotkey = "2";
  protected requiredWinding = "ccw" as const;
  protected previewColor = 0x6cdcff;

  protected commitPoly(poly: Point[]): void {
    this.ctx.editor.mutate((lvl) => {
      lvl.boundary = poly;
    });
  }
}

export class DrawObstacleTool extends DrawPolygonTool {
  id = "obstacle";
  label = "Obstacle";
  hotkey = "3";
  protected requiredWinding = "cw" as const;
  protected previewColor = 0xff9a3c;

  protected commitPoly(poly: Point[]): void {
    this.ctx.editor.mutate((lvl) => {
      lvl.obstacles.push(poly);
    });
  }
}

export class DrawWaterTool extends DrawPolygonTool {
  id = "water";
  label = "Water";
  hotkey = "4";
  protected requiredWinding = "ccw" as const;
  protected previewColor = 0x58c8ff;

  protected commitPoly(poly: Point[]): void {
    this.ctx.editor.mutate((lvl) => {
      if (!lvl.waterZones) lvl.waterZones = [];
      lvl.waterZones.push(poly);
    });
  }
}

function signedArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return a / 2;
}
