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
import type { Point } from "../level/Level";

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

  constructor(waterZones: Point[][]) {
    super();
    this.addChild(this.g);
    for (const poly of waterZones) {
      const zone = buildZone(poly);
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

/** Sample a water polygon into surface/floor columns. For each x step, cast
 *  a vertical line through the polygon: the topmost hit is the surface, the
 *  bottommost is the floor. Concave pools resolve to their outer envelope,
 *  which is right for how the zones are authored (top edge + bottom edge). */
function buildZone(poly: Point[]): Zone | null {
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
  for (let x = x0; x <= x1 + 1e-6; x += SAMPLE_STEP) {
    let top = Infinity, bottom = -Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      if ((a.x <= x) === (b.x <= x)) continue; // edge doesn't span this column
      const y = a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
    if (top === Infinity || bottom <= top) continue;
    xs.push(x);
    restY.push(top);
    bottomY.push(bottom);
  }
  if (xs.length < 3) return null;
  return {
    xs, restY, bottomY,
    offset: new Array(xs.length).fill(0),
    vel: new Array(xs.length).fill(0),
  };
}
