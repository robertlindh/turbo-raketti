import RAPIER from "@dimforge/rapier2d-compat";
import { Container, Graphics, Renderer, Sprite } from "pixi.js";
import type { PhysicsWorld } from "./PhysicsWorld";
import { PHYS_DT } from "./PhysicsWorld";
import type { ShipInput } from "./Input";
import { makeShipTexture } from "../render/sprites";
import { SETTINGS } from "./Settings";

export const SHIP_RADIUS = 1.0; // metres (collider radius)
const SHIP_SPRITE_PX = { w: 13, h: 14 };
const SHIP_SPRITE_METRES_PER_PX = 2.0 / 13; // 13px → 2.0m wide (matches collider diameter)

export interface ShipConfig {
  x: number;
  y: number;
  color: number;
  angle?: number;
}

export class Ship {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Wrapper container that the camera transform reaches — holds hull + flame. */
  readonly view: Container;
  private hull: Sprite;
  private flame: Graphics;
  private shieldRing: Graphics;
  private shieldActive = false;
  private shieldPhase = 0;
  /** True while thrust was applied in the most recent applyInput(). */
  thrustOn = false;

  constructor(
    physics: PhysicsWorld,
    renderer: Renderer,
    parent: Container,
    cfg: ShipConfig,
  ) {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(cfg.x, cfg.y)
      .setRotation(cfg.angle ?? -Math.PI / 2)
      .setLinearDamping(SETTINGS.shipLinearDamping)
      .setAngularDamping(SETTINGS.shipAngularDamping)
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = physics.world.createRigidBody(bodyDesc);

    const colDesc = RAPIER.ColliderDesc.ball(SHIP_RADIUS)
      .setDensity(1)
      .setFriction(0.3)
      .setRestitution(SETTINGS.shipRestitution);
    this.collider = physics.world.createCollider(colDesc, this.body);

    // Wrapper container — its scale converts sprite-pixels into metres so
    // both the hull sprite and the flame graphics share the same scaling.
    this.view = new Container();
    this.view.label = "ship";
    this.view.scale.set(SHIP_SPRITE_METRES_PER_PX, SHIP_SPRITE_METRES_PER_PX);

    // Shield aura (drawn first, behind everything). Activated externally via
    // setShieldActive(); pulses in sync().
    this.shieldRing = new Graphics();
    this.shieldRing.visible = false;
    // Two concentric circles — outer soft glow, inner crisp edge.
    const r = 11;  // sprite-pixel radius (matches roughly 2× hull width)
    this.shieldRing.circle(0, 0, r * 1.15).fill({ color: 0x6cd0ff, alpha: 0.15 });
    this.shieldRing.circle(0, 0, r).stroke({ color: 0x6cd0ff, width: 0.7, alpha: 0.9 });
    this.shieldRing.circle(0, 0, r * 0.95).stroke({ color: 0xffffff, width: 0.3, alpha: 0.6 });
    this.view.addChild(this.shieldRing);

    // Flame: drawn UNDER the hull so the hull sits on top of the base of
    // the flame. Painted in local sprite-pixel coordinates centred on (0, 0)
    // — sprite anchor is (0.5, 0.5) so the hull is centred at origin and
    // its rear is at local y ≈ +6.
    this.flame = new Graphics();
    this.flame.visible = false;
    this.view.addChild(this.flame);

    // Hull sprite.
    const texture = makeShipTexture(renderer, cfg.color);
    this.hull = new Sprite(texture);
    this.hull.anchor.set(0.5, 0.5);
    this.view.addChild(this.hull);

    this.drawFlame();
    parent.addChild(this.view);
  }

