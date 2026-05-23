import RAPIER from "@dimforge/rapier2d-compat";
import { Container, Graphics } from "pixi.js";
import type { PhysicsWorld } from "./PhysicsWorld";

export interface CaveBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Cave physics + interior decoration. The atmospheric backdrop, stars, and
 * outer wall art come from Background.ts. We still need invisible outer
 * colliders here, plus stylised interior platforms that the backdrop can't
 * know about.
 */
export class Cave {
  readonly bounds: CaveBounds;
  readonly view: Container;

  constructor(physics: PhysicsWorld, parent: Container, bounds: CaveBounds) {
    this.bounds = bounds;
    this.view = new Container();
    this.view.label = "cave";
    parent.addChild(this.view);

    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;

    // Outer walls — collision only (Background.ts draws them).
    const wallThickness = 1;
    const addCollider = (x: number, y: number, hx: number, hy: number) => {
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, y),
      );
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy).setFriction(0.4).setRestitution(0.2),
        body,
      );
    };
    addCollider(cx, bounds.minY - wallThickness, w / 2 + wallThickness, wallThickness);
    addCollider(cx, bounds.maxY + wallThickness, w / 2 + wallThickness, wallThickness);
    addCollider(bounds.minX - wallThickness, cy, wallThickness, h / 2 + wallThickness);
    addCollider(bounds.maxX + wallThickness, cy, wallThickness, h / 2 + wallThickness);

    // Interior platforms — collider + Style-3 stylised rendering.
    const platforms: Array<[number, number, number, number]> = [
      [cx - w * 0.25, cy + h * 0.15, 6, 0.6],
      [cx + w * 0.2, cy - h * 0.1, 4, 0.6],
      [cx, cy + h * 0.3, 3, 0.6],
      [cx + w * 0.3, cy + h * 0.25, 2, 0.6],
      [cx - w * 0.3, cy - h * 0.25, 2.5, 0.6],
    ];
    for (const [px, py, hx, hy] of platforms) {
      addCollider(px, py, hx, hy);
      this.view.addChild(this.makePlatform(px, py, hx, hy));
    }
  }

  /** Style-3 rock platform: three tones plus a top rim-light. */
  private makePlatform(x: number, y: number, hx: number, hy: number): Graphics {
    const g = new Graphics();
    // Dark base (slightly larger to give an ambient-occlusion drop).
    g.rect(-hx, -hy + 0.04, hx * 2, hy * 2).fill({ color: 0x1a0e26 });
    // Main body.
    g.rect(-hx, -hy, hx * 2, hy * 2 - 0.08).fill({ color: 0x3a2848 });
    // Mid-tone band.
    g.rect(-hx + 0.08, -hy + 0.18, hx * 2 - 0.16, hy * 2 - 0.32).fill({
      color: 0x5e4670,
    });
    // Rim light along the top.
    g.rect(-hx, -hy, hx * 2, 0.1).fill({ color: 0x9e88be });
    g.rect(-hx, -hy + 0.1, hx * 2, 0.04).fill({ color: 0xdec4ff });
    g.x = x;
    g.y = y;
    return g;
  }
}
