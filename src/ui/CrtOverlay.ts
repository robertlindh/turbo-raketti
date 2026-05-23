/**
 * CSS-based CRT overlay — scanlines + subtle vignette + slight chromatic
 * tint. Toggleable from settings. Lightweight (no shader, no Pixi filter).
 */
export class CrtOverlay {
  private el: HTMLDivElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "crt-overlay";
    this.el.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 50;
      display: none;
      background:
        repeating-linear-gradient(
          0deg,
          rgba(0, 0, 0, 0.22) 0px,
          rgba(0, 0, 0, 0.22) 1px,
          transparent 1px,
          transparent 3px
        ),
        radial-gradient(
          ellipse at center,
          rgba(0, 0, 0, 0) 50%,
          rgba(0, 0, 0, 0.55) 100%
        );
      mix-blend-mode: multiply;
    `;
    document.body.appendChild(this.el);
  }

  setEnabled(on: boolean): void {
    this.el.style.display = on ? "block" : "none";
  }
}