  /** Paint the static flame shape into `this.flame`. Sized in sprite-pixel
   *  units so it matches the hull's pixel resolution after the parent's
   *  metres-per-pixel scale is applied. */
  private drawFlame() {
    const g = this.flame;
    g.clear();
    // 7×8 pixel flame, centred horizontally on x=0, top edge at y=+6
    // (just below the hull's rear). W = white-hot, Y = yellow, O = orange.
    const GRID: readonly string[] = [
      "..WWW..",
      ".WWWWW.",
      "WYYYYYW",
      "WYYYYYW",
      ".YYYYY.",
      ".YOOOY.",
      "..OOO..",
      "...O...",
    ];
    const palette: Record<string, number> = {
      W: 0xffffff,
      Y: 0xffd24a,
      O: 0xff6a14,
    };
    const offsetY = 6;
    const halfW = 3; // grid is 7 wide, half-extent 3
    for (let y = 0; y < GRID.length; y++) {
      const row = GRID[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === ".") continue;
        const color = palette[ch];
        g.rect(x - halfW, y + offsetY, 1, 1).fill({ color });
      }
    }
  }

  applyInput(input: ShipInput) {
    if (input.rotateLeft || input.rotateRight) {
      const angVel =
        (input.rotateRight ? SETTINGS.shipRotate : 0) -
        (input.rotateLeft ? SETTINGS.shipRotate : 0);
      this.body.setAngvel(angVel, true);
    }

    this.thrustOn = input.thrust;
    if (input.thrust) {
      const angle = this.body.rotation();
      const fx = Math.cos(angle) * SETTINGS.shipThrust * PHYS_DT;
      const fy = Math.sin(angle) * SETTINGS.shipThrust * PHYS_DT;
      const mass = this.body.mass();
      this.body.applyImpulse({ x: fx * mass, y: fy * mass }, true);
    }

    const v = this.body.linvel();
    const sp = Math.hypot(v.x, v.y);
    if (sp > SETTINGS.shipMaxSpeed) {
      const k = SETTINGS.shipMaxSpeed / sp;
      this.body.setLinvel({ x: v.x * k, y: v.y * k }, true);
    }
  }

  sync(alpha: number, prev: { x: number; y: number; r: number }) {
    const p = this.body.translation();
    const r = this.body.rotation();
    this.view.x = prev.x + (p.x - prev.x) * alpha;
    this.view.y = prev.y + (p.y - prev.y) * alpha;
    let dr = r - prev.r;
    if (dr > Math.PI) dr -= Math.PI * 2;
    else if (dr < -Math.PI) dr += Math.PI * 2;
    // Texture's nose points UP (-Y); add π/2 so body.rotation=0 (facing +X)
    // points the sprite +X visually.
    this.view.rotation = prev.r + dr * alpha + Math.PI / 2;

    // Flame on/off + per-frame flicker.
    this.flame.visible = this.thrustOn;
    if (this.thrustOn) {
      const flickerScale = 0.82 + Math.random() * 0.36;
      const flickerSquash = 0.92 + Math.random() * 0.16;
      this.flame.scale.set(flickerSquash, flickerScale);
    }

    // Shield aura — pulse alpha + scale when active. The aura counter-
    // rotates so the energy circle stays world-aligned even though the
    // wrapper container rotates with the ship.
    this.shieldRing.visible = this.shieldActive;
    if (this.shieldActive) {
      this.shieldPhase += 0.18;
      const a = 0.65 + Math.sin(this.shieldPhase) * 0.25;
      const s = 1 + Math.sin(this.shieldPhase * 1.3) * 0.06;
      this.shieldRing.alpha = a;
      this.shieldRing.scale.set(s, s);
      // Counter-rotate so the bubble doesn't spin with the ship.
      this.shieldRing.rotation = -this.view.rotation;
    }
  }

  /** Called from Game when the shield power-up is active for this player. */
  setShieldActive(on: boolean) {
    this.shieldActive = on;
  }

  /** World-space position of the rear of the ship (engine nozzle). */
  tailPosition(out: { x: number; y: number }): { x: number; y: number } {
    const p = this.body.translation();
    const a = this.body.rotation();
    const tailOffset = SHIP_RADIUS + 0.05;
    out.x = p.x - Math.cos(a) * tailOffset;
    out.y = p.y - Math.sin(a) * tailOffset;
    return out;
  }

  snapshot() {
    const p = this.body.translation();
    return { x: p.x, y: p.y, r: this.body.rotation() };
  }

  dispose(physics: PhysicsWorld) {
    physics.world.removeRigidBody(this.body);
    this.view.destroy({ children: true });
  }
}

export { SHIP_SPRITE_PX };
