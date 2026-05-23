// LevelLoader — turns a Level (data) into a Pixi backdrop Sprite + Rapier
// colliders. Visuals and physics are derived from the same polygons, so a
// visible wall pixel is guaranteed to be a collision surface.

import RAPIER from "@dimforge/rapier2d-compat";
import { Container, Renderer, Sprite, Texture } from "pixi.js";
import type { Level, LevelTheme, Point } from "./Level";
import type { PhysicsWorld } from "../game/PhysicsWorld";

/** Logical pixels per world metre used by the backdrop raster. */
const PIXELS_PER_METRE = 8;
/** Wall fill expressed as a Path2D — caches across renders. */

type AnyCtx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface LoadedLevel {
  /** Sprite holding the rendered backdrop, ready to drop into the world layer. */
  backdrop: Sprite;
  /** The Level used to build this. */
  level: Level;
}

/**
 * Load a Level into the world: render the backdrop and create all colliders.
 * The colliders are attached to a fresh fixed rigid body kept inside the
 * physics world; the caller doesn't need to track them (they live as long as
 * the world does).
 */
export function loadLevel(
  renderer: Renderer,
  physics: PhysicsWorld,
  parent: Container,
  level: Level,
): LoadedLevel {
  // 1. Build colliders from the same polygon data.
  createColliders(physics, level);

  // 2. Render the backdrop.
  const backdrop = renderBackdrop(renderer, level);
  parent.addChild(backdrop);

  return { backdrop, level };
}

// ──────────────────────────────────────────────────────────────────────────
// Physics — polyline colliders from the boundary + each obstacle polygon.
// ──────────────────────────────────────────────────────────────────────────

