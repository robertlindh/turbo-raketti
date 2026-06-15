import RAPIER from "@dimforge/rapier2d-compat";
import { Container, Graphics, Renderer } from "pixi.js";
import type { PhysicsWorld } from "./PhysicsWorld";
import { PHYS_DT } from "./PhysicsWorld";
import type { ShipInput } from "./Input";
import { drawLowPolyHull } from "../render/lowpoly";
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
  private hull: Graphics;
  /** Base hull tint, kept so the facets can be re-lit each frame. */
  private hullColor: number;
  /** Last rotation the hull was painted at — skips redraw when not turning. */
  private lastHullAngle = NaN;
  private flame: Graphics;
  private shieldRing: Graphics;
  private shieldActive = false;
  private shieldPhase = 0;
  /** Generic powerup aura — a brightly-coloured ring drawn behind the
   *  ship so the player can see at a glance that some passive (Triple,
   *  Rapid, Speed, AntiGrav, …) is currently active. Distinct from the
   *  dedicated shield bubble; coexists with it. */
  private powerUpAura: Graphics;
  private powerUpActive = false;
  private powerUpColor = 0xffffff;
  private powerUpPhase = 0;
  /** Eases from 1 → 0 over ~16 frames after pickup, briefly boosting
   *  the aura's alpha + scale so the moment is unmistakable. */
  private powerUpFlash = 0;
  /** True while thrust was applied in the most recent applyInput(). */
  thrustOn = false;
  /** Multipliers on the global thrust + max-speed settings, allowing
   *  per-mode tuning. Game.ts sets these after construction; default 1.0
   *  leaves the ship feeling identical to before. */
  thrustMultiplier = 1.0;
  maxSpeedMultiplier = 1.0;

  constructor(
    physics: PhysicsWorld,
    _renderer: Renderer,
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

    // Generic powerup aura (drawn BEHIND the shield ring + flame + hull).
    // Painted blank here and redrawn each time setPowerUpAura() switches
    // colour. Counter-rotates in sync() so the disc stays world-aligned.
    this.powerUpAura = new Graphics();
    this.powerUpAura.visible = false;
    this.view.addChild(this.powerUpAura);

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

    // Hull — low-poly flat-shaded vector facets, drawn in the 13×14 sprite-px
    // space so the flame / shield / aura offsets above still line up. Re-lit
    // each frame in sync() so the lit side tracks a fixed world light.
    this.hullColor = cfg.color;
    this.hull = new Graphics();
    drawLowPolyHull(this.hull, cfg.color, 0);
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
      const thrust = SETTINGS.shipThrust * this.thrustMultiplier;
      const fx = Math.cos(angle) * thrust * PHYS_DT;
      const fy = Math.sin(angle) * thrust * PHYS_DT;
      const mass = this.body.mass();
      this.body.applyImpulse({ x: fx * mass, y: fy * mass }, true);
    }

    const v = this.body.linvel();
    const sp = Math.hypot(v.x, v.y);
    const maxSpeed = SETTINGS.shipMaxSpeed * this.maxSpeedMultiplier;
    if (sp > maxSpeed) {
      const k = maxSpeed / sp;
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

    // Re-light the hull facets against the fixed world light whenever the
    // ship has turned enough to matter. The hull geometry rotates with the
    // view container; passing the view's world rotation lets the lit side
    // sweep across the facets instead of spinning rigidly with them.
    if (!(Math.abs(this.view.rotation - this.lastHullAngle) < 0.01)) {
      drawLowPolyHull(this.hull, this.hullColor, this.view.rotation);
      this.lastHullAngle = this.view.rotation;
    }

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

    // Generic powerup aura — pulse + brief flash on pickup so the
    // player notices the moment their ship lights up.
    this.powerUpAura.visible = this.powerUpActive;
    if (this.powerUpActive) {
      this.powerUpPhase += 0.22;
      // Decay any active pickup flash toward 0 each frame.
      if (this.powerUpFlash > 0) this.powerUpFlash = Math.max(0, this.powerUpFlash - 0.06);
      const breath = 0.55 + Math.sin(this.powerUpPhase) * 0.30;
      const scale = 1 + Math.sin(this.powerUpPhase * 1.1) * 0.08;
      // Flash boosts both alpha and scale right after pickup.
      const flashBoost = this.powerUpFlash;
      this.powerUpAura.alpha = Math.min(1, breath + flashBoost * 0.6);
      this.powerUpAura.scale.set(scale + flashBoost * 0.5, scale + flashBoost * 0.5);
      this.powerUpAura.rotation = -this.view.rotation;
    }
  }

  /** Called from Game when the shield power-up is active for this player. */
  setShieldActive(on: boolean) {
    this.shieldActive = on;
  }

  /** Called from Game each tick with the colour of the most-recently
   *  picked-up passive powerup (Triple/Rapid/Speed/AntiGrav). Off when
   *  no such passive is active. Repainted on every colour change so the
   *  aura always matches the currently dominant effect. */
  setPowerUpAura(on: boolean, color: number) {
    if (on && (!this.powerUpActive || color !== this.powerUpColor)) {
      // Re-draw the ring in the new colour. Three layers — outer soft
      // halo, mid ring, inner crisp edge — so it reads from across the
      // cave but doesn't drown the hull.
      const r = 13;
      const g = this.powerUpAura;
      g.clear();
      g.circle(0, 0, r * 1.35).fill({ color, alpha: 0.10 });
      g.circle(0, 0, r * 1.15).fill({ color, alpha: 0.18 });
      g.circle(0, 0, r).stroke({ color, width: 0.9, alpha: 0.95 });
      g.circle(0, 0, r * 0.85).stroke({ color: 0xffffff, width: 0.3, alpha: 0.5 });
      this.powerUpColor = color;
      // Pop the flash whenever the aura turns on or the colour swaps.
      this.powerUpFlash = 1;
    }
    this.powerUpActive = on;
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
    const v = this.body.linvel();
    return { x: p.x, y: p.y, r: this.body.rotation(), vx: v.x, vy: v.y };
  }

  dispose(physics: PhysicsWorld) {
    physics.world.removeRigidBody(this.body);
    this.view.destroy({ children: true });
  }
}

export { SHIP_SPRITE_PX };
