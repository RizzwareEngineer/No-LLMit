// scripts/checks.mjs --changed: an edit to a file selects the checks that guard what it draws. Run from web/:
// node --experimental-strip-types --test src/lib/checkCovers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../scripts/checks.mjs', import.meta.url), 'utf8');
const IDS = [...src.matchAll(/^(?:  await |(?:group|late|main)\(\(\) => )check\('([\w-]+)'/gm)].map(m => m[1]);
const COVERS = new Function(`return ${src.slice(src.indexOf('const COVERS = [') + 'const COVERS = '.length, src.indexOf('function changedChecks')).trim().replace(/;$/, '')}`)();
// The ids --changed adds for a changed file, or null where no row names it (then it runs every check).
const selected = f => { const rows = COVERS.filter(([file]) => file.test(f)); return rows.length ? new Set(IDS.filter(id => rows.some(([, r]) => r.test(id)))) : null; };

// fix-final #5 and #7: each file below holds what the check beside it measures, and an edit to it alone ran neither.
const GUARDS = [
  ['web/src/components/SoundToggle.tsx', 'sound-switch-name'],
  ['web/src/components/StickyBar.tsx', 'sound-switch-name'],
  ['web/src/components/CumulativeChart.tsx', 'chart-text-11'],
  ['web/src/components/StatsTable.tsx', 'phone-profiles-rows-whole'],
  ['web/src/components/StatsTable.tsx', 'phone-tables-scroll-cue'],
  ['web/src/components/StatsTable.tsx', 'preview-rows-whole'],
  ['web/src/components/StatsTable.tsx', 'no-stub-ellipsis'],
  ['web/src/components/StatsTable.tsx', 'profiles-names-fit'],
  ['web/src/components/HeadToHead.tsx', 'preview-rows-whole'],
  ['web/src/components/HeadToHead.tsx', 'no-stub-ellipsis'],
  ['web/src/components/HeadToHead.tsx', 'matchups-cells-fit'],
  ['web/src/lib/boxes.ts', 'status-boxes-remembered'],
  ['web/src/lib/boxes.ts', 'skeleton-matches'],
];
test('--changed selects the checks that guard each named file', () => {
  const miss = GUARDS.filter(([f, id]) => { assert.ok(IDS.includes(id), `no check ${id}`); const s = selected(f); return s && !s.has(id); });
  assert.deepEqual(miss, []);
});
// A check no row selects runs only when a file outside every row changes: that is fine for whole-page checks, but each
// such check is named here, so a new one has to be placed in a row (or here) on purpose.
const PAGE_WIDE = ['card-adds-after-close', 'usage-card-one-line', 'watching-counts-me', 'donate-apparent', 'zoom-tolerable', 'reconnect-unseen'];
test('every check is selected by a --changed row, or named as page-wide', () => {
  assert.deepEqual(IDS.filter(id => !PAGE_WIDE.includes(id) && !COVERS.some(([, r]) => r.test(id))), []);
});
