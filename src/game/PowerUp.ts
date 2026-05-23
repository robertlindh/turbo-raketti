import { Container, Graphics } from "pixi.js";

export type PowerUpType =
  | "shield"
  | "triple"
  | "rapid"
  | "speed"
  | "cloak"
  | "antigrav"
  | "mine"
  | "homing";

export interface PowerUpDef {
  type: PowerUpType;
  /** Effect duration (seconds) for timer-based pickups; for ammo-based
   *  ones (Mine) this is unused. */
  durationSec: number;
  /** Display colour for the icon + active indicator. */
  color: number;
  /** One-character glyph drawn in the centre. */
  glyph: string;
  /** Friendly label for HUD tooltips. */
  label: string;
  /** True = single-use ammunition triggered via the "special" key.
   *  False = passive timer that ticks down. */
  ammo: boolean;
}

export const POWERUP_DEFS: Record<PowerUpType, PowerUpDef> = {
  shield:   { type: "shield",   durationSec: 5, color: 0x6cd0ff, glyph: "S", label: "Shield",   ammo: false },
  triple:   { type: "triple",   durationSec: 8, color: 0xff8030, glyph: "T", label: "Triple",   ammo: false },
  rapid:    { type: "rapid",    durationSec: 8, color: 0xffd040, glyph: "R", label: "Rapid",    ammo: false },
  speed:    { type: "speed",    durationSec: 5, color: 0x6cff80, glyph: "V", label: "Speed",    ammo: false },
  cloak:    { type: "cloak",    durationSec: 4, color: 0xa078ff, glyph: "C", label: "Cloak",    ammo: false },
  antigrav: { type: "antigrav", durationSec: 5, color: 0xff6cd0, glyph: "G", label: "AntiGrav", ammo: false },
  mine:     { type: "mine",     durationSec: 0, color: 0xff4848, glyph: "M", label: "Mine",     ammo: true  },
  homing:   { type: "homing",   durationSec: 0, color: 0xff8030, glyph: "H", label: "Homing",   ammo: true  },
};

export const ALL_TYPES: PowerUpType[] = [
  "shield", "triple", "rapid", "speed", "cloak", "antigrav", "mine", "homing",
];

/** Pickup radius in metres — scales with the icon size so the hitbox tracks
 *  the visible disc. */
export const PICKUP_RADIUS = 3.5;
/** World size of the on-screen icon (radius, metres). Doubled compared to
 *  the previous iteration: from 1.8 → 3.6 so the disc reads from across
 *  the cave. */
export const ICON_RADIUS = 3.6;

export class PowerUpEntity {
  readonly type: PowerUpType;
  readonly x: number;
  readonly y: number;
  readonly view: Container;
  alive = true;
  /** Bob animation phase, seconds since spawn. */
  private t = 0;
  /** Layers we animate individually so the pulse reads stronger than a
   *  simple uniform scale. The outer glow breathes large + transparent;
   *  the disc and icon do a subtle counter-pulse. */
  private outerGlow: Graphics;
  private innerGroup: Container;

