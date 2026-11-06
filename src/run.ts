import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { stats } from './calendar.js';
import { collect, dayKey, defaultClaudeDirs } from './collect.js';
import { collectHistory } from './history.js';
import { loadLedger, mergeLedger, saveLedger } from './ledger.js';
import { compact, renderProjects, renderSvg, type Lang, type Theme } from './render.js';
import { METRICS, metricValue, type DayKey, type Metric } from './types.js';

export const VERSION = '0.1.0';

export const HELP = `cc-hitmap — GitHub-style heatmap of your Claude Code token usage

Usage
  cc-hitmap [options]

Reads Claude Code transcripts on this machine, adds each day's token counts to a
ledger file (so history survives Claude Code's 30-day cleanup), and writes an SVG
you can embed in a README.

Options
  -o, --out <dir>        Folder to write into (default: .)
      --svg <name>       SVG file name (default: claude-hitmap.svg)
      --data <name>      Ledger file name (default: claude-hitmap.json)
      --claude-dir <dir> Claude Code data folder; repeatable
                         (default: $CLAUDE_CONFIG_DIR, else ~/.claude and ~/.config/claude)
      --metric <m>       total | output | input (default: total)
      --days <n>         Days shown, 7–371 (default: 365)
      --tz <zone>        IANA time zone for day boundaries (default: this machine's)
      --theme <t>        auto | light | dark (default: auto, follows the viewer)
      --lang <l>         en | ko (default: en)
      --title <text>     Heading (default: Claude Code)
      --prompts          Also draw prompts-per-day and top-projects charts from
                         history.jsonl, which reaches back further than transcripts
                         (writes claude-prompts.svg and claude-projects.svg)
      --top <n>          Projects in the projects chart (default: 8)
      --no-mascot        Leave out the pixel mascot
      --full             Rescan every transcript, not only those changed since the last run
      --push             git add, commit and push the two files in --out
  -h, --help             Show this help
  -v, --version          Show the version
`;

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  now?: () => Date;
}

class UsageError extends Error {}

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new UsageError(`--${name} must be one of ${allowed.join(', ')} (got "${value}")`);
}

function validTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    throw new UsageError(`--tz is not a known IANA time zone: "${tz}"`);
  }
}

function pushFiles(dir: string, files: string[], io: Io): void {
  const git = (args: string[]): string =>
    execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  git(['add', '--', ...files]);
  const staged = spawnSync('git', ['-C', dir, 'diff', '--cached', '--quiet', '--', ...files]);
  if (staged.status === 0) {
    io.out('No change to push.\n');
    return;
  }
  git(['commit', '-m', 'chore: update Claude Code hitmap', '--', ...files]);
  git(['push']);
  io.out('Pushed.\n');
}

