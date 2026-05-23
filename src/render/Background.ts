import { Renderer, Sprite, Texture } from "pixi.js";

export interface CaveBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG so the star field / wall noise stays reproducible.
// (Mulberry32 — small, fast, good enough for cosmetic noise.)
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type AnyCtx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Paint a single logical pixel. */
function px(ctx: AnyCtx2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

/** Paint a filled rectangle. */
function rect(
  ctx: AnyCtx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/**
 * Renders the static Style-3 backdrop to a single RenderTexture and returns a
 * Sprite ready to be added to the world layer.
 *
 * `pixelsPerMetre` controls the logical pixel resolution. Use 8 — meaning a
 * 60 m x 36 m cave becomes a 480 x 288 logical pixel image. The returned Sprite
 * is scaled so 1 logical pixel maps back to 1/8 of a metre in world space.
 * The sprite's top-left aligns with (bounds.minX, bounds.minY) in world
 * coordinates.
 */
export function createBackdrop(
  _renderer: Renderer,
  bounds: CaveBounds,
  pixelsPerMetre: number,
): Sprite {
  const widthM = bounds.maxX - bounds.minX;
  const heightM = bounds.maxY - bounds.minY;

  // Logical pixel dimensions.
  const W = Math.max(1, Math.round(widthM * pixelsPerMetre));
  const H = Math.max(1, Math.round(heightM * pixelsPerMetre));

  // Use an HTMLCanvasElement (works everywhere; OffscreenCanvas would also work
  // but is not universally available in test/SSR environments).
  const canvas: HTMLCanvasElement = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Background: failed to acquire 2D context");
  }
  ctx.imageSmoothingEnabled = false;

  drawBackdrop(ctx, W, H);

  // Build a Pixi v8 texture from the canvas with nearest-neighbour scaling.
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";

  const sprite = new Sprite(texture);
  sprite.x = bounds.minX;
  sprite.y = bounds.minY;
  // 1 logical pixel == (1 / pixelsPerMetre) metres on screen.
  sprite.scale.set(1 / pixelsPerMetre, 1 / pixelsPerMetre);

  return sprite;
}

// ---------------------------------------------------------------------------
// Backdrop painter — mirrors public/graphics-preview.js -> drawStyle3() but
// extended so the cave is fully enclosed (walls on all four sides).
// ---------------------------------------------------------------------------
function drawBackdrop(ctx: AnyCtx2D, W: number, H: number): void {
  // -------------------------------------------------------------------------
  // 1. Layered atmospheric vertical gradient.
  //    Dim purple at top -> near-black at bottom, with sin modulation.
  //    +Y is DOWN; texture row 0 is the top (purple).
  // -------------------------------------------------------------------------
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const r = Math.round(0x10 + 0x18 * Math.sin(t * 1.4) * (1 - t));
    const g = Math.round(0x14 + 0x10 * (1 - t));
    const b = Math.round(0x2e + 0x16 * Math.sin(t * 2.1));
    rect(
      ctx,
      0,
      y,
      W,
      1,
      `rgb(${Math.max(8, r)},${Math.max(10, g)},${Math.max(20, b)})`,
    );
  }

  // -------------------------------------------------------------------------
  // 2. Distant nebula wash — additive radial blobs.
  //    Positions/sizes scaled with W/H so they look right at any cave size.
  // -------------------------------------------------------------------------
  ctx.globalCompositeOperation = "lighter";
  const nebulae: Array<[number, number, number, string]> = [
    [W * 0.21, H * 0.21, Math.min(W, H) * 0.22, "rgba(120,60,140,0.10)"],
    [W * 0.68, H * 0.17, Math.min(W, H) * 0.28, "rgba(80,100,180,0.09)"],
    [W * 0.47, H * 0.42, Math.min(W, H) * 0.18, "rgba(200,90,140,0.06)"],
    [W * 0.85, H * 0.55, Math.min(W, H) * 0.20, "rgba(120,80,180,0.07)"],
  ];
  for (const [cx, cy, rad, col] of nebulae) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, col);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  ctx.globalCompositeOperation = "source-over";

  // -------------------------------------------------------------------------
  // 3. Star field — deterministic via seeded PRNG. Density scales with area.
  //    Bright stars get a cross-shaped sparkle.
  // -------------------------------------------------------------------------
  const rng = mulberry32(0xb16b00b5);
  const starArea = W * H;
  const starCount = Math.max(40, Math.floor(starArea / 480));

  // Leave a margin so stars don't spawn under walls/floor — those rocks will
  // overwrite them anyway, but skipping is cheaper. The interior region used
  // here roughly matches what the wall pass below leaves free.
  const wallMargin = Math.max(6, Math.round(Math.min(W, H) * 0.07));

  for (let i = 0; i < starCount; i++) {
    const x = wallMargin + Math.floor(rng() * (W - wallMargin * 2));
    const y = wallMargin + Math.floor(rng() * (H - wallMargin * 2 - 8));
    const b = rng();
    const v = Math.round(120 + b * 135);
    const bluish = Math.min(255, v + 20);
    px(ctx, x, y, `rgb(${v},${v},${bluish})`);
    if (b > 0.8) {
      // Cross-shaped sparkle.
      const a = `rgba(${v},${v},${v},0.5)`;
      px(ctx, x - 1, y, a);
      px(ctx, x + 1, y, a);
      px(ctx, x, y - 1, a);
      px(ctx, x, y + 1, a);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Cave walls on all four sides. Multi-tone rock with rim light facing
  //    the playable interior. The wall thickness is sin/cos modulated to
  //    produce a jagged silhouette.
  //
  //    Palette mirrors drawStyle3():
  //      d = deepest rock (#1a0e26)
  //      D = dark        (#241834)
  //      M = mid         (#3a2848)
  //      L = light       (#5e4670)
  //      H = highlight   (#9e88be)
  //      X = rim light   (#dec4ff)
  // -------------------------------------------------------------------------
  const pal = {
    d: "#1a0e26",
    D: "#241834",
    M: "#3a2848",
    L: "#5e4670",
    H: "#9e88be",
    X: "#dec4ff",
  };

  // Base thickness scales gently with cave size; ~14% of the smaller side.
  const baseThick = Math.max(8, Math.round(Math.min(W, H) * 0.14));

  // Resolve tone given the depth into the wall (i, from rim inward) and the
  // overall thickness w. `i === 0` is the playable-interior-facing edge.
  const toneAt = (i: number, w: number): keyof typeof pal => {
    if (i === 0) return "X";
    if (i === 1) return "H";
    if (i === 2) return "L";
    if (i > w - 2) return "d";
    if (i > w - 5) return "D";
    return "M";
  };

  // Right wall (rim on the LEFT side of the strip, i.e. the inward-facing edge).
  for (let y = 0; y < H; y++) {
    const w =
      baseThick +
      Math.round(Math.sin(y * 0.15) * 5 + Math.cos(y * 0.41) * 3);
    for (let i = 0; i < w; i++) {
      const x = W - w + i;
      // `i = 0` is leftmost column of the wall strip -> facing interior.
      // We want rim on the inward edge, so map depth = i.
      let tone: keyof typeof pal = toneAt(i, w);
      if ((y + i) % 17 === 0 && i > 5 && i < w - 5) tone = "D";
      px(ctx, x, y, pal[tone]);
    }
  }

  // Left wall — mirrored. Rim on the right column of the strip.
  for (let y = 0; y < H; y++) {
    const w =
      baseThick +
      Math.round(Math.sin(y * 0.17 + 1.3) * 5 + Math.cos(y * 0.39 + 0.7) * 3);
    for (let i = 0; i < w; i++) {
      const x = i; // 0 .. w-1
      // depth from inward-facing rim (rightmost column) inward:
      const depth = w - 1 - i;
      let tone: keyof typeof pal = toneAt(depth, w);
      if ((y + depth) % 17 === 0 && depth > 5 && depth < w - 5) tone = "D";
      px(ctx, x, y, pal[tone]);
    }
  }

  // Top wall — rim on the BOTTOM edge of the strip (interior-facing).
  for (let x = 0; x < W; x++) {
    const w =
      baseThick +
      Math.round(Math.sin(x * 0.16 + 0.4) * 5 + Math.cos(x * 0.43 + 1.1) * 3);
    for (let i = 0; i < w; i++) {
      const y = i; // 0 .. w-1
      const depth = w - 1 - i; // 0 == interior-facing rim
      let tone: keyof typeof pal = toneAt(depth, w);
      if ((x + depth) % 19 === 0 && depth > 5 && depth < w - 5) tone = "D";
      px(ctx, x, y, pal[tone]);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Bottom wall / floor — sculpted top with rim light, AO line, dark body.
  //    Mirrors drawStyle3()'s floor pass but uses the same wall palette so it
  //    blends with the side walls.
  // -------------------------------------------------------------------------
  const floorThickBase = Math.max(10, Math.round(Math.min(W, H) * 0.15));

  // Solid floor body first.
  rect(ctx, 0, H - floorThickBase, W, floorThickBase, pal.d);

  // Per-column sculpted top: a small peak of light/highlight, then an AO line.
  for (let x = 0; x < W; x++) {
    const peak =
      3 + Math.round(Math.sin(x * 0.18) * 1.5 + Math.sin(x * 0.62) * 1);

    // Cover everything from the start of the floor band down to the peak top.
    // The floor's "true" top sits at `H - floorThickBase + (some sculpt)`.
    const top = H - floorThickBase - peak;

    // Light face of the peak.
    rect(ctx, x, top, 1, peak, pal.L);
    // Rim highlight on the very top pixel of the peak.
    px(ctx, x, top, pal.H);
    // Ambient-occlusion line just below the peak top, inside the floor body.
    px(ctx, x, top + peak + 1, pal.D);
  }

  // -------------------------------------------------------------------------
  // 6. Crystal formations scattered along the bottom interior edge.
  //    ~12 crystals positioned deterministically.
  // -------------------------------------------------------------------------
  const crystalRng = mulberry32(0xc0ffee42);
  const crystalCount = 12;

  // Interior x-range — keep crystals away from left/right walls.
  const innerLeft = baseThick + 4;
  const innerRight = W - baseThick - 4;
  const innerSpan = Math.max(1, innerRight - innerLeft);

  // Track crystal positions so we can apply additive bloom afterwards.
  const crystalSpots: Array<[number, number]> = [];

  for (let i = 0; i < crystalCount; i++) {
    // Even-ish spread, then jitter.
    const slot = i / crystalCount;
    const jitter = (crystalRng() - 0.5) * (innerSpan / crystalCount) * 0.8;
    const cx = Math.round(innerLeft + slot * innerSpan + jitter);
    // Sample the actual peak height at this x so the crystal sits on the floor.
    const peak =
      3 + Math.round(Math.sin(cx * 0.18) * 1.5 + Math.sin(cx * 0.62) * 1);
    const baseY = H - floorThickBase - peak; // top of the sculpted floor
    const cy = baseY - 1; // crystal base sits just above the floor top
    crystalSpots.push([cx, cy]);

    // Two-pixel-wide crystal, 3 pixels tall, with a white tip.
    px(ctx, cx, cy, "#82d8ff");
    px(ctx, cx, cy - 1, "#c8edff");
    px(ctx, cx, cy - 2, "#ffffff");
    px(ctx, cx + 1, cy, "#5ab0e0");
    px(ctx, cx + 1, cy - 1, "#82d8ff");
    px(ctx, cx - 1, cy, "#3a7eb0");
  }

  // -------------------------------------------------------------------------
  // 7. Crystal bloom — additive radial glow under each crystal.
  // -------------------------------------------------------------------------
  ctx.globalCompositeOperation = "lighter";
  const glow = (x: number, y: number, r: number, color: string) => {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (const [cx, cy] of crystalSpots) {
    glow(cx, cy - 1, 5, "rgba(120,200,255,0.45)");
  }
  ctx.globalCompositeOperation = "source-over";

  // -------------------------------------------------------------------------
  // 8. Subtle radial vignette to push contrast.
  // -------------------------------------------------------------------------
  const vignette = ctx.createRadialGradient(
    W / 2,
    H / 2,
    Math.min(W, H) * 0.3,
    W / 2,
    H / 2,
    Math.max(W, H) * 0.75,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}
