import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { emptyCounts, type DayKey, type TokenCounts } from './types.js';

/**
 * Where Claude Code keeps its data: `$CLAUDE_CONFIG_DIR` (comma-separated) if set,
 * otherwise both `~/.claude` and `~/.config/claude`.
 */
export function defaultClaudeDirs(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string[] {
  const fromEnv = (env['CLAUDE_CONFIG_DIR'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  return [join(home, '.claude'), join(home, '.config', 'claude')];
}

/** Every `*.jsonl` transcript under `<dir>/projects`, optionally only those modified since `since`. */
export async function findTranscripts(dirs: readonly string[], since?: Date): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // missing or unreadable directory: nothing to collect
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        if (since) {
          const s = await stat(p);
          if (s.mtime < since) continue;
        }
        out.push(p);
      }
    }
  };
  for (const d of dirs) await walk(join(d, 'projects'));
  return out.sort();
}

/** `YYYY-MM-DD` for `date` as seen in `timeZone`. */
export function dayKey(date: Date, timeZone: string): DayKey {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** One API response's usage, as found in a transcript line. */
export interface UsageRecord {
  /** Identifies the response, so the repeated lines Claude Code writes for it count once. */
  key: string;
  timestamp: Date;
  counts: Omit<TokenCounts, 'messages'>;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Parse one transcript line. Returns null for anything that is not an assistant response with usage. */
export function parseLine(line: string): UsageRecord | null {
  // Cheap pre-filter: most lines carry no usage, and JSON.parse dominates the cost.
  if (!line.includes('"usage"')) return null;
  let d: unknown;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(d) || d['type'] !== 'assistant') return null;
  const msg = d['message'];
  if (!isObject(msg) || !isObject(msg['usage'])) return null;
  const ts = typeof d['timestamp'] === 'string' ? new Date(d['timestamp']) : null;
  if (!ts || Number.isNaN(ts.getTime())) return null;
  const u = msg['usage'];
  const id = typeof msg['id'] === 'string' ? msg['id'] : '';
  const req = typeof d['requestId'] === 'string' ? d['requestId'] : '';
  const uuid = typeof d['uuid'] === 'string' ? d['uuid'] : '';
  const key = id || req ? `${id}:${req}` : `uuid:${uuid || ts.toISOString()}`;
  return {
    key,
    timestamp: ts,
    counts: {
      input: num(u['input_tokens']),
      output: num(u['output_tokens']),
      cacheCreation: num(u['cache_creation_input_tokens']),
      cacheRead: num(u['cache_read_input_tokens']),
    },
  };
}

/**
 * Sum usage per day. Responses that appear on several lines (streaming writes
 * the same message more than once) are counted once, keeping the largest value
 * of each field.
 */
export function aggregate(records: Iterable<UsageRecord>, timeZone: string): Map<DayKey, TokenCounts> {
  const byKey = new Map<string, UsageRecord>();
  for (const r of records) {
    const prev = byKey.get(r.key);
    if (!prev) {
      byKey.set(r.key, { ...r, counts: { ...r.counts } });
      continue;
    }
    prev.counts.input = Math.max(prev.counts.input, r.counts.input);
    prev.counts.output = Math.max(prev.counts.output, r.counts.output);
    prev.counts.cacheCreation = Math.max(prev.counts.cacheCreation, r.counts.cacheCreation);
    prev.counts.cacheRead = Math.max(prev.counts.cacheRead, r.counts.cacheRead);
    if (r.timestamp < prev.timestamp) prev.timestamp = r.timestamp;
  }
  const days = new Map<DayKey, TokenCounts>();
  for (const r of byKey.values()) {
    const k = dayKey(r.timestamp, timeZone);
    const c = days.get(k) ?? emptyCounts();
    c.input += r.counts.input;
    c.output += r.counts.output;
    c.cacheCreation += r.counts.cacheCreation;
    c.cacheRead += r.counts.cacheRead;
    c.messages += 1;
    days.set(k, c);
  }
  return days;
}

/** Stream every usage record out of the given transcript files. */
export async function* readUsage(files: readonly string[]): AsyncGenerator<UsageRecord> {
  for (const f of files) {
    const rl = createInterface({ input: createReadStream(f, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      const r = parseLine(line);
      if (r) yield r;
    }
  }
}

/** Scan transcripts and return token counts per day. */
export async function collect(opts: { dirs: readonly string[]; timeZone: string; since?: Date }): Promise<{
  days: Map<DayKey, TokenCounts>;
  files: number;
}> {
  const files = await findTranscripts(opts.dirs, opts.since);
  const records: UsageRecord[] = [];
  for await (const r of readUsage(files)) records.push(r);
  return { days: aggregate(records, opts.timeZone), files: files.length };
}
