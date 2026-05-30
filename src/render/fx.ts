import { Container, Renderer, Sprite, Texture } from "pixi.js";

// ---------------------------------------------------------------------------
// Glow texture cache
// ---------------------------------------------------------------------------

const GLOW_TEXTURE_CACHE = new Map<number, Texture>();

/**
 * Generate (or return cached) soft radial-glow texture: white-hot centre
 * fading to transparent. Cached per integer radius.
 *
 * Drawn to a 2D canvas using `createRadialGradient` — same approach as
 * `drawStyle3()` in `public/graphics-preview.js`. The texture is white so
 * the colour comes from `sprite.tint`, and additive blend mode gives the
 * "lighter" composite look from the reference.
 */
export function makeGlowTexture(renderer: Renderer, radius: number): Texture {
  // renderer is accepted for API symmetry / future use (e.g. resolution
  // aware textures); v8 textures are renderer-agnostic so we don't need it
  // for the actual upload.
  void renderer;

  const r = Math.max(1, Math.round(radius));
  const cached = GLOW_TEXTURE_CACHE.get(r);
  // `cached.destroyed` guards against the cache returning a stale texture
  // after a prior Game.dispose() destroyed it via app.destroy({texture: true}).
  // Without the guard, the next match's GlowLayer/ParticleSystem would attach
  // a freed GPU texture to fresh sprites and either render garbage or hard-
  // crash inside Pixi's batch renderer.
  if (cached && !cached.destroyed) return cached;

  const size = r * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Fallback: empty texture. Shouldn't happen in any real browser.
    const empty = Texture.EMPTY;
    GLOW_TEXTURE_CACHE.set(r, empty);
    return empty;
  }

  const cx = r;
  const cy = r;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  // White-hot core fading to fully transparent. Use a soft falloff with
  // a small "hot" plateau near the centre to read as a bloom.
  grad.addColorStop(0.0, "rgba(255,255,255,1.0)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.75)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.30)");
  grad.addColorStop(1.0, "rgba(255,255,255,0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const texture = Texture.from(canvas);
  // Smooth scaling so we can stretch the glow without nearest-neighbour
  // pixel-art crunch.
  texture.source.scaleMode = "linear";

  GLOW_TEXTURE_CACHE.set(r, texture);
  return texture;
}

// ---------------------------------------------------------------------------
// GlowLayer
// ---------------------------------------------------------------------------

/** Internal state attached to a one-shot glow sprite. */
interface BurstState {
  sprite: Sprite;
  life: number;
  maxLife: number;
  initialAlpha: number;
}

/** Reference radius used for the shared "base" glow texture. Sprites are
 *  scaled relative to this so we re-use the same texture for many sizes. */
const GLOW_BASE_RADIUS = 32;

/**
 * Container of additive-blended glow sprites. Add it to the world layer
 * ABOVE the ships/bullets so it lights them.
 */
export class GlowLayer extends Container {
  private readonly _baseTexture: Texture;
  private readonly _bursts: BurstState[] = [];

  constructor(renderer: Renderer) {
    super();
    this._baseTexture = makeGlowTexture(renderer, GLOW_BASE_RADIUS);
    // Children paint themselves additively. We don't set blendMode on the
    // Container — Pixi v8 picks it up per-Sprite (see addPersistent / burst).
  }

  /** One-shot burst that fades out then removes itself. */
  burst(
    x: number,
    y: number,
    radius: number,
    color: number,
    durationSec: number = 0.35,
  ): void {
    const sprite = this._makeGlowSprite(x, y, radius, color);
    sprite.alpha = 1;
    this.addChild(sprite);

    this._bursts.push({
      sprite,
      life: durationSec,
      maxLife: durationSec,
      initialAlpha: 1,
    });
  }

  /** Persistent glow sprite the caller owns. Returns the sprite. */
  addPersistent(x: number, y: number, radius: number, color: number): Sprite {
    const sprite = this._makeGlowSprite(x, y, radius, color);
    this.addChild(sprite);
    return sprite;
  }

