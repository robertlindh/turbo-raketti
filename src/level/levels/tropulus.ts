// Tropulus — the Finnish countryside theme. A wide, shallow twilight valley
// with rolling hills, jagged mountain silhouettes on the sides, and the iconic
// red mökki huts dotted across the floor. Cosy, nostalgic, Nordic.

import type { Level } from "../Level";

export const tropulus: Level = {
  name: "Tropulus",
  theme: {
    name: "Tropulus",
    // Deep twilight blue fading to near-black at the horizon, with a touch of
    // aurora violet near the top.
    skyTop: "#1a2848",
    skyBottom: "#06081a",
    // Faint aurora cyan-green tint for the nebula haze.
    nebula: "#88e8d0",
    // Cool icy white stars.
    starColor: "#dceeff",
    // Granite-under-moonlight palette with a snow-dusted rim.
    rockDeepest: "#08101c",
    rockDark: "#162234",
    rockMid: "#2a3e58",
    rockLight: "#5a7090",
    rockRim: "#dceaf6",
    // Iconic Finnish red-hut paint colour — used for lantern/window lights.
    accent: "#d83838",
  },
  // Same bounds as Metarola so the camera and physics scale identically.
  bounds: { minX: -136, maxX: 136, minY: -88, maxY: 88 },
  // CCW boundary on screen: wide, shallow valley. Low rolling ceiling, jagged
  // mountain silhouettes on the sides, rolling-hill floor profile. Trace order
  // is right-along-top, down the right, left-along-bottom, up the left.
  boundary: [
    // Top edge — a low, mostly open sky ceiling. Gently undulating so the
    // rock above reads as distant low clouds / horizon haze rather than a
    // tight cavern roof.
    { x: -112, y: -52 },
    { x: -92, y: -56 },
    { x: -68, y: -54 },
    { x: -44, y: -58 },
    { x: -20, y: -60 },
    { x: 4, y: -62 },
    { x: 28, y: -60 },
    { x: 52, y: -58 },
    { x: 76, y: -54 },
    { x: 96, y: -56 },
    { x: 112, y: -52 },
    // Right side — a jagged mountain silhouette stepping down toward the
    // valley floor. A few inward notches read as ridges.
    { x: 108, y: -36 },
    { x: 114, y: -20 },
    { x: 104, y: -4 },
    { x: 112, y: 12 },
    { x: 106, y: 28 },
    { x: 112, y: 44 },
    { x: 104, y: 52 },
    // Bottom edge — rolling hills as the valley floor. Big, smooth-ish
    // undulations rather than sharp teeth.
    { x: 88, y: 56 },
    { x: 72, y: 50 },
    { x: 56, y: 56 },
    { x: 40, y: 62 },
    { x: 20, y: 56 },
    { x: 4, y: 52 },
    { x: -12, y: 56 },
    { x: -32, y: 62 },
    { x: -52, y: 56 },
    { x: -68, y: 50 },
    { x: -84, y: 56 },
    { x: -100, y: 52 },
    // Left side — mirror mountain silhouette stepping up to the ceiling.
    { x: -108, y: 44 },
    { x: -114, y: 28 },
    { x: -104, y: 12 },
    { x: -112, y: -4 },
    { x: -106, y: -20 },
    { x: -112, y: -36 },
  ],
  // Interior obstacles — classic Finnish countryside silhouettes. CW winding
  // on screen. Each polygon sits well clear of the boundary.
  obstacles: [
    // Pine tree, left of centre, rising from the valley floor. Tall, narrow
    // triangular silhouette with a short trunk at the base. CW on screen:
    // trace down the right side of the trunk, around the floor, up the left
    // side of the trunk and out through the left branches to the tip, then
    // back down through the right branches.
    [
      { x: -40, y: 52 }, // trunk base, right
      { x: -40, y: 42 }, // trunk top, right
      { x: -40, y: 40 }, // lowest branch tip, right
      { x: -34.8, y: 28 }, // notch
      { x: -40, y: 20 }, // mid branch tip, right
      { x: -35.2, y: 12 }, // notch
      { x: -37.2, y: 2 }, // upper-mid branch tip, right
      { x: -42, y: -10 }, // tip of the pine
      { x: -46.8, y: 2 }, // upper-mid branch tip, left
      { x: -44.8, y: 12 }, // notch
      { x: -50, y: 20 }, // mid branch tip, left
      { x: -45.2, y: 28 }, // notch
      { x: -52, y: 40 }, // lowest branch tip, left
      { x: -44, y: 42 }, // trunk top, left
      { x: -44, y: 52 }, // trunk base, left
    ],
    // Red mökki hut, right of centre, sitting on the valley floor. Pentagon:
    // rectangular body with a triangular gable roof. CW on screen.
    [
      { x: 32, y: 56 }, // bottom-left corner
      { x: 56, y: 56 }, // bottom-right corner
      { x: 56, y: 42 }, // top-right of body
      { x: 44, y: 32 }, // roof peak
      { x: 32, y: 42 }, // top-left of body
    ],
    // Haystack, far right of centre. Low, rounded dome on the floor. CW.
    [
      { x: 76, y: 54 },
      { x: 92, y: 54 },
      { x: 91.2, y: 48 },
      { x: 88.8, y: 44 },
      { x: 84, y: 42 },
      { x: 79.2, y: 44 },
      { x: 76.8, y: 48 },
    ],
  ],
  // Two spawn points in opposite corners, roughly mirror-symmetric. Both sit
  // well inside the cave with >2m clearance from the nearest wall.
  spawns: [
    { x: -96, y: -40, angle: -Math.PI / 2 },
    { x: 96, y: -40, angle: -Math.PI / 2 },
  ],
  // Decoration "crystals" reinterpreted as warm lantern / window lights of
  // distant cottages — scattered along the valley floor in the red accent
  // colour, evoking villages tucked into the dusk.
  decorations: [
    // Far left cluster — a small hamlet near the left mountain.
    { type: "crystal", x: -92, y: 52 },
    { type: "crystal", x: -80, y: 54 },
    { type: "crystal", x: -72, y: 50 },
    // Pine area — a single lantern at the foot of the tree.
    { type: "crystal", x: -56, y: 54 },
    // Between the pine and the hut.
    { type: "crystal", x: -20, y: 54 },
    { type: "crystal", x: -4, y: 52 },
    { type: "crystal", x: 12, y: 54 },
    // The mökki's own warm-lit windows.
    { type: "crystal", x: 38, y: 48 },
    { type: "crystal", x: 50, y: 48 },
    // Haystack neighbours.
    { type: "crystal", x: 68, y: 52 },
    { type: "crystal", x: 100, y: 50 },
  ],
};
