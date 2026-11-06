import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { run } from '../src/run.js';

const FIXTURE = fileURLToPath(new URL('../../test/fixtures/claude', import.meta.url));

function io(now = '2026-03-10T12:00:00Z') {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s), now: () => new Date(now) }, out, err };
}

test('writes an SVG and a ledger from the transcripts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hitmap-'));
  const t = io();
  const code = await run(['--claude-dir', FIXTURE, '--out', dir, '--tz', 'UTC', '--days', '30'], t.io);
  assert.equal(code, 0, t.err.join(''));
  const ledger = JSON.parse(await readFile(join(dir, 'claude-hitmap.json'), 'utf8'));
  assert.equal(ledger.days['2026-03-02'].messages, 2);
  const svg = await readFile(join(dir, 'claude-hitmap.svg'), 'utf8');
  assert.match(svg, /1\.1K tokens in the last 30 days/);
});

test('a second run keeps days the transcripts no longer have', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hitmap-'));
  const old = {
    version: 1,
    timeZone: 'UTC',
    lastScanAt: null,
    days: { '2026-02-20': { input: 0, output: 500, cacheCreation: 0, cacheRead: 0, messages: 1 } },
  };
  await writeFile(join(dir, 'claude-hitmap.json'), JSON.stringify(old));
  const t = io();
  assert.equal(await run(['--claude-dir', FIXTURE, '--out', dir, '--tz', 'UTC'], t.io), 0, t.err.join(''));
  const ledger = JSON.parse(await readFile(join(dir, 'claude-hitmap.json'), 'utf8'));
  assert.equal(ledger.days['2026-02-20'].output, 500);
  assert.equal(ledger.days['2026-03-04'].output, 3);
});

test('refuses a ledger built in another time zone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hitmap-'));
  await writeFile(join(dir, 'claude-hitmap.json'), JSON.stringify({ version: 1, timeZone: 'Asia/Seoul', lastScanAt: null, days: {} }));
  const t = io();
  assert.equal(await run(['--claude-dir', FIXTURE, '--out', dir, '--tz', 'UTC'], t.io), 2);
  assert.match(t.err.join(''), /built in Asia\/Seoul/);
});

test('rejects bad options with exit code 2', async () => {
  for (const args of [['--metric', 'cost'], ['--days', '3'], ['--tz', 'Mars/Base'], ['--svg', '../x.svg'], ['--nope']]) {
    const t = io();
    assert.equal(await run(args, t.io), 2, args.join(' '));
    assert.ok(t.err.join('').length > 0);
  }
});

test('prints help and version', async () => {
  const t = io();
  assert.equal(await run(['--help'], t.io), 0);
  assert.match(t.out.join(''), /Usage/);
  const v = io();
  assert.equal(await run(['-v'], v.io), 0);
  assert.match(v.out.join(''), /^\d+\.\d+\.\d+/);
});
