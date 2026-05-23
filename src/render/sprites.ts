// Pixel-art sprite factories for TurboRaketti.
//
// Each exported function rasterises a tiny pixel-art grid onto an offscreen
// HTMLCanvasElement using plain 2D ops (one fillRect per pixel), wraps the
// canvas in a Pixi v8 Texture, and forces nearest-neighbour sampling so the
// art stays crisp when the camera zooms in.
//
// The artwork matches "Style 3 — HD pixel art + glow" from
// public/graphics-preview.js: the rocket silhouette, palette and shading are
// taken straight from `drawStyle3()`'s `ship3` grid and `palette3` map.
//
// Notes on the hull tint: the player ship can be drawn in either the original
// cool-blue palette (P1) or a red palette (P2). We do that by treating the
// "hull family" palette entries (H, h, M, m, n) as a luminance ramp and
// re-hue/re-saturating them toward whatever `color` the caller passes, while
// leaving the nose, canopy, outline and flame untouched so they read the same
// on both ships.

import { Texture, type Renderer } from "pixi.js";

// ---------------------------------------------------------------------------
// Colour helpers (inlined; no extra files).
// ---------------------------------------------------------------------------

/** Convert a 0xRRGGBB integer to a CSS "#rrggbb" string. */
function intToHex(n: number): string {
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Parse "#rrggbb" or "#rgb" into [r,g,b] (0..255). */
function hexToRgb(hex: string): [number, number, number] {
    let h = hex.replace(/^#/, "");
    if (h.length === 3) {
        h = h.split("").map((c) => c + c).join("");
    }
    const n = parseInt(h, 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Standard RGB→HSL with channels in 0..1, h in 0..1. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h, s, l];
}

/** Standard HSL→RGB with h/s/l in 0..1, returns channels in 0..255. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    if (s === 0) {
        const v = Math.round(l * 255);
        return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t: number): number => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [
        Math.round(hue2rgb(h + 1 / 3) * 255),
        Math.round(hue2rgb(h) * 255),
        Math.round(hue2rgb(h - 1 / 3) * 255),
    ];
}

/**
 * Re-hue/re-saturate an original palette colour toward `targetHex`.
 *
 * The original colour's *lightness* is preserved (so the relative shading of
 * the ramp doesn't collapse) while its hue and saturation are pulled toward
 * the target. When `targetHex` is the original hull mid (#4fa0d0) the output
 * is essentially the input, so blue ships look identical to the reference.
 */
function tintTowards(originalHex: string, targetHex: string): string {
    const [tr, tg, tb] = hexToRgb(targetHex);
    const [targetHue, ts, tl] = rgbToHsl(tr, tg, tb);
    const [or, og, ob] = hexToRgb(originalHex);
    const [, , ol] = rgbToHsl(or, og, ob);
    // Pull saturation toward the target's saturation but bias toward keeping
    // some richness — clamp to at least 0.35 so very desaturated targets
    // (e.g. near-white) still produce a visible tint instead of grey.
    const sat = Math.max(0.35, ts * 0.85 + 0.15);
    // Slight lightness bias toward target so red ships don't look washed out
    // when the target is itself quite dark/bright. 80/20 mix.
    const lit = ol * 0.8 + tl * 0.2;
    const [r, g, b] = hslToRgb(targetHue, sat, lit);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Canvas / texture plumbing.
// ---------------------------------------------------------------------------

/** Create a transparent canvas of the given pixel size. */
function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) throw new Error("sprites.ts: failed to acquire 2D context");
    ctx.imageSmoothingEnabled = false;
    return { canvas, ctx };
}

/** One pixel. */
function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
}

/** Blit a character grid using a string→colour palette. '.' and ' ' are transparent. */
function blit(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    grid: readonly string[],
    palette: Readonly<Record<string, string>>,
): void {
    for (let y = 0; y < grid.length; y++) {
        const row = grid[y];
        for (let x = 0; x < row.length; x++) {
            const ch = row[x];
            if (ch === "." || ch === " ") continue;
            const color = palette[ch];
            if (!color) continue;
            px(ctx, ox + x, oy + y, color);
        }
    }
}

/** Wrap a canvas as a Pixi Texture with nearest-neighbour sampling. */
function canvasToTexture(canvas: HTMLCanvasElement): Texture {
    const texture = Texture.from(canvas);
    texture.source.scaleMode = "nearest";
    return texture;
}

