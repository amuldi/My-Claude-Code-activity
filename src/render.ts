import { buildCalendar, stats, type Calendar, type Stats } from './calendar.js';
import { MASCOT, MASCOT_COLS, MASCOT_ROWS } from './mascot.js';
import type { DayKey, LimitHits, Metric } from './types.js';

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
  const base = `text{font-family:${font}}.t{font-size:14px;font-weight:600}.s,.m{font-size:11px}.v{font-size:22px;font-weight:700}.k{font-size:11px}.mascot{fill:${MASCOT_COLOR}}`;
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

export interface LimitsOptions {
  /** Last day of the period (YYYY-MM-DD). */
  end: DayKey;
  /** Show Jan–Dec of this year instead of the last 12 months. */
  year?: number;
  plan?: string;
  theme?: Theme;
  lang?: Lang;
  title?: string;
  mascot?: boolean;
}

const LIMIT_TEXT = {
  en: {
    title: 'Plan & limits',
    plan: 'Plan',
    unknown: 'Unknown',
    session: '5-hour limit',
    weekly: 'Weekly limit',
    days: 'Days at a limit',
    unit: (n: number) => (n === 1 ? 'time' : 'times'),
    dayUnit: (n: number) => (n === 1 ? 'day' : 'days'),
    period: (y?: number) => (y ? String(y) : 'the last 12 months'),
    foot: (d: string | undefined) => (d ? `Last time at a limit: ${d}` : 'Never reached a limit'),
    chart: 'Days at a limit, by month',
    months: ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'],
  },
  ko: {
    title: '플랜 · 사용 한도',
    plan: '플랜',
    unknown: '알 수 없음',
    session: '5시간 한도',
    weekly: '주간 한도',
    days: '한도에 닿은 날',
    unit: () => '회',
    dayUnit: () => '일',
    period: (y?: number) => (y ? `${y}년` : '최근 12개월'),
    foot: (d: string | undefined) => (d ? `마지막으로 한도에 닿은 날: ${d}` : '한도에 닿은 적 없음'),
    chart: '월별 한도에 닿은 날',
    months: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
  },
} as const;

/** Plan name plus how often the usage limits were reached. */
export function renderLimits(limits: ReadonlyMap<DayKey, LimitHits>, opts: LimitsOptions): string {
  const lang = opts.lang ?? 'en';
  const t = LIMIT_TEXT[lang];
  const showMascot = opts.mascot ?? true;
  const endYear = Number(opts.end.slice(0, 4));
  const endMonth = Number(opts.end.slice(5, 7));

  // The 12 month buckets shown.
  const buckets: { key: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const y = opts.year ?? endYear;
    const m = opts.year ? i + 1 : endMonth - 11 + i;
    const yy = m < 1 ? y - 1 : y;
    const mm = ((m + 11) % 12) + 1;
    buckets.push({ key: `${yy}-${String(mm).padStart(2, '0')}`, label: t.months[mm - 1] ?? '' });
  }
  const first = buckets[0]?.key ?? '';
  const last = buckets[11]?.key ?? '';

  let session = 0;
  let weekly = 0;
  let lastDay: string | undefined;
  const perMonth = new Map<string, number>();
  for (const [day, h] of limits) {
    const mk = day.slice(0, 7);
    if (mk < first || mk > last || day > opts.end || (h.session === 0 && h.weekly === 0)) continue;
    session += h.session;
    weekly += h.weekly;
    perMonth.set(mk, (perMonth.get(mk) ?? 0) + 1);
    if (!lastDay || day > lastDay) lastDay = day;
  }
  const daysAt = [...perMonth.values()].reduce((a, b) => a + b, 0);

  const W = 620;
  const stats: [string, string, string][] = [
    [t.plan, opts.plan ?? t.unknown, ''],
    [t.session, String(session), t.unit(session)],
    [t.weekly, String(weekly), t.unit(weekly)],
    [t.days, String(daysAt), t.dayUnit(daysAt)],
  ];
  const colW = (W - 3 * 16) / 4;
  const chartTop = 128;
  const chartH = 64;
  const H = chartTop + chartH + 44;
  const maxBar = Math.max(1, ...buckets.map((b) => perMonth.get(b.key) ?? 0));
  const title = opts.title ?? t.title;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="lm-title">`);
  parts.push(`<title id="lm-title">${escapeXml(title)}</title>`);
  parts.push(`<style>${styles(opts.theme ?? 'auto')}</style>`);
  const titleX = showMascot ? MASCOT_COLS * PIXEL + 10 : 0;
  if (showMascot) parts.push(mascotSvg(0, 14 - (MASCOT_ROWS * PIXEL) / 2));
  parts.push(`<text class="t" x="${titleX}" y="19">${escapeXml(title)}</text>`);
  parts.push(`<text class="m" x="${W}" y="19" text-anchor="end">${escapeXml(t.period(opts.year))}</text>`);

  stats.forEach(([label, value, unit], i) => {
    const x = i * (colW + 16);
    parts.push(`<rect class="l0" x="${x}" y="40" width="${colW}" height="64" rx="6"/>`);
    parts.push(`<text class="m k" x="${x + 12}" y="60">${escapeXml(label)}</text>`);
    parts.push(`<text class="t v" x="${x + 12}" y="90">${escapeXml(value)}${unit ? `<tspan class="m k" dx="5">${escapeXml(unit)}</tspan>` : ''}</text>`);
  });

  parts.push(`<text class="m" x="0" y="${chartTop - 8}">${escapeXml(t.chart)}</text>`);
  const slot = W / 12;
  buckets.forEach((b, i) => {
    const n = perMonth.get(b.key) ?? 0;
    const h = n === 0 ? 3 : Math.max(5, Math.round((n / maxBar) * chartH));
    const x = i * slot + 6;
    const y = chartTop + chartH - h;
    parts.push(`<rect class="l${n === 0 ? 0 : n === maxBar ? 4 : 3}" x="${x}" y="${y}" width="${slot - 12}" height="${h}" rx="3"><title>${escapeXml(b.key)}: ${n}</title></rect>`);
    if (n > 0) parts.push(`<text class="m" x="${x + (slot - 12) / 2}" y="${y - 4}" text-anchor="middle">${n}</text>`);
    parts.push(`<text class="m" x="${x + (slot - 12) / 2}" y="${chartTop + chartH + 14}" text-anchor="middle">${escapeXml(b.label)}</text>`);
  });
  parts.push(`<text class="m" x="0" y="${H - 4}">${escapeXml(t.foot(lastDay))}</text>`);
  parts.push('</svg>');
  return parts.join('') + '\n';
}
