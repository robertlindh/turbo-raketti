// Shared 2D polygon geometry. One canonical home for the point-in-polygon
// test that used to be copy-pasted per module (Game, Bot, PowerUpSystem,
// caveMesh, water), plus the vertical-raycast helper the water/cave renderers
// use to sample level geometry column by column.

import type { Point } from "./Level";

/** Even-odd ray cast — winding-agnostic, which suits both the CCW cave
 *  boundary and CW obstacles authored "as seen on screen". */
export function pointInPolygon(x: number, y: number, poly: Point[]): boolean {
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

/** Append every y where the vertical line at `x` crosses the polygon's
 *  edges to `out`. Callers reuse `out` across calls to avoid allocation. */
export function verticalHits(poly: Point[], x: number, out: number[]): void {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    if ((a.x <= x) === (b.x <= x)) continue; // edge doesn't span this column
    out.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
  }
}
