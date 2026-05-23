import RAPIER from "@dimforge/rapier2d-compat";
import { Container, Renderer, Sprite } from "pixi.js";
import type { PhysicsWorld } from "./PhysicsWorld";
import { makeBulletTexture } from "../render/sprites";
import { SETTINGS } from "./Settings";

// Bullets are intentionally pin-prick small — the sprite is a single white
// pixel, and the trail particles do all the streaking work. Physics radius
// is a tiny ball so hits register precisely without the bullet visibly
// "splashing" wider than its mark.
const BULLET_RADIUS = 0.06;
// Display size of the 1×1 sprite, expressed in metres-per-texel. At the
// game's typical close-in zoom (~22 px/m) this lands a single bullet head
// at roughly one screen pixel.
const BULLET_SPRITE_METRES_PER_PX = 0.05;

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
    // Additive blend so the bullet reads as a hot point light against the
    // dark cave, matching the trail particles drawn behind it.
    this.view.blendMode = "add";
    // Orient sprite forward (texture head points -Y; rotate to align with velocity).
    this.view.rotation = Math.atan2(cfg.vy, cfg.vx) + Math.PI / 2;
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
