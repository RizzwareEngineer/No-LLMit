// The site's one number format (en-US grouping everywhere). Run from web/: node --experimental-strip-types --test src/lib/format.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { grouped, signed, signedBrief } from './format.ts';

test('signedBrief picks its decimals from the rounded figure: 99.96 is +100, never +100.0', () => {
  assert.equal(signedBrief(99.94), '+99.9');
  assert.equal(signedBrief(99.96), '+100');
  assert.equal(signedBrief(-99.97), '−100');
  assert.equal(signedBrief(100.04), '+100');
  assert.equal(signedBrief(1306.2), '+1,306');
});

test('grouped and signed are en-US whatever the runtime locale', () => {
  assert.equal(grouped(2366.3, 1), '2,366.3');
  assert.equal(signed(-12345, 0), '−12,345');
});

// Every figure on the page goes through an en-US formatter: a bare toLocaleString() (or one given undefined) follows
// the visitor's browser, so a German reader saw 1.306 beside 1,306 on one chart.
test('no source file formats a number in the browser\'s locale', () => {
  const src = new URL('..', import.meta.url).pathname, bad = [];
  const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/\.toLocaleString\(\s*(\)|undefined)/.test(l) || /new Intl\.NumberFormat\(\s*(\)|undefined)/.test(l)) bad.push(`${p.slice(src.length)}:${i + 1}`); }); } };
  walk(src);
  assert.deepEqual(bad, []);
});

// PENDING: TableFelt.tsx (the phone pot) is held by the parallel seat-drafts run; its NumberFlow gets locales="en-US"
// when that run lands. Remove this entry then: the test then holds every NumberFlow.
const PENDING = new Set(['components/TableFelt.tsx']);
test('every NumberFlow names the en-US locale', () => {
  const src = new URL('..', import.meta.url).pathname, bad = [];
  const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx$/.test(f)) readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/<NumberFlow\b/.test(l) && !/locales="en-US"/.test(l) && !PENDING.has(p.slice(src.length))) bad.push(`${p.slice(src.length)}:${i + 1}`); }); } };
  walk(src);
  assert.deepEqual(bad, []);
});
