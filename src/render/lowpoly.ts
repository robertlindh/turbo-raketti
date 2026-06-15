// Low-poly flat-shaded 3D art helpers (art "Style 2").
//
// Shared toolkit for the vectorised look: simple colour ramp math plus the
// ship hull facet model. Drawn with Pixi `Graphics` so the art stays crisp at
// any camera zoom instead of baking a raster texture. Reused by the player /
// bot ships (Ship.ts) and the remote multiplayer ghost (Game.ts); gates and
// the cave will hang their own facet builders off the same colour helpers.

import type { Graphics } from "pixi.js";

// ---------------------------------------------------------------------------
// Colour ramp — flat per-facet shading is just the base hull colour mixed
// toward white (lit faces) or black (shadowed faces) by a fixed factor.
// Working in 0xRRGGBB integers so the results drop straight into Graphics
// `.fill({ color })` without string round-trips.
// ---------------------------------------------------------------------------

/** Mix colour `c` toward `target` by `k` (0 = c, 1 = target). */
function mix(c: number, target: number, k: number): number {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  const tr = (target >> 16) & 0xff;
  const tg = (target >> 8) & 0xff;
  const tb = target & 0xff;
  const rr = Math.round(r + (tr - r) * k);
  const gg = Math.round(g + (tg - g) * k);
  const bb = Math.round(b + (tb - b) * k);
  return (rr << 16) | (gg << 8) | bb;
}

/** Lighten toward white by `k`. */
export function lighten(c: number, k: number): number {
  return mix(c, 0xffffff, k);
}

/** Darken toward black by `k`. */
export function darken(c: number, k: number): number {
  return mix(c, 0x000000, k);
}

// ---------------------------------------------------------------------------
// Ship hull — a faceted delta drawn in the legacy 13×14 "sprite-pixel" space,
// centred on (0, 0), nose pointing UP (−Y). Keeping the original footprint
// means the flame, shield and power-up auras (which are positioned in that
// same space) line up unchanged, and the parent container's metres-per-pixel
// scale still maps the hull to ~2 m wide in world space.
//
// The centreline splits the hull into a lit right half and a shadowed left
// half — that two-tone split, plus a bright spine sliver, is what reads as a
// 3D faceted form rather than a flat silhouette. Light is treated as coming
// from the upper-right.
// ---------------------------------------------------------------------------

// Silhouette anchor points (sprite-px, origin = centre).
const NOSE: [number, number] = [0, -7];
const R_SHOULDER: [number, number] = [2, -2];
const L_SHOULDER: [number, number] = [-2, -2];
const R_MID: [number, number] = [3.5, 2];
const L_MID: [number, number] = [-3.5, 2];
const R_WING: [number, number] = [6.5, 6];
const L_WING: [number, number] = [-6.5, 6];
const R_TAIL: [number, number] = [2, 6];
const L_TAIL: [number, number] = [-2, 6];
const TAIL_C: [number, number] = [0, 4.5];

/** Flatten a list of points into the [x0,y0,x1,y1,…] array Graphics wants. */
function flat(...pts: Array<[number, number]>): number[] {
  const out: number[] = [];
  for (const [x, y] of pts) out.push(x, y);
  return out;
}

// ---------------------------------------------------------------------------
// World-fixed lighting. Each sloped facet is given a "tilt" — the horizontal
// direction its surface normal leans toward in ship-local space (nose = −Y).
// When the hull is rotated by `angle` on screen, we rotate that tilt into
// world space and dot it against a fixed light direction, so the lit side
// sweeps across the hull as the ship turns rather than rotating rigidly with
// it. `+Y` is DOWN, so the light below points from the upper-left.
// ---------------------------------------------------------------------------

const LIGHT_X = -0.55;
const LIGHT_Y = -0.83;
/** Max ± brightness swing applied to a facet fully facing toward/away. */
const SHADE_AMOUNT = 0.85;

/** Shade `base` by how much a facet (local tilt tx,ty) faces the light once
 *  rotated by (ca,sa) = (cos angle, sin angle). */
function shade(
  base: number,
  tx: number,
  ty: number,
  ca: number,
  sa: number,
): number {
  const wx = tx * ca - ty * sa;
  const wy = tx * sa + ty * ca;
  const d = wx * LIGHT_X + wy * LIGHT_Y; // −1 (away) … 1 (toward)
  return d >= 0 ? lighten(base, d * SHADE_AMOUNT) : darken(base, -d * SHADE_AMOUNT);
}

