import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compact, escapeXml, renderSvg } from '../src/render.js';

const values = new Map([
  ['2026-11-01', 1_200_000],
  ['2026-11-02', 30_000_000],
]);

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

test('renders one cell per day plus a five-step legend', () => {
  const svg = renderSvg(values, { end: '2026-11-06', days: 365 });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.equal(count(svg, /<rect class="l\d" x="\d+" y="\d+" width="10" height="10" rx="2"><title>/g), 365);
  assert.equal(count(svg, /<rect class="l\d"[^>]*\/>/g), 5);
});

test('summarises the total in the header', () => {
  const svg = renderSvg(values, { end: '2026-11-06' });
  assert.match(svg, /31\.2M tokens in the last year/);
});

test('follows the viewer theme by default and can be pinned', () => {
  assert.match(renderSvg(values, { end: '2026-11-06' }), /prefers-color-scheme:dark/);
  assert.doesNotMatch(renderSvg(values, { end: '2026-11-06', theme: 'dark' }), /prefers-color-scheme/);
});

test('escapes the title', () => {
  const svg = renderSvg(values, { end: '2026-11-06', title: '<script>&' });
  assert.match(svg, /&lt;script&gt;&amp;/);
  assert.doesNotMatch(svg, /<script>/);
});

test('can drop the mascot and switch to Korean', () => {
  const svg = renderSvg(values, { end: '2026-11-06', mascot: false, lang: 'ko' });
  assert.doesNotMatch(svg, /class="mascot"/);
  assert.match(svg, /최근 1년 토큰/);
  assert.match(svg, />11월</);
});

test('compact formats large numbers', () => {
  assert.equal(compact(999), '999');
  assert.equal(compact(1500), '1.5K');
  assert.equal(compact(2_000_000), '2M');
  assert.equal(compact(123_400_000), '123M');
  assert.equal(compact(4_560_000_000), '4.6B');
});

test('escapeXml handles all five special characters', () => {
  assert.equal(escapeXml(`<>&"'`), '&lt;&gt;&amp;&quot;&apos;');
});

test('can label the heatmap with another unit', () => {
  const svg = renderSvg(values, { end: '2026-11-06', unit: 'prompts' });
  assert.match(svg, /31\.2M prompts in the last year/);
  assert.match(svg, /<title>30M prompts on 2026-11-02<\/title>/);
});

test('draws a bar per project and escapes names', async () => {
  const { renderProjects } = await import('../src/render.js');
  const svg = renderProjects([['<a>', 10], ['b', 5]], { mascot: false });
  assert.equal((svg.match(/<rect class="l\d" x="190"/g) ?? []).length, 2);
  assert.match(svg, /&lt;a&gt;/);
  assert.doesNotMatch(svg, /<a>/);
});

test('projects header can show shown-of-total', async () => {
  const { renderProjects } = await import('../src/render.js');
  assert.match(renderProjects([['a', 1500]], { mascot: false, total: 2800 }), /1\.5K of 2\.8K prompts/);
});
