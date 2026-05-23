import RAPIER from "@dimforge/rapier2d-compat";
import { Container, Renderer, Sprite } from "pixi.js";
import type { PhysicsWorld } from "./PhysicsWorld";
import { makeBulletTexture } from "../render/sprites";
import { SETTINGS } from "./Settings";

// Bullets read as a small dot of plasma — the sprite is a single tinted
// pixel scaled up to ~2 screen pixels at gameplay zoom, with a short
// subtle trail behind it for motion clarity.
const BULLET_RADIUS = 0.10;
// Display size of the 1×1 sprite, expressed in metres-per-texel. At the
// game's typical close-in zoom (~22 px/m) this puts the bullet head at
// ~2 screen pixels — visible but still very tight.
const BULLET_SPRITE_METRES_PER_PX = 0.10;

export interface BulletConfig {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ownerIndex: number;
  color: number;
}

export class Bullet {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly view: Sprite;
  readonly ownerIndex: number;
  readonly color: number;
  ttl = SETTINGS.bulletTtl;
  /** Gameplay flag: true while the bullet should still affect the game. */
  alive = true;
  private disposed = false;
  prev: { x: number; y: number };

  constructor(
    physics: PhysicsWorld,
    renderer: Renderer,
    parent: Container,
    cfg: BulletConfig,
  ) {
    this.ownerIndex = cfg.ownerIndex;
    this.color = cfg.color;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(cfg.x, cfg.y)
      .setLinvel(cfg.vx, cfg.vy)
      .setGravityScale(0)
      .setLinearDamping(0)
      .setCcdEnabled(true);
    this.body = physics.world.createRigidBody(bodyDesc);

    const colDesc = RAPIER.ColliderDesc.ball(BULLET_RADIUS)
      .setDensity(0.5)
      .setRestitution(0)
      .setFriction(0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.collider = physics.world.createCollider(colDesc, this.body);

    const texture = makeBulletTexture(renderer, cfg.color);
    this.view = new Sprite(texture);
    this.view.anchor.set(0.5, 0.5);
    this.view.scale.set(BULLET_SPRITE_METRES_PER_PX, BULLET_SPRITE_METRES_PER_PX);
    // Tint the white pixel toward the firing ship's colour so red/blue
    // bullets are distinguishable on screen. Normal blend (no additive)
    // keeps the bullet reading as a single hard pixel rather than a glow.
    this.view.tint = cfg.color;
    parent.addChild(this.view);

    this.prev = { x: cfg.x, y: cfg.y };
    this.view.x = cfg.x;
    this.view.y = cfg.y;
  }

  static spawnSpeed() {
    return SETTINGS.bulletSpeed;
  }

  static radius() {
    return BULLET_RADIUS;
  }

  snapshot() {
    const p = this.body.translation();
    return { x: p.x, y: p.y };
  }

  sync(alpha: number) {
    const p = this.body.translation();
    this.view.x = this.prev.x + (p.x - this.prev.x) * alpha;
    this.view.y = this.prev.y + (p.y - this.prev.y) * alpha;
  }

  dispose(physics: PhysicsWorld) {
    if (this.disposed) return;
    this.disposed = true;
    this.alive = false;
    physics.world.removeRigidBody(this.body);
    this.view.destroy();
  }
}
