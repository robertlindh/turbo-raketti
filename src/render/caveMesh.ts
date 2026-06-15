// Low-poly vector rock mesh for the cave ("Style 2", Phase 3).
//
// The cave interior is a polygon; the rock is everything OUTSIDE that boundary
// plus everything INSIDE the obstacle islands. We fill that rock region with a
// flat-shaded triangle field: densified edge points + a jittered interior grid
// are Delaunay-triangulated, triangles are clipped to the rock region, and each
// facet is flat-filled — toned by depth from the cave edge (lighter at the rim,
// darker deep) with a subtle swing from the same world light as the ship and
// gates. Drawn in world metres as a single Pixi `Graphics`, replacing the old
// baked raster rock so it stays crisp at any camera zoom.

import Delaunator from "delaunator";
import { Graphics } from "pixi.js";
import type { Level, Point } from "../level/Level";
import { LIGHT_X, LIGHT_Y, lighten, darken } from "./lowpoly";

// ── colour helpers ──────────────────────────────────────────────────────────

function hexToNum(hex: string): number {
  return parseInt(hex.replace(/^#/, ""), 16) & 0xffffff;
}

/** Linear blend between two 0xRRGGBB colours. */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

// ── geometry helpers ─────────────────────────────────────────────────────────

/** Even-odd ray cast — winding-agnostic, which suits both CCW boundary and
 *  CW obstacles authored "as seen on screen". */
function pointInPoly(x: number, y: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from (px,py) to segment a→b, plus the closest point on it. */
function distPointSeg(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
): { dist: number; cx: number; cy: number } {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t, cy = ay + dy * t;
  return { dist: Math.hypot(px - cx, py - cy), cx, cy };
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── mesh builder ──────────────────────────────────────────────────────────────

/**
 * Build the faceted rock mesh for a level. Returns a `Graphics` in world
 * coordinates (add it straight to the world layer — no scaling).
 */
export function buildRockMesh(level: Level): Graphics {
  const g = new Graphics();
  const { bounds, boundary, obstacles, theme } = level;

  // Degenerate boundary (e.g. mid-edit in the editor): just flood the bounds
  // with the darkest rock so the preview isn't blank.
  if (!boundary || boundary.length < 3) {
    g.rect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
      .fill({ color: hexToNum(theme.rockDeepest) });
    return g;
  }

  const polys: Point[][] = [boundary, ...obstacles];
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const spacing = Math.max(6, (w + h) / 40);
  const margin = spacing * 2.5;
  const minX = bounds.minX - margin, maxX = bounds.maxX + margin;
  const minY = bounds.minY - margin, maxY = bounds.maxY + margin;

  // A point is rock if it's outside the cave interior, or inside an island.
  const inRock = (x: number, y: number): boolean => {
    if (!pointInPoly(x, y, boundary)) return true;
    for (const ob of obstacles) if (pointInPoly(x, y, ob)) return true;
    return false;
  };

  const pts: number[] = [];
  const push = (x: number, y: number) => pts.push(x, y);

  // 1. Densified points along every polygon edge — keeps facets hugging the
  //    cave outline so the rim reads clean.
  const addEdgePoints = (poly: Point[]) => {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / spacing));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
    }
  };
  for (const poly of polys) addEdgePoints(poly);

  // 2. Expanded-rect perimeter so rock reaches past the camera view.
  addEdgePoints([
    { x: minX, y: minY }, { x: maxX, y: minY },
    { x: maxX, y: maxY }, { x: minX, y: maxY },
  ]);

  // 3. Jittered interior grid, keeping only rock points.
  const rng = mulberry32((0x5eed ^ Math.round(w * 131 + h)) >>> 0);
  for (let y = minY; y <= maxY; y += spacing) {
    for (let x = minX; x <= maxX; x += spacing) {
      const jx = x + (rng() - 0.5) * spacing * 0.7;
      const jy = y + (rng() - 0.5) * spacing * 0.7;
      if (inRock(jx, jy)) push(jx, jy);
    }
  }

  const del = new Delaunator(Float64Array.from(pts));
  const tri = del.triangles;

  // Depth ramp: rim (t=1) → deep (t=0).
  const ramp = [
    hexToNum(theme.rockDeepest),
    hexToNum(theme.rockDark),
    hexToNum(theme.rockMid),
    hexToNum(theme.rockLight),
  ];
  const rampAt = (t: number): number => {
    const u = Math.min(0.9999, Math.max(0, t)) * (ramp.length - 1);
    const i = Math.floor(u);
    return lerpColor(ramp[i], ramp[i + 1], u - i);
  };
  const falloff = spacing * 2.2;

  for (let i = 0; i < tri.length; i += 3) {
    const i0 = tri[i], i1 = tri[i + 1], i2 = tri[i + 2];
    const ax = pts[i0 * 2], ay = pts[i0 * 2 + 1];
    const bx = pts[i1 * 2], by = pts[i1 * 2 + 1];
    const cx = pts[i2 * 2], cy = pts[i2 * 2 + 1];
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3;

    // Clip to the rock region. Test the centroid AND the three edge midpoints
    // so triangles that bridge a concavity (centroid in rock, but a long edge
    // crossing the interior) are dropped.
    if (!inRock(mx, my)) continue;
    if (!inRock((ax + bx) / 2, (ay + by) / 2)) continue;
    if (!inRock((bx + cx) / 2, (by + cy) / 2)) continue;
    if (!inRock((cx + ax) / 2, (cy + ay) / 2)) continue;

    // Depth + nearest interior-facing direction (for the light swing).
    let best = Infinity, ndx = 0, ndy = 0;
    for (const poly of polys) {
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k], q = poly[(k + 1) % poly.length];
        const r = distPointSeg(mx, my, p.x, p.y, q.x, q.y);
        if (r.dist < best) { best = r.dist; ndx = r.cx - mx; ndy = r.cy - my; }
      }
    }
    let col = rampAt(1 - best / falloff);
    const nl = Math.hypot(ndx, ndy) || 1;
    const dot = (ndx / nl) * LIGHT_X + (ndy / nl) * LIGHT_Y;
    col = dot >= 0 ? lighten(col, dot * 0.16) : darken(col, -dot * 0.16);

    g.poly([ax, ay, bx, by, cx, cy]).fill({ color: col });
  }

  // Rim light along the interior edges, on top of the facets.
  const rim = hexToNum(theme.rockRim);
  for (const poly of polys) {
    const fp: number[] = [];
    for (const p of poly) fp.push(p.x, p.y);
    g.poly(fp).stroke({ color: rim, width: 0.5, alignment: 0.5, join: "round" });
  }

  return g;
}