// ---------------------------------------------------------------------------
// Ship sprite — pulled directly from drawStyle3()'s `ship3` grid.
// 20 wide × 25 tall. Texture is 20×26 (one extra row of pad below the flame
// so the default centre (0.5, 0.5) lands near the ship's centre of mass —
// roughly between the canopy and the wing tips).
// ---------------------------------------------------------------------------

// Clean triangle silhouette echoing the original 1992 sprite. 13 wide × 14 tall.
// Nose at the top (low Y), wide base at the bottom. K = outline, H = hull (tinted),
// h = hull shadow, C = canopy pixel, M = wing edge highlight (tinted lighter).
const SHIP_GRID: readonly string[] = [
    "......K......",
    ".....KHK.....",
    ".....KHK.....",
    "....KHHHK....",
    "....KHCHK....",
    "...KHHHHHK...",
    "...KHHHHHK...",
    "..KHHHhHHHK..",
    "..KHHHhHHHK..",
    ".KHHHHHHHHHK.",
    ".KHHHHHHHHHK.",
    "KMHHHHHHHHHMK",
    "KMM.......MMK",
    "KK.........KK",
];

/** Static (un-tinted) parts of the ship palette — match palette3 exactly. */
const SHIP_PALETTE_STATIC: Readonly<Record<string, string>> = {
    X: "#ffd166", // nose tip light
    // NB: in graphics-preview.js, palette3 declares "Y" twice; the later
    //     definition (#ffe199) wins at runtime, so we use that here.
    Y: "#ffe199",
    R: "#e85a1c", // nose mid
    r: "#a13510", // nose shadow
    K: "#0a0414", // outline darkest
    C: "#aef0ff", // canopy bright
    c: "#5cb6e6", // canopy dark
    O: "#ff8030", // flame outer
    I: "#ffd66e", // flame inner
    F: "#ffffff", // flame core
};

/** Original "hull family" entries from palette3 — these get tinted. */
const HULL_ORIGINALS = {
    H: "#4fa0d0", // hull mid
    h: "#1f5078", // hull deepest shadow
    M: "#7ec0e8", // wing light
    m: "#2a6090", // wing shadow
    n: "#0e2e4e", // wing seam
} as const;

/**
 * Build the full ship palette for a given hull tint colour. The hull family
 * (H, h, M, m, n) is re-hue'd toward `targetHex`; nose, canopy, outline and
 * flame are taken verbatim from palette3.
 */
function buildShipPalette(targetHex: string): Record<string, string> {
    return {
        ...SHIP_PALETTE_STATIC,
        H: tintTowards(HULL_ORIGINALS.H, targetHex),
        h: tintTowards(HULL_ORIGINALS.h, targetHex),
        M: tintTowards(HULL_ORIGINALS.M, targetHex),
        m: tintTowards(HULL_ORIGINALS.m, targetHex),
        n: tintTowards(HULL_ORIGINALS.n, targetHex),
    };
}

/**
 * Build the ship texture. Nose points UP (toward decreasing Y in canvas
 * coords), so the consumer should orient the sprite so that the in-game
 * "forward" vector for the ship maps to the texture's -Y direction (i.e.
 * rotation 0 = pointing up).
 *
 * `color` is an integer like 0x4fa0d0 (blue, matches the original) or
 * 0xd04f4f (red P2 variant). Only the hull family is recoloured.
 */
export function makeShipTexture(_renderer: Renderer, color: number): Texture {
    const W = 13;
    const H = 14;
    const { canvas, ctx } = makeCanvas(W, H);
    const palette = buildShipPalette(intToHex(color));
    blit(ctx, 0, 0, SHIP_GRID, palette);
    return canvasToTexture(canvas);
}

// ---------------------------------------------------------------------------
// Bullet sprite — small streak pointing UP, brightest at the head, with a
// short fading tail behind it. 5 logical pixels tall × 3 wide.
// ---------------------------------------------------------------------------

/**
 * Bullet texture. The head is at the TOP of the texture (low Y) and the tail
 * trails downward, so rotating the sprite to face direction of travel works
 * the same way as the ship (texture-up == in-game forward).
 *
 * Like the ship, the `color` integer tints the bullet's hot core. We keep
 * the white head pixel and the dark tail tip untouched to preserve the
 * "tracer round" silhouette, and only re-hue the mid-bright body pixels.
 */
