// Highscores — localStorage-backed leaderboards per level + mode.
//
// Two leaderboards exist for each level:
//   - "time-trial": lowest time wins. `value` is seconds.
//   - "duel":       highest score wins. `value` is winning frag count;
//                   `loser` records the opponent's frag count.
//
// Top 10 entries per board. A new score only qualifies if either fewer
// than 10 entries exist or it beats the worst current entry.

export type GameMode = "time-trial" | "duel" | "race" | "wave";

export interface HighScore {
  /** 3-letter initials. */
  initials: string;
  /** Time in seconds (time-trial) or winning frag count (duel). */
  value: number;
  /** Duel only — the opponent's final frag count. */
  loser?: number;
  /** ISO date string at the moment the score was recorded. */
  date: string;
}

const STORAGE_KEY = "tr.highscores.v1";
const MAX_ENTRIES = 10;

type Table = Record<string /* levelId */, Record<GameMode, HighScore[]>>;

function load(): Table {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Table;
  } catch {
    return {};
  }
}

function save(table: Table): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch (err) {
    console.warn("Highscores save failed:", err);
  }
}

function getBoard(levelId: string, mode: GameMode): HighScore[] {
  return load()[levelId]?.[mode] ?? [];
}

/** Sort so the best entries are first. */
function compare(mode: GameMode): (a: HighScore, b: HighScore) => number {
  // Race-style modes use time; duel uses frag count.
  const isTimeBased = mode === "time-trial" || mode === "race";
  return isTimeBased
    ? (a, b) => a.value - b.value          // lower time = better
    : (a, b) => b.value - a.value;          // higher frags = better
}

export function getHighScores(levelId: string, mode: GameMode): HighScore[] {
  return getBoard(levelId, mode).slice().sort(compare(mode));
}

/** Does this value beat the current worst-on-board, or is the board not full? */
export function qualifies(levelId: string, mode: GameMode, value: number): boolean {
  const board = getBoard(levelId, mode);
  if (board.length < MAX_ENTRIES) return true;
  const sorted = board.slice().sort(compare(mode));
  const worst = sorted[sorted.length - 1];
  const isTimeBased = mode === "time-trial" || mode === "race";
  return isTimeBased ? value < worst.value : value > worst.value;
}

/** Insert a new score, trim to top 10, return the resulting board.
 *  Returns the inserted score's 1-based rank, or 0 if it didn't qualify. */
export function addScore(
  levelId: string,
  mode: GameMode,
  entry: Omit<HighScore, "date"> & { date?: string },
): { rank: number; board: HighScore[] } {
  if (!qualifies(levelId, mode, entry.value)) {
    return { rank: 0, board: getHighScores(levelId, mode) };
  }
  const table = load();
  table[levelId] = table[levelId] ?? { "time-trial": [], duel: [], race: [], wave: [] };
  const board = table[levelId][mode] ?? [];
  const fullEntry: HighScore = {
    initials: entry.initials.toUpperCase().slice(0, 3).padEnd(3, " ").trim() || "AAA",
    value: entry.value,
    loser: entry.loser,
    date: entry.date ?? new Date().toISOString(),
  };
  board.push(fullEntry);
  board.sort(compare(mode));
  while (board.length > MAX_ENTRIES) board.pop();
  table[levelId][mode] = board;
  save(table);
  const rank = board.indexOf(fullEntry) + 1;
  return { rank, board };
}

/** Format a time-trial value as MM:SS.cs (centiseconds for tight finishes). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}
