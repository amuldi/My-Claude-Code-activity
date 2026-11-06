import { createReadStream } from 'node:fs';
import { join, basename } from 'node:path';
import { createInterface } from 'node:readline';
import { dayKey } from './collect.js';
import type { DayKey } from './types.js';

export interface History {
  /** Prompts typed per day. */
  days: Map<DayKey, number>;
  /** Prompts per project folder name. */
  projects: Map<string, number>;
}

/**
 * Parse one line of `history.jsonl`. Only the timestamp and the project folder
 * name are read; the prompt text itself is never looked at.
 */
export function parseHistoryLine(line: string): { at: Date; project: string } | undefined {
  if (!line.includes('"timestamp"')) return undefined;
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof obj !== 'object' || obj === null) return undefined;
  const { timestamp, project } = obj as { timestamp?: unknown; project?: unknown };
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return undefined;
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return undefined;
  const name = typeof project === 'string' ? basename(project.replace(/[\\/]+$/, '')).trim() : '';
  return { at, project: name || '(unknown)' };
}

/** Count prompts per day and per project from `<dir>/history.jsonl`. Missing files are skipped. */
export async function collectHistory(dirs: readonly string[], timeZone: string): Promise<History> {
  const days = new Map<DayKey, number>();
  const projects = new Map<string, number>();
  for (const dir of dirs) {
    const stream = createReadStream(join(dir, 'history.jsonl'), { encoding: 'utf8' });
    stream.on('error', () => undefined);
    try {
      for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
        const rec = parseHistoryLine(line);
        if (!rec) continue;
        const day = dayKey(rec.at, timeZone);
        days.set(day, (days.get(day) ?? 0) + 1);
        projects.set(rec.project, (projects.get(rec.project) ?? 0) + 1);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  return { days, projects };
}
