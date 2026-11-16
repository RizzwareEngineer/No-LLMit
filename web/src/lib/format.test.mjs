// The site's one number format (en-US grouping everywhere). Run from web/: node --experimental-strip-types --test src/lib/format.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { figureEms, fitFigure, grouped, signed, signedBrief, signedCompact } from './format.ts';

test('signedBrief picks its decimals from the rounded figure: 99.96 is +100, never +100.0', () => {
  assert.equal(signedBrief(99.94), '+99.9');
  assert.equal(signedBrief(99.96), '+100');
  assert.equal(signedBrief(-99.97), '−100');
  assert.equal(signedBrief(100.04), '+100');
  assert.equal(signedBrief(1306.2), '+1,306');
});

// A phone's Matchups cell: 34px of room at 14px figures (nine models in a 360px card). A pair with one hand together
// where the row model won a 185bb all-in is +18,500 bb/100; +18.5k is 46px and was clipped to "+18.5".
test('fitFigure never draws a form wider than its cell when a narrower one fits', () => {
  assert.equal(fitFigure(18500, 34, 14), '+19k');
  assert.equal(fitFigure(-12345, 34, 14), '−12k');
  assert.equal(fitFigure(999.6, 34, 14), '+1k');
  assert.equal(fitFigure(1234.5, 200, 14), '+1,234.5');
  assert.equal(fitFigure(485.9, 34, 14), '+486');
  // A phone's 38.8px cell (34px inside its padding): the engine's +1,450 reads +1.5k, never +1k (review 3, finding 8).
  assert.equal(fitFigure(1450, 34, 14, 38.7), '+1.5k');
  assert.equal(fitFigure(-2499, 34, 14, 38.7), '−2.5k');
  assert.equal(fitFigure(18500, 34, 14, 38.7), '+19k');
  for (const room of [30, 34, 38.8, 47.5, 64]) for (const px of [13, 14]) for (let v = 0.05; v < 300000; v *= 1.013) for (const n of [v, -v]) {
    const forms = [signed(n), signed(n, 0), signedCompact(n), signedCompact(n, 0)], t = fitFigure(n, room, px);
    if (forms.some(f => figureEms(f) * px <= room)) assert.ok(figureEms(t) * px <= room, `${n} in ${room}px at ${px}px drew ${t}`);
    else assert.equal(figureEms(t), Math.min(...forms.map(figureEms)), `${n}: not the narrowest form`);
  }
});

test('grouped and signed are en-US whatever the runtime locale', () => {
  assert.equal(grouped(2366.3, 1), '2,366.3');
  assert.equal(signed(-12345, 0), '−12,345');
});

// Every figure on the page goes through an en-US formatter: a bare toLocaleString() (or one given undefined) follows
// the visitor's browser, so a German reader saw 1.306 beside 1,306 on one chart.
test('no source file formats a number in the browser\'s locale', () => {
  const src = new URL('..', import.meta.url).pathname, bad = [];
  const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/\.toLocaleString\(\s*(\)|undefined|\[)/.test(l) || /Intl\.NumberFormat\(\s*(\)|undefined|\[|(?!['"]en(-US)?['"]))/.test(l)) bad.push(`${p.slice(src.length)}:${i + 1}`); }); } };
  walk(src);
  assert.deepEqual(bad, []);
});

test('every NumberFlow names the en-US locale', () => {
  const src = new URL('..', import.meta.url).pathname, bad = [];
  const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx$/.test(f)) readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/<NumberFlow\b/.test(l) && !/locales="en-US"/.test(l)) bad.push(`${p.slice(src.length)}:${i + 1}`); }); } };
  walk(src);
  assert.deepEqual(bad, []);
});
