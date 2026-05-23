// OverlayRenderer — paints all editor-only visualisations on top of the
// backdrop: polygon vertex handles, winding arrows, spawns, checkpoints,
// crystals, water-zone outlines, and the in-progress drawing preview.

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Editor, EditorSelection } from "./Editor";
import type { Point } from "../level/Level";

export class OverlayRenderer {
  private root = new Container();
  private g = new Graphics();
  private labels = new Container();
  private labelStyleSmall = new TextStyle({
    fontFamily: "ui-monospace, monospace",
    fontSize: 3,
    fill: 0xffffff,
  });

  constructor(private editor: Editor) {
    editor.overlayLayer.addChild(this.root);
    this.root.addChild(this.g);
    this.root.addChild(this.labels);
  }

  draw(): void {
    this.g.clear();
    this.labels.removeChildren().forEach((c) => c.destroy());

    const lvl = this.editor.level;
    const sel = this.editor.selection;

    // Boundary polygon — bright cyan outline + numbered handles.
    this.drawPolyOutline(lvl.boundary, 0x6cdcff, 0.55, true);
    this.drawHandles(lvl.boundary, 0x6cdcff, sel.kind === "boundary-vertex" ? sel.index : -1);
    this.drawWindingArrow(lvl.boundary, 0x6cdcff, "CCW");

    // Obstacles — warm orange.
    lvl.obstacles.forEach((poly, oi) => {
      this.drawPolyOutline(poly, 0xff9a3c, 0.55, true);
      this.drawHandles(
        poly, 0xff9a3c,
        sel.kind === "obstacle-vertex" && sel.obstacle === oi ? sel.index : -1,
      );
      this.drawWindingArrow(poly, 0xff9a3c, "CW");
    });

    // Water zones — translucent teal.
    (lvl.waterZones ?? []).forEach((poly, zi) => {
      this.drawPolyOutline(poly, 0x58c8ff, 0.4, true);
      this.drawHandles(
        poly, 0x58c8ff,
        sel.kind === "water-vertex" && sel.zone === zi ? sel.index : -1,
      );
    });

    // Spawns.
    for (let i = 0; i < 2; i++) {
      const sp = lvl.spawns[i];
      const color = i === 0 ? 0x64b5ff : 0xff6b6b;
      this.drawSpawn(sp.x, sp.y, sp.angle ?? -Math.PI / 2, color,
        sel.kind === "spawn" && sel.index === i, `P${i + 1}`);
    }

    // Checkpoints — numbered yellow rings.
    (lvl.checkpoints ?? []).forEach((cp, i) => {
      const highlighted = sel.kind === "checkpoint" && sel.index === i;
      this.drawCheckpoint(cp.x, cp.y, i + 1, highlighted);
    });

    // Decorations — small magenta dots.
    (lvl.decorations ?? []).forEach((d, i) => {
      const highlighted = sel.kind === "decoration" && sel.index === i;
      this.g.circle(d.x, d.y, highlighted ? 1.2 : 0.8)
        .fill({ color: 0xff7adf, alpha: 0.9 })
        .stroke({ color: 0xffffff, alpha: highlighted ? 1 : 0.4, width: 0.15 });
    });

    // Active-tool preview hook — tool draws into the same Graphics.
    const tool = this.editor.tools.activeTool;
    if (tool?.drawPreview) tool.drawPreview(this.g);

    this.drawSelectionHint(sel);
  }

  private drawPolyOutline(
    poly: Point[], color: number, alpha: number, closed: boolean,
  ): void {
    if (poly.length < 2) return;
    this.g.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) {
      this.g.lineTo(poly[i].x, poly[i].y);
    }
    if (closed && poly.length >= 3) this.g.lineTo(poly[0].x, poly[0].y);
    this.g.stroke({ color, alpha, width: 0.25 });
  }

  private drawHandles(
    poly: Point[], color: number, highlightIndex: number,
  ): void {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const hi = i === highlightIndex;
      const r = hi ? 0.9 : 0.55;
      this.g.circle(p.x, p.y, r)
        .fill({ color: hi ? 0xffffff : 0x0a0a0a, alpha: 0.95 })
        .stroke({ color, alpha: 1, width: 0.18 });
    }
  }

  private drawWindingArrow(
    poly: Point[], color: number, label: string,
  ): void {
    if (poly.length < 3) return;
    // Draw a small arrowhead at the midpoint of edge 0→1.
    const a = poly[0];
    const b = poly[1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const tip = { x: mx + ux * 1.2, y: my + uy * 1.2 };
    const back = { x: mx - ux * 0.6, y: my - uy * 0.6 };
    const left = { x: back.x + px * 0.6, y: back.y + py * 0.6 };
    const right = { x: back.x - px * 0.6, y: back.y - py * 0.6 };
    this.g.moveTo(tip.x, tip.y)
      .lineTo(left.x, left.y)
      .lineTo(right.x, right.y)
      .lineTo(tip.x, tip.y)
      .fill({ color, alpha: 0.65 });

    const t = new Text({ text: label, style: this.labelStyleSmall });
    t.x = mx + px * 1.5 - 1;
    t.y = my + py * 1.5 - 1.5;
    this.labels.addChild(t);
  }

  private drawSpawn(
    x: number, y: number, angle: number,
    color: number, highlighted: boolean, label: string,
  ): void {
    const r = highlighted ? 2.2 : 1.6;
    this.g.circle(x, y, r)
      .fill({ color, alpha: 0.25 })
      .stroke({ color, alpha: 1, width: 0.2 });
    // Triangle pointing in the facing direction.
    const tip = { x: x + Math.cos(angle) * r * 0.9, y: y + Math.sin(angle) * r * 0.9 };
    const lp = {
      x: x + Math.cos(angle + Math.PI * 0.85) * r * 0.7,
      y: y + Math.sin(angle + Math.PI * 0.85) * r * 0.7,
    };
    const rp = {
      x: x + Math.cos(angle - Math.PI * 0.85) * r * 0.7,
      y: y + Math.sin(angle - Math.PI * 0.85) * r * 0.7,
    };
    this.g.moveTo(tip.x, tip.y).lineTo(lp.x, lp.y).lineTo(rp.x, rp.y).lineTo(tip.x, tip.y)
      .fill({ color, alpha: 0.95 });
    const t = new Text({ text: label, style: this.labelStyleSmall });
    t.x = x - 1.2;
    t.y = y - r - 2.5;
    this.labels.addChild(t);
  }

  private drawCheckpoint(
    x: number, y: number, num: number, highlighted: boolean,
  ): void {
    const color = 0xffd84d;
    const r = highlighted ? 2.4 : 1.8;
    this.g.circle(x, y, r)
      .stroke({ color, alpha: 1, width: 0.3 });
    this.g.circle(x, y, r * 0.5)
      .fill({ color: 0x000000, alpha: 0.4 });
    const t = new Text({
      text: String(num),
      style: new TextStyle({
        fontFamily: "ui-monospace, monospace",
        fontSize: 3,
        fill: 0xffd84d,
        fontWeight: "bold",
      }),
    });
    t.x = x - 0.8;
    t.y = y - 1.6;
    this.labels.addChild(t);
  }

  private drawSelectionHint(_sel: EditorSelection): void {
    // Hook for future visual selection emphasis (e.g. ring around dragged
    // vertex). The handle itself already brightens, so noop for now.
  }
}
