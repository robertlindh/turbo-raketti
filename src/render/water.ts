// WaterLayer — animated, interactive vector water for the cave pools.
//
// Replaces the old baked-raster water polygon. Each zone's surface is a row
// of spring points (the classic 2D water sim: every point has a height offset
// and velocity, springs back toward rest, and bleeds motion into its
// neighbours), so waves ripple outward from a disturbance and reflect off the
// pool edges. A faint ambient swell keeps the surface alive even when nothing
// touches it. The body + crest are redrawn as flat vector polygons each frame,
// matching the low-poly art style.
//
// Deliberately renderer-only: the drag physics stays in Game.ts. If update()
// is never called (the level editor preview), the springs sit at rest and the
// water renders as a correct static pool.

import { Container, Graphics } from "pixi.js";
import type { Level, Point } from "../level/Level";

/** Horizontal spacing between surface spring points (metres). */
const SAMPLE_STEP = 1.2;
/** Spring stiffness toward rest height (1/s²). */
const SPRING_K = 34;
/** Velocity damping (1/s). */
const DAMPING = 2.6;
/** Neighbour spread rate (1/s²) — how fast waves travel sideways. */
const SPREAD = 22;
/** Neighbour-spread smoothing passes per update. */
const SPREAD_PASSES = 2;
/** Hard clamp on surface displacement (m) so splashes can't explode. */
const MAX_OFFSET = 1.4;

const BODY_COLOR = 0x387cc8;
const BODY_ALPHA = 0.55;
const CREST_COLOR = 0xa0dcff;
const SHIMMER_COLOR = 0xc8f0ff;

interface Zone {
  /** Surface sample x positions (fixed). */
  xs: number[];
  /** Rest surface height per sample (world y, +y down). */
  restY: number[];
  /** Pool floor per sample — the polygon's bottom edge, for closing the fill. */
  bottomY: number[];
  /** Spring state: current offset from rest (+ = pushed down) and velocity. */
  offset: number[];
  vel: number[];
}

export class WaterLayer extends Container {
  private zones: Zone[] = [];
  private g = new Graphics();
  private t = 0;

  constructor(waterZones: Point[][], level: Level) {
    super();
    this.addChild(this.g);
    // The rock the water must sit in: cave boundary + obstacle islands.
    const solids: Point[][] = [level.boundary, ...level.obstacles];
    for (const poly of waterZones) {
      const zone = buildZone(poly, solids);
      if (zone) this.zones.push(zone);
    }
    this.redraw(); // static rest state (editor preview / pre-first-update)
  }

  /** True if any zone contains surface near world x (cheap x-range check). */
  private zoneAt(x: number): Zone | null {
    for (const z of this.zones) {
      if (x >= z.xs[0] && x <= z.xs[z.xs.length - 1]) return z;
    }
    return null;
  }

  /** Surface world-y at x, or null if x isn't over water. Game uses this to
   *  decide whether a disturbance is near the surface. */
  surfaceYAt(x: number): number | null {
    const z = this.zoneAt(x);
    if (!z) return null;
    const i = nearestIndex(z, x);
    return z.restY[i] + z.offset[i];
  }

  /** Kick the surface at world x with a vertical impulse (m/s). Positive =
   *  push down (a ship plunging in), negative = suck up (leaving). The kick
   *  is spread over a few samples so even hard hits stay smooth. */
  disturb(x: number, impulse: number): void {
    const z = this.zoneAt(x);
    if (!z) return;
    const i = nearestIndex(z, x);
    const clamped = Math.max(-20, Math.min(20, impulse));
    for (let d = -2; d <= 2; d++) {
      const j = i + d;
      if (j < 0 || j >= z.xs.length) continue;
      const falloff = 1 - Math.abs(d) * 0.35;
      z.vel[j] += clamped * falloff;
    }
  }

  /** Advance the spring sim + ambient swell and redraw. Call once per frame
   *  with real dt (not fixed dt) — visuals only, nothing physics reads this. */
  update(dt: number): void {
    if (this.zones.length === 0) return;
    this.t += dt;
    const step = Math.min(dt, 1 / 30); // clamp huge frames; sim stays stable
    for (const z of this.zones) {
      const n = z.xs.length;
      // Springs toward rest + damping + a whisper of ambient swell.
      for (let i = 0; i < n; i++) {
        const swell = Math.sin(this.t * 1.4 + z.xs[i] * 0.35) * 0.10;
        const accel = -SPRING_K * (z.offset[i] - swell) - DAMPING * z.vel[i];
        z.vel[i] += accel * step;
        z.offset[i] += z.vel[i] * step;
        if (z.offset[i] > MAX_OFFSET) { z.offset[i] = MAX_OFFSET; z.vel[i] = 0; }
        else if (z.offset[i] < -MAX_OFFSET) { z.offset[i] = -MAX_OFFSET; z.vel[i] = 0; }
      }
      // Neighbour spread — waves travel sideways and reflect at the ends.
      for (let pass = 0; pass < SPREAD_PASSES; pass++) {
        for (let i = 0; i < n; i++) {
          if (i > 0) z.vel[i - 1] += SPREAD * (z.offset[i] - z.offset[i - 1]) * step;
          if (i < n - 1) z.vel[i + 1] += SPREAD * (z.offset[i] - z.offset[i + 1]) * step;
        }
      }
    }
    this.redraw();
  }

