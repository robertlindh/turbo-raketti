import RAPIER from "@dimforge/rapier2d-compat";

export const PHYS_HZ = 60;
export const PHYS_DT = 1 / PHYS_HZ;

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;
  private freed = false;

  constructor(gravity: RAPIER.Vector2 = { x: 0, y: 0 }) {
    this.world = new RAPIER.World(gravity);
    this.world.timestep = PHYS_DT;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  step() {
    this.world.step(this.eventQueue);
  }

  /** Release the underlying wasm-backed world + event queue. Must be
   *  called when the owning Game is being torn down, otherwise every
   *  collider/body the level created stays in wasm memory for the rest
   *  of the page session — a major leak that compounds each time the
   *  player returns to the menu and starts a new match. */
  free() {
    if (this.freed) return;
    this.freed = true;
    try { this.eventQueue.free(); } catch { /* already freed */ }
    try { this.world.free(); } catch { /* already freed */ }
  }
}
