// Level data model for TurboRaketti.
//
// A Level describes the playable cave as a single closed polygon (the boundary)
// plus zero-or-more closed obstacle polygons. Both visuals and physics derive
// from these polygons so they're guaranteed to align — when a ship bumps a
// visible wall, the collision happens at exactly that pixel.
//
// Polygon winding convention:
//   - Boundary: counterclockwise (CCW) so that the interior of the cave is on
//     the LEFT of each edge as you walk along the polygon. The exterior (rock)
//     fills the area to the right of each edge.
//   - Obstacles: clockwise (CW). Same rule applied locally — the rock is on
//     the right of each edge, the playable cave wraps around the obstacle.
//
// In a canvas where +Y is DOWN (Pixi/screen convention), CCW math winding
// looks CW visually. Since we render in screen coords directly, author
// polygons "as you see them" — what reads as counterclockwise when you draw
// the path on screen is the right boundary winding.

export interface Point {
  x: number;
  y: number;
}

/**
 * Theme palette for a level. Colors are CSS hex strings ("#aabbcc").
 */
export interface LevelTheme {
  name: string;
  /** Vertical sky/atmosphere gradient. */
  skyTop: string;
  skyBottom: string;
  /** Subtle haze/nebula tint applied additively to a few patches. */
  nebula: string;
  /** Star colour. */
  starColor: string;
  /** Rock palette, from deepest to lightest, plus a rim-light colour. */
  rockDeepest: string;
  rockDark: string;
  rockMid: string;
  rockLight: string;
  rockRim: string;
  /** Accent colour used for decoration glow (crystals, lights). */
  accent: string;
}

export interface DecorationSpawn {
  /** Visual-only decoration drawn on the backdrop or as a sprite. */
  type: "crystal";
  x: number;
  y: number;
}

export interface Spawn {
  x: number;
  y: number;
  /** Initial facing angle in radians. Defaults to -π/2 (nose up). */
  angle?: number;
}

export interface Level {
  /** Display name. */
  name: string;
  /** Theme palette for rendering. */
  theme: LevelTheme;
  /** Bounding box in world metres (used to size the backdrop texture). */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /**
   * Closed polygon of the playable cave interior. Author CCW (as seen on
   * screen). The last point does NOT need to repeat the first — the polygon
   * closes implicitly.
   */
  boundary: Point[];
  /**
   * Closed polygons of solid obstacles inside the cave. Author CW (as seen
   * on screen).
   */
  obstacles: Point[][];
  /** Two player spawn positions. More may be added for 3-4P later. */
  spawns: [Spawn, Spawn];
  /** Visual-only decorations. Optional. */
  decorations?: DecorationSpawn[];
  /**
   * Ordered list of checkpoint positions for Racing mode. Players must
   * touch them in order; once they return to the first, that's a lap.
   * Optional — levels without checkpoints can't host races.
   */
  checkpoints?: Point[];
  /**
   * Polygons of water — flying through these slows the ship down. Each
   * polygon is a closed loop of points. Polygons cannot overlap obstacles
   * (the renderer draws water on top of cave-interior space only).
   */
  waterZones?: Point[][];
}
