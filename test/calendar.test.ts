import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCalendar, levelOf, quartiles, stats, toUtc } from '../src/calendar.js';

test('the grid starts on a Sunday and ends on the given day', () => {
  const cal = buildCalendar(new Map(), '2026-11-06', 365);
  assert.equal(cal.cells.length, 365);
  assert.equal(cal.cells.at(-1)?.date, '2026-11-06');
  assert.equal(cal.cells.at(-1)?.weekday, new Date(toUtc('2026-11-06')).getUTCDay());
  const first = cal.cells[0];
  assert.ok(first);
  assert.equal(first.week, 0);
  assert.ok(cal.weeks === 53 || cal.weeks === 54);
});

test('every cell sits in a unique week/weekday slot', () => {
  const cal = buildCalendar(new Map(), '2026-11-06', 365);
  const slots = new Set(cal.cells.map((c) => `${c.week}:${c.weekday}`));
  assert.equal(slots.size, cal.cells.length);
});

test('quartiles ignore empty days', () => {
  assert.deepEqual(quartiles([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(quartiles([0, 1, 2, 3, 4, 5, 6, 7, 8]), [2, 4, 6]);
});

test('levelOf maps values into five steps', () => {
  const t = [2, 4, 6] as const;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((v) => levelOf(v, t)), [0, 1, 1, 2, 2, 3, 3, 4]);
});

test('stats counts streaks and the busiest day', () => {
  const v = new Map([
    ['2026-01-01', 5],
    ['2026-01-02', 9],
    ['2026-01-03', 1],
    ['2026-01-05', 2],
    ['2026-01-06', 2],
  ]);
  const s = stats(v, '2026-01-06', 10);
  assert.equal(s.total, 19);
  assert.equal(s.activeDays, 5);
  assert.equal(s.longestStreak, 3);
  assert.equal(s.currentStreak, 2);
  assert.deepEqual(s.best, { date: '2026-01-02', value: 9 });
});

test('the current streak still counts when today has no activity yet', () => {
  const v = new Map([
    ['2026-01-04', 1],
    ['2026-01-05', 1],
  ]);
  assert.equal(stats(v, '2026-01-06', 10).currentStreak, 2);
  assert.equal(stats(v, '2026-01-07', 10).currentStreak, 0);
});
