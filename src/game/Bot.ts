// Bot — an AI-driven Ship that wanders the cave by picking random target
// points inside the play area and steering toward them. Used by the
// single-player "wave" combat mode. Bots take a single bullet to kill
// (no HP, just instant death + score) so the action stays tight.
//
// The movement intentionally stays simple — pick a point, fly there, pick
// a new one when close — so the player can read the bot's path. More
// complex evasion would feel unfair when there's only one player.

import type { Renderer } from "pixi.js";
import type { Container } from "pixi.js";
import type { PhysicsWorld } from "./PhysicsWorld";
import type { Level, Point } from "../level/Level";
import { pointInPolygon } from "../level/geometry";
import { Ship, SHIP_RADIUS } from "./Ship";
import type { ShipInput } from "./Input";

const BOT_COLOR = 0xa86bff;
/** Distance to a target before we pick a new one. */
const ARRIVE_RADIUS = 4.0;
/** How tightly the bot has to be aimed at its target before it thrusts.
 *  Loose tolerance means the bot drifts gracefully instead of constantly
 *  spinning. */
const THRUST_TOLERANCE = 0.45; // radians (≈26°)

export class Bot {
  readonly ship: Ship;
  /** True while the bot should still participate in gameplay. Flipped to
   *  false when a bullet kills it — the reap loop then calls dispose. */
  alive = true;
  /** Separate from `alive` so dispose() is idempotent regardless of which
   *  state machine flipped the bot's gameplay status first. Without this
   *  we used to early-return when alive was already false, leaking the
   *  ship's physics body + Pixi sprite on every wave-mode kill. */
  private disposed = false;

  private target: Point;
  private boundary: Point[];
  private obstacles: Point[][];
  private bounds: Level["bounds"];
  /** Last seen position — used to detect "stuck against a wall" state
   *  where the AI keeps thrusting forward but the body can't move. */
  private lastPos: { x: number; y: number };
  /** Seconds spent making no progress toward the current target. */
  private stuckFor = 0;

  constructor(
    physics: PhysicsWorld,
    renderer: Renderer,
    parent: Container,
    level: Level,
    spawn: Point,
  ) {
    this.ship = new Ship(physics, renderer, parent, {
      x: spawn.x,
      y: spawn.y,
      color: BOT_COLOR,
      angle: -Math.PI / 2,
    });
    this.boundary = level.boundary;
    this.obstacles = level.obstacles;
    this.bounds = level.bounds;
    this.target = this.pickTarget();
    this.lastPos = { x: spawn.x, y: spawn.y };
  }

  /** Produce an input vector for the underlying ship this tick. Steers
   *  toward `target`; if already there or stuck against a wall, picks
   *  a new one. */
  computeInput(): ShipInput {
    const pos = this.ship.body.translation();
    const dx = this.target.x - pos.x;
    const dy = this.target.y - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < ARRIVE_RADIUS) {
      this.target = this.pickTarget();
    }

    // Stuck detection — if the body has barely moved in the last half
    // second despite the AI trying to thrust, the bot has wedged itself
    // against geometry. Pick a fresh target so it tries another route.
    const moved = Math.hypot(pos.x - this.lastPos.x, pos.y - this.lastPos.y);
    this.lastPos.x = pos.x;
    this.lastPos.y = pos.y;
    // Speed roughly < 1 m/s per physics step (1/60s) → moved < 0.017m.
    if (moved < 0.02) {
      this.stuckFor += 1 / 60;
      if (this.stuckFor > 0.6) {
        this.target = this.pickTarget();
        this.stuckFor = 0;
        // Force a hard kick — applyInput will rotate first, but apply a
        // small reverse impulse to dislodge the body from the wall.
        const v = this.ship.body.linvel();
        this.ship.body.setLinvel({ x: v.x * -0.3, y: v.y * -0.3 - 2 }, true);
      }
    } else {
      this.stuckFor = 0;
    }

    const desiredAngle = Math.atan2(dy, dx);
    const currentAngle = this.ship.body.rotation();
    // Shortest angular difference, signed.
    let diff = desiredAngle - currentAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const rotateLeft = diff < -0.05;
    const rotateRight = diff > 0.05;
    const thrust = Math.abs(diff) < THRUST_TOLERANCE;
    return { thrust, rotateLeft, rotateRight, fire: false, special: false };
  }

  /** Sample a random target point inside the cave (interior of boundary,
   *  outside obstacles). Falls back to the bounds centre if no valid point
   *  is found within a reasonable number of attempts. */
  private pickTarget(): Point {
    const b = this.bounds;
    const margin = 4;
    for (let attempt = 0; attempt < 25; attempt++) {
      const x = b.minX + margin + Math.random() * (b.maxX - b.minX - margin * 2);
      const y = b.minY + margin + Math.random() * (b.maxY - b.minY - margin * 2);
      const p = { x, y };
      if (!pointInPolygon(p.x, p.y, this.boundary)) continue;
      let blocked = false;
      for (const obs of this.obstacles) {
        if (pointInPolygon(p.x, p.y, obs)) { blocked = true; break; }
      }
      if (!blocked) return p;
    }
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }

  dispose(physics: PhysicsWorld): void {
    if (this.disposed) return;
    this.disposed = true;
    this.alive = false;
    this.ship.dispose(physics);
  }
}

/** Re-export so callers don't need to import from Ship.ts. */
export { SHIP_RADIUS as BOT_RADIUS };
