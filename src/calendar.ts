import type { DayKey } from './types.js';

export type Level = 0 | 1 | 2 | 3 | 4;

export interface Cell {
  date: DayKey;
  value: number;
  level: Level;
  /** Column, 0 = the oldest week. */
  week: number;
  /** Row, 0 = Sunday. */
  weekday: number;
}

export interface Calendar {
  cells: Cell[];
  weeks: number;
  /** Where each month starts, for the labels above the grid. */
  months: { week: number; month: number; year: number }[];
  thresholds: readonly [number, number, number];
}

export interface Stats {
  total: number;
  activeDays: number;
  longestStreak: number;
  /** Consecutive active days ending today, or yesterday if today has no activity yet. */
  currentStreak: number;
  best: { date: DayKey; value: number } | null;
}

const MS_DAY = 86_400_000;

export function toUtc(day: DayKey): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function fromUtc(ms: number): DayKey {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Split levels at the quartiles of the non-zero values, the way GitHub's
 * contribution graph does, so a heavy month does not wash out a quiet one.
 */
export function quartiles(values: readonly number[]): readonly [number, number, number] {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (nz.length === 0) return [0, 0, 0];
  const at = (p: number): number => nz[Math.min(nz.length - 1, Math.floor(p * (nz.length - 1)))] ?? 0;
  return [at(0.25), at(0.5), at(0.75)];
}

export function levelOf(v: number, t: readonly [number, number, number]): Level {
  if (v <= 0) return 0;
  if (v <= t[0]) return 1;
  if (v <= t[1]) return 2;
  if (v <= t[2]) return 3;
  return 4;
}

/**
 * Lay out the `days` days ending at `end` as a week-per-column grid that starts
 * on a Sunday, as GitHub does.
 */
export function buildCalendar(values: ReadonlyMap<DayKey, number>, end: DayKey, days = 365): Calendar {
  const endMs = toUtc(end);
  const firstMs = endMs - (days - 1) * MS_DAY;
  const startMs = firstMs - new Date(firstMs).getUTCDay() * MS_DAY;
  const inRange: number[] = [];
  for (let t = firstMs; t <= endMs; t += MS_DAY) inRange.push(values.get(fromUtc(t)) ?? 0);
  const thresholds = quartiles(inRange);

  const cells: Cell[] = [];
  const months: Calendar['months'] = [];
  let lastMonth = -1;
  for (let t = firstMs; t <= endMs; t += MS_DAY) {
    const date = fromUtc(t);
    const d = new Date(t);
    const week = Math.floor((t - startMs) / (7 * MS_DAY));
    const value = values.get(date) ?? 0;
    cells.push({ date, value, level: levelOf(value, thresholds), week, weekday: d.getUTCDay() });
    if (d.getUTCMonth() !== lastMonth) {
      lastMonth = d.getUTCMonth();
      // Label the month at the first full week it owns.
      const labelWeek = d.getUTCDay() === 0 ? week : week + 1;
      months.push({ week: labelWeek, month: lastMonth, year: d.getUTCFullYear() });
    }
  }
  const weeks = Math.floor((endMs - startMs) / (7 * MS_DAY)) + 1;
  return { cells, weeks, months: months.filter((m) => m.week < weeks), thresholds };
}

export function stats(values: ReadonlyMap<DayKey, number>, end: DayKey, days = 365): Stats {
  const endMs = toUtc(end);
  const firstMs = endMs - (days - 1) * MS_DAY;
  let total = 0;
  let activeDays = 0;
  let longest = 0;
  let run = 0;
  let best: Stats['best'] = null;
  for (let t = firstMs; t <= endMs; t += MS_DAY) {
    const date = fromUtc(t);
    const v = values.get(date) ?? 0;
    total += v;
    if (v > 0) {
      activeDays++;
      run++;
      longest = Math.max(longest, run);
      if (!best || v > best.value) best = { date, value: v };
    } else {
      run = 0;
    }
  }
  let current = 0;
  let t = endMs;
  if ((values.get(fromUtc(t)) ?? 0) <= 0) t -= MS_DAY; // today may not have started yet
  for (; t >= firstMs && (values.get(fromUtc(t)) ?? 0) > 0; t -= MS_DAY) current++;
  return { total, activeDays, longestStreak: longest, currentStreak: current, best };
}
