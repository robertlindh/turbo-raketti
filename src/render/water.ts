// WaterLayer — animated, interactive vector water for the cave pools.
//
// Each zone's surface is a row of spring points (the classic 2D water sim:
// every point has a height offset and velocity, springs back toward rest, and
// bleeds motion into its neighbours), so waves ripple outward from a
// disturbance and reflect off the pool edges. A faint ambient swell keeps the
// surface alive even when nothing touches it.
//
// Connection to the environment: the layer is drawn UNDER the rock mesh. The
// fill extends far below the floor and past the pool ends into the walls, and
// the opaque rock covers the excess — so the visible water is pixel-exactly
// "water ∩ cave interior". No sampled bottom edge, no seams: the waterline
// runs straight into the rock. Only the authored surface height and extent
// matter; ends over open floor get a shoreline taper that tucks the surface
// under the floor line.
//
// Deliberately renderer-only: the drag physics stays in Game.ts. If update()
// is never called (the level editor preview), the springs sit at rest and the
// water renders as a correct static pool.

import { Container, Graphics } from "pixi.js";
import type { Level, Point } from "../level/Level";
import { pointInPolygon, verticalHits } from "../level/geometry";

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

/** Extra surface samples pushed into a wall at each end (hidden by the
 *  rock, so the visible waterline meets the wall exactly). */
const WALL_EXTEND_SAMPLES = 3;
/** How far the waterline may extend past the authored zone to reach the
 *  nearest wall (m). Water finds its level — the authored polygon only says
 *  roughly where the pool is; the basin decides where it ends. */
const MAX_EXTEND = 60;

const BODY_COLOR = 0x387cc8;
const BODY_ALPHA = 0.55;
const CREST_COLOR = 0xa0dcff;
const SHIMMER_COLOR = 0xc8f0ff;

interface Zone {
  /** Surface sample x positions (fixed, uniform SAMPLE_STEP). */
  xs: number[];
  /** Rest surface height per sample (world y, +y down). */
  restY: number[];
  /** Flat bottom of the fill, far below the real floor (rock covers it). */
  deepY: number;
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
    for (const poly of waterZones) {
      const zone = buildZone(poly, level);
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

  /** Is the world point under a pool's live surface? This is the single
   *  source of truth for "in water" — Game's drag physics uses it, so the
   *  slowdown zone always matches the rendered pool (including the
   *  wall-to-wall extension and the waves themselves). */
  contains(x: number, y: number): boolean {
    const z = this.zoneAt(x);
    if (!z) return false;
    const i = nearestIndex(z, x);
    return y >= z.restY[i] + z.offset[i] && y <= z.deepY;
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
      // Body — live surface polyline, closed by two deep corners. The rock
      // mesh above this layer crops it to the basin.
      const pts: number[] = [];
      for (let i = 0; i < n; i++) pts.push(z.xs[i], z.restY[i] + z.offset[i]);
      pts.push(z.xs[n - 1], z.deepY, z.xs[0], z.deepY);
      g.poly(pts).fill({ color: BODY_COLOR, alpha: BODY_ALPHA });

      // Crest line along the live surface — runs into the rock at the ends.
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

/**
 * Build a zone from a water polygon: water finds its level. The authored
 * polygon only supplies WHERE the pool is and roughly how high it sits — the
 * rest surface becomes one flat horizontal waterline (the median of the
 * authored top edge), extended in both directions until it enters rock, so
 * the pool always fills its basin wall-to-wall. The fill's bottom is a flat
 * deep line the rock mesh covers.
 */
function buildZone(poly: Point[], level: Level): Zone | null {
  if (poly.length < 3) return null;
  const inRock = (x: number, y: number): boolean => {
    if (!pointInPolygon(x, y, level.boundary)) return true;
    for (const ob of level.obstacles) if (pointInPolygon(x, y, ob)) return true;
    return false;
  };

  let minX = Infinity, maxX = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  // Inset half a step so edge columns always intersect the polygon.
  const x0 = minX + SAMPLE_STEP * 0.4;
  const x1 = maxX - SAMPLE_STEP * 0.4;
  if (x1 <= x0) return null;

  // Sample the authored top edge, then flatten to its median: that's the
  // pool's water level. (Median, not min/max, so one stray vertex in a
  // hand-drawn zone can't raise or sink the whole pool.)
  const hits: number[] = [];
  const tops: number[] = [];
  for (let x = x0; x <= x1 + 1e-6; x += SAMPLE_STEP) {
    hits.length = 0;
    verticalHits(poly, x, hits);
    if (hits.length < 2) continue;
    tops.push(Math.min(...hits));
  }
  if (tops.length < 3) return null;
  const sorted = tops.slice().sort((a, b) => a - b);
  const waterLevel = sorted[Math.floor(sorted.length / 2)];

  // Walk outward from the authored extent until the waterline enters rock,
  // then push a few hidden anchor samples into it. If there's no rock within
  // MAX_EXTEND (unenclosed level), just stop — the fill ends off-screen.
  const probeY = waterLevel + 0.4;
  let left = x0;
  let right = x1;
  for (let d = 0; d <= MAX_EXTEND; d += SAMPLE_STEP) {
    if (inRock(x0 - d, probeY)) { left = x0 - d; break; }
    left = x0 - d;
  }
  for (let d = 0; d <= MAX_EXTEND; d += SAMPLE_STEP) {
    if (inRock(x1 + d, probeY)) { right = x1 + d; break; }
    right = x1 + d;
  }
  left -= WALL_EXTEND_SAMPLES * SAMPLE_STEP;
  right += WALL_EXTEND_SAMPLES * SAMPLE_STEP;

  const count = Math.max(4, Math.round((right - left) / SAMPLE_STEP) + 1);
  const xs: number[] = new Array(count);
  for (let i = 0; i < count; i++) xs[i] = left + i * SAMPLE_STEP;

  return {
    xs,
    restY: new Array(count).fill(waterLevel),
    deepY: level.bounds.maxY + 4,
    offset: new Array(count).fill(0),
    vel: new Array(count).fill(0),
  };
}
