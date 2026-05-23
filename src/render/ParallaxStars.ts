import { Container, Graphics } from "pixi.js";

/**
 * A separate star layer that sits on top of the world but translates more
 * slowly than the camera to fake depth. Stars are drawn once in screen-pixel
 * space and the layer's position is recomputed each frame from the current
 * camera. No transforms inherited from the world layer.
 */
export class ParallaxStars extends Container {
  /** How much of the camera motion to apply. 0 = stationary, 1 = follow exactly. */
  parallaxFactor = 0.25;

  constructor(viewportW: number, viewportH: number) {
    super();
    this.rebuildStars(viewportW, viewportH);
  }

  /** Rebuild the star field after a viewport resize. */
  rebuildStars(viewportW: number, viewportH: number): void {
    this.removeChildren().forEach((c) => c.destroy());
    // Tile a generous area so the parallax shift never reveals an empty edge.
    const tileW = viewportW * 2;
    const tileH = viewportH * 2;
    const g = new Graphics();
    const rng = mulberry32(0xa11ce);
    const count = Math.round((tileW * tileH) / 4000);
    for (let i = 0; i < count; i++) {
      const x = -tileW / 2 + rng() * tileW;
      const y = -tileH / 2 + rng() * tileH;
      const b = rng();
      const v = Math.round(120 + b * 135);
      g.rect(x, y, 1, 1).fill({ color: rgbToHex(v, v, Math.min(255, v + 20)) });
      if (b > 0.88) {
        // A subtle cross sparkle for the brightest stars.
        const dim = Math.round(v * 0.45);
        const col = rgbToHex(dim, dim, dim);
        g.rect(x - 1, y, 1, 1).fill({ color: col });
        g.rect(x + 1, y, 1, 1).fill({ color: col });
        g.rect(x, y - 1, 1, 1).fill({ color: col });
        g.rect(x, y + 1, 1, 1).fill({ color: col });
      }
    }
    this.addChild(g);
  }

  /** Reposition based on the camera's world position and screen size. */
  update(cameraX: number, cameraY: number, zoom: number, screenW: number, screenH: number): void {
    // Translate slower than the world container by `parallaxFactor`.
    // Stars live in screen-pixel space, so we shift them by the negative
    // camera offset (×factor) — the world shifts at full speed under them.
    const shift = (1 - this.parallaxFactor) * zoom;
    this.x = screenW / 2 - cameraX * shift;
    this.y = screenH / 2 - cameraY * shift;
  }
}

function rgbToHex(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
