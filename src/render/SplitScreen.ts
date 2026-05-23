import {
  Container, Graphics, RenderTexture, Renderer, Sprite,
} from "pixi.js";

/**
 * Splitscreen renderer — renders the same world twice into two off-screen
 * RenderTextures, one per player, and displays them as side-by-side sprites
 * on the stage with a divider line between them.
 *
 * The main game decides each frame whether to use split mode or single mode
 * based on player distance.
 */
export class SplitScreen {
  /** Off-screen render targets — recreated on resize. */
  leftRT!: RenderTexture;
  rightRT!: RenderTexture;
  /** Display sprites that show the RTs on the actual screen. */
  readonly leftView: Sprite;
  readonly rightView: Sprite;
  readonly divider: Graphics;
  /** Container that holds the split-mode UI (views + divider). */
  readonly root: Container;

  private resolution: number;
  private dividerWidth = 4;

  constructor(resolution: number, viewportW: number, viewportH: number) {
    this.resolution = resolution;
    this.leftRT = this.makeRT(viewportW, viewportH);
    this.rightRT = this.makeRT(viewportW, viewportH);

    this.leftView = new Sprite(this.leftRT);
    this.rightView = new Sprite(this.rightRT);
    this.divider = new Graphics();

    this.root = new Container();
    this.root.addChild(this.leftView, this.rightView, this.divider);
    this.layoutViews(viewportW, viewportH);

    // Default to hidden — game shows us only when split mode triggers.
    this.root.visible = false;
  }

  private makeRT(viewportW: number, viewportH: number): RenderTexture {
    // Each half is (W - divider) / 2 wide, full height.
    const halfW = Math.max(2, Math.floor((viewportW - this.dividerWidth) / 2));
    return RenderTexture.create({
      width: halfW,
      height: viewportH,
      resolution: this.resolution,
    });
  }

  /** Recreate textures + reposition after a viewport resize. */
  resize(viewportW: number, viewportH: number): void {
    this.leftRT.destroy(true);
    this.rightRT.destroy(true);
    this.leftRT = this.makeRT(viewportW, viewportH);
    this.rightRT = this.makeRT(viewportW, viewportH);
    this.leftView.texture = this.leftRT;
    this.rightView.texture = this.rightRT;
    this.layoutViews(viewportW, viewportH);
  }

  /** Pixel size of each half in CSS pixels (sprite display size). */
  halfSize(): { w: number; h: number } {
    return {
      w: this.leftRT.width / this.resolution,
      h: this.leftRT.height / this.resolution,
    };
  }

  setActive(on: boolean): void {
    this.root.visible = on;
  }

  isActive(): boolean {
    return this.root.visible;
  }

  private layoutViews(viewportW: number, viewportH: number): void {
    const halfW = (viewportW - this.dividerWidth) / 2;
    this.leftView.position.set(0, 0);
    this.leftView.width = halfW;
    this.leftView.height = viewportH;
    this.rightView.position.set(halfW + this.dividerWidth, 0);
    this.rightView.width = halfW;
    this.rightView.height = viewportH;

    this.divider.clear();
    this.divider
      .rect(halfW, 0, this.dividerWidth, viewportH)
      .fill({ color: 0x1a1a22 });
    this.divider
      .rect(halfW + 1, 0, this.dividerWidth - 2, viewportH)
      .fill({ color: 0x4a4a58, alpha: 0.6 });
  }

  /**
   * Render `worldRoot` twice — once per RT — with the camera focused on
   * each player. The camera state is set up by the caller via `setCamera`
   * between the two renders.
   */
  render(
    renderer: Renderer,
    worldRoot: Container,
    setLeftCamera: () => void,
    setRightCamera: () => void,
  ): void {
    setLeftCamera();
    renderer.render({ container: worldRoot, target: this.leftRT, clear: true });
    setRightCamera();
    renderer.render({ container: worldRoot, target: this.rightRT, clear: true });
  }
}
