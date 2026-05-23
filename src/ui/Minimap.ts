import type { Level, Point } from "../level/Level";

/**
 * A tiny canvas-based overview of the arena in the bottom-right of the
 * screen. Shows the cave shape, obstacles, water, power-ups, mines, and
 * each player's position with their colour.
 *
 * Updates ~10× per second to keep CPU cost negligible.
 */

const PADDING = 4; // px between content and canvas edges

interface PlayerDot {
  x: number;
  y: number;
  color: number;
  alive: boolean;
}

interface PowerUpDot {
  x: number;
  y: number;
  color: number;
}

interface MineDot {
  x: number;
  y: number;
  ownerColor: number;
}

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private level: Level | null = null;
  private updateAccum = 0;
  /** Cached bounds + scaling — recomputed when level changes. */
  private scaleX = 1;
  private scaleY = 1;
  private worldOffsetX = 0;
  private worldOffsetY = 0;

  constructor(widthPx = 200, heightPx = 130) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = widthPx;
    this.canvas.height = heightPx;
    this.canvas.style.cssText = `
      position: fixed;
      bottom: 12px;
      right: 12px;
      z-index: 60;
      background: rgba(8, 6, 16, 0.78);
      border: 1px solid #2a2a36;
      border-radius: 6px;
      pointer-events: none;
      image-rendering: pixelated;
    `;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Minimap: no 2D context");
    this.ctx = ctx;
    document.body.appendChild(this.canvas);
  }

  setLevel(level: Level) {
    this.level = level;
    const w = this.canvas.width - PADDING * 2;
    const h = this.canvas.height - PADDING * 2;
    const lvW = level.bounds.maxX - level.bounds.minX;
    const lvH = level.bounds.maxY - level.bounds.minY;
    // Fit-aspect: pick the smaller scale so both dimensions fit.
    const fit = Math.min(w / lvW, h / lvH);
    this.scaleX = fit;
    this.scaleY = fit;
    // Centre the level content inside the canvas.
    const usedW = lvW * fit;
    const usedH = lvH * fit;
    this.worldOffsetX = PADDING + (w - usedW) / 2 - level.bounds.minX * fit;
    this.worldOffsetY = PADDING + (h - usedH) / 2 - level.bounds.minY * fit;
  }

  private wx(x: number): number { return x * this.scaleX + this.worldOffsetX; }
  private wy(y: number): number { return y * this.scaleY + this.worldOffsetY; }

  update(
    dt: number,
    players: PlayerDot[],
    powerups: PowerUpDot[],
    mines: MineDot[],
    /** Index of the checkpoint each player is currently racing toward, or
     *  `null` if that player is dead / not racing. When provided, the
     *  matching gates are highlighted on the minimap so the racer always
     *  knows where to head next. */
    nextCheckpointPerPlayer?: Array<number | null>,
  ): void {
    // Throttle to ~10 Hz to keep CPU cost negligible.
    this.updateAccum += dt;
    if (this.updateAccum < 0.1) return;
    this.updateAccum = 0;
    if (!this.level) return;

    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Clear (translucent so the styled background div shows through).
    ctx.clearRect(0, 0, W, H);

    // Cave-interior fill (slightly lighter than the panel background).
    if (this.level.boundary.length >= 3) {
      ctx.fillStyle = "rgba(30, 22, 50, 0.95)";
      this.tracePolygon(this.level.boundary);
      ctx.fill();
    }

    // Obstacles in solid rock colour.
    ctx.fillStyle = "rgba(80, 64, 110, 0.9)";
    for (const obs of this.level.obstacles) {
      if (obs.length >= 3) {
        this.tracePolygon(obs);
        ctx.fill();
      }
    }

    // Water zones — translucent teal.
    if (this.level.waterZones) {
      ctx.fillStyle = "rgba(56, 124, 200, 0.6)";
      for (const wz of this.level.waterZones) {
        if (wz.length >= 3) {
          this.tracePolygon(wz);
          ctx.fill();
        }
      }
    }

    // Boundary outline.
    ctx.strokeStyle = "#9e88be";
    ctx.lineWidth = 1;
    if (this.level.boundary.length >= 3) {
      this.tracePolygon(this.level.boundary);
      ctx.stroke();
    }

    // Checkpoints — gold gates so they pop against the rock. Players who
    // are currently racing toward a specific gate get that gate filled
    // (and pulsed slightly) in their colour.
    if (this.level.checkpoints) {
      // Build a set of (checkpointIndex → player colours that need it next)
      // so a single gate can be tinted with whoever's about to hit it.
      const nextFor = new Map<number, number[]>();
      if (nextCheckpointPerPlayer) {
        for (let pi = 0; pi < nextCheckpointPerPlayer.length; pi++) {
          const idx = nextCheckpointPerPlayer[pi];
          if (idx == null) continue;
          const colour = players[pi]?.color ?? 0xffffff;
          const list = nextFor.get(idx) ?? [];
          list.push(colour);
          nextFor.set(idx, list);
        }
      }
      // Slow pulse — gold gates breathe so the eye is drawn to them.
      const pulse = 0.85 + 0.15 * Math.sin(performance.now() * 0.005);
      for (let i = 0; i < this.level.checkpoints.length; i++) {
        const cp = this.level.checkpoints[i];
        const cx = this.wx(cp.x);
        const cy = this.wy(cp.y);
        const r = 5;
        const targetColours = nextFor.get(i);
        // Base ring — bright gold.
        ctx.strokeStyle = "rgba(255, 209, 102, 0.95)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, r * (targetColours ? pulse : 1), 0, Math.PI * 2);
        ctx.stroke();
        // Inner dot — fills the "current" gate in the racer's colour;
        // otherwise leaves a small gold dot.
        if (targetColours && targetColours.length > 0) {
          ctx.fillStyle =
            `#${targetColours[0].toString(16).padStart(6, "0")}`;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.45 * pulse, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = "rgba(255, 209, 102, 0.5)";
          ctx.beginPath();
          ctx.arc(cx, cy, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Mines — red Xs.
    for (const m of mines) {
      const cx = this.wx(m.x);
      const cy = this.wy(m.y);
      ctx.strokeStyle = "#ff4848";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy - 2); ctx.lineTo(cx + 2, cy + 2);
      ctx.moveTo(cx + 2, cy - 2); ctx.lineTo(cx - 2, cy + 2);
      ctx.stroke();
      void m.ownerColor;
    }

    // Power-ups — coloured diamonds with a subtle outline so they pop.
    for (const pu of powerups) {
      const cx = this.wx(pu.x);
      const cy = this.wy(pu.y);
      ctx.fillStyle = `#${pu.color.toString(16).padStart(6, "0")}`;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 3);
      ctx.lineTo(cx + 3, cy);
      ctx.lineTo(cx, cy + 3);
      ctx.lineTo(cx - 3, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Players — coloured filled circles, dim if dead.
    for (const p of players) {
      const cx = this.wx(p.x);
      const cy = this.wy(p.y);
      ctx.fillStyle = `#${p.color.toString(16).padStart(6, "0")}`;
      ctx.globalAlpha = p.alive ? 1 : 0.35;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
      // White rim for legibility.
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private tracePolygon(poly: Point[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(this.wx(poly[0].x), this.wy(poly[0].y));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(this.wx(poly[i].x), this.wy(poly[i].y));
    }
    ctx.closePath();
  }

  dispose(): void {
    this.canvas.remove();
  }
}
