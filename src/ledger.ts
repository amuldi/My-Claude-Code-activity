import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyCounts, type DayKey, type Ledger, type TokenCounts } from './types.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS = ['input', 'output', 'cacheCreation', 'cacheRead', 'messages'] as const;

export function emptyLedger(timeZone: string): Ledger {
  return { version: 1, timeZone, lastScanAt: null, days: {} };
}

/** Validate untrusted JSON as a ledger. Throws with a message saying what is wrong. */
export function parseLedger(raw: unknown): Ledger {
  if (typeof raw !== 'object' || raw === null) throw new Error('ledger is not a JSON object');
  const r = raw as Record<string, unknown>;
  if (r['version'] !== 1) throw new Error(`unsupported ledger version: ${String(r['version'])}`);
  if (typeof r['timeZone'] !== 'string') throw new Error('ledger.timeZone must be a string');
  const days: Record<DayKey, TokenCounts> = {};
  const rawDays = r['days'];
  if (typeof rawDays !== 'object' || rawDays === null) throw new Error('ledger.days must be an object');
  for (const [k, v] of Object.entries(rawDays)) {
    if (!DAY.test(k)) throw new Error(`ledger.days has an invalid date key: ${k}`);
    const c = emptyCounts();
    for (const f of FIELDS) {
      const n = (v as Record<string, unknown>)[f];
      c[f] = typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
    }
    days[k] = c;
  }
  const lastScanAt = typeof r['lastScanAt'] === 'string' ? r['lastScanAt'] : null;
  return { version: 1, timeZone: r['timeZone'], lastScanAt, days };
}

/** Read the ledger at `path`, or start an empty one if the file does not exist. */
export async function loadLedger(path: string, timeZone: string): Promise<Ledger> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyLedger(timeZone);
    throw e;
  }
  return parseLedger(JSON.parse(text));
}

/**
 * Merge freshly scanned days into the ledger, field by field, keeping the larger
 * value. Once Claude Code deletes an old transcript, a rescan sees less than
 * before; taking the maximum means history only ever grows.
 */
export function mergeLedger(ledger: Ledger, scanned: ReadonlyMap<DayKey, TokenCounts>, scannedAt: Date): Ledger {
  const days: Record<DayKey, TokenCounts> = { ...ledger.days };
  for (const [k, c] of scanned) {
    const prev = days[k] ?? emptyCounts();
    const next = emptyCounts();
    for (const f of FIELDS) next[f] = Math.max(prev[f], c[f]);
    days[k] = next;
  }
  return { ...ledger, lastScanAt: scannedAt.toISOString(), days };
}

/** Write the ledger with days in date order, so diffs stay small. */
export async function saveLedger(path: string, ledger: Ledger): Promise<void> {
  const sorted: Record<DayKey, TokenCounts> = {};
  for (const k of Object.keys(ledger.days).sort()) {
    const c = ledger.days[k];
    if (c) sorted[k] = c;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ ...ledger, days: sorted }, null, 2) + '\n', 'utf8');
}
