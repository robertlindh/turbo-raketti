// Shared colour math for the renderer.
//
// One canonical home for the small colour helpers that used to be copy-pasted
// per module (lowpoly, caveMesh, LevelLoader, fx, Minimap, sprites). Two
// representations are supported:
//   - 0xRRGGBB integers — what Pixi `Graphics.fill({ color })` wants.
//   - "#rrggbb" CSS strings — what canvas 2D contexts and Level themes use.
// Helpers are grouped by the representation they operate on; the `hexToNum` /
// `hexToRgb` bridges convert between them.

// ── 0xRRGGBB integer helpers ────────────────────────────────────────────────

/** Mix colour `c` toward `target` by `k` (0 = c, 1 = target). */
export function mix(c: number, target: number, k: number): number {
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

/** Lighten toward white by `k` (0..1). */
export function lighten(c: number, k: number): number {
  return mix(c, 0xffffff, k);
}

/** Darken toward black by `k` (0..1). */
export function darken(c: number, k: number): number {
  return mix(c, 0x000000, k);
}

/** Linearly interpolate two RGB colours. `t` in [0,1]. */
export function lerpColor(a: number, b: number, t: number): number {
  return mix(a, b, t);
}

// ── "#rrggbb" string helpers ────────────────────────────────────────────────

/** Parse "#rrggbb" or "#rgb" into a 0xRRGGBB integer. */
export function hexToNum(hex: string): number {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return parseInt(h, 16) & 0xffffff;
}

/** Parse "#rrggbb" or "#rgb" into [r, g, b] channels (0..255). */
export function hexToRgb(hex: string): [number, number, number] {
  const n = hexToNum(hex);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** "#rrggbb" + alpha → "rgba(r,g,b,a)" for canvas fills. */
export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Darken a hex string by factor `k` (0..1), returning "#rrggbb". */
export function darkenHex(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.round(v * (1 - k));
  return `#${f(r).toString(16).padStart(2, "0")}${f(g).toString(16).padStart(2, "0")}${f(b).toString(16).padStart(2, "0")}`;
}
