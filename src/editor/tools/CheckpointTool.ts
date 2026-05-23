// CheckpointTool — click to append a race checkpoint at the cursor.
// Existing checkpoints can be reordered/moved with the SelectTool.

import type { Graphics } from "pixi.js";
import type { Tool, ToolContext, PointerEventArgs } from "./ToolManager";

export class CheckpointTool implements Tool {
  id = "checkpoint";
  label = "Checkpoint";
  hotkey = "6";

  constructor(private ctx: ToolContext) {}

  onPointerDown(e: PointerEventArgs): void {
    this.ctx.editor.mutate((lvl) => {
      if (!lvl.checkpoints) lvl.checkpoints = [];
      lvl.checkpoints.push({ x: e.world.x, y: e.world.y });
    });
  }

  drawPreview(_g: Graphics): void { /* none */ }
}
