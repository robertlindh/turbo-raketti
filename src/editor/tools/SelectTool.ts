// SelectTool — hit-test any handle (polygon vertex, spawn, checkpoint,
// decoration) under the cursor; clicking selects, dragging moves. Right-click
// on a polygon vertex deletes it (with a min-3 guard); double-click on an
// edge inserts a vertex.

import type { Tool, ToolContext, PointerEventArgs } from "./ToolManager";
import type { EditorSelection } from "../Editor";
import type { Point } from "../../level/Level";
import type { Graphics } from "pixi.js";

const HIT_RADIUS = 1.5; // world metres

export class SelectTool implements Tool {
  id = "select";
  label = "Select";
  hotkey = "1";

  private dragging = false;
  private lastDoubleClickAt = 0;

  constructor(private ctx: ToolContext) {}

  onPointerDown(e: PointerEventArgs): void {
    const hit = this.hitTest(e.worldRaw.x, e.worldRaw.y);
    this.ctx.editor.selection = hit ?? { kind: "none" };
    this.dragging = hit !== null;
    this.ctx.editor.updateStatus();

    // Double-click detect → insert vertex on nearest edge of selected polygon.
    const now = performance.now();
    if (now - this.lastDoubleClickAt < 350 && !hit) {
      this.tryInsertVertex(e.worldRaw.x, e.worldRaw.y);
    }
    this.lastDoubleClickAt = now;
  }

  onPointerMove(e: PointerEventArgs): void {
    if (!this.dragging) return;
    if (!(e.event.buttons & 1)) {
      this.dragging = false;
      return;
    }
    this.moveSelectionTo(e.world.x, e.world.y);
  }

