import { Container, Graphics } from "pixi.js";
import type { Level, Point } from "../level/Level";

/** Pickup-style distance for hitting a checkpoint. */
export const CHECKPOINT_RADIUS = 3.0;

/**
 * Visual representation of a single checkpoint. Two colour-coded glow rings
 * per player highlight which one is next for them.
 */
class CheckpointView {
  readonly view: Container;
  /** Outer pulsing ring per player — keyed by player index. */
  private rings: Graphics[] = [];
  /** Soft glow fill underneath everything — pulses with the base ring. */
  private glow: Graphics;
  /** Always-on gold base ring + number. */
  private base: Graphics;
  private numberLabel: Graphics;
  private t = 0;

  constructor(parent: Container, x: number, y: number, index: number, total: number) {
    void total;
    this.view = new Container();
    this.view.x = x;
    this.view.y = y;

    // 1. Soft outer glow disc — translucent gold, pulses scale+alpha.
    this.glow = new Graphics();
    this.glow.circle(0, 0, CHECKPOINT_RADIUS * 1.4)
      .fill({ color: 0xffd166, alpha: 0.10 });
    this.glow.circle(0, 0, CHECKPOINT_RADIUS * 1.05)
      .fill({ color: 0xffd166, alpha: 0.18 });
    this.view.addChild(this.glow);

    // 2. Bold gold ring — the "gate" itself. Two concentric strokes give
    //    it visual weight at gameplay zoom (~22 px/m).
    this.base = new Graphics();
    this.base.circle(0, 0, CHECKPOINT_RADIUS)
      .stroke({ color: 0xffd166, width: 0.45, alpha: 1 });
    this.base.circle(0, 0, CHECKPOINT_RADIUS - 0.5)
      .stroke({ color: 0xffffff, width: 0.18, alpha: 0.85 });
    this.view.addChild(this.base);

    // 3. Number — a chunky pixel-art digit (1-9) in the middle.
    this.numberLabel = new Graphics();
    this.drawDigit(this.numberLabel, index + 1);
    this.view.addChild(this.numberLabel);

    parent.addChild(this.view);
  }

  /** Draw a 1-9 pixel digit centred on (0, 0). Each digit is on a 3×5 grid
   *  of "pixels" 0.4m × 0.4m. */
  private drawDigit(g: Graphics, n: number) {
    const PX = 0.42;
    const digits: Record<number, string[]> = {
      1: ["010", "110", "010", "010", "111"],
      2: ["111", "001", "111", "100", "111"],
      3: ["111", "001", "111", "001", "111"],
      4: ["101", "101", "111", "001", "001"],
      5: ["111", "100", "111", "001", "111"],
      6: ["111", "100", "111", "101", "111"],
      7: ["111", "001", "010", "100", "100"],
      8: ["111", "101", "111", "101", "111"],
      9: ["111", "101", "111", "001", "111"],
    };
    const rows = digits[n] ?? digits[1];
    const w = 3, h = 5;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (rows[y][x] === "1") {
          g.rect((x - w / 2) * PX, (y - h / 2) * PX, PX, PX)
            .fill({ color: 0xffd166, alpha: 1 });
        }
      }
    }
  }

  /** Update the highlight rings per player. `nextForPlayer` is a Map<index,bool>
   *  saying which players have THIS checkpoint as their next one. */
  update(dt: number, nextForPlayers: { color: number }[]) {
    this.t += dt;

    // Pulse the always-on glow + base ring so every gate is visible and
    // alive, not just the "next" one. The active player's gate pulses
    // harder (see below).
    const breath = (Math.sin(this.t * 2.6) + 1) * 0.5; // 0..1
    const glowScale = 1 + breath * 0.18;
    this.glow.scale.set(glowScale, glowScale);
    this.glow.alpha = 0.55 + breath * 0.45;
    const baseScale = 1 + breath * 0.04;
    this.base.scale.set(baseScale, baseScale);

    // Remove old rings.
    for (const r of this.rings) r.destroy();
    this.rings = [];

    // For each player whose next checkpoint is this one, draw a big glowing
    // ring tinted to that player's colour — that's the "target" cue.
    const targetPulse = 1 + Math.sin(this.t * 3.5) * 0.10;
    let stack = 0;
    for (const { color } of nextForPlayers) {
      const r = new Graphics();
      const outer = CHECKPOINT_RADIUS + 0.6 + stack * 0.4;
      r.circle(0, 0, outer)
        .stroke({ color, width: 0.55, alpha: 0.95 });
      r.circle(0, 0, outer + 0.6).fill({ color, alpha: 0.12 });
      r.scale.set(targetPulse, targetPulse);
      this.view.addChild(r);
      this.rings.push(r);
      stack++;
    }
  }

  dispose() {
    this.view.destroy({ children: true });
  }
}

/**
 * RacingSystem — manages checkpoint visuals and per-player lap tracking.
 * Touching the *next* checkpoint advances the player's progress; touching
 * the first one again after all others completes a lap.
 */
export class RacingSystem {
  private checkpoints: Point[];
  private views: CheckpointView[] = [];
  /** Per player: which checkpoint index they need to hit next. */
  private nextIndex: number[];
  /** Per player: completed laps. */
  laps: number[];

  constructor(parent: Container, level: Level, numPlayers: number) {
    this.checkpoints = level.checkpoints ?? [];
    this.nextIndex = new Array(numPlayers).fill(0);
    this.laps = new Array(numPlayers).fill(0);
    for (let i = 0; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i];
      this.views.push(new CheckpointView(parent, cp.x, cp.y, i, this.checkpoints.length));
    }
  }

  hasCheckpoints(): boolean {
    return this.checkpoints.length > 0;
  }

  /** Returns the next checkpoint index a player needs to hit. */
  nextFor(playerIndex: number): number {
    return this.nextIndex[playerIndex] ?? 0;
  }

  /** Check every player against their next checkpoint. Returns the player
   *  index that just completed a lap, or -1 if nobody did. */
  checkProgress(
    playerPositions: Array<{ index: number; x: number; y: number; color: number; alive: boolean } | null>,
  ): number {
    let lappedPlayer = -1;
    for (const p of playerPositions) {
      if (!p || !p.alive) continue;
      const target = this.nextIndex[p.index];
      const cp = this.checkpoints[target];
      if (!cp) continue;
      const dx = p.x - cp.x;
      const dy = p.y - cp.y;
      if (dx * dx + dy * dy < CHECKPOINT_RADIUS * CHECKPOINT_RADIUS) {
        // Hit! Advance. Wrap-around = lap finished.
        const advanced = target + 1;
        if (advanced >= this.checkpoints.length) {
          this.nextIndex[p.index] = 0;
          this.laps[p.index]++;
          lappedPlayer = p.index;
        } else {
          this.nextIndex[p.index] = advanced;
        }
      }
    }
    return lappedPlayer;
  }

  /** Per-frame visual update — highlights each player's next checkpoint. */
  update(dt: number, players: Array<{ index: number; color: number; alive: boolean }>) {
    for (let i = 0; i < this.views.length; i++) {
      const nextForList: { color: number }[] = [];
      for (const p of players) {
        if (!p.alive) continue;
        if (this.nextIndex[p.index] === i) {
          nextForList.push({ color: p.color });
        }
      }
      this.views[i].update(dt, nextForList);
    }
  }

  dispose() {
    for (const v of this.views) v.dispose();
    this.views = [];
  }
}
