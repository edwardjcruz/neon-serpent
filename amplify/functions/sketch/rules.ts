// Neon Sketch rules, kept free of AWS code so they can be tested on their own.
import { WORDS } from './words';

export const MAX_PLAYERS = 10;
export const CHOOSE_MS = 15_000; // the drawer's time to pick a word before one is picked for them
export const REVEAL_MS = 5_000; // how long "the word was …" stays up between turns
export const ROUNDS = [2, 3, 4], DRAW_SECONDS = [60, 80, 100];
export const DRAWER_POINTS_PER_GUESS = 50, DRAWER_POINTS_MAX = 300;

export const cleanName = (value: unknown) => String(value ?? '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
export const normalize = (text: unknown) => String(text ?? '').toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, ' ').trim();

export function pickWords(count = 3, random = Math.random) {
  const pool = [...WORDS];
  for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, count);
}

// Blanks for letters, spaces and hyphens shown as they are: "ice cream" → "___ _____".
export const maskOf = (word: string) => word.replace(/[a-z0-9]/g, '_');

// Reveals one more hidden letter of `word` in `mask`.
export function revealLetter(word: string, mask: string, random = Math.random) {
  const hidden = [...mask].map((char, index) => (char === '_' ? index : -1)).filter((index) => index >= 0);
  if (hidden.length <= 1) return mask;
  const index = hidden[Math.floor(random() * hidden.length)];
  return mask.slice(0, index) + word[index] + mask.slice(index + 1);
}
// Letter hints at half and three-quarters of the drawing time (none for short words).
export function hintsDue(word: string, elapsed: number, total: number) {
  const letters = word.replace(/[^a-z0-9]/g, '').length;
  if (letters <= 3) return 0;
  return (elapsed >= total * .5 ? 1 : 0) + (elapsed >= total * .75 && letters > 5 ? 1 : 0);
}

// Faster guesses score more: 300 at the start down to 50 at the buzzer.
export const guessPoints = (remaining: number, total: number) => Math.round(50 + 250 * Math.max(0, Math.min(1, remaining / total)));
export const drawerPoints = (guessers: number) => Math.min(DRAWER_POINTS_MAX, guessers * DRAWER_POINTS_PER_GUESS);

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) { const saved = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = saved; }
  }
  return row[b.length];
}
// 'correct', 'close' (one letter off, told only to the guesser), 'hidden' (contains the word, so it isn't shown to
// anyone), or 'wrong' (shown in chat like any message).
export function judge(guess: string, word: string): 'correct' | 'close' | 'hidden' | 'wrong' {
  const text = normalize(guess), target = normalize(word), squash = (value: string) => value.replace(/[ -]/g, '');
  if (!text) return 'wrong';
  if (text === target || squash(text) === squash(target)) return 'correct';
  if (squash(text).includes(squash(target))) return 'hidden';
  if (target.length >= 4 && distance(squash(text), squash(target)) === 1) return 'close';
  return 'wrong';
}