function createColliders(physics: PhysicsWorld, level: Level): void {
  // One static body holds everything.
  const body = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0),
  );

  const polygons: Point[][] = [level.boundary, ...level.obstacles];
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    // Build a closed polyline (last vertex connects back to first).
    const verts = new Float32Array((poly.length + 1) * 2);
    for (let i = 0; i < poly.length; i++) {
      verts[i * 2] = poly[i].x;
      verts[i * 2 + 1] = poly[i].y;
    }
    verts[poly.length * 2] = poly[0].x;
    verts[poly.length * 2 + 1] = poly[0].y;

    physics.world.createCollider(
      RAPIER.ColliderDesc.polyline(verts)
        .setFriction(0.4)
        .setRestitution(0.2),
      body,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Rendering — gradient sky, stars, rock fill using even-odd polygon fill,
// rim light along the boundary, accent decorations.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Render the level's backdrop as a Sprite — no physics involved. Used by the
 * level editor for live preview, and internally by `loadLevel`.
 */
export function renderLevelBackdrop(level: Level): Sprite {
  return renderBackdrop(null as unknown as Renderer, level);
}

function renderBackdrop(_renderer: Renderer, level: Level): Sprite {
  const { bounds, theme } = level;
  const widthM = bounds.maxX - bounds.minX;
  const heightM = bounds.maxY - bounds.minY;
  const W = Math.max(1, Math.round(widthM * PIXELS_PER_METRE));
  const H = Math.max(1, Math.round(heightM * PIXELS_PER_METRE));

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("LevelLoader: failed to acquire 2D context");
  ctx.imageSmoothingEnabled = false;

  // Helper: convert world coords to texture px.
  const wx = (x: number) => (x - bounds.minX) * PIXELS_PER_METRE;
  const wy = (y: number) => (y - bounds.minY) * PIXELS_PER_METRE;

  // 1. Sky gradient over the full canvas.
  drawSkyGradient(ctx, W, H, theme);

  // 2. Nebula wash (optional).
  drawNebula(ctx, W, H, theme);

  // 3. Star field, deterministic.
  drawStars(ctx, W, H, theme);

  // 4. Rock fill: rectangle MINUS the boundary polygon (so everything outside
  //    the cave interior is rock). Subtract obstacle polygons too so they get
  //    rock-filled instead of staying as cave interior. Use even-odd fill rule.
  drawRockFill(ctx, W, H, level, wx, wy);

  // 5. Rim light along the interior side of each polygon edge.
  drawRimLight(ctx, level, wx, wy);

  // 5b. Water zones drawn on top of the interior — semi-transparent teal
  //     with a lighter top edge.
  drawWaterZones(ctx, level, wx, wy);

  // 6. Decorations (crystals etc.).
  drawDecorations(ctx, level, wx, wy);

  // 7. Subtle vignette to push interior contrast.
  drawVignette(ctx, W, H);

  // Wrap into Pixi texture + Sprite.
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  const sprite = new Sprite(texture);
  sprite.x = bounds.minX;
  sprite.y = bounds.minY;
  sprite.scale.set(1 / PIXELS_PER_METRE, 1 / PIXELS_PER_METRE);
  return sprite;
}

function drawSkyGradient(
  ctx: AnyCtx2D, W: number, H: number, theme: LevelTheme,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, theme.skyTop);
  grad.addColorStop(1, theme.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

function drawNebula(
  ctx: AnyCtx2D, W: number, H: number, theme: LevelTheme,
): void {
  ctx.globalCompositeOperation = "lighter";
  const rng = mulberry32(0xb16b00b5);
  const blobs = 3;
  for (let i = 0; i < blobs; i++) {
    const cx = rng() * W;
    const cy = rng() * H * 0.7;
    const r = 30 + rng() * 40;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(theme.nebula, 0.06));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawStars(
  ctx: AnyCtx2D, W: number, H: number, theme: LevelTheme,
): void {
  const rng = mulberry32(0xc0ffee01);
  const count = Math.round((W * H) / 1200);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * H);
    const b = rng();
    const v = Math.round(80 + b * 175);
    ctx.fillStyle = `rgba(${tintRgb(theme.starColor, v)})`;
    ctx.fillRect(x, y, 1, 1);
    if (b > 0.92) {
      // Bright star: small cross sparkle.
      ctx.fillStyle = `rgba(${tintRgb(theme.starColor, Math.round(v * 0.6))})`;
      ctx.fillRect(x - 1, y, 1, 1);
      ctx.fillRect(x + 1, y, 1, 1);
      ctx.fillRect(x, y - 1, 1, 1);
      ctx.fillRect(x, y + 1, 1, 1);
    }
  }
}

function drawRockFill(
  ctx: AnyCtx2D,
  W: number, H: number,
  level: Level,
  wx: (x: number) => number,
  wy: (y: number) => number,
): void {
  // Build a Path2D combining outer rect + boundary + obstacles. Used both
  // for filling rock with even-odd and for clipping subsequent passes.
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(W, 0);
  path.lineTo(W, H);
  path.lineTo(0, H);
  path.closePath();
  if (level.boundary.length >= 3) addPolygonToPath(path, level.boundary, wx, wy);
  for (const poly of level.obstacles) {
    if (poly.length >= 3) addPolygonToPath(path, poly, wx, wy);
  }

  // 1. Fill the entire rock area with the darkest tone.
  ctx.fillStyle = level.theme.rockDeepest;
  ctx.fill(path, "evenodd");

  // 2. Stippled noise texture for the rock so it doesn't read as flat.
  ctx.save();
  ctx.clip(path, "evenodd");
  drawRockNoise(ctx, W, H, level);
  ctx.restore();

  // 3. Nested concentric bands from the boundary inward into the rock,
  //    creating a faux-AO + depth effect. Outermost band is dark, innermost
  //    is lightest (closer to the cave interior). Stroke order matters —
  //    later strokes overwrite earlier ones, so we paint from widest to
  //    narrowest with progressively lighter tones.
  ctx.save();
  ctx.clip(path, "evenodd");
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const bands: Array<{ width: number; color: string }> = [
    { width: 14, color: level.theme.rockDark },
    { width: 9,  color: level.theme.rockMid },
    { width: 5,  color: level.theme.rockLight },
  ];
  for (const b of bands) {
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.width;
    strokeAllPolygonsRaw(ctx, level, wx, wy);
  }
  ctx.restore();
}

/** Stipple the rock area with a deterministic noise pattern. Uses 4×4 cells
 *  to keep the fillRect count under ~10k for a 500×400 canvas. */
function drawRockNoise(
  ctx: AnyCtx2D, W: number, H: number, level: Level,
): void {
  const rng = mulberry32(0xdeadbeef);
  const cell = 4;
  // Group fills by colour to minimise fillStyle changes.
  const dark: number[] = [];
  const mid: number[] = [];
  const light: number[] = [];
  for (let y = 0; y < H; y += cell) {
    for (let x = 0; x < W; x += cell) {
      const r = rng();
      const bucket = r < 0.6 ? dark : r < 0.9 ? mid : light;
      bucket.push(x, y);
    }
  }
  const paint = (coords: number[], color: string) => {
    ctx.fillStyle = color;
    for (let i = 0; i < coords.length; i += 2) {
      ctx.fillRect(coords[i], coords[i + 1], cell, cell);
    }
  };
  paint(dark, level.theme.rockDeepest);
  paint(mid, level.theme.rockDark);
  paint(light, level.theme.rockMid);
}

/** Stroke polygons without changing strokeStyle/lineWidth — caller sets them. */
function strokeAllPolygonsRaw(
  ctx: AnyCtx2D, level: Level,
  wx: (x: number) => number, wy: (y: number) => number,
): void {
  for (const poly of [level.boundary, ...level.obstacles]) {
    if (poly.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(wx(poly[0].x), wy(poly[0].y));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(wx(poly[i].x), wy(poly[i].y));
    }
    ctx.closePath();
    ctx.stroke();
  }
}

function drawWaterZones(
  ctx: AnyCtx2D,
  level: Level,
  wx: (x: number) => number,
  wy: (y: number) => number,
): void {
  if (!level.waterZones || level.waterZones.length === 0) return;
  ctx.save();
  for (const poly of level.waterZones) {
    if (poly.length < 3) continue;
    // Filled body — semi-transparent teal.
    ctx.beginPath();
    ctx.moveTo(wx(poly[0].x), wy(poly[0].y));
    for (let i = 1; i < poly.length; i++) ctx.lineTo(wx(poly[i].x), wy(poly[i].y));
    ctx.closePath();
    ctx.fillStyle = "rgba(56, 124, 200, 0.55)";
    ctx.fill();
    // Slight rim of lighter cyan along the top edge.
    ctx.strokeStyle = "rgba(160, 220, 255, 0.55)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
    // A horizontal "shimmer" line a few px below the surface.
    ctx.strokeStyle = "rgba(200, 240, 255, 0.18)";
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(wx(poly[0].x), wy(poly[0].y) + 1.4);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(wx(poly[i].x), wy(poly[i].y) + 1.4);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawRimLight(
  ctx: AnyCtx2D,
  level: Level,
  wx: (x: number) => number,
  wy: (y: number) => number,
): void {
  // A 1px-thick stroke right on the boundary draws a bright rim.
  strokePolygons(ctx, level, wx, wy, level.theme.rockRim, 1);
}

function drawDecorations(
  ctx: AnyCtx2D,
  level: Level,
  wx: (x: number) => number,
  wy: (y: number) => number,
): void {
  if (!level.decorations) return;
  const theme = level.theme;
  for (const d of level.decorations) {
    const px = Math.round(wx(d.x));
    const py = Math.round(wy(d.y));
    switch (d.type) {
      case "crystal": drawCrystal(ctx, px, py, theme.accent); break;
      case "rock":    drawRock(ctx, px, py, theme); break;
      case "plant":   drawPlant(ctx, px, py, theme); break;
      case "sign":    drawSign(ctx, px, py, theme); break;
      case "skull":   drawSkull(ctx, px, py); break;
    }
  }
}

/** Grey rock clump — 10×6 pixel-art chunk drawn at 4× scale so it reads
 *  as a proper boulder next to the ships. Bright top-edge highlight,
 *  dark bottom shadow, mid body. */
function drawRock(ctx: AnyCtx2D, px: number, py: number, theme: LevelTheme): void {
  const mid = theme.rockLight;
  const dark = theme.rockMid;
  const hi = theme.rockRim;
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(DECO_SCALE, DECO_SCALE);
  // 10×6 base shape — wider than tall, flat bottom, irregular top.
  ctx.fillStyle = mid;
  ctx.fillRect(-4, -1, 10, 5);    // body
  ctx.fillRect(-3, -2, 8, 1);     // upper bulge
  ctx.fillRect(-1, -3, 5, 1);     // peak
  // Top highlight along the lit side (upper-left).
  ctx.fillStyle = hi;
  ctx.fillRect(-1, -3, 3, 1);
  ctx.fillRect(-3, -2, 3, 1);
  ctx.fillRect(-4, -1, 2, 1);
  // Shadow on the underside / lower-right.
  ctx.fillStyle = dark;
  ctx.fillRect(2, 2, 4, 2);
  ctx.fillRect(4, 1, 2, 1);
  ctx.restore();
}

/** Scale factor for every non-crystal decoration. 4× means a 10×6 sprite
 *  ends up 40×24 texture pixels, ≈5m × 3m in world space — comparable
 *  to (slightly bigger than) a 2m ship. */
const DECO_SCALE = 4;

/** Small green plant — 5 wide × 5 tall sprout drawn at 4× scale. */
function drawPlant(ctx: AnyCtx2D, px: number, py: number, theme: LevelTheme): void {
  void theme;
  const leaf = "#5ed884";
  const leafDark = "#2a7a48";
  const stem = "#3a9858";
  const tip = "#a8f0c0";
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(DECO_SCALE, DECO_SCALE);
  // Stem column.
  ctx.fillStyle = stem;
  ctx.fillRect(0, -1, 1, 3);
  // Side leaves — upward V.
  ctx.fillStyle = leaf;
  ctx.fillRect(-2, -3, 1, 1);
  ctx.fillRect(-3, -2, 1, 1);
  ctx.fillRect(-2, -1, 1, 1);
  ctx.fillRect(2, -3, 1, 1);
  ctx.fillRect(3, -2, 1, 1);
  ctx.fillRect(2, -1, 1, 1);
  // Centre leaf cluster.
  ctx.fillRect(-1, -4, 3, 1);
  ctx.fillRect(-1, -3, 3, 1);
  // Mid-leaf shadow.
  ctx.fillStyle = leafDark;
  ctx.fillRect(0, -3, 1, 1);
  ctx.fillRect(-1, -2, 1, 1);
  ctx.fillRect(1, -2, 1, 1);
  // Bright tip.
  ctx.fillStyle = tip;
  ctx.fillRect(0, -4, 1, 1);
  ctx.restore();
}

/** Yellow / black warning sign — 5 wide × 8 tall on a brown post,
 *  drawn at 4× scale. */
function drawSign(ctx: AnyCtx2D, px: number, py: number, theme: LevelTheme): void {
  void theme;
  const post = "#5a4a3a";
  const postHi = "#8a7a5a";
  const yellow = "#ffd166";
  const black = "#1a0a0a";
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(DECO_SCALE, DECO_SCALE);
  // Post.
  ctx.fillStyle = post;
  ctx.fillRect(0, -3, 1, 4);
  ctx.fillStyle = postHi;
  ctx.fillRect(-1, 0, 1, 1);
  // Sign panel — 5×4 rectangle above the post.
  ctx.fillStyle = yellow;
  ctx.fillRect(-2, -7, 5, 4);
  // Black border.
  ctx.fillStyle = black;
  ctx.fillRect(-2, -7, 5, 1);
  ctx.fillRect(-2, -4, 5, 1);
  ctx.fillRect(-2, -7, 1, 4);
  ctx.fillRect(2, -7, 1, 4);
  // Exclamation glyph inside.
  ctx.fillRect(0, -6, 1, 2);
  ctx.fillRect(0, -3, 1, 1);
  ctx.restore();
}

/** Skull — 5 wide × 5 tall, drawn at 4× scale. */
function drawSkull(ctx: AnyCtx2D, px: number, py: number): void {
  const bone = "#e8e4d4";
  const boneShadow = "#a8a496";
  const shadow = "#3a3630";
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(DECO_SCALE, DECO_SCALE);
  // Cranium.
  ctx.fillStyle = bone;
  ctx.fillRect(-2, -3, 5, 3);
  ctx.fillRect(-1, -4, 3, 1);
  // Jaw.
  ctx.fillRect(-1, 0, 3, 1);
  ctx.fillRect(0, 1, 1, 1);
  ctx.fillStyle = boneShadow;
  ctx.fillRect(-2, -1, 1, 1);
  ctx.fillRect(2, -1, 1, 1);
  // Eye sockets.
  ctx.fillStyle = shadow;
  ctx.fillRect(-1, -2, 1, 1);
  ctx.fillRect(1, -2, 1, 1);
  // Nose hole.
  ctx.fillRect(0, -1, 1, 1);
  // Tooth gap.
  ctx.fillRect(0, 0, 1, 1);
  ctx.restore();
}

function drawCrystal(
  ctx: AnyCtx2D, px: number, py: number, accent: string,
): void {
  // 3px tall crystal — top bright, middle accent, base dark.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(px, py - 2, 1, 1);
  ctx.fillStyle = accent;
  ctx.fillRect(px - 1, py - 1, 1, 1);
  ctx.fillRect(px, py - 1, 1, 1);
  ctx.fillRect(px + 1, py - 1, 1, 1);
  ctx.fillStyle = darken(accent, 0.5);
  ctx.fillRect(px, py, 1, 1);
  // Soft additive glow halo.
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(px, py - 1, 0, px, py - 1, 6);
  g.addColorStop(0, withAlpha(accent, 0.35));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(px - 6, py - 7, 12, 12);
  ctx.globalCompositeOperation = "source-over";
}

function drawVignette(ctx: AnyCtx2D, W: number, H: number): void {
  const cx = W / 2;
  const cy = H / 2;
  const inner = Math.min(W, H) * 0.4;
  const outer = Math.max(W, H) * 0.8;
  const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ──────────────────────────────────────────────────────────────────────────
// Geometry / colour helpers.
// ──────────────────────────────────────────────────────────────────────────

function addPolygonToPath(
  path: Path2D, poly: Point[],
  wx: (x: number) => number, wy: (y: number) => number,
): void {
  path.moveTo(wx(poly[0].x), wy(poly[0].y));
  for (let i = 1; i < poly.length; i++) {
    path.lineTo(wx(poly[i].x), wy(poly[i].y));
  }
  path.closePath();
}

function strokePolygons(
  ctx: AnyCtx2D, level: Level,
  wx: (x: number) => number, wy: (y: number) => number,
  color: string, width: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  for (const poly of [level.boundary, ...level.obstacles]) {
    if (poly.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(wx(poly[0].x), wy(poly[0].y));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(wx(poly[i].x), wy(poly[i].y));
    }
    ctx.closePath();
    ctx.stroke();
  }
}

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

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Scale a hex colour by brightness factor (0..1+) and return "r,g,b,1". */
function tintRgb(hex: string, brightness: number): string {
  const [r, g, b] = hexToRgb(hex);
  const k = brightness / 255;
  return `${Math.min(255, Math.round(r * k + brightness * 0.3))},${Math.min(255, Math.round(g * k + brightness * 0.3))},${Math.min(255, Math.round(b * k + brightness * 0.3))},1`;
}

function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function darken(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.round(v * (1 - k));
  return `#${f(r).toString(16).padStart(2, "0")}${f(g).toString(16).padStart(2, "0")}${f(b).toString(16).padStart(2, "0")}`;
}
