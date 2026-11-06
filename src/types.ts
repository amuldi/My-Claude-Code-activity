/** A calendar day in `YYYY-MM-DD` form, in the time zone the ledger was built with. */
export type DayKey = string;

/** Token counts for one day, summed over every Claude Code API response that day. */
export interface TokenCounts {
  /** Fresh input tokens (not served from cache). */
  input: number;
  /** Output tokens, thinking included. */
  output: number;
  /** Input tokens written to the prompt cache. */
  cacheCreation: number;
  /** Input tokens read from the prompt cache. */
  cacheRead: number;
  /** Number of distinct API responses. */
  messages: number;
}

/**
 * The persistent history. Claude Code deletes transcripts after 30 days by
 * default, so each run merges what it finds into this file instead of
 * recomputing from scratch.
 */
export interface Ledger {
  version: 1;
  timeZone: string;
  /** When the transcripts were last scanned (ISO time), or null if never. */
  lastScanAt: string | null;
  days: Record<DayKey, TokenCounts>;
}

/** Which number each cell shows. */
export type Metric = 'total' | 'output' | 'input';

export const METRICS: readonly Metric[] = ['total', 'output', 'input'];

export function emptyCounts(): TokenCounts {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, messages: 0 };
}

/** The value of `metric` for one day. */
export function metricValue(c: TokenCounts, metric: Metric): number {
  switch (metric) {
    case 'total':
      return c.input + c.output + c.cacheCreation + c.cacheRead;
    case 'output':
      return c.output;
    case 'input':
      return c.input + c.cacheCreation;
  }
}
