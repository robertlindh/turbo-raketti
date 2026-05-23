// Ekolos — the "eco-cave" theme from the original 1992 TurboRaketti.
// A lush underground grotto: mossy floors, rooty ceiling, luminescent
// leaf-green flora as accents. Earthy palette, organic curves throughout.

import type { Level } from "../Level";

export const ekolos: Level = {
  name: "Ekolos",
  theme: {
    name: "Ekolos",
    skyTop: "#0e2818",
    skyBottom: "#040c08",
    nebula: "#a8d870",
    starColor: "#fff4d0",
    rockDeepest: "#0c1408",
    rockDark: "#1e2812",
    rockMid: "#34421c",
    rockLight: "#6a8240",
    rockRim: "#b8d480",
    accent: "#a8ff80",
  },
  // Bounds extend ~6m past the polygon on each side so the rock has visual
  // breathing room around the playable grotto.
  bounds: { minX: -136, maxX: 136, minY: -88, maxY: 88 },
  // CCW boundary on screen: trace the cave interior going right along the
  // ceiling, down the right wall, left along the floor, and up the left.
  // Lots of small bumps to evoke roots, moss mounds and bulging rock — no
  // straight segments longer than ~6m.
  boundary: [
    // Ceiling — irregular, with hanging-root scallops.
    { x: -108, y: -56 },
    { x: -96, y: -60 },
    { x: -84, y: -54 },
    { x: -72, y: -62 },
    { x: -60, y: -52 },
    { x: -48, y: -60 },
    { x: -36, y: -54 },
    { x: -24, y: -62 },
    { x: -12, y: -56 },
    { x: 0, y: -62 },
    { x: 12, y: -54 },
    { x: 24, y: -60 },
    { x: 36, y: -52 },
    { x: 48, y: -62 },
    { x: 60, y: -56 },
    { x: 72, y: -62 },
    { x: 84, y: -54 },
    { x: 96, y: -60 },
    { x: 108, y: -54 },
    // Right wall — bulging, organic.
    { x: 104, y: -40 },
    { x: 96, y: -24 },
    { x: 104, y: -8 },
    { x: 100, y: 8 },
    { x: 108, y: 24 },
    { x: 100, y: 40 },
    { x: 104, y: 52 },
    // Floor — scalloped with mossy mounds.
    { x: 92, y: 60 },
    { x: 76, y: 56 },
    { x: 64, y: 62 },
    { x: 48, y: 56 },
    { x: 36, y: 62 },
    { x: 20, y: 56 },
    { x: 8, y: 62 },
    { x: -8, y: 56 },
    { x: -24, y: 62 },
    { x: -40, y: 56 },
    { x: -52, y: 62 },
    { x: -68, y: 56 },
    { x: -80, y: 62 },
    { x: -96, y: 56 },
    { x: -104, y: 52 },
    // Left wall — mirrors the right with its own organic bulges.
    { x: -100, y: 40 },
    { x: -108, y: 24 },
    { x: -100, y: 8 },
    { x: -104, y: -8 },
    { x: -96, y: -24 },
    { x: -104, y: -40 },
  ],
  // Three organic obstacles. CW winding on screen.
  obstacles: [
    // Tree-stump platform on the lower-left floor — a roundish mound.
    [
      { x: -56, y: 32 },
      { x: -44, y: 30 },
      { x: -36, y: 36 },
      { x: -34, y: 44 },
      { x: -40, y: 50 },
      { x: -52, y: 52 },
      { x: -60, y: 48 },
      { x: -62, y: 40 },
    ],
    // Hanging root cluster from the ceiling, right of centre — bulbous,
    // narrowing as it droops down.
    [
      { x: 28, y: -54 },
      { x: 44, y: -52 },
      { x: 52, y: -44 },
      { x: 50, y: -32 },
      { x: 44, y: -22 },
      { x: 38, y: -16 },
      { x: 32, y: -22 },
      { x: 26, y: -32 },
      { x: 24, y: -44 },
    ],
    // Central boulder cluster — a clump of round stones at mid-height.
    [
      { x: -12, y: -4 },
      { x: 0, y: -8 },
      { x: 12, y: -4 },
      { x: 16, y: 4 },
      { x: 14, y: 12 },
      { x: 6, y: 16 },
      { x: -6, y: 16 },
      { x: -14, y: 12 },
      { x: -16, y: 4 },
    ],
    // Lower-right boulder/moss mound on the floor.
    [
      { x: 56, y: 44 },
      { x: 68, y: 42 },
      { x: 76, y: 48 },
      { x: 76, y: 54 },
      { x: 64, y: 54 },
      { x: 52, y: 52 },
    ],
  ],
  spawns: [
    // Upper-left and upper-right pockets, roughly mirror-symmetric and well
    // clear of the ceiling, walls and the central boulder cluster.
    { x: -80, y: -40, angle: -Math.PI / 2 },
    { x: 80, y: -40, angle: -Math.PI / 2 },
  ],
  decorations: [
    // Luminescent flora along the floor.
    { type: "crystal", x: -88, y: 58 },
    { type: "crystal", x: -72, y: 59.2 },
    { type: "crystal", x: -16, y: 59.2 },
    { type: "crystal", x: 16, y: 59.2 },
    { type: "crystal", x: 44, y: 58 },
    { type: "crystal", x: 84, y: 58 },
    // A few clinging to ledges on the walls.
    { type: "crystal", x: -100, y: 16 },
    { type: "crystal", x: 100, y: 16 },
    { type: "crystal", x: -100, y: -32 },
    { type: "crystal", x: 100, y: -32 },
    // Glowing buds on the ceiling.
    { type: "crystal", x: -64, y: -56.8 },
    { type: "crystal", x: -8, y: -59.2 },
    { type: "crystal", x: 68, y: -58 },
  ],
};
