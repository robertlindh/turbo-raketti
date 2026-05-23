// CrystalTool — sprinkle decorative crystals onto the level. Click to place.

import type { Graphics } from "pixi.js";
import type { Tool, ToolContext, PointerEventArgs } from "./ToolManager";

export class CrystalTool implements Tool {
  id = "crystal";
  label = "Crystal";
  hotkey = "7";

  constructor(private ctx: ToolContext) {}

  onPointerDown(e: PointerEventArgs): void {
    this.ctx.editor.mutate((lvl) => {
      if (!lvl.decorations) lvl.decorations = [];
      lvl.decorations.push({ type: "crystal", x: e.world.x, y: e.world.y });
    });
  }

  drawPreview(_g: Graphics): void { /* none */ }
}
