import RAPIER from "@dimforge/rapier2d-compat";

export const PHYS_HZ = 60;
export const PHYS_DT = 1 / PHYS_HZ;

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;

  constructor(gravity: RAPIER.Vector2 = { x: 0, y: 0 }) {
    this.world = new RAPIER.World(gravity);
    this.world.timestep = PHYS_DT;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  step() {
    this.world.step(this.eventQueue);
  }
}