  /** Call from your fixed update — fades and prunes finished bursts. */
  update(dt: number): void {
    for (let i = this._bursts.length - 1; i >= 0; i--) {
      const b = this._bursts[i]!;
      b.life -= dt;
      if (b.life <= 0) {
        // Done — destroy sprite, remove from list (texture is shared so
        // we don't destroy the texture itself).
        b.sprite.destroy({ children: false, texture: false });
        this._bursts.splice(i, 1);
      } else {
        const t = b.life / b.maxLife; // 1 → 0
        b.sprite.alpha = b.initialAlpha * t;
      }
    }
  }

  private _makeGlowSprite(
    x: number,
    y: number,
    radius: number,
    color: number,
  ): Sprite {
    const sprite = new Sprite(this._baseTexture);
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    sprite.tint = color;
    sprite.blendMode = "add";
    const scale = Math.max(0.0001, radius / GLOW_BASE_RADIUS);
    sprite.scale.set(scale);
    return sprite;
  }
}

// ---------------------------------------------------------------------------
// ParticleSystem
// ---------------------------------------------------------------------------

/** Texture radius for the tiny per-particle glow. Particles are drawn from
 *  an 8×8 (radius 4) soft glow tinted to the particle colour. */
const PARTICLE_TEX_RADIUS = 4;
const PARTICLE_TEX_SIZE = PARTICLE_TEX_RADIUS * 2;

/** Streak texture dimensions. Elongated horizontally so when oriented along
 *  a particle's velocity it reads as a "smear" instead of a dot. */
const STREAK_TEX_W = 24;
const STREAK_TEX_H = 6;

/** Initial pool capacity. The pool grows on demand up to PARTICLE_POOL_MAX. */
const PARTICLE_POOL_INITIAL = 256;
/** Hard cap on the pool size. Without this, sustained heavy emission
 *  (race + 2 ship trails + power-up bursts + checkpoint FX) can balloon the
 *  pool into the thousands of Sprite children — each one is a participating
 *  node in Pixi's transform + render graph even when invisible. Above ~1k
 *  sprites the per-frame walk becomes the dominant cost and the GC starts
 *  thrashing. Drop emissions silently once the pool is full and busy. */
const PARTICLE_POOL_MAX = 1024;

interface Particle {
  sprite: Sprite;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  baseSize: number; // logical pixels
  color: number;
  /** Start tint at full life (life == maxLife). */
  startColor: number;
  /** End tint when life reaches 0. If equal to startColor, particle stays
   *  one colour the whole time. */
  endColor: number;
  drag: number; // per-second drag factor (e.g. ~0.85^60 for "0.85/frame")
  /** If true the sprite is oriented along velocity and scaled non-uniformly
   *  to read as an elongated streak. */
  streak: boolean;
}

/**
 * Lightweight particle emitter. Each particle is a tiny additive glow
 * sprite tinted to its colour. Particles are pooled — `explode` /
 * `thrust` pull from a free-list and never allocate after warmup.
 */
export class ParticleSystem extends Container {
  private readonly _texture: Texture;
  private readonly _streakTexture: Texture;
  private readonly _particles: Particle[] = [];
  private readonly _free: Particle[] = [];

  constructor(renderer: Renderer) {
    super();
    this._texture = makeGlowTexture(renderer, PARTICLE_TEX_RADIUS);
    this._streakTexture = makeStreakTexture(renderer);
    // Pre-warm the pool so steady-state has no allocations.
    for (let i = 0; i < PARTICLE_POOL_INITIAL; i++) {
      this._allocParticle();
    }
  }

