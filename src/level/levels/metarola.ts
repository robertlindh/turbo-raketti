// Metarola — the "high-tech cave" theme. Industrial purple-blue palette,
// cyan crystal accents, jagged interior with two pillars to fly around.

import type { Level } from "../Level";

export const metarola: Level = {
  name: "Metarola",
  theme: {
    name: "Metarola",
    skyTop: "#1a1230",
    skyBottom: "#070418",
    nebula: "#7e5cd8",
    starColor: "#c8dcff",
    rockDeepest: "#0a0414",
    rockDark: "#241834",
    rockMid: "#3a2848",
    rockLight: "#5e4670",
    rockRim: "#9e88be",
    accent: "#82d8ff",
  },
  bounds: { minX: -136, maxX: 136, minY: -88, maxY: 88 },
  // CCW boundary: trace the cave interior. Author the points in screen-CCW
  // (i.e. going right along the top, down the right, left along the bottom,
  // up the left). The renderer fills everything outside this polygon with
  // rock, and the polyline collider keeps ships inside.
  boundary: [
    // Top edge — irregular ceiling.
    { x: -112, y: -60 },
    { x: -88, y: -64 },
    { x: -64, y: -56 },
    { x: -40, y: -64 },
    { x: -16, y: -58 },
    { x: 8, y: -64 },
    { x: 32, y: -56 },
    { x: 56, y: -64 },
    { x: 80, y: -60 },
    { x: 104, y: -64 },
    { x: 112, y: -56 },
    // Right wall — bulges inward.
    { x: 108, y: -40 },
    { x: 96, y: -24 },
    { x: 104, y: 0 },
    { x: 92, y: 24 },
    { x: 104, y: 40 },
    { x: 108, y: 56 },
    // Bottom edge — sculpted floor.
    { x: 96, y: 60 },
    { x: 72, y: 64 },
    { x: 48, y: 60 },
    { x: 24, y: 64 },
    { x: 0, y: 56 },
    { x: -24, y: 64 },
    { x: -48, y: 60 },
    { x: -72, y: 64 },
    { x: -96, y: 60 },
    { x: -108, y: 56 },
    // Left wall.
    { x: -104, y: 40 },
    { x: -92, y: 24 },
    { x: -104, y: 0 },
    { x: -92, y: -24 },
    { x: -104, y: -40 },
  ],
  // Two interior pillars to fly around. CW winding.
  obstacles: [
    // Central pillar — vertical column with notched corners.
    [
      { x: -8, y: -16 },
      { x: 8, y: -16 },
      { x: 10, y: -8 },
      { x: 8, y: 8 },
      { x: 10, y: 24 },
      { x: 8, y: 32 },
      { x: -8, y: 32 },
      { x: -10, y: 24 },
      { x: -8, y: 8 },
      { x: -10, y: -8 },
    ],
    // Hanging stalactite from the ceiling, left of centre.
    [
      { x: -56, y: -56 },
      { x: -40, y: -56 },
      { x: -44, y: -40 },
      { x: -48, y: -32 },
      { x: -52, y: -40 },
    ],
    // Ground bump on the right.
    [
      { x: 48, y: 64 },
      { x: 72, y: 64 },
      { x: 68, y: 48 },
      { x: 60, y: 40 },
      { x: 52, y: 48 },
    ],
  ],
  spawns: [
    { x: -88, y: -40, angle: -Math.PI / 2 },
    { x: 88, y: -40, angle: -Math.PI / 2 },
  ],
  decorations: [
    // Floor crystals scattered along the bottom.
    { type: "crystal", x: -88, y: 58 },
    { type: "crystal", x: -64, y: 60 },
    { type: "crystal", x: -32, y: 62 },
    { type: "crystal", x: 16, y: 62 },
    { type: "crystal", x: 40, y: 58 },
    { type: "crystal", x: 88, y: 58 },
    // A few on the ceiling, hanging.
    { type: "crystal", x: -80, y: -58 },
    { type: "crystal", x: 24, y: -58 },
    { type: "crystal", x: 80, y: -58 },
  ],
  // Race checkpoints — clockwise loop around the central pillar.
  checkpoints: [
    { x: -80, y: 0 },   // 1 — far left, mid-height
    { x: 0, y: -44 },   // 2 — top of the cave
    { x: 80, y: 0 },    // 3 — far right
    { x: 0, y: 44 },    // 4 — bottom centre
  ],
  // A long water pool along the bottom — flying through it drags you. Author
  // counter-clockwise on screen (matches the cave-interior winding).
  waterZones: [
    [
      { x: -95, y: 55 },
      { x: -60, y: 56 },
      { x: -30, y: 55 },
      { x: 30, y: 55 },
      { x: 60, y: 56 },
      { x: 95, y: 55 },
      { x: 100, y: 60 },
      { x: 80, y: 64 },
      { x: 50, y: 60 },
      { x: 20, y: 64 },
      { x: -20, y: 64 },
      { x: -50, y: 60 },
      { x: -80, y: 64 },
      { x: -100, y: 60 },
    ],
  ],
};
