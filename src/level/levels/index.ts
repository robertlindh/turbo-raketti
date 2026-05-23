import type { Level } from "../Level";
import { metarola } from "./metarola";
import { ekolos } from "./ekolos";
import { tropulus } from "./tropulus";
import { lavanos } from "./lavanos";

export interface LevelEntry {
  id: string;
  level: Level;
}

export const LEVELS: LevelEntry[] = [
  { id: "metarola", level: metarola },
  { id: "ekolos", level: ekolos },
  { id: "tropulus", level: tropulus },
  { id: "lavanos", level: lavanos },
];

export function getLevelById(id: string): Level {
  return LEVELS.find((e) => e.id === id)?.level ?? LEVELS[0].level;
}
