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
  // Review 3, finding 12: these were named page-wide, so --changed never ran them for the files they guard.
  ['web/src/components/UsageIndicator.tsx', 'usage-card-one-line'],
  ['web/src/components/UsageIndicator.tsx', 'donate-apparent'],
  ['web/src/components/UsageIndicator.tsx', 'watching-counts-me'],
  ['web/src/components/WinningsPanel.tsx', 'usage-card-one-line'],
  ['web/src/components/TypewriterText.tsx', 'reconnect-unseen'],
  ['web/src/components/ReasoningPanel.tsx', 'reconnect-unseen'],
  ['web/src/components/CumulativeChart.tsx', 'zoom-tolerable'],
  ['web/src/components/TypewriterText.tsx', 'stats-while-typing'],
  ['web/src/hooks/useGameState.ts', 'clock-after-load'],
  ['web/src/components/TableMotion.tsx', 'table-shuffle-resume'],
];
test('--changed selects the checks that guard each named file', () => {
  const miss = GUARDS.filter(([f, id]) => { assert.ok(IDS.includes(id), `no check ${id}`); const s = selected(f); return s && !s.has(id); });
  assert.deepEqual(miss, []);
});
// A check no row selects runs only when a file outside every row changes: that is fine for whole-page checks, but each
// such check is named here, so a new one has to be placed in a row (or here) on purpose.
// chunk-fail-keeps-table and early-scroll-kept guard StatsScreens.tsx and app/page.tsx, which no row names: an edit to
// either runs every check.
const PAGE_WIDE = ['card-adds-after-close', 'chunk-fail-keeps-table', 'early-scroll-kept'];
test('the page-wide checks guard only files no row names', () => {
  for (const f of ['web/src/components/StatsScreens.tsx', 'web/src/app/page.tsx']) assert.equal(selected(f), null, `${f} is named by a row`);
});
test('every check is selected by a --changed row, or named as page-wide', () => {
  assert.deepEqual(IDS.filter(id => !PAGE_WIDE.includes(id) && !COVERS.some(([, r]) => r.test(id))), []);
});

// Review 3, finding 13: an edit to a line of this script belongs to the check whose block holds it (changedChecks walks
// up to the nearest check line, or a block's end, which means every check). skeleton-matches' SKELETON sat under two
// one-line checks, so its edits ran only table-shuffle-notice-reduced.
test('an edit to SKELETON selects skeleton-matches, or every check', () => {
  const lines = src.split('\n'), CHECK = /^(?:  await |(?:group|late|main)\(\(\) => )check\('([\w-]+)'/, END = /^}\)\)?;$/;
  const at = lines.findIndex(l => l.startsWith('const SKELETON = {'));
  assert.ok(at > 0, 'no SKELETON');
  for (let n = at; !lines[n].startsWith('};'); n++) {
    let i = n; while (i >= 0 && !CHECK.test(lines[i]) && !(i < n && END.test(lines[i]))) i--;
    const id = i >= 0 && lines[i].match(CHECK)?.[1];
    assert.ok(!id || id === 'skeleton-matches', `line ${n + 1} of SKELETON selects ${id}`);
  }
});