export function makeBulletTexture(_renderer: Renderer, color: number): Texture {
    // Just a single white-hot pixel — the bullet-trail particles handle the
    // visual streaking, so the sprite itself only marks the precise hit
    // point. Tinting is intentionally skipped: the additive blend lets it
    // read as a tiny point of light regardless of background.
    void color;
    const { canvas, ctx } = makeCanvas(1, 1);
    px(ctx, 0, 0, "#ffffff");
    return canvasToTexture(canvas);
}

// ---------------------------------------------------------------------------
// Homing missile — a chunky little pixel-art rocket. Nose points -Y so
// it lines up with the ship's "forward" convention (caller adds +π/2 to
// velocity heading). 5 wide × 9 tall, with palette:
//   W  white nose tip
//   M  metallic mid-grey body
//   H  highlight on the body's left side (lit from upper-left)
//   D  darker shadow on the right side of the body
//   F  fin (warm tinted by `color`)
//   o  orange exhaust outer
//   y  yellow exhaust inner
//   w  bright white flame core
// The colour parameter tints the warning stripe + the fins so each pilot's
// missiles read in their player colour at a glance.
// ---------------------------------------------------------------------------

export function makeMissileTexture(_renderer: Renderer, color: number): Texture {
    const W = 5;
    const H = 9;
    const { canvas, ctx } = makeCanvas(W, H);
    const accent = intToHex(color);
    const accentDark = tintTowards(accent, "#1a0808");

    // Layout (y, x). "." = transparent.
    //   y=0: ..W..   (nose tip)
    //   y=1: .HMD.   (head — lit / mid / shadow)
    //   y=2: .HMD.
    //   y=3: HHMDD   (warning stripe row — accented)
    //   y=4: .HMD.
    //   y=5: FHMDF   (fins flare out)
    //   y=6: .HMD.
    //   y=7: .oyo.   (flame outer)
    //   y=8: ..w..   (flame core)
    const body = "#8a929e";       // M  mid metallic
    const hi   = "#c8d0db";       // H  highlight
    const sh   = "#4a525e";       // D  shadow
    const nose = "#ffffff";       // W
    const flameO = "#ff6020";     // o
    const flameI = "#ffd040";     // y
    const flameC = "#ffffff";     // w

    // Nose
    px(ctx, 2, 0, nose);

    // Head and body — three vertical columns of hi / mid / shadow.
    const drawTri = (y: number) => {
        px(ctx, 1, y, hi);
        px(ctx, 2, y, body);
        px(ctx, 3, y, sh);
    };
    drawTri(1);
    drawTri(2);

    // Warning stripe row — replace highlight + shadow with accent variants
    // so the player colour clearly bands the missile mid-body.
    px(ctx, 0, 3, accent);
    px(ctx, 1, 3, accent);
    px(ctx, 2, 3, body);
    px(ctx, 3, 3, accentDark);
    px(ctx, 4, 3, accentDark);

    drawTri(4);

    // Fins — small tabs sticking out at the body's widest point.
    px(ctx, 0, 5, accent);
    drawTri(5);
    px(ctx, 4, 5, accentDark);

    drawTri(6);

    // Flame — three pixels of warm exhaust under the engine.
    px(ctx, 1, 7, flameO);
    px(ctx, 2, 7, flameI);
    px(ctx, 3, 7, flameO);
    px(ctx, 2, 8, flameC);

    return canvasToTexture(canvas);
}

// ---------------------------------------------------------------------------
// Crystal sprite — small floor decoration. 3 wide × 4 tall: bright top tapers
// to a darker base. Matches the cyan crystals on the floor in drawStyle3().
// ---------------------------------------------------------------------------

/**
 * Crystal texture for floor decoration. Always the same cyan palette — no
 * tinting parameter needed.
 */
export function makeCrystalTexture(_renderer: Renderer): Texture {
    const W = 3;
    const H = 4;
    const { canvas, ctx } = makeCanvas(W, H);
    // Top row: bright tip.
    px(ctx, 1, 0, "#ffffff");
    // Upper body: brightest cyan.
    px(ctx, 0, 1, "#82d8ff");
    px(ctx, 1, 1, "#c8edff");
    px(ctx, 2, 1, "#82d8ff");
    // Lower body: mid cyan.
    px(ctx, 0, 2, "#3a7eb0");
    px(ctx, 1, 2, "#5ab0e0");
    px(ctx, 2, 2, "#82d8ff");
    // Base: dark.
    px(ctx, 1, 3, "#1f5078");
    return canvasToTexture(canvas);
}