/** Run the CLI. Returns the process exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      allowPositionals: false,
      options: {
        out: { type: 'string', short: 'o', default: '.' },
        svg: { type: 'string', default: 'claude-hitmap.svg' },
        data: { type: 'string', default: 'claude-hitmap.json' },
        'claude-dir': { type: 'string', multiple: true },
        metric: { type: 'string', default: 'total' },
        days: { type: 'string', default: '365' },
        tz: { type: 'string' },
        theme: { type: 'string', default: 'auto' },
        lang: { type: 'string', default: 'en' },
        title: { type: 'string', default: 'Claude Code' },
        prompts: { type: 'boolean', default: false },
        top: { type: 'string', default: '8' },
        'no-mascot': { type: 'boolean', default: false },
        full: { type: 'boolean', default: false },
        push: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    }));
  } catch (e) {
    io.err(`${(e as Error).message}\nRun cc-hitmap --help for usage.\n`);
    return 2;
  }
  if (values.help) {
    io.out(HELP);
    return 0;
  }
  if (values.version) {
    io.out(VERSION + '\n');
    return 0;
  }

  try {
    const metric: Metric = oneOf('metric', values.metric, METRICS);
    const theme: Theme = oneOf('theme', values.theme, ['auto', 'light', 'dark'] as const);
    const lang: Lang = oneOf('lang', values.lang, ['en', 'ko'] as const);
    const days = Number(values.days);
    if (!Number.isInteger(days) || days < 7 || days > 371) throw new UsageError('--days must be a whole number from 7 to 371');
    const top = Number(values.top);
    if (!Number.isInteger(top) || top < 1 || top > 30) throw new UsageError('--top must be a whole number from 1 to 30');
    const timeZone = validTimeZone(values.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    for (const [flag, name] of [['svg', values.svg], ['data', values.data]] as const) {
      if (basename(name) !== name) throw new UsageError(`--${flag} must be a file name, not a path (use --out for the folder)`);
    }

    const outDir = resolve(values.out);
    const dataPath = join(outDir, values.data);
    const svgPath = join(outDir, values.svg);
    const dirs = values['claude-dir']?.length ? values['claude-dir'] : defaultClaudeDirs();
    const now = io.now ? io.now() : new Date();

    let ledger = await loadLedger(dataPath, timeZone);
    if (ledger.timeZone !== timeZone) {
      throw new UsageError(
        `the ledger was built in ${ledger.timeZone}; pass --tz ${ledger.timeZone} or start a new ledger with --data`,
      );
    }

    // Incremental scan: a transcript last modified before the cutoff holds nothing
    // newer than the cutoff, so days from the cutoff on are complete without it.
    const since = !values.full && ledger.lastScanAt ? new Date(Date.parse(ledger.lastScanAt) - 86_400_000) : undefined;
    const scan = await collect(since ? { dirs, timeZone, since } : { dirs, timeZone });
    if (since) {
      const from = dayKey(since, timeZone);
      for (const k of [...scan.days.keys()]) if (k < from) scan.days.delete(k);
    }
    ledger = mergeLedger(ledger, scan.days, now);

    const values_ = new Map<DayKey, number>(
      Object.entries(ledger.days).map(([k, c]) => [k, metricValue(c, metric)]),
    );
    const end = dayKey(now, timeZone);
    const svg = renderSvg(values_, { end, days, metric, theme, lang, title: values.title, mascot: !values['no-mascot'] });

    await mkdir(outDir, { recursive: true });
    await saveLedger(dataPath, ledger);
    await writeFile(svgPath, svg, 'utf8');

    const extra: string[] = [];
    if (values.prompts) {
      const h = await collectHistory(dirs, timeZone);
      const mascot = !values['no-mascot'];
      const promptTitle = lang === 'ko' ? 'Claude Code 프롬프트' : 'Claude Code prompts';
      await writeFile(
        join(outDir, 'claude-prompts.svg'),
        renderSvg(h.days, { end, days, theme, lang, title: promptTitle, mascot, unit: lang === 'ko' ? '프롬프트' : 'prompts' }),
        'utf8',
      );
      const best = [...h.projects].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top);
      await writeFile(join(outDir, 'claude-projects.svg'), renderProjects(best, { theme, lang, mascot, total: [...h.projects.values()].reduce((a, b) => a + b, 0) }), 'utf8');
      extra.push('claude-prompts.svg', 'claude-projects.svg');
      io.out(`History: ${[...h.days.values()].reduce((a, b) => a + b, 0)} prompts on ${h.days.size} days, ${h.projects.size} projects.\n`);
    }

    const s = stats(values_, end, days);
    io.out(
      [
        `Scanned ${scan.files} transcript${scan.files === 1 ? '' : 's'}${since ? ' changed since the last run' : ''}.`,
        `Ledger: ${Object.keys(ledger.days).length} days (${dataPath})`,
        `Last ${days} days: ${compact(s.total)} ${metric} tokens · ${s.activeDays} active days · longest streak ${s.longestStreak}`,
        `Wrote ${svgPath}`,
        '',
      ].join('\n'),
    );
    if (values.push) pushFiles(outDir, [values.svg, values.data, ...extra], io);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`${e.message}\n`);
      return 2;
    }
    io.err(`cc-hitmap: ${(e as Error).message}\n`);
    return 1;
  }
}
