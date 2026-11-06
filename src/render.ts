import { buildCalendar, stats, type Calendar, type Stats } from './calendar.js';
import { MASCOT, MASCOT_COLS, MASCOT_ROWS } from './mascot.js';
import type { DayKey, Metric } from './types.js';

export type Theme = 'auto' | 'light' | 'dark';
export type Lang = 'en' | 'ko';

export interface RenderOptions {
  /** Last day shown (YYYY-MM-DD). */
  end: DayKey;
  days?: number;
  metric?: Metric;
  theme?: Theme;
  lang?: Lang;
  title?: string;
  mascot?: boolean;
  /** Replaces "tokens" in the header and tooltips (e.g. "prompts"). */
  unit?: string;
  /** Replaces "the last year" in the header, e.g. "2026". */
  period?: string;
}

const CELL = 10;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 30;
const HEADER = 34;
const MONTH_ROW = 16;
const FOOTER = 30;
const PIXEL = 2;

const PALETTE = {
  light: { text: '#1f2328', muted: '#6e7781', levels: ['#efebe8', '#f6cdb8', '#ec9c76', '#d97757', '#a9482a'] },
  dark: { text: '#e6edf3', muted: '#8d96a0', levels: ['#262220', '#5b3323', '#8f4a2e', '#d97757', '#f3a27e'] },
} as const;

const MASCOT_COLOR = '#d97757';

const TEXT = {
  en: {
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    weekdays: ['Mon', 'Wed', 'Fri'],
    summary: (n: string, metric: Metric, days: number, unit?: string, period?: string) =>
      `${n} ${unit ?? (metric === 'total' ? 'tokens' : metric + ' tokens')} in ${period ?? `the last ${days === 365 ? 'year' : days + ' days'}`}`,
    footer: (s: Stats) =>
      `${s.activeDays} active days · longest streak ${s.longestStreak} · current streak ${s.currentStreak}`,
    less: 'Less',
    more: 'More',
    cell: (n: string, date: string, unit?: string) => `${n} ${unit ?? 'tokens'} on ${date}`,
  },
  ko: {
    months: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
    weekdays: ['월', '수', '금'],
    summary: (n: string, metric: Metric, days: number, unit?: string, period?: string) =>
      `${period ? period + '년' : `최근 ${days === 365 ? '1년' : days + '일'}`} ${unit ?? (metric === 'total' ? '' : metric + ' ') + '토큰'} ${n}`,
    footer: (s: Stats) => `활동 ${s.activeDays}일 · 최장 연속 ${s.longestStreak}일 · 현재 연속 ${s.currentStreak}일`,
    less: '적음',
    more: '많음',
    cell: (n: string, date: string, unit?: string) => `${date} · ${unit ?? '토큰'} ${n}`,
  },
} as const;

/** 1234567 → "1.2M". */
export function compact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (n >= size) {
      const v = n / size;
      return (v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')) + suffix;
    }
  }
  return String(n);
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}

function styles(theme: Theme): string {
  const font = `-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR",Helvetica,Arial,sans-serif`;
  const rules = (p: (typeof PALETTE)['light' | 'dark']): string =>
    [
      `.t{fill:${p.text}}`,
      `.m{fill:${p.muted}}`,
      ...p.levels.map((c, i) => `.l${i}{fill:${c}}`),
    ].join('');
  const base = `text{font-family:${font}}.t{font-size:14px;font-weight:600}.s,.m{font-size:11px}.mascot{fill:${MASCOT_COLOR}}`;
  if (theme === 'light') return base + rules(PALETTE.light);
  if (theme === 'dark') return base + rules(PALETTE.dark);
  return base + rules(PALETTE.light) + `@media (prefers-color-scheme:dark){${rules(PALETTE.dark)}}`;
}

function mascotSvg(x: number, y: number): string {
  const rects: string[] = [];
  MASCOT.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '#') {
        rects.push(`<rect x="${x + c * PIXEL}" y="${y + r * PIXEL}" width="${PIXEL}" height="${PIXEL}"/>`);
      }
    }
  });
  return `<g class="mascot" shape-rendering="crispEdges" aria-hidden="true">${rects.join('')}</g>`;
}

