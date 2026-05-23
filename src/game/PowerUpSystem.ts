import { Container } from "pixi.js";
import type { Level, Point } from "../level/Level";
import {
  ALL_TYPES, PICKUP_RADIUS, PowerUpEntity, POWERUP_DEFS,
  type PowerUpType,
} from "./PowerUp";
import { SETTINGS } from "./Settings";

/**
 * Spawns power-ups at random positions inside the cave polygon (and outside
 * obstacles). Caps the number of simultaneous pickups, picks a fresh random
 * position when one is consumed.
 */
export class PowerUpSystem {
  private active: PowerUpEntity[] = [];
  private spawnTimer = 0;
  /** Polygon-cached for point-in-polygon tests during random spawn. */
  private boundary: Point[];
  private obstacles: Point[][];
  /** Which power-up types the spawner is allowed to roll. Caller can pass
   *  e.g. `["speed"]` in time-trial to restrict pickups to speed boosts. */
  private allowedTypes: PowerUpType[];

  constructor(
    private parent: Container,
    private level: Level,
    allowedTypes?: PowerUpType[],
  ) {
    this.boundary = level.boundary;
    this.obstacles = level.obstacles;
    this.allowedTypes = allowedTypes && allowedTypes.length > 0
      ? allowedTypes
      : ALL_TYPES;
    // Stagger initial spawn so the first power-up appears quickly.
    this.spawnTimer = 1.5;
  }

  update(dt: number) {
    // Prune any flagged-dead entries.
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (!this.active[i].alive) {
        this.active.splice(i, 1);
      } else {
        this.active[i].update(dt);
      }
    }

    if (!SETTINGS.powerupsEnabled) return;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.active.length < SETTINGS.powerupsMax) {
      const spot = this.findSpawnPoint();
      if (spot) {
        const type = this.allowedTypes[Math.floor(Math.random() * this.allowedTypes.length)];
        this.active.push(new PowerUpEntity(this.parent, type, spot.x, spot.y));
      }
      this.spawnTimer = SETTINGS.powerupSpawnSec * (0.7 + Math.random() * 0.6);
    }
  }

  /** Check if a ship at (x, y) is touching any power-up; consume + return it. */
  pickupAt(x: number, y: number): PowerUpType | null {
    for (const p of this.active) {
      if (!p.alive) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < PICKUP_RADIUS * PICKUP_RADIUS) {
        const t = p.type;
        p.dispose();
        return t;
      }
    }
    return null;
  }

  /** Clear every active pickup — used when reloading a level. */
  clear() {
    for (const p of this.active) p.dispose();
    this.active = [];
  }

  // ──────────────────────────────────────────────────────────────────────
  // Random spawn-point search — rejection-sample inside boundary, outside
  // every obstacle and with a margin away from the polygon edges.
  // ──────────────────────────────────────────────────────────────────────

  private findSpawnPoint(): Point | null {
    const b = this.level.bounds;
    const margin = 3; // metres inside the bounds to stay clear of walls
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = b.minX + margin + Math.random() * (b.maxX - b.minX - margin * 2);
      const y = b.minY + margin + Math.random() * (b.maxY - b.minY - margin * 2);
      if (!pointInPolygon({ x, y }, this.boundary)) continue;
      let blocked = false;
      for (const obs of this.obstacles) {
        if (pointInPolygon({ x, y }, obs)) { blocked = true; break; }
      }
      if (blocked) continue;
      // Try to keep away from any other active power-up so they don't overlap.
      let tooClose = false;
      for (const p of this.active) {
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy < 9) { tooClose = true; break; }
      }
      if (tooClose) continue;
      return { x, y };
    }
    return null;
  }
}

/** Standard ray-casting point-in-polygon test. */
function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Glyph + colour exported so HUD can render matching badges. */
export { POWERUP_DEFS };
