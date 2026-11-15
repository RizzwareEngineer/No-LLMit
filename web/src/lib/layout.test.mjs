// The phone/desktop switch is defined once (layout.ts) and CSS says the same (globals.css's md and max-md variants and
// every plain media query there): no 768 left anywhere in the site's code, and no width test of its own.
// Run from web/: node --experimental-strip-types --test src/lib/layout.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { DESK, PHONE } from './layout.ts';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const files = dir => readdirSync(dir).flatMap(f => { const p = `${dir}/${f}`; return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(f) ? [p] : []; });
const SRC = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

test('globals.css redefines md and max-md as layout.ts\'s DESK and PHONE', () => {
  assert.ok(css.includes(`@custom-variant md (@media ${DESK});`), 'md');
  assert.ok(css.includes(`@custom-variant max-md (@media ${PHONE});`), 'max-md');
});

test('every plain media query on the window\'s width in globals.css is DESK or PHONE', () => {
  const qs = [...css.matchAll(/^@media ([^{\n]*\bwidth\b[^{\n]*)\{/gm)].map(m => m[1].trim());
  assert.ok(qs.length > 0);
  for (const q of qs) assert.ok(q === DESK || q === PHONE, q);
});

test('no 768px breakpoint and no width test of its own in the site\'s code', () => {
  const bad = [];
  for (const f of files(SRC)) {
    if (f.endsWith('layout.ts')) continue;
    const isCss = f.endsWith('.css');
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((l, i) => {
      if (/^\s*\/\//.test(l) || (isCss && /^@(custom-variant|media)/.test(l) && (l.includes(DESK)))) return;
      if (/\b76[78]px\b|innerWidth\s*[<>]=?\s*\d|\(m(ax|in)-width:\s*\d/.test(l)) bad.push(`${f.slice(SRC.length + 1)}:${i + 1}: ${l.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(bad, []);
});
