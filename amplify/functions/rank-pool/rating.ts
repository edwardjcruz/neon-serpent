// Neon Cue global ranking rules, kept free of AWS code so they can be tested on their own.
//
// - Online racks move an Elo rating: beating a stronger player earns more than beating a weaker one.
// - Racks against the computer can't be checked by the server (they run in the player's browser), so they only
//   nudge a small bonus, capped so online play decides who's on top.
// - The ranking sorts on rating + bonus.

export const START = 1200;
export const K = 32;
export const PAIR_DAILY_LIMIT = 5; // ranked racks per pair of players per day, so two browsers can't farm each other
export const CPU_DAILY_LIMIT = 10; // ranked CPU racks per player per day
export const CPU_MIN_GAP_MS = 60_000; // a real rack takes longer than a minute
export const CPU_POINTS: Record<string, number> = { medium: 2, hard: 4 }; // Easy doesn't count
export const BONUS_MAX = 100, BONUS_MIN = -50;
export const MIN_GAMES = 3; // ranked racks before a player shows on the board

// Points the winner takes from the loser.
export function eloDelta(winnerRating: number, loserRating: number) {
  const expected = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
  return Math.max(1, Math.round(K * (1 - expected)));
}

export function cpuBonus(bonus: number, level: string, won: boolean) {
  const points = CPU_POINTS[level];
  if (!points) return bonus;
  return Math.max(BONUS_MIN, Math.min(BONUS_MAX, bonus + (won ? points : -Math.ceil(points / 2))));
}

export const day = (now = Date.now()) => Math.floor(now / 86_400_000);
export const cleanName = (value: unknown) => String(value ?? '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