  onPointerUp(): void {
    this.dragging = false;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Delete" || e.key === "Backspace") {
      this.deleteSelection();
      e.preventDefault();
    } else if (e.key === "Escape") {
      this.ctx.editor.selection = { kind: "none" };
      this.ctx.editor.updateStatus();
    } else if (e.key === "[" || e.key === "]") {
      // Rotate spawn angle.
      this.rotateSpawn(e.key === "]" ? 1 : -1);
    }
  }

  drawPreview(_g: Graphics): void { /* no preview */ }

  // ── hit-testing ────────────────────────────────────────────────────────

  private hitTest(x: number, y: number): EditorSelection | null {
    const lvl = this.ctx.editor.level;
    // Order: spawns first (always interactive), then checkpoints, then
    // decorations, then polygon vertices. This matches z-order intuition.
    for (let i = 0; i < 2; i++) {
      const sp = lvl.spawns[i];
      if (dist(sp.x, sp.y, x, y) <= HIT_RADIUS * 1.4) {
        return { kind: "spawn", index: i as 0 | 1 };
      }
    }
    const cps = lvl.checkpoints ?? [];
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      if (dist(cp.x, cp.y, x, y) <= HIT_RADIUS * 1.6) {
        return { kind: "checkpoint", index: i };
      }
    }
    const decos = lvl.decorations ?? [];
    for (let i = 0; i < decos.length; i++) {
      const d = decos[i];
      if (dist(d.x, d.y, x, y) <= HIT_RADIUS) {
        return { kind: "decoration", index: i };
      }
    }
    // Boundary vertices.
    for (let i = 0; i < lvl.boundary.length; i++) {
      const p = lvl.boundary[i];
      if (dist(p.x, p.y, x, y) <= HIT_RADIUS) {
        return { kind: "boundary-vertex", index: i };
      }
    }
    // Obstacle vertices.
    for (let oi = 0; oi < lvl.obstacles.length; oi++) {
      const poly = lvl.obstacles[oi];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        if (dist(p.x, p.y, x, y) <= HIT_RADIUS) {
          return { kind: "obstacle-vertex", obstacle: oi, index: i };
        }
      }
    }
    // Water vertices.
    const water = lvl.waterZones ?? [];
    for (let zi = 0; zi < water.length; zi++) {
      const poly = water[zi];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        if (dist(p.x, p.y, x, y) <= HIT_RADIUS) {
          return { kind: "water-vertex", zone: zi, index: i };
        }
      }
    }
    return null;
  }

  private moveSelectionTo(x: number, y: number): void {
    const sel = this.ctx.editor.selection;
    if (sel.kind === "none") return;
    this.ctx.editor.mutate((lvl) => {
      switch (sel.kind) {
        case "boundary-vertex":
          lvl.boundary[sel.index] = { x, y }; break;
        case "obstacle-vertex":
          lvl.obstacles[sel.obstacle][sel.index] = { x, y }; break;
        case "water-vertex":
          lvl.waterZones![sel.zone][sel.index] = { x, y }; break;
        case "spawn":
          lvl.spawns[sel.index] = { ...lvl.spawns[sel.index], x, y }; break;
        case "checkpoint":
          lvl.checkpoints![sel.index] = { x, y }; break;
        case "decoration":
          lvl.decorations![sel.index] = { ...lvl.decorations![sel.index], x, y }; break;
      }
    });
  }

  private deleteSelection(): void {
    const sel = this.ctx.editor.selection;
    if (sel.kind === "none") return;
    this.ctx.editor.mutate((lvl) => {
      switch (sel.kind) {
        case "boundary-vertex":
          if (lvl.boundary.length > 3) lvl.boundary.splice(sel.index, 1);
          break;
        case "obstacle-vertex": {
          const poly = lvl.obstacles[sel.obstacle];
          if (poly.length > 3) poly.splice(sel.index, 1);
          else lvl.obstacles.splice(sel.obstacle, 1);
          break;
        }
        case "water-vertex": {
          const poly = lvl.waterZones![sel.zone];
          if (poly.length > 3) poly.splice(sel.index, 1);
          else lvl.waterZones!.splice(sel.zone, 1);
          break;
        }
        case "checkpoint":
          lvl.checkpoints!.splice(sel.index, 1); break;
        case "decoration":
          lvl.decorations!.splice(sel.index, 1); break;
        // Spawns are mandatory — never delete.
      }
    });
    this.ctx.editor.selection = { kind: "none" };
    this.ctx.editor.updateStatus();
  }

  private rotateSpawn(direction: 1 | -1): void {
    const sel = this.ctx.editor.selection;
    if (sel.kind !== "spawn") return;
    this.ctx.editor.mutate((lvl) => {
      const sp = lvl.spawns[sel.index];
      const a = (sp.angle ?? -Math.PI / 2) + direction * (Math.PI / 12);
      lvl.spawns[sel.index] = { ...sp, angle: a };
    });
  }

  /** Find the nearest polygon edge and insert a vertex at the click point. */
  private tryInsertVertex(x: number, y: number): void {
    const lvl = this.ctx.editor.level;
    type Hit = {
      kind: "boundary" | "obstacle" | "water";
      polyIndex: number;
      edgeIndex: number;
      d: number;
    };
    const hits: Hit[] = [];
    const consider = (
      poly: Point[],
      kind: "boundary" | "obstacle" | "water",
      polyIndex: number,
    ) => {
      if (poly.length < 2) return;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const d = distToSegment(x, y, a.x, a.y, b.x, b.y);
        if (d <= 1.5) hits.push({ kind, polyIndex, edgeIndex: i, d });
      }
    };
    consider(lvl.boundary, "boundary", 0);
    lvl.obstacles.forEach((p, i) => consider(p, "obstacle", i));
    (lvl.waterZones ?? []).forEach((p, i) => consider(p, "water", i));

    if (hits.length === 0) return;
    const best = hits.reduce((a, b) => (a.d <= b.d ? a : b));
    const insertAt = best.edgeIndex + 1;
    this.ctx.editor.mutate((lvl) => {
      const snapped = this.ctx.editor.snap(x, y);
      if (best.kind === "boundary") {
        lvl.boundary.splice(insertAt, 0, snapped);
      } else if (best.kind === "obstacle") {
        lvl.obstacles[best.polyIndex].splice(insertAt, 0, snapped);
      } else {
        lvl.waterZones![best.polyIndex].splice(insertAt, 0, snapped);
      }
    });
  }
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function distToSegment(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(px, py, ax + t * dx, ay + t * dy);
}