  constructor(parent: Container, type: PowerUpType, x: number, y: number) {
    this.type = type;
    this.x = x;
    this.y = y;
    const def = POWERUP_DEFS[type];

    this.view = new Container();
    this.view.x = x;
    this.view.y = y;

    // 1. Outer glow ring — large, very translucent. Pulses scale + alpha.
    this.outerGlow = new Graphics();
    this.outerGlow.circle(0, 0, ICON_RADIUS * 1.10).fill({ color: def.color, alpha: 0.18 });
    this.outerGlow.circle(0, 0, ICON_RADIUS * 0.95).fill({ color: def.color, alpha: 0.30 });
    this.view.addChild(this.outerGlow);

    // 2. Inner group — holds the solid disc + the icon. Pulses subtly so
    //    the symbol stays legible even as the glow breathes.
    this.innerGroup = new Container();
    this.view.addChild(this.innerGroup);

    // 2a. Solid coloured disc with a bright rim — this is the actual "thing".
    const disc = new Graphics();
    disc.circle(0, 0, ICON_RADIUS * 0.78).fill({ color: def.color, alpha: 1 });
    disc.circle(0, 0, ICON_RADIUS * 0.78).stroke({ color: 0xffffff, width: 0.18, alpha: 0.95 });
    // A slightly darker inner stroke gives the disc a small bevel.
    disc.circle(0, 0, ICON_RADIUS * 0.72).stroke({ color: 0x000000, width: 0.12, alpha: 0.25 });
    this.innerGroup.addChild(disc);

    // 2b. The icon — distinct symbol per power-up type so the player can
    //     tell them apart at a glance, no reading required.
    const icon = new Graphics();
    drawPowerUpIcon(icon, type, ICON_RADIUS * 0.55);
    this.innerGroup.addChild(icon);

    parent.addChild(this.view);
  }

  update(dt: number) {
    this.t += dt;
    // Gentle vertical bob.
    this.view.y = this.y + Math.sin(this.t * 2.6) * 0.35;

    // Outer glow — strong breath: scale 1.0 → 1.35, alpha 0.35 → 1.0.
    const p = (Math.sin(this.t * 3.4) + 1) * 0.5; // 0..1
    const glowScale = 1 + p * 0.35;
    this.outerGlow.scale.set(glowScale, glowScale);
    this.outerGlow.alpha = 0.35 + p * 0.65;

    // Inner group — small counter-pulse so the icon doesn't feel locked.
    const innerPulse = 1 + Math.sin(this.t * 3.4 + Math.PI) * 0.06;
    this.innerGroup.scale.set(innerPulse, innerPulse);
  }

  dispose() {
    this.view.destroy({ children: true });
    this.alive = false;
  }
}

/**
 * Draw a distinct white symbol for each power-up type into `g`. The icon is
 * sized so the bounding box fits inside a square of side ≈ 2 * s centred on
 * (0, 0). Caller can rely on the symbol staying inside `disc`'s radius.
 */