/**
 * Paint the low-poly hull into `g` (cleared first). `color` is the base hull
 * tint — 0x4fa0d0 for the classic blue P1, a red for P2, etc. Every facet is
 * derived from it, so per-player colours come through for free. `angle` is the
 * hull's on-screen rotation in radians (the ship view's `rotation`); pass it
 * each frame so the sloped facets re-light as the ship turns.
 */
export function drawLowPolyHull(g: Graphics, color: number, angle = 0): void {
  g.clear();

  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const fuse = color;
  const wing = darken(color, 0.12); // wings sit a touch darker than the fuselage
  const deep = darken(color, 0.55);
  const spineHi = lighten(color, 0.5);
  const outline = 0x0a0414;
  const canopyHi = 0xbfeeff;
  const canopyLo = 0x4a90c0;

  // Wings first (furthest back), then fuselage halves — each lit by its tilt.
  g.poly(flat(R_MID, R_WING, R_TAIL, TAIL_C)).fill({ color: shade(wing, 0.85, 0.25, ca, sa) });
  g.poly(flat(L_MID, TAIL_C, L_TAIL, L_WING)).fill({ color: shade(wing, -0.85, 0.25, ca, sa) });
  g.poly(flat(NOSE, R_SHOULDER, R_MID, TAIL_C)).fill({ color: shade(fuse, 0.7, -0.3, ca, sa) });
  g.poly(flat(NOSE, TAIL_C, L_MID, L_SHOULDER)).fill({ color: shade(fuse, -0.7, -0.3, ca, sa) });

  // Engine block at the rear notch (the flame attaches just below, ~y=6).
  g.poly([-1.6, 4.4, 1.6, 4.4, 1.1, 6.2, -1.1, 6.2]).fill({ color: deep });

  // Bright spine sliver — the centreline ridge, a near-constant specular
  // highlight that only drifts slightly with the light.
  g.poly([0, -6.5, 0.9, -1, 0, 4.5, -0.9, -1]).fill({ color: shade(spineHi, 0, -0.4, ca, sa) });

  // Canopy — bright upper facet, darker lower facet (glass, kept constant).
  g.poly([0, -3.4, 1.5, -1.4, -1.5, -1.4]).fill({ color: canopyHi });
  g.poly([1.5, -1.4, 0, 0.4, -1.5, -1.4]).fill({ color: canopyLo });

  // Outline silhouette last so the facet seams read crisply.
  g.poly(
    flat(NOSE, R_SHOULDER, R_MID, R_WING, R_TAIL, TAIL_C, L_TAIL, L_WING, L_MID, L_SHOULDER),
  ).stroke({ color: outline, width: 0.5, alignment: 0.5, join: "round" });
}

// ---------------------------------------------------------------------------
// Faceted ring — a low-poly "torus" for the race-checkpoint gates. The ring
// is split into `segments` flat trapezoid facets; each is shaded by how much
// its outward normal faces the same world light as the ship, so the gate
// reads as a 3D ring catching light from the upper-left. Thin dark radial
// seams sell the facet edges. Drawn centred on (0, 0) in world metres.
// ---------------------------------------------------------------------------

/** Gentler swing than the ship so gates stay readable on their shadow side. */
const RING_SHADE = 0.5;

export function drawFacetRing(
  g: Graphics,
  innerR: number,
  outerR: number,
  segments: number,
  base: number,
): void {
  const seam = darken(base, 0.7);
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const d = Math.cos(mid) * LIGHT_X + Math.sin(mid) * LIGHT_Y;
    const col = d >= 0 ? lighten(base, d * RING_SHADE) : darken(base, -d * RING_SHADE);
    g.poly([
      Math.cos(a0) * innerR, Math.sin(a0) * innerR,
      Math.cos(a0) * outerR, Math.sin(a0) * outerR,
      Math.cos(a1) * outerR, Math.sin(a1) * outerR,
      Math.cos(a1) * innerR, Math.sin(a1) * innerR,
    ]).fill({ color: col });
  }
  // Radial seams between facets.
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    g.poly([
      Math.cos(a) * innerR, Math.sin(a) * innerR,
      Math.cos(a) * outerR, Math.sin(a) * outerR,
    ]).stroke({ color: seam, width: 0.1 });
  }
}
