// Lavanos — the volcanic depths theme. A wide cavern with a narrowing
// central "throat" between two duelling chambers, a sunken lava floor with
// island stalagmites, and dripping stalactites from the ceiling. Hot reds,
// glowing magma orange, sooty black rock.

import type { Level } from "../Level";

export const lavanos: Level = {
  name: "Lavanos",
  theme: {
    name: "Lavanos",
    // Dark plum-red sky fading to near-black at the floor.
    skyTop: "#2a0810",
    skyBottom: "#0a0204",
    // Smouldering ember haze in the upper atmosphere.
    nebula: "#ff7a2a",
    // Hot embers as "stars" — they read as floating sparks.
    starColor: "#ffd2a0",
    // Charred basalt palette, deepest near-black, rim glowing faintly red.
    rockDeepest: "#100406",
    rockDark: "#2a0e0c",
    rockMid: "#4a1c14",
    rockLight: "#7a3220",
    rockRim: "#ffae6a",
    // Magma-glow accent for decorations.
    accent: "#ff5520",
  },
  // Same world bounds as the other levels so the camera + physics scale
  // identically and the minimap reads consistently.
  bounds: { minX: -136, maxX: 136, minY: -88, maxY: 88 },
  // CCW boundary (screen-CCW): trace the cave interior clockwise visually.
  // The shape is a wide cavern with a pronounced "throat" choke point in the
  // middle, creating two duelling chambers connected by a narrow channel.
  boundary: [
    // ── Top edge (left → right) — dripping ceiling with a low arch in the
    //    middle that mirrors the throat below.
    { x: -116, y: -64 },
    { x: -100, y: -68 },
    { x: -80, y: -58 },
    { x: -60, y: -64 },
    { x: -44, y: -56 },
    { x: -28, y: -48 },   // ceiling drops toward the throat
    { x: -14, y: -36 },
    { x: 0, y: -32 },     // tightest point of the upper throat
    { x: 14, y: -36 },
    { x: 28, y: -48 },
    { x: 44, y: -56 },
    { x: 60, y: -64 },
    { x: 80, y: -58 },
    { x: 100, y: -68 },
    { x: 116, y: -64 },
    // ── Right wall — bulges into the right chamber, curves back out.
    { x: 120, y: -44 },
    { x: 112, y: -24 },
    { x: 124, y: -4 },
    { x: 116, y: 20 },
    { x: 120, y: 44 },
    { x: 112, y: 60 },
    // ── Bottom edge (right → left) — sunken lava floor with island pads.
    { x: 96, y: 64 },
    { x: 76, y: 56 },     // island pad
    { x: 60, y: 64 },     // back down into lava
    { x: 40, y: 68 },
    { x: 24, y: 60 },     // small platform
    { x: 12, y: 64 },
    { x: 0, y: 56 },      // central pillar base meets floor
    { x: -12, y: 64 },
    { x: -24, y: 60 },
    { x: -40, y: 68 },
    { x: -60, y: 64 },
    { x: -76, y: 56 },    // mirror island pad
    { x: -96, y: 64 },
    { x: -112, y: 60 },
    // ── Left wall — mirror of the right wall.
    { x: -120, y: 44 },
    { x: -116, y: 20 },
    { x: -124, y: -4 },
    { x: -112, y: -24 },
    { x: -120, y: -44 },
  ],
  // Interior obstacles (CW on screen). The set is built around the central
  // narrows: a fat stalagmite from the floor and a matching stalactite from
  // the ceiling, plus a chamber pillar on each side.
  obstacles: [
    // Central stalagmite — rises from the floor in the choke point. CW.
    [
      { x: -10, y: 56 },
      { x: 10, y: 56 },
      { x: 8, y: 44 },
      { x: 4, y: 32 },
      { x: 0, y: 24 },
      { x: -4, y: 32 },
      { x: -8, y: 44 },
    ],
    // Central stalactite — hangs from the ceiling in the same choke. CW.
    [
      { x: -8, y: -32 },
      { x: 0, y: -16 },
      { x: 4, y: -22 },
      { x: 8, y: -32 },
      { x: 6, y: -40 },
      { x: -6, y: -40 },
    ],
    // Left chamber pillar — provides cover near the left spawn.
    [
      { x: -72, y: -12 },
      { x: -60, y: -12 },
      { x: -56, y: 0 },
      { x: -60, y: 16 },
      { x: -72, y: 16 },
      { x: -76, y: 0 },
    ],
    // Right chamber pillar — mirror of the left.
    [
      { x: 60, y: -12 },
      { x: 72, y: -12 },
      { x: 76, y: 0 },
      { x: 72, y: 16 },
      { x: 60, y: 16 },
      { x: 56, y: 0 },
    ],
    // Hanging stalactite over the left chamber.
    [
      { x: -96, y: -62 },
      { x: -84, y: -62 },
      { x: -86, y: -52 },
      { x: -90, y: -42 },
      { x: -94, y: -52 },
    ],
    // Hanging stalactite over the right chamber.
    [
      { x: 84, y: -62 },
      { x: 96, y: -62 },
      { x: 94, y: -52 },
      { x: 90, y: -42 },
      { x: 86, y: -52 },
    ],
  ],
  // Two spawn points, one per chamber. Both facing up — pilots launch into
  // the open air above the floor.
  spawns: [
    { x: -96, y: -28, angle: -Math.PI / 2 },
    { x: 96, y: -28, angle: -Math.PI / 2 },
  ],
  // Magma-glow decorations as "ember crystals" scattered across the floor
  // and ceiling — visually they read as lava droplets and floor cracks.
  decorations: [
    // Left chamber floor.
    { type: "crystal", x: -104, y: 60 },
    { type: "crystal", x: -88, y: 58 },
    { type: "crystal", x: -72, y: 52 },
    { type: "crystal", x: -54, y: 60 },
    // Right chamber floor (mirror).
    { type: "crystal", x: 104, y: 60 },
    { type: "crystal", x: 88, y: 58 },
    { type: "crystal", x: 72, y: 52 },
    { type: "crystal", x: 54, y: 60 },
    // Central narrows — a few embers around the stalagmite tip.
    { type: "crystal", x: -6, y: 26 },
    { type: "crystal", x: 6, y: 26 },
    // Ceiling embers near the stalactites.
    { type: "crystal", x: -90, y: -60 },
    { type: "crystal", x: 90, y: -60 },
    { type: "crystal", x: 0, y: -22 },
  ],
  // Race checkpoints — a figure-8 around the central narrows so the racing
  // line forces players to commit to one side, navigate the choke, and
  // unwind through the other chamber.
  checkpoints: [
    { x: -96, y: 0 },    // 1 — middle of left chamber
    { x: 0, y: -52 },    // 2 — squeezed through the upper throat
    { x: 96, y: 0 },     // 3 — middle of right chamber
    { x: 0, y: 50 },     // 4 — past the stalagmite base
  ],
  // Lava pools on the cavern floor — slowing zones where flying through is
  // costly. Two pools, one per chamber, leaving the central island reachable
  // but the chamber floors hot.
  waterZones: [
    // Left lava pool.
    [
      { x: -108, y: 60 },
      { x: -96, y: 62 },
      { x: -80, y: 58 },
      { x: -64, y: 62 },
      { x: -48, y: 66 },
      { x: -36, y: 66 },
      { x: -28, y: 62 },
      { x: -24, y: 64 },
      { x: -32, y: 70 },
      { x: -64, y: 70 },
      { x: -100, y: 68 },
    ],
    // Right lava pool (mirror).
    [
      { x: 24, y: 64 },
      { x: 28, y: 62 },
      { x: 36, y: 66 },
      { x: 48, y: 66 },
      { x: 64, y: 62 },
      { x: 80, y: 58 },
      { x: 96, y: 62 },
      { x: 108, y: 60 },
      { x: 100, y: 68 },
      { x: 64, y: 70 },
      { x: 32, y: 70 },
    ],
  ],
};
