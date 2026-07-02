// GhostReplay — plays back a recorded run as a translucent "record holder"
// ship the player can chase. Self-contained: give it a parent container and
// a leaderboard slot, then feed it the run clock each frame.
//
// The replay data comes from the HighScore `replay` field (10Hz samples of
// {t, x, y, r} captured by Game.sampleReplay). Playback interpolates between
// samples, so the ghost moves smoothly even though the recording is coarse.
// Deliberately renderer-only — no physics body, no collisions; the ghost is
// a pace car, not an obstacle.

import { Container, Graphics } from "pixi.js";
import { drawLowPolyHull } from "../render/lowpoly";
import {
  getHighScores, fetchHighScoresAsync,
  type GameMode, type ReplaySample,
} from "../app/highscores";

/** Gold — the record-holder's colour, matching the gate accent. */
const GHOST_COLOR = 0xffd166;
const GHOST_ALPHA = 0.4;

export class GhostReplay {
  private replay: ReplaySample[] | null = null;
  private ship: Graphics | null = null;
  /** Monotonic index into the samples — playback never seeks backwards. */
  private cursor = 0;
  private disposed = false;

  constructor(
    private parent: Container,
    private color = GHOST_COLOR,
  ) {}

  /** Load the top score's recorded path for `levelId`/`mode` (remote board
   *  first, local cache as fallback) and spawn the ghost hull. Resolves true
   *  if a ghost is on the line — a board with no replay (e.g. a freshly
   *  reset leaderboard) simply yields no ghost and the run proceeds. */
  async load(levelId: string, mode: GameMode): Promise<boolean> {
    let board;
    try {
      board = await fetchHighScoresAsync(levelId, mode);
    } catch {
      board = getHighScores(levelId, mode);
    }
    if (this.disposed) return false;
    const best = board[0];
    if (!best?.replay || best.replay.length < 2) return false;

    this.replay = best.replay;
    const g = new Graphics();
    drawLowPolyHull(g, this.color, 0);
    g.scale.set(2 / 13); // sprite-px space → ~2 m wide, like the player hull
    g.alpha = GHOST_ALPHA;
    g.visible = false; // shown once update() places it
    this.parent.addChild(g);
    this.ship = g;
    return true;
  }

  /** Move the ghost to its recorded position at run time `t` (seconds since
   *  GO). Holds at the start line before t=0 and parks at the finish once
   *  the recording runs out. Safe to call before load resolves. */
  update(t: number): void {
    const g = this.ship;
    const rep = this.replay;
    if (!g || !rep) return;
    while (this.cursor < rep.length - 1 && rep[this.cursor + 1].t <= t) {
      this.cursor++;
    }
    const a = rep[this.cursor];
    const b = rep[Math.min(rep.length - 1, this.cursor + 1)];
    let { x, y, r } = a;
    if (b.t > a.t) {
      const f = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
      x = a.x + (b.x - a.x) * f;
      y = a.y + (b.y - a.y) * f;
      let dr = b.r - a.r;
      if (dr > Math.PI) dr -= Math.PI * 2;
      else if (dr < -Math.PI) dr += Math.PI * 2;
      r = a.r + dr * f;
    }
    g.visible = true;
    g.x = x;
    g.y = y;
    g.rotation = r + Math.PI / 2; // hull texture-space: nose up == forward
    drawLowPolyHull(g, this.color, g.rotation);
  }

  /** Stop playback and free the hull. Guards the async load() resolution so
   *  a ghost never spawns into a torn-down world. Safe to call twice. */
  dispose(): void {
    this.disposed = true;
    this.ship?.destroy();
    this.ship = null;
    this.replay = null;
  }
}