function drawPowerUpIcon(g: Graphics, type: PowerUpType, s: number): void {
  const W = 0xffffff;
  switch (type) {
    case "shield": {
      // Shield silhouette — flat top, pointed bottom, with an inner crest.
      g.moveTo(-s * 0.85, -s * 0.7)
        .lineTo(s * 0.85, -s * 0.7)
        .lineTo(s * 0.85, s * 0.05)
        .lineTo(0, s * 0.9)
        .lineTo(-s * 0.85, s * 0.05)
        .closePath()
        .fill({ color: W });
      // Bevel ring inside.
      g.moveTo(-s * 0.55, -s * 0.45)
        .lineTo(s * 0.55, -s * 0.45)
        .lineTo(s * 0.55, -s * 0.1)
        .lineTo(0, s * 0.45)
        .lineTo(-s * 0.55, -s * 0.1)
        .closePath()
        .stroke({ color: 0x000000, width: s * 0.14, alpha: 0.35 });
      return;
    }
    case "triple": {
      // Three bullets in a row.
      g.circle(-s * 0.6, 0, s * 0.28).fill({ color: W });
      g.circle(0, 0, s * 0.28).fill({ color: W });
      g.circle(s * 0.6, 0, s * 0.28).fill({ color: W });
      return;
    }
    case "rapid": {
      // Lightning bolt — angular zig-zag.
      g.moveTo(s * 0.15, -s * 0.95)
        .lineTo(-s * 0.55, s * 0.05)
        .lineTo(-s * 0.05, s * 0.05)
        .lineTo(-s * 0.45, s * 0.95)
        .lineTo(s * 0.55, -s * 0.15)
        .lineTo(s * 0.05, -s * 0.15)
        .closePath()
        .fill({ color: W });
      return;
    }
    case "speed": {
      // Double chevron pointing right — universal "fast forward" cue.
      const chev = (offset: number) => {
        g.moveTo(offset - s * 0.5, -s * 0.7)
          .lineTo(offset + s * 0.1, 0)
          .lineTo(offset - s * 0.5, s * 0.7)
          .lineTo(offset - s * 0.2, s * 0.7)
          .lineTo(offset + s * 0.4, 0)
          .lineTo(offset - s * 0.2, -s * 0.7)
          .closePath()
          .fill({ color: W });
      };
      chev(-s * 0.3);
      chev(s * 0.25);
      return;
    }
    case "cloak": {
      // Eye / lens — outer ellipse with a centred pupil.
      g.ellipse(0, 0, s * 0.95, s * 0.55).stroke({ color: W, width: s * 0.16 });
      g.circle(0, 0, s * 0.28).fill({ color: W });
      return;
    }
    case "antigrav": {
      // Up-arrow inside a circle — "lift".
      g.circle(0, 0, s * 0.85).stroke({ color: W, width: s * 0.14 });
      g.moveTo(0, -s * 0.55)
        .lineTo(s * 0.4, -s * 0.1)
        .lineTo(s * 0.18, -s * 0.1)
        .lineTo(s * 0.18, s * 0.45)
        .lineTo(-s * 0.18, s * 0.45)
        .lineTo(-s * 0.18, -s * 0.1)
        .lineTo(-s * 0.4, -s * 0.1)
        .closePath()
        .fill({ color: W });
      return;
    }
    case "mine": {
      // 4-pointed spiked star.
      g.rect(-s * 0.1, -s * 0.95, s * 0.2, s * 1.9).fill({ color: W });
      g.rect(-s * 0.95, -s * 0.1, s * 1.9, s * 0.2).fill({ color: W });
      // Diagonal spikes — thinner, rotated rectangles.
      const diag = (rot: number) => {
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const len = s * 0.7;
        const wid = s * 0.12;
        // Manual rectangle by 4 transformed corners.
        const pts = [
          [-wid, -len], [wid, -len], [wid, len], [-wid, len],
        ].map(([px, py]) => [px * cos - py * sin, px * sin + py * cos]);
        g.moveTo(pts[0][0], pts[0][1])
          .lineTo(pts[1][0], pts[1][1])
          .lineTo(pts[2][0], pts[2][1])
          .lineTo(pts[3][0], pts[3][1])
          .closePath()
          .fill({ color: W });
      };
      diag(Math.PI / 4);
      diag(-Math.PI / 4);
      g.circle(0, 0, s * 0.32).fill({ color: 0x000000 });
      g.circle(0, 0, s * 0.18).fill({ color: W });
      return;
    }
    case "homing": {
      // Tiny rocket silhouette pointing up — nose, body, fins, flame.
      // Nose triangle.
      g.moveTo(0, -s * 0.9)
        .lineTo(s * 0.35, -s * 0.35)
        .lineTo(-s * 0.35, -s * 0.35)
        .closePath()
        .fill({ color: W });
      // Body.
      g.rect(-s * 0.3, -s * 0.35, s * 0.6, s * 0.75).fill({ color: W });
      // Fins.
      g.moveTo(-s * 0.3, s * 0.2)
        .lineTo(-s * 0.7, s * 0.5)
        .lineTo(-s * 0.3, s * 0.5)
        .closePath()
        .fill({ color: W });
      g.moveTo(s * 0.3, s * 0.2)
        .lineTo(s * 0.7, s * 0.5)
        .lineTo(s * 0.3, s * 0.5)
        .closePath()
        .fill({ color: W });
      // Flame — kept white-on-disc so it reads from far away.
      g.moveTo(-s * 0.2, s * 0.5)
        .lineTo(0, s * 0.95)
        .lineTo(s * 0.2, s * 0.5)
        .closePath()
        .fill({ color: 0x000000, alpha: 0.45 });
      return;
    }
  }
}
