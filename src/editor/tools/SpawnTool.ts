// SpawnTool — click to move the currently-selected spawn (P1 or P2). If no
// spawn is selected, the first click selects the nearest one. Cycle with Tab.

import type { Graphics } from "pixi.js";
import type { Tool, ToolContext, PointerEventArgs } from "./ToolManager";

export class SpawnTool implements Tool {
  id = "spawn";
  label = "Spawns";
  hotkey = "5";

  /** Which spawn the next click will move (0 = P1, 1 = P2). */
  private active: 0 | 1 = 0;

  constructor(private ctx: ToolContext) {}

  onActivate(): void {
    // Mark the current spawn in selection so the overlay highlights it.
    this.ctx.editor.selection = { kind: "spawn", index: this.active };
    this.ctx.editor.updateStatus();
  }

  onPointerDown(e: PointerEventArgs): void {
    const ed = this.ctx.editor;
    ed.mutate((lvl) => {
      lvl.spawns[this.active] = {
        ...lvl.spawns[this.active],
        x: e.world.x,
        y: e.world.y,
      };
    });
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Tab") {
      this.active = this.active === 0 ? 1 : 0;
      this.ctx.editor.selection = { kind: "spawn", index: this.active };
      this.ctx.editor.updateStatus();
      e.preventDefault();
    } else if (e.key === "[" || e.key === "]") {
      this.ctx.editor.mutate((lvl) => {
        const sp = lvl.spawns[this.active];
        const a = (sp.angle ?? -Math.PI / 2) + (e.key === "]" ? 1 : -1) * (Math.PI / 12);
        lvl.spawns[this.active] = { ...sp, angle: a };
      });
    }
  }

  drawPreview(_g: Graphics): void { /* overlay handles spawn visuals */ }
}
