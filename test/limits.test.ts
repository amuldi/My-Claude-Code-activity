import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseLedger } from '../src/ledger.js';
import { mergeLedger, emptyLedger } from '../src/ledger.js';
import { accountFiles, parseLimitHit, planLabel, readPlan, scanLimits } from '../src/limits.js';
import { renderLimits } from '../src/render.js';
import { run } from '../src/run.js';

const notice = (text: string, uuid: string, ts: string): string =>
  JSON.stringify({ type: 'assistant', uuid, timestamp: ts, message: { content: [{ type: 'text', text }] } });

test('recognises session and weekly limit notices only', () => {
  const w = parseLimitHit(notice("You've hit your weekly limit · resets 1pm (Asia/Seoul)", 'a', '2026-11-01T01:00:00Z'));
  assert.equal(w?.kind, 'weekly');
  assert.equal(parseLimitHit(notice("You've hit your 5-hour limit · resets 12:50am", 'b', '2026-11-01T01:00:00Z'))?.kind, 'session');
  assert.equal(parseLimitHit(notice("You've hit your session limit", 'c', '2026-11-01T01:00:00Z'))?.kind, 'session');
  assert.equal(parseLimitHit(notice('we hit your server', 'd', '2026-11-01T01:00:00Z')), null);
  assert.equal(parseLimitHit('not json hit your'), null);
});

test('counts notices per day, once per message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lim-'));
  const f = join(dir, 's.jsonl');
  await writeFile(
    f,
    [
      notice("You've hit your 5-hour limit", 'u1', '2026-11-01T01:00:00Z'),
      notice("You've hit your 5-hour limit", 'u1', '2026-11-01T01:00:00Z'),
      notice("You've hit your weekly limit", 'u2', '2026-11-01T02:00:00Z'),
      notice("You've hit your 5-hour limit", 'u3', '2026-11-02T02:00:00Z'),
    ].join('\n'),
  );
  const m = await scanLimits([f], 'UTC');
  assert.deepEqual([...m], [['2026-11-01', { session: 1, weekly: 1 }], ['2026-11-02', { session: 1, weekly: 0 }]]);
});

test('maps account fields to a plan label', () => {
  assert.equal(planLabel('claude_pro', null), 'Pro');
  assert.equal(planLabel('claude_max', 'default_claude_max_5x'), 'Max 5x');
  assert.equal(planLabel('claude_max', 'default_claude_max_20x'), 'Max 20x');
  assert.equal(planLabel('claude_team', undefined), 'Team');
  assert.equal(planLabel('mystery', undefined), undefined);
});

test('reads only the plan from the account file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acct-'));
  const f = join(dir, '.claude.json');
  await writeFile(f, JSON.stringify({ oauthAccount: { organizationType: 'claude_pro', emailAddress: 'x@y.z' } }));
  assert.equal(await readPlan([join(dir, 'missing.json'), f]), 'Pro');
  assert.deepEqual(accountFiles(['/d'], '/h', {}), ['/h/.claude.json', '/d/.claude.json']);
  assert.deepEqual(accountFiles(['/d'], '/h', { CLAUDE_CONFIG_DIR: '/d' }), ['/d/.claude.json']);
});

test('the ledger keeps limits and plan, and merging keeps the larger count', () => {
  let l = mergeLedger(emptyLedger('UTC'), new Map(), new Date(0), {
    limits: new Map([['2026-11-01', { session: 2, weekly: 0 }]]),
    plan: 'Pro',
  });
  l = mergeLedger(l, new Map(), new Date(1), { limits: new Map([['2026-11-01', { session: 1, weekly: 1 }]]) });
  assert.deepEqual(l.limits?.['2026-11-01'], { session: 2, weekly: 1 });
  assert.equal(l.plan, 'Pro');
  assert.deepEqual(parseLedger(JSON.parse(JSON.stringify(l))).limits, l.limits);
  assert.equal(parseLedger({ version: 1, timeZone: 'UTC', days: {} }).limits, undefined);
});

test('draws plan, totals and a bar per month', () => {
  const svg = renderLimits(
    new Map([
      ['2026-10-03', { session: 2, weekly: 0 }],
      ['2026-10-04', { session: 1, weekly: 1 }],
      ['2026-11-01', { session: 0, weekly: 1 }],
    ]),
    { end: '2026-11-07', year: 2026, plan: 'Pro', mascot: false },
  );
  assert.match(svg, />Pro</);
  assert.match(svg, /3<tspan/); // session
  assert.match(svg, /2<tspan/); // weekly
  assert.match(svg, /Last time at a limit: 2026-11-01/);
  assert.equal((svg.match(/<rect class="l\d" x="[\d.]+" y="[\d.]+" width="[\d.]+" height="\d+" rx="3">/g) ?? []).length, 12);
});

test('--limits writes the chart and stores the plan; --plan overrides', async () => {
  const claude = await mkdtemp(join(tmpdir(), 'cl-'));
  await mkdir(join(claude, 'projects', 'p'), { recursive: true });
  await writeFile(join(claude, 'projects', 'p', 's.jsonl'), notice("You've hit your weekly limit", 'z', '2026-03-09T01:00:00Z') + '\n');
  const out = await mkdtemp(join(tmpdir(), 'o-'));
  const e: string[] = [];
  const code = await run(['--claude-dir', claude, '--out', out, '--tz', 'UTC', '--limits', '--plan', 'Max 5x'], {
    out: () => undefined,
    err: (s) => e.push(s),
    now: () => new Date('2026-03-10T12:00:00Z'),
  });
  assert.equal(code, 0, e.join(''));
  const { readFile } = await import('node:fs/promises');
  const ledger = JSON.parse(await readFile(join(out, 'claude-hitmap.json'), 'utf8'));
  assert.equal(ledger.plan, 'Max 5x');
  assert.deepEqual(ledger.limits['2026-03-09'], { session: 0, weekly: 1 });
  assert.match(await readFile(join(out, 'claude-limits.svg'), 'utf8'), />Max 5x</);
});

test('turning --limits on later backfills from every transcript', async () => {
  const claude = await mkdtemp(join(tmpdir(), 'cl-'));
  await mkdir(join(claude, 'projects', 'p'), { recursive: true });
  await writeFile(join(claude, 'projects', 'p', 's.jsonl'), notice("You've hit your weekly limit", 'z', '2026-03-01T01:00:00Z') + '\n');
  const out = await mkdtemp(join(tmpdir(), 'o-'));
  const io = (now: string) => ({ out: () => undefined, err: () => undefined, now: () => new Date(now) });
  assert.equal(await run(['--claude-dir', claude, '--out', out, '--tz', 'UTC'], io('2026-03-02T00:00:00Z')), 0);
  // A later run, with the transcript untouched since before the cutoff, still finds the old notice.
  const { utimes, readFile } = await import('node:fs/promises');
  const old = new Date('2026-03-01T02:00:00Z');
  await utimes(join(claude, 'projects', 'p', 's.jsonl'), old, old);
  assert.equal(await run(['--claude-dir', claude, '--out', out, '--tz', 'UTC', '--limits', '--plan', 'Pro'], io('2026-03-20T00:00:00Z')), 0);
  const ledger = JSON.parse(await readFile(join(out, 'claude-hitmap.json'), 'utf8'));
  assert.deepEqual(ledger.limits['2026-03-01'], { session: 0, weekly: 1 });
});
