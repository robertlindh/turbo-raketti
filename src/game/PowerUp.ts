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

/** Pickup radius in metres — bigger now that icons are larger. */
export const PICKUP_RADIUS = 2.5;
/** World size of the on-screen icon (radius, metres). Doubled per request. */
export const ICON_RADIUS = 1.8;

export class PowerUpEntity {
  readonly type: PowerUpType;
  readonly x: number;
  readonly y: number;
  readonly view: Container;
  alive = true;
  /** Bob animation phase, seconds since spawn. */
  private t = 0;

  constructor(parent: Container, type: PowerUpType, x: number, y: number) {
    this.type = type;
    this.x = x;
    this.y = y;
    const def = POWERUP_DEFS[type];

    this.view = new Container();
    this.view.x = x;
    this.view.y = y;

    // Outer glow ring.
    const ring = new Graphics();
    ring.circle(0, 0, ICON_RADIUS).fill({ color: def.color, alpha: 0.18 });
    ring.circle(0, 0, ICON_RADIUS * 0.78).fill({ color: def.color, alpha: 0.35 });
    ring.circle(0, 0, ICON_RADIUS * 0.55).fill({ color: def.color, alpha: 1 });
    ring.circle(0, 0, ICON_RADIUS * 0.55).stroke({ color: 0xffffff, width: 0.05, alpha: 0.9 });
    this.view.addChild(ring);

    // Inner letter — done with thick strokes so it's readable at this scale.
    const letter = new Graphics();
    letter.rect(-0.2, -0.35, 0.4, 0.7).fill({ color: 0xffffff });
    // Just use a coloured rectangle stamp; the colour ring tells the player
    // what the power-up is more clearly than tiny text at this resolution.
    letter.rect(-0.4, -0.15, 0.8, 0.3).fill({ color: 0xffffff });
    this.view.addChild(letter);

    // Reuse the def.glyph for a future-proof debug aid (not rendered yet).
    void def.glyph;

    parent.addChild(this.view);
  }

  update(dt: number) {
    this.t += dt;
    // Gentle vertical bob + scale pulse.
    this.view.y = this.y + Math.sin(this.t * 3) * 0.2;
    const s = 1 + Math.sin(this.t * 4) * 0.06;
    this.view.scale.set(s, s);
  }

  dispose() {
    this.view.destroy({ children: true });
    this.alive = false;
  }
}
