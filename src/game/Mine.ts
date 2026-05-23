import { Container, Graphics } from "pixi.js";

/**
 * A mine sits still in the world (no Rapier body — pure distance check from
 * the game loop) and detonates when an enemy ship gets close.
 *
 * Visually: a small dark-red disc with two crossed bars and a blinking
 * white pip in the middle.
 */
export class MineEntity {
  readonly view: Container;
  readonly x: number;
  readonly y: number;
  readonly ownerIndex: number;
  /** Time alive — used for the blink animation and self-despawn after TTL. */
  private t = 0;
  /** Lifetime in seconds; the mine quietly disappears if no one trips it. */
  ttl = 25;
  alive = true;
  /** Detonation radius (metres). Larger than the visual icon so getting
   *  "close" is dangerous, even at high speed. */
  static readonly TRIGGER_RADIUS = 2.2;
  /** Damage radius — anything within this gets damage. */
  static readonly BLAST_RADIUS = 4.5;
  static readonly DAMAGE = 60;
  private pip: Graphics;

  constructor(parent: Container, x: number, y: number, ownerIndex: number) {
    this.x = x;
    this.y = y;
    this.ownerIndex = ownerIndex;

    this.view = new Container();
    this.view.x = x;
    this.view.y = y;

    const radius = 0.8;
    const g = new Graphics();
    g.circle(0, 0, radius * 1.3).fill({ color: 0x1a0810, alpha: 0.7 });
    g.circle(0, 0, radius).fill({ color: 0x3a1018 });
    g.circle(0, 0, radius).stroke({ color: 0xff4848, width: 0.12 });
    // Crossed bars to give it that "explosive" feel.
    g.rect(-radius * 0.7, -0.1, radius * 1.4, 0.2).fill({ color: 0x661a20 });
    g.rect(-0.1, -radius * 0.7, 0.2, radius * 1.4).fill({ color: 0x661a20 });
    this.view.addChild(g);

    this.pip = new Graphics();
    this.pip.circle(0, 0, 0.12).fill({ color: 0xffffff });
    this.view.addChild(this.pip);

    parent.addChild(this.view);
  }

  update(dt: number): void {
    this.t += dt;
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
    // Blink — slow at first, faster as TTL ticks down.
    const speed = this.ttl < 5 ? 8 : 2;
    this.pip.visible = Math.floor(this.t * speed) % 2 === 0;
  }

  dispose() {
    this.view.destroy({ children: true });
    this.alive = false;
  }
}
