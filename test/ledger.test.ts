import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { emptyLedger, loadLedger, mergeLedger, parseLedger, saveLedger } from '../src/ledger.js';
import type { TokenCounts } from '../src/types.js';

const c = (n: number): TokenCounts => ({ input: n, output: n, cacheCreation: n, cacheRead: n, messages: n });

test('mergeLedger keeps the larger value, so deleted transcripts never shrink history', () => {
  const before = mergeLedger(emptyLedger('UTC'), new Map([['2026-01-01', c(10)], ['2026-01-02', c(5)]]), new Date(0));
  const after = mergeLedger(before, new Map([['2026-01-01', c(3)], ['2026-01-02', c(8)], ['2026-01-03', c(1)]]), new Date(1));
  assert.equal(after.days['2026-01-01']?.output, 10);
  assert.equal(after.days['2026-01-02']?.output, 8);
  assert.equal(after.days['2026-01-03']?.output, 1);
  assert.equal(after.lastScanAt, new Date(1).toISOString());
});

test('loadLedger starts empty when the file is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hitmap-'));
  const l = await loadLedger(join(dir, 'none.json'), 'Asia/Seoul');
  assert.deepEqual(l, emptyLedger('Asia/Seoul'));
});

test('saveLedger writes days in date order and loads back unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hitmap-'));
  const path = join(dir, 'nested', 'ledger.json');
  const l = mergeLedger(emptyLedger('UTC'), new Map([['2026-02-01', c(2)], ['2026-01-01', c(1)]]), new Date(0));
  await saveLedger(path, l);
  const text = await readFile(path, 'utf8');
  assert.ok(text.indexOf('2026-01-01') < text.indexOf('2026-02-01'));
  assert.deepEqual(await loadLedger(path, 'UTC'), l);
});

test('parseLedger rejects malformed input with a clear message', () => {
  assert.throws(() => parseLedger(null), /not a JSON object/);
  assert.throws(() => parseLedger({ version: 2, timeZone: 'UTC', days: {} }), /unsupported ledger version/);
  assert.throws(() => parseLedger({ version: 1, timeZone: 'UTC', days: { yesterday: {} } }), /invalid date key/);
});

test('parseLedger turns bad counts into zero', () => {
  const l = parseLedger({ version: 1, timeZone: 'UTC', days: { '2026-01-01': { output: -1, input: 'x', messages: 4 } } });
  assert.deepEqual(l.days['2026-01-01'], { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, messages: 4 });
});
