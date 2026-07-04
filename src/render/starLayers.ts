// StarLayers — multi-depth parallax star field for the cave "sky".
//
// Replaces the old stage-level ParallaxStars, which sat BEHIND the opaque
// atmosphere sprite and was never actually visible in play. These layers
// live inside the level view (above the sky gradient, below the water and
// rock), so they show through the cave interior and get cropped by the rock
// like everything else.
//
// Parallax: each sublayer follows the camera by `factor` (0 = fixed in the
// world like the cave, 1 = glued to the screen). A far layer at high factor
// barely moves on screen while the cave sweeps past; a near layer at low
// factor streaks along with the world. The relative sliding between layers
// is what sells depth — and speed, which is the point.
//
// If update() is never called (the level editor preview), every layer sits
// at its generated position and renders as a plain static star field.

import { Container, Graphics } from "pixi.js";
import type { Level } from "../level/Level";
import { hexToNum, lighten, darken } from "./color";
import { mulberry32 } from "./rng";

interface LayerSpec {
  /** Camera-follow fraction. Higher = farther away = steadier on screen. */
  factor: number;
  /** One star per this many m². */
  areaPerStar: number;
  /** Star radius range (m). */
  rMin: number;
  rMax: number;
  alpha: number;
}

/** Far → near. Near stars are sparse, big and bright; far ones dim dust. */
const LAYER_SPECS: LayerSpec[] = [
  { factor: 0.78, areaPerStar: 240, rMin: 0.06, rMax: 0.12, alpha: 0.45 },
  { factor: 0.55, areaPerStar: 420, rMin: 0.10, rMax: 0.18, alpha: 0.70 },
  { factor: 0.30, areaPerStar: 780, rMin: 0.15, rMax: 0.28, alpha: 0.95 },
];

export class StarLayers extends Container {
  private layers: Array<{ view: Graphics; factor: number }> = [];

  constructor(level: Level) {
    super();
    const { bounds, theme } = level;
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    const base = hexToNum(theme.starColor);
    const rng = mulberry32(0x57a125);

    for (const spec of LAYER_SPECS) {
      // The layer shifts by up to (half the camera's travel × factor); pad
      // the field so the shift never drags an empty edge into view.
      const padX = (spanX / 2) * spec.factor + 40;
      const padY = (spanY / 2) * spec.factor + 40;
      const w = spanX + padX * 2;
      const h = spanY + padY * 2;
      const g = new Graphics();
      const count = Math.max(20, Math.round((w * h) / spec.areaPerStar));
      for (let i = 0; i < count; i++) {
        const x = bounds.minX - padX + rng() * w;
        const y = bounds.minY - padY + rng() * h;
        const r = spec.rMin + rng() * (spec.rMax - spec.rMin);
        // Brightness scatter around the theme's star colour.
        const b = rng();
        const col = b > 0.7 ? lighten(base, (b - 0.7) * 1.5) : darken(base, (0.7 - b) * 0.6);
        g.circle(x, y, r).fill({ color: col, alpha: spec.alpha });
      }
      this.addChild(g);
      this.layers.push({ view: g, factor: spec.factor });
    }
  }

  /** Reposition the layers for the current camera focus (world metres).
   *  Cheap — two assignments per layer; call it per render pass (the split-
   *  screen renderer calls it once per half with that half's camera). */
  update(camX: number, camY: number): void {
    for (const l of this.layers) {
      l.view.x = camX * l.factor;
      l.view.y = camY * l.factor;
    }
  }
}