  private redraw(): void {
    const g = this.g;
    g.clear();
    for (const z of this.zones) {
      const n = z.xs.length;
      // Body — surface polyline forward, floor polyline back.
      const pts: number[] = [];
      for (let i = 0; i < n; i++) pts.push(z.xs[i], z.restY[i] + z.offset[i]);
      for (let i = n - 1; i >= 0; i--) pts.push(z.xs[i], z.bottomY[i]);
      g.poly(pts).fill({ color: BODY_COLOR, alpha: BODY_ALPHA });

      // Crest line along the live surface.
      g.moveTo(z.xs[0], z.restY[0] + z.offset[0]);
      for (let i = 1; i < n; i++) g.lineTo(z.xs[i], z.restY[i] + z.offset[i]);
      g.stroke({ color: CREST_COLOR, width: 0.35, alpha: 0.7 });

      // Faint shimmer line just under the surface, following the waves at
      // half amplitude so the two lines slide against each other.
      g.moveTo(z.xs[0], z.restY[0] + z.offset[0] * 0.5 + 1.1);
      for (let i = 1; i < n; i++) {
        g.lineTo(z.xs[i], z.restY[i] + z.offset[i] * 0.5 + 1.1);
      }
      g.stroke({ color: SHIMMER_COLOR, width: 0.2, alpha: 0.16 });
    }
  }
}

/** Nearest surface-sample index to world x (xs is uniform, so O(1)). */
function nearestIndex(z: Zone, x: number): number {
  const i = Math.round((x - z.xs[0]) / SAMPLE_STEP);
  return Math.max(0, Math.min(z.xs.length - 1, i));
}

/** How far past the rock line the fill extends (m) — hides hairline seams
 *  between the water fill and the rock mesh at facet edges. */
const ROCK_OVERFILL = 0.3;
/** Shoreline length (in samples) when a pool ends over open floor — the
 *  surface eases down to meet the rock instead of cutting off mid-air. */
const SHORE_SAMPLES = 4;

/** All y-intersections of the vertical line at `x` with a polygon's edges. */
function columnHits(poly: Point[], x: number, out: number[]): void {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    if ((a.x <= x) === (b.x <= x)) continue; // edge doesn't span this column
    out.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
  }
}

/**
 * Sample a water polygon into surface/floor columns, aligned to the cave.
 * The authored polygon supplies the surface height and horizontal extent;
 * the *bottom* of each column comes from the actual rock geometry — the
 * first boundary/obstacle edge below the surface — so the pool always sits
 * exactly in its basin regardless of how sloppily the zone was drawn.
 * Pool ends over open floor get a short shoreline taper.
 */
function buildZone(poly: Point[], solids: Point[][]): Zone | null {
  if (poly.length < 3) return null;
  let minX = Infinity, maxX = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  // Inset half a step so edge columns always intersect the polygon.
  const x0 = minX + SAMPLE_STEP * 0.4;
  const x1 = maxX - SAMPLE_STEP * 0.4;
  if (x1 <= x0) return null;

  const xs: number[] = [];
  const restY: number[] = [];
  const bottomY: number[] = [];
  const hits: number[] = [];
  for (let x = x0; x <= x1 + 1e-6; x += SAMPLE_STEP) {
    // Surface + authored bottom from the water polygon itself.
    hits.length = 0;
    columnHits(poly, x, hits);
    if (hits.length < 2) continue;
    let top = Infinity, authoredBottom = -Infinity;
    for (const y of hits) {
      if (y < top) top = y;
      if (y > authoredBottom) authoredBottom = y;
    }

    // Rock line: the first solid edge below the surface in this column —
    // the cave floor, or an obstacle top if an island pokes into the pool.
    let rock = Infinity;
    for (const solid of solids) {
      hits.length = 0;
      columnHits(solid, x, hits);
      for (const y of hits) {
        if (y > top + 0.05 && y < rock) rock = y;
      }
    }
    // Fill down into the rock slightly; fall back to the authored bottom
    // where no rock exists below (shouldn't happen in a closed cave).
    const bottom = rock !== Infinity ? rock + ROCK_OVERFILL : authoredBottom;
    if (bottom <= top) continue;
    xs.push(x);
    restY.push(top);
    bottomY.push(bottom);
  }
  if (xs.length < 3) return null;

  // Shoreline taper — where a pool END sits over open floor (deep water at
  // the last column), ease the surface down to the rock over a few samples
  // so the pool reads as filling its basin instead of ending in a wall of
  // water. Ends that already meet rock (depth ≈ 0) are left alone.
  const n = xs.length;
  const shore = Math.min(SHORE_SAMPLES, Math.floor(n / 3));
  const taper = (idx: number, w: number) => {
    const floor = bottomY[idx] - ROCK_OVERFILL;
    const depth = floor - restY[idx];
    if (depth > 0.2) restY[idx] = floor - depth * w;
  };
  for (let i = 0; i < shore; i++) {
    const w = (i + 0.5) / shore; // 0 at the tip → 1 pool-inward
    taper(i, w);
    taper(n - 1 - i, w);
  }

  return {
    xs, restY, bottomY,
    offset: new Array(n).fill(0),
    vel: new Array(n).fill(0),
  };
}
