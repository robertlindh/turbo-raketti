import { Container, Graphics } from "pixi.js";

// ──────────────────────────────────────────────────────────────────────────
// Decals — bullet scorch marks on walls. They fade out over time and self-
// remove. A simple Graphics per decal so we don't accumulate texture memory.
// ──────────────────────────────────────────────────────────────────────────

interface Decal {
  view: Graphics;
  life: number;
  maxLife: number;
}

const MAX_DECALS = 60; // keep memory bounded — older ones get culled

export class DecalLayer extends Container {
  private decals: Decal[] = [];

  /** Spawn a scorch mark at a world position. `color` is the bullet's colour. */
  spawn(x: number, y: number, color: number): void {
    const g = new Graphics();
    // Random rotation so consecutive hits don't look identical.
    g.rotation = Math.random() * Math.PI * 2;
    g.x = x;
    g.y = y;
    const radius = 0.18 + Math.random() * 0.12;
    g.circle(0, 0, radius * 1.4).fill({ color: 0x000000, alpha: 0.55 });
    g.circle(0, 0, radius).fill({ color: 0x1a0a04, alpha: 0.85 });
    g.circle(0, 0, radius * 0.5).fill({ color, alpha: 0.4 });
    this.addChild(g);

    const life = 9 + Math.random() * 3;
    this.decals.push({ view: g, life, maxLife: life });

    // Cull oldest if we exceeded the cap.
    if (this.decals.length > MAX_DECALS) {
      const old = this.decals.shift()!;
      old.view.destroy();
    }
  }

  update(dt: number): void {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life <= 0) {
        d.view.destroy();
        this.decals.splice(i, 1);
      } else {
        // Stay solid for most of the life, fade only near the end.
        const t = d.life / d.maxLife;
        d.view.alpha = t > 0.4 ? 1 : t / 0.4;
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Wreckage — small chunks that fly out when a ship dies, fall with gravity,
// rotate and fade. Pure visual; no physics interactions with the cave (their
// own integrator handles fall).
// ──────────────────────────────────────────────────────────────────────────

interface Chunk {
  view: Graphics;
  vx: number;
  vy: number;
  vrot: number;
  life: number;
  maxLife: number;
}

/** Mirror of MAX_DECALS — keep visible wreckage bounded so a flurry of
 *  kills + checkpoint hits doesn't pile up hundreds of Graphics objects.
 *  When the cap is exceeded we evict the oldest chunk, same pattern the
 *  DecalLayer uses. */
const MAX_WRECKAGE = 120;

export class WreckageLayer extends Container {
  private chunks: Chunk[] = [];

  /** Spawn a wreckage burst at the kill position in the victim's colour. */
  spawn(x: number, y: number, color: number, count = 6): void {
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      // A small jagged shard.
      const size = 0.18 + Math.random() * 0.22;
      g.moveTo(-size, -size * 0.3);
      g.lineTo(size * 0.6, -size);
      g.lineTo(size, size * 0.5);
      g.lineTo(-size * 0.3, size);
      g.closePath();
      g.fill({ color, alpha: 1 });
      g.stroke({ color: 0x000000, width: 0.03, alpha: 0.7 });
      g.x = x;
      g.y = y;
      g.rotation = Math.random() * Math.PI * 2;
      this.addChild(g);

      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 8;
      const life = 0.9 + Math.random() * 0.5;
      this.chunks.push({
        view: g,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2, // slight upward kick
        vrot: (Math.random() - 0.5) * 12,
        life,
        maxLife: life,
      });
      // Evict the oldest chunk if we blew past the cap. Matches the
      // DecalLayer policy so both layers behave consistently.
      if (this.chunks.length > MAX_WRECKAGE) {
        const old = this.chunks.shift()!;
        old.view.destroy();
      }
    }
  }

  update(dt: number, gravity: number): void {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      if (c.life <= 0) {
        c.view.destroy();
        this.chunks.splice(i, 1);
        continue;
      }
      c.vy += gravity * dt;
      c.view.x += c.vx * dt;
      c.view.y += c.vy * dt;
      c.view.rotation += c.vrot * dt;
      // Air drag.
      c.vx *= 0.985;
      c.vy *= 0.99;
      c.vrot *= 0.985;
      const t = c.life / c.maxLife;
      c.view.alpha = t > 0.3 ? 1 : t / 0.3;
    }
  }
}
