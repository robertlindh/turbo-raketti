// Theme presets sourced from the existing levels — handy to start from a
// known-good palette and tweak from there.

import type { LevelTheme } from "../level/Level";
import { metarola } from "../level/levels/metarola";
import { ekolos } from "../level/levels/ekolos";
import { tropulus } from "../level/levels/tropulus";

export const THEME_PRESETS: Record<string, LevelTheme> = {
  Metarola: metarola.theme,
  Ekolos: ekolos.theme,
  Tropulus: tropulus.theme,
};
