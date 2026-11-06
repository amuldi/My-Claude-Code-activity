import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { dayKey } from './collect.js';
import type { DayKey, LimitHits } from './types.js';

export interface LimitHit {
  key: string;
  at: Date;
  kind: 'session' | 'weekly';
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Recognise the notice Claude Code writes when a usage limit is reached, e.g.
 * "You've hit your weekly limit · resets 1pm". Only that notice is read; no other
 * message text is looked at.
 */
export function parseLimitHit(line: string): LimitHit | null {
  if (!line.includes('hit your')) return null;
  let d: unknown;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(d) || d['type'] !== 'assistant' || !isObject(d['message'])) return null;
  const content = d['message']['content'];
  if (!Array.isArray(content)) return null;
  const at = typeof d['timestamp'] === 'string' ? new Date(d['timestamp']) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  for (const part of content) {
    if (!isObject(part) || typeof part['text'] !== 'string') continue;
    const m = /^You['’]ve hit your ([^·\n]*?) limit/.exec(part['text']);
    if (!m) continue;
    const uuid = typeof d['uuid'] === 'string' ? d['uuid'] : '';
    return { key: uuid || at.toISOString(), at, kind: /week/i.test(m[1] ?? '') ? 'weekly' : 'session' };
  }
  return null;
}

/** Count limit-reached notices per day across transcripts. */
export async function scanLimits(files: readonly string[], timeZone: string): Promise<Map<DayKey, LimitHits>> {
  const seen = new Set<string>();
  const out = new Map<DayKey, LimitHits>();
  for (const f of files) {
    const rl = createInterface({ input: createReadStream(f, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      const hit = parseLimitHit(line);
      if (!hit || seen.has(hit.key)) continue;
      seen.add(hit.key);
      const day = dayKey(hit.at, timeZone);
      const h = out.get(day) ?? { session: 0, weekly: 0 };
      h[hit.kind] += 1;
      out.set(day, h);
    }
  }
  return out;
}

/** Turn Claude Code's account fields into a short plan label, or undefined if unknown. */
export function planLabel(organizationType: unknown, rateLimitTier: unknown): string | undefined {
  const tier = typeof rateLimitTier === 'string' ? rateLimitTier.toLowerCase() : '';
  const org = typeof organizationType === 'string' ? organizationType.toLowerCase() : '';
  if (tier.includes('max_20x')) return 'Max 20x';
  if (tier.includes('max_5x')) return 'Max 5x';
  if (org.includes('max')) return 'Max';
  if (org.includes('pro')) return 'Pro';
  if (org.includes('team')) return 'Team';
  if (org.includes('enterprise')) return 'Enterprise';
  if (org.includes('free')) return 'Free';
  return undefined;
}

/**
 * Read only the subscription plan from Claude Code's account file. Nothing else in
 * that file (name, e-mail, ids) is read or kept.
 */
export async function readPlan(files: readonly string[]): Promise<string | undefined> {
  for (const f of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(f, 'utf8'));
    } catch {
      continue;
    }
    const acct = isObject(raw) && isObject(raw['oauthAccount']) ? raw['oauthAccount'] : undefined;
    if (!acct) continue;
    const label = planLabel(acct['organizationType'], acct['userRateLimitTier'] ?? acct['organizationRateLimitTier']);
    if (label) return label;
  }
  return undefined;
}

/** Where Claude Code keeps the account file for each data folder. */
export function accountFiles(dirs: readonly string[], home: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const files = dirs.map((d) => join(d, '.claude.json'));
  if (!env['CLAUDE_CONFIG_DIR']) files.unshift(join(home, '.claude.json'));
  return files;
}
