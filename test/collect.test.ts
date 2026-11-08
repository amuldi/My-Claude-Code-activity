import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { collect, dayKey, defaultClaudeDirs, parseLine } from '../src/collect.js';

const FIXTURE = fileURLToPath(new URL('../../test/fixtures/claude', import.meta.url));

test('parseLine reads an assistant response with usage', () => {
  const r = parseLine(
    '{"type":"assistant","timestamp":"2026-03-02T10:00:00Z","requestId":"r","message":{"id":"m","usage":{"input_tokens":3,"output_tokens":4}}}',
  );
  assert.ok(r);
  assert.equal(r.key, 'm:r');
  assert.deepEqual(r.counts, { input: 3, output: 4, cacheCreation: 0, cacheRead: 0 });
});

test('parseLine ignores user lines, bad JSON, missing usage and bad timestamps', () => {
  assert.equal(parseLine('{"type":"user","usage":{}}'), null);
  assert.equal(parseLine('{"usage": not json'), null);
  assert.equal(parseLine('{"type":"assistant","timestamp":"2026-03-02T10:00:00Z","message":{"id":"m"}}'), null);
  assert.equal(parseLine('{"type":"assistant","timestamp":"nope","message":{"usage":{"input_tokens":1}}}'), null);
});

test('parseLine treats negative or non-numeric counts as zero', () => {
  const r = parseLine(
    '{"type":"assistant","timestamp":"2026-03-02T10:00:00Z","message":{"id":"m","usage":{"input_tokens":-5,"output_tokens":"9"}}}',
  );
  assert.ok(r);
  assert.deepEqual(r.counts, { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });
});

test('dayKey uses the given time zone', () => {
  const t = new Date('2026-03-02T23:30:00Z');
  assert.equal(dayKey(t, 'UTC'), '2026-03-02');
  assert.equal(dayKey(t, 'Asia/Seoul'), '2026-03-03');
});

test('collect counts a repeated response once, keeping its largest values', async () => {
  const { days, files } = await collect({ dirs: [FIXTURE], timeZone: 'UTC' });
  assert.equal(files, 1);
  assert.deepEqual(days.get('2026-03-02'), { input: 11, output: 8, cacheCreation: 100, cacheRead: 1000, messages: 2 });
  assert.deepEqual(days.get('2026-03-04'), { input: 2, output: 3, cacheCreation: 0, cacheRead: 10, messages: 1 });
  assert.equal(days.size, 2);
});

test('collect splits days by the time zone', async () => {
  const { days } = await collect({ dirs: [FIXTURE], timeZone: 'Asia/Seoul' });
  assert.equal(days.get('2026-03-02')?.messages, 1);
  assert.equal(days.get('2026-03-03')?.messages, 1);
  assert.equal(days.get('2026-03-04')?.messages, 1);
});

test('collect skips transcripts not modified since the cutoff', async () => {
  const { files } = await collect({ dirs: [FIXTURE], timeZone: 'UTC', since: new Date(Date.now() + 86_400_000) });
  assert.equal(files, 0);
});

test('collect returns nothing for a folder without transcripts', async () => {
  const { days, files } = await collect({ dirs: ['/nonexistent/claude'], timeZone: 'UTC' });
  assert.equal(files, 0);
  assert.equal(days.size, 0);
});

test('defaultClaudeDirs honours CLAUDE_CONFIG_DIR', () => {
  assert.deepEqual(defaultClaudeDirs({ CLAUDE_CONFIG_DIR: '/a, /b' }, '/home/x'), ['/a', '/b']);
  assert.deepEqual(defaultClaudeDirs({}, '/home/x'), ['/home/x/.claude', '/home/x/.config/claude']);
});