  /** Explosion burst at world position. Default values give an outward-flying
   *  blast; pass `speedMin/speedMax/lifeMin/lifeMax` to tune. For a local
   *  contained pop, drop speed and life. */
  explode(
    x: number, y: number, count: number, color: number,
    opts: {
      speedMin?: number;
      speedMax?: number;
      lifeMin?: number;
      lifeMax?: number;
      sizeMin?: number;
      sizeMax?: number;
    } = {},
  ): void {
    const speedMin = opts.speedMin ?? 40;
    const speedMax = opts.speedMax ?? 160;
    const lifeMin = opts.lifeMin ?? 0.35;
    const lifeMax = opts.lifeMax ?? 0.75;
    const sizeMin = opts.sizeMin ?? 1.5;
    const sizeMax = opts.sizeMax ?? 3.0;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      const life = lifeMin + Math.random() * (lifeMax - lifeMin);
      this._emit({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        baseSize: sizeMin + Math.random() * (sizeMax - sizeMin),
        startColor: color,
        endColor: color,
        drag: Math.pow(0.92, 60),
        streak: false,
      });
    }
  }

  /** Brief thrust spark with velocity (used by ship engine, etc.). */
  thrust(x: number, y: number, vx: number, vy: number, color: number): void {
    // Small randomization around the input velocity.
    const jitter = 40; // px/sec spread
    const jx = (Math.random() - 0.5) * jitter;
    const jy = (Math.random() - 0.5) * jitter;
    this._emit({
      x,
      y,
      vx: vx + jx,
      vy: vy + jy,
      life: 0.18 + Math.random() * 0.08,
      baseSize: 1 + Math.random(),
      startColor: color,
      endColor: color,
      // ~0.85 per frame at 60fps  →  pow(0.85, 60) ≈ 6.4e-5/sec
      drag: Math.pow(0.85, 60),
      streak: false,
    });
  }

  /** Elongated streak particle — the per-frame thrust emission for a rocket
   *  flame trail. The particle is oriented along its velocity and tints from
   *  `startColor` to `endColor` over its life (so the flame fades white → red
   *  → dark behind the ship). */
  thrustStreak(
    x: number, y: number,
    vx: number, vy: number,
    startColor: number,
    endColor: number,
    opts: { life?: number; size?: number; drag?: number } = {},
  ): void {
    const jitter = 20;
    const jx = (Math.random() - 0.5) * jitter;
    const jy = (Math.random() - 0.5) * jitter;
    const life = (opts.life ?? 0.9) + Math.random() * 0.25;
    const size = (opts.size ?? 1.6) + Math.random() * 0.6;
    // drag closer to 1 = particle keeps speed longer = trail stretches further
    const drag = opts.drag ?? Math.pow(0.98, 60);
    this._emit({
      x,
      y,
      vx: vx + jx,
      vy: vy + jy,
      life,
      baseSize: size,
      startColor,
      endColor,
      drag,
      streak: true,
    });
  }

  /** Call each fixed update. */
  update(dt: number): void {
    // Per-second drag → per-dt scalar via pow(drag, dt). For typical small
    // dt (1/60) and drag close to 1, this is cheap.
    for (let i = 0; i < this._particles.length; i++) {
      const p = this._particles[i]!;
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        this._free.push(p);
        continue;
      }

      // Integrate. Drag is stored as "per-second" so we exponentiate by dt.
      const dragStep = Math.pow(p.drag, dt);
      p.vx *= dragStep;
      p.vy *= dragStep;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const t = p.life / p.maxLife; // 1 → 0
      const s = p.baseSize * (0.4 + 0.6 * t); // shrink slightly with age

      // Colour ramp from startColor (t=1) to endColor (t=0).
      p.sprite.tint =
        p.startColor === p.endColor
          ? p.startColor
          : lerpColor(p.endColor, p.startColor, t);

      p.sprite.position.set(p.x, p.y);
      p.sprite.alpha = t;

      if (p.streak) {
        // Orient along velocity, stretch horizontally so the sprite reads as
        // a smear behind the particle. Length tapers with age so the streak
        // narrows as it dies.
        const speed = Math.hypot(p.vx, p.vy);
        if (speed > 0.01) {
          p.sprite.rotation = Math.atan2(p.vy, p.vx);
        }
        // Stretch grows briefly then settles to ~1 so the streak shortens
        // as the particle slows.
        const stretch = 0.6 + 0.6 * t;
        const sx = (s * 2 * stretch) / STREAK_TEX_W;
        const sy = (s * 2) / STREAK_TEX_H;
        p.sprite.scale.set(sx, sy);
      } else {
        const spriteScale = (s * 2) / PARTICLE_TEX_SIZE;
        p.sprite.scale.set(spriteScale);
      }
    }
  }

  // ---- internals ----

  /** Allocates a particle and parks it on the free list. */
  private _allocParticle(): Particle {
    const sprite = new Sprite(this._texture);
    sprite.anchor.set(0.5);
    sprite.blendMode = "add";
    sprite.visible = false;
    this.addChild(sprite);

    const p: Particle = {
      sprite,
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      baseSize: 1,
      color: 0xffffff,
      startColor: 0xffffff,
      endColor: 0xffffff,
      drag: 1,
      streak: false,
    };
    this._particles.push(p);
    this._free.push(p);
    return p;
  }

  /** Claim a particle off the free list, growing the pool if empty up to
   *  PARTICLE_POOL_MAX. Returns null once the cap is hit so callers can
   *  silently drop the emission instead of unbounded growth. */
  private _claimParticle(): Particle | null {
    if (this._free.length === 0) {
      if (this._particles.length >= PARTICLE_POOL_MAX) return null;
      this._allocParticle(); // pushes onto _free
    }
    return this._free.pop()!;
  }

  private _emit(opts: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    baseSize: number;
    startColor: number;
    endColor: number;
    drag: number;
    streak: boolean;
  }): void {
    const p = this._claimParticle();
    if (!p) return; // pool exhausted — drop the emission silently
    p.active = true;
    p.x = opts.x;
    p.y = opts.y;
    p.vx = opts.vx;
    p.vy = opts.vy;
    p.life = opts.life;
    p.maxLife = opts.life;
    p.baseSize = opts.baseSize;
    p.color = opts.startColor;
    p.startColor = opts.startColor;
    p.endColor = opts.endColor;
    p.drag = opts.drag;
    p.streak = opts.streak;

    // Swap texture based on streak mode.
    p.sprite.texture = opts.streak ? this._streakTexture : this._texture;
    p.sprite.visible = true;
    p.sprite.tint = opts.startColor;
    p.sprite.alpha = 1;
    p.sprite.rotation = 0;
    p.sprite.position.set(opts.x, opts.y);
    if (opts.streak) {
      const sx = (opts.baseSize * 2) / STREAK_TEX_W;
      const sy = (opts.baseSize * 2) / STREAK_TEX_H;
      p.sprite.scale.set(sx, sy);
    } else {
      const spriteScale = (opts.baseSize * 2) / PARTICLE_TEX_SIZE;
      p.sprite.scale.set(spriteScale);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Streak texture — elongated horizontal smear used by thrustStreak.
// ──────────────────────────────────────────────────────────────────────────

let STREAK_TEXTURE: Texture | null = null;

function makeStreakTexture(renderer: Renderer): Texture {
  void renderer;
  // Same .destroyed dance as the glow cache — rebuild lazily if the prior
  // session's app.destroy() killed the texture.
  if (STREAK_TEXTURE && !STREAK_TEXTURE.destroyed) return STREAK_TEXTURE;
  const canvas = document.createElement("canvas");
  canvas.width = STREAK_TEX_W;
  canvas.height = STREAK_TEX_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.EMPTY;
  // Soft falloff along X (length) modulated by a falloff along Y (thickness).
  const img = ctx.createImageData(STREAK_TEX_W, STREAK_TEX_H);
  const cx = STREAK_TEX_W / 2;
  const cy = STREAK_TEX_H / 2;
  for (let y = 0; y < STREAK_TEX_H; y++) {
    for (let x = 0; x < STREAK_TEX_W; x++) {
      // X falloff: peak at centre, fades to edges with a smooth curve.
      const dx = (x - cx) / (STREAK_TEX_W / 2);
      // Y falloff: peak on the centreline.
      const dy = (y - cy) / (STREAK_TEX_H / 2);
      const fx = Math.max(0, 1 - dx * dx);
      const fy = Math.max(0, 1 - dy * dy);
      const a = Math.round(255 * fx * fy);
      const i = (y * STREAK_TEX_W + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = "linear";
  STREAK_TEXTURE = tex;
  return tex;
}

/** Linearly interpolate two RGB hex colours. `t` in [0,1]. */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