/** Render the heatmap as a standalone SVG document. */
export function renderSvg(values: ReadonlyMap<DayKey, number>, opts: RenderOptions): string {
  const days = opts.days ?? 365;
  const metric = opts.metric ?? 'total';
  const lang = opts.lang ?? 'en';
  const t = TEXT[lang];
  const showMascot = opts.mascot ?? true;
  const cal: Calendar = buildCalendar(values, opts.end, days);
  const s = stats(values, opts.end, days);

  const gridW = cal.weeks * STEP - GAP;
  const width = LEFT + gridW;
  const gridTop = HEADER + MONTH_ROW;
  const height = gridTop + 7 * STEP - GAP + FOOTER;
  const titleX = showMascot ? MASCOT_COLS * PIXEL + 10 : 0;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="hm-title hm-desc">`,
  );
  parts.push(`<title id="hm-title">${escapeXml(opts.title ?? 'Claude Code')}</title>`);
  parts.push(`<desc id="hm-desc">${escapeXml(t.summary(compact(s.total), metric, days, opts.unit, opts.period))}. ${escapeXml(t.footer(s))}</desc>`);
  parts.push(`<style>${styles(opts.theme ?? 'auto')}</style>`);

  // Header: mascot, title, total.
  // Centre the mascot on the title's x-height (baseline 19, cap height ~10).
  if (showMascot) parts.push(mascotSvg(0, 14 - (MASCOT_ROWS * PIXEL) / 2));
  parts.push(`<text class="t" x="${titleX}" y="19">${escapeXml(opts.title ?? 'Claude Code')}</text>`);
  parts.push(`<text class="m" x="${width}" y="19" text-anchor="end">${escapeXml(t.summary(compact(s.total), metric, days, opts.unit, opts.period))}</text>`);

  // Month and weekday labels.
  let lastLabelX = -Infinity;
  for (const m of cal.months) {
    const x = LEFT + m.week * STEP;
    if (x - lastLabelX < 3 * STEP || x > width - 20) continue;
    parts.push(`<text class="m" x="${x}" y="${HEADER + 10}">${escapeXml(t.months[m.month] ?? '')}</text>`);
    lastLabelX = x;
  }
  [1, 3, 5].forEach((row, i) => {
    parts.push(`<text class="m" x="0" y="${gridTop + row * STEP + CELL - 1}">${escapeXml(t.weekdays[i] ?? '')}</text>`);
  });

  // Cells.
  parts.push('<g>');
  for (const c of cal.cells) {
    const x = LEFT + c.week * STEP;
    const y = gridTop + c.weekday * STEP;
    const label = t.cell(compact(c.value), c.date, opts.unit);
    parts.push(
      `<rect class="l${c.level}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2"><title>${escapeXml(label)}</title></rect>`,
    );
  }
  parts.push('</g>');

  // Footer: streaks on the left, legend on the right.
  const footY = gridTop + 7 * STEP - GAP + 20;
  parts.push(`<text class="m" x="${LEFT}" y="${footY}">${escapeXml(t.footer(s))}</text>`);
  // "More" is anchored to the right edge so its width never matters.
  const legendCells = 5 * STEP - GAP;
  const moreW = lang === 'ko' ? 22 : 30;
  const legendX = width - moreW - 6 - legendCells;
  parts.push(`<text class="m" x="${legendX - 6}" y="${footY}" text-anchor="end">${escapeXml(t.less)}</text>`);
  for (let i = 0; i < 5; i++) {
    parts.push(`<rect class="l${i}" x="${legendX + i * STEP}" y="${footY - CELL + 1}" width="${CELL}" height="${CELL}" rx="2"/>`);
  }
  parts.push(`<text class="m" x="${width}" y="${footY}" text-anchor="end">${escapeXml(t.more)}</text>`);
  parts.push('</svg>');
  return parts.join('') + '\n';
}

export interface ProjectsOptions {
  theme?: Theme;
  lang?: Lang;
  title?: string;
  unit?: string;
  mascot?: boolean;
  /** Everything across all projects; the header then reads "shown of total". */
  total?: number;
}

/** Horizontal bars for the projects with the most activity. */
export function renderProjects(items: readonly (readonly [string, number])[], opts: ProjectsOptions = {}): string {
  const lang = opts.lang ?? 'en';
  const title = opts.title ?? (lang === 'ko' ? '작업한 프로젝트' : 'Projects');
  const unit = opts.unit ?? 'prompts';
  const showMascot = opts.mascot ?? true;
  const NAME_W = 190;
  const BAR_MAX = 360;
  const ROW = 22;
  const top = 38;
  const width = NAME_W + BAR_MAX + 64;
  const height = top + items.length * ROW + 8;
  const max = Math.max(1, ...items.map(([, n]) => n));
  const total = items.reduce((a, [, n]) => a + n, 0);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="pj-title">`,
  );
  parts.push(`<title id="pj-title">${escapeXml(title)}</title>`);
  parts.push(`<style>${styles(opts.theme ?? 'auto')}</style>`);
  const titleX = showMascot ? MASCOT_COLS * PIXEL + 10 : 0;
  if (showMascot) parts.push(mascotSvg(0, 14 - (MASCOT_ROWS * PIXEL) / 2));
  parts.push(`<text class="t" x="${titleX}" y="19">${escapeXml(title)}</text>`);
  parts.push(`<text class="m" x="${width}" y="19" text-anchor="end">${opts.total === undefined ? compact(total) : `${compact(total)} of ${compact(opts.total)}`} ${escapeXml(unit)}</text>`);
  items.forEach(([name, n], i) => {
    const y = top + i * ROW;
    const w = Math.max(3, Math.round((n / max) * BAR_MAX));
    const label = name.length > 24 ? name.slice(0, 23) + '…' : name;
    parts.push(`<text class="s t" x="0" y="${y + 12}" style="font-weight:400">${escapeXml(label)}</text>`);
    parts.push(`<rect class="l${n === max ? 4 : 3}" x="${NAME_W}" y="${y + 2}" width="${w}" height="12" rx="2"><title>${escapeXml(name)}: ${n} ${escapeXml(unit)}</title></rect>`);
    parts.push(`<text class="m" x="${NAME_W + w + 6}" y="${y + 12}">${n}</text>`);
  });
  parts.push('</svg>');
  return parts.join('') + '\n';
}
