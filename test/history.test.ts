import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collectHistory, parseHistoryLine } from '../src/history.js';

test('reads the timestamp and project folder, never the prompt', () => {
  const r = parseHistoryLine(JSON.stringify({ display: 'secret', timestamp: Date.UTC(2026, 2, 11, 1), project: '/Users/x/code/My App/' }));
  assert.equal(r?.project, 'My App');
  assert.equal(r?.at.toISOString(), '2026-03-11T01:00:00.000Z');
  assert.equal(parseHistoryLine('not json "timestamp"'), undefined);
  assert.equal(parseHistoryLine('{"display":"x"}'), undefined);
});

test('counts prompts per day and per project, skipping bad lines and missing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hist-'));
  const t = (d: number, h: number): number => Date.UTC(2026, 2, d, h);
  await writeFile(
    join(dir, 'history.jsonl'),
    [
      JSON.stringify({ timestamp: t(1, 23), project: '/a/one' }),
      JSON.stringify({ timestamp: t(2, 1), project: '/a/one' }),
      JSON.stringify({ timestamp: t(2, 2), project: '/a/two' }),
      '{broken "timestamp"',
    ].join('\n'),
  );
  const h = await collectHistory([dir, join(dir, 'nope')], 'UTC');
  assert.deepEqual([...h.days], [['2026-03-01', 1], ['2026-03-02', 2]]);
  assert.deepEqual([...h.projects].sort(), [['one', 2], ['two', 1]]);
});
