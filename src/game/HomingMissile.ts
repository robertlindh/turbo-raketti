// HomingMissile — a smart projectile that lazily acquires the nearest
// non-owner ship and applies steering acceleration toward it. The flight
// looks like a Bullet but the entity has its own physics body so we can
// shape its trajectory (limit turn rate, cap speed) without fighting the
// Bullet's straight-line assumptions.

import RAPIER from "@dimforge/rapier2d-compat";
import { Container, Renderer, Sprite } from "pixi.js";
import type { PhysicsWorld } from "./PhysicsWorld";
import { makeMissileTexture } from "../render/sprites";

const MISSILE_RADIUS = 0.10;
/** Cruise speed (m/s) the missile tries to hold. */
const MISSILE_SPEED = 36;
/** Maximum steering acceleration (m/s²). Higher = tighter turns. */
const MISSILE_ACCEL = 90;
/** Lifetime in seconds before self-destructing. */
const MISSILE_TTL = 4.0;
/** Acquisition / re-acquisition range. Outside this, the missile flies
 *  straight until something enters range. Tuned wide enough to cover most
 *  of a level — Metarola is ~272m across, and the missile should still be
 *  able to swing onto a fleeing target launched from across the cave. */
const MISSILE_RANGE = 160;

export interface MissileTargetProvider {
  /** Return the current world positions of every potential target along
   *  with their player index — owner index will be filtered out. */
  candidates(): Array<{ index: number; x: number; y: number }>;
}

export interface MissileConfig {
  x: number;
  y: number;
  /** Initial velocity (the launching ship's barrel direction). */
  vx: number;
  vy: number;
  ownerIndex: number;
  color: number;
  targets: MissileTargetProvider;
}

export class HomingMissile {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly view: Sprite;
  readonly ownerIndex: number;
  readonly color: number;
  ttl = MISSILE_TTL;
  alive = true;

  private targets: MissileTargetProvider;
  private prev: { x: number; y: number };
  private disposed = false;

  constructor(
    physics: PhysicsWorld,
    renderer: Renderer,
    parent: Container,
    cfg: MissileConfig,
  ) {
    this.ownerIndex = cfg.ownerIndex;
    this.color = cfg.color;
    this.targets = cfg.targets;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(cfg.x, cfg.y)
      .setLinvel(cfg.vx, cfg.vy)
      .setGravityScale(0)
      .setLinearDamping(0)
      .setCcdEnabled(true);
    this.body = physics.world.createRigidBody(bodyDesc);

    const colDesc = RAPIER.ColliderDesc.ball(MISSILE_RADIUS)
      .setDensity(0.5)
      .setRestitution(0)
      .setFriction(0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.collider = physics.world.createCollider(colDesc, this.body);

    // Pixel-art mini-rocket — 5×9 sprite drawn by makeMissileTexture. The
    // texture's nose points up the -Y axis, so we add +π/2 in step() to
    // align the heading with velocity. Anchor at (0.5, 0.7) so the rocket
    // rotates around its engine, not its centre — that makes the trail
    // emit from behind it as you'd expect on a real missile.
    const texture = makeMissileTexture(renderer, cfg.color);
    this.view = new Sprite(texture);
    this.view.anchor.set(0.5, 0.5);
    // Scale: with a 5×9 texture and 0.06 m per texel, the missile renders
    // ~0.3 × 0.54 m — clearly read as a small craft next to the 0.85 m
    // ship, but small enough not to clutter dogfights.
    this.view.scale.set(0.06, 0.06);
    parent.addChild(this.view);

    // Point the nose along the initial velocity so the first frame doesn't
    // show the rocket sideways before step() kicks in.
    this.view.rotation = Math.atan2(cfg.vy, cfg.vx) + Math.PI / 2;

    this.prev = { x: cfg.x, y: cfg.y };
    this.view.x = cfg.x;
    this.view.y = cfg.y;
  }

  static radius(): number { return MISSILE_RADIUS; }
  static speed(): number { return MISSILE_SPEED; }

  snapshot() {
    const p = this.body.translation();
    return { x: p.x, y: p.y };
  }

  /** Step the homing logic. Called from the physics fixed-update step so
   *  we can apply impulses that take effect on the next integration. */
  step(dt: number): void {
    this.ttl -= dt;
    if (this.ttl <= 0) {
      this.alive = false;
      return;
    }

    const pos = this.body.translation();
    const target = this.pickTarget(pos.x, pos.y);
    const vel = this.body.linvel();
    const speed = Math.hypot(vel.x, vel.y) || 1;

    let desiredVx: number;
    let desiredVy: number;
    if (target) {
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const d = Math.hypot(dx, dy) || 1;
      desiredVx = (dx / d) * MISSILE_SPEED;
      desiredVy = (dy / d) * MISSILE_SPEED;
    } else {
      // No target in range — keep current heading, snap speed back to cruise.
      desiredVx = (vel.x / speed) * MISSILE_SPEED;
      desiredVy = (vel.y / speed) * MISSILE_SPEED;
    }

    // Apply steering as a clamped acceleration toward the desired velocity.
    const maxDv = MISSILE_ACCEL * dt;
    let dvx = desiredVx - vel.x;
    let dvy = desiredVy - vel.y;
    const mag = Math.hypot(dvx, dvy);
    if (mag > maxDv) {
      dvx = (dvx / mag) * maxDv;
      dvy = (dvy / mag) * maxDv;
    }
    this.body.setLinvel({ x: vel.x + dvx, y: vel.y + dvy }, true);

    // Rotate the sprite so its head points along the velocity vector.
    const nv = this.body.linvel();
    this.view.rotation = Math.atan2(nv.y, nv.x) + Math.PI / 2;
  }

  /** Pick the nearest non-owner candidate within range. */
  private pickTarget(x: number, y: number): { x: number; y: number } | null {
    let best: { x: number; y: number; d: number } | null = null;
    for (const c of this.targets.candidates()) {
      if (c.index === this.ownerIndex) continue;
      const dx = c.x - x;
      const dy = c.y - y;
      const d = Math.hypot(dx, dy);
      if (d > MISSILE_RANGE) continue;
      if (!best || d < best.d) best = { x: c.x, y: c.y, d };
    }
    return best;
  }

  /** Interpolated render sync between physics steps. */
  sync(alpha: number): void {
    const p = this.body.translation();
    this.view.x = this.prev.x + (p.x - this.prev.x) * alpha;
    this.view.y = this.prev.y + (p.y - this.prev.y) * alpha;
  }

  /** Snapshot the current position into `prev` so the next interpolation
   *  starts from the right place. Called at the end of each fixed-update. */
  snapshotPrev(): void {
    const p = this.body.translation();
    this.prev.x = p.x;
    this.prev.y = p.y;
  }

  dispose(physics: PhysicsWorld): void {
    if (this.disposed) return;
    this.disposed = true;
    this.alive = false;
    physics.world.removeRigidBody(this.body);
    this.view.destroy();
  }
}
