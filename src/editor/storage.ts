// Storage helpers — autosave the in-progress level to localStorage and
// expose the same key for the game to load via the test-play button.

import type { Level } from "../level/Level";

const KEY_DRAFT = "tr.editor.draft";

export function saveDraft(level: Level): void {
  try {
    localStorage.setItem(KEY_DRAFT, JSON.stringify(level));
  } catch (err) {
    console.warn("saveDraft failed:", err);
  }
}

export function loadDraft(): Level | null {
  try {
    const raw = localStorage.getItem(KEY_DRAFT);
    if (!raw) return null;
    return JSON.parse(raw) as Level;
  } catch (err) {
    console.warn("loadDraft failed:", err);
    return null;
  }
}
