// Unit tests for the gate's pure verdict helpers: node --test scripts/gate.test.mjs (from web/)
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { srcRoot, readSrc, layoutOf, promptLinesOf } from './check-src.mjs';
import assert from 'node:assert/strict';
import { judgeDetail, judgeG2, g2Judge, countVerdict, fisherP, SETTLE_N, redFor, pathRule, scriptKey, scriptCounts, checksEnv, uaDiff, uaExtra, quantile } from './gate.mjs';

const CLIP = '50s: 191px out (#D97757 at x 1288); 3 of 228 replay frames over 2px, worst 308.1px at 47.3 s';

test('judgeDetail: a figure that grows past 15% + 2 is worse with no `better` given (R6-4)', () => {
  const j = judgeDetail([CLIP], '50s: 15000px out (#D97757 at x 1288); 40 of 228 replay frames over 2px, worst 15000.0px at 47.3 s');
  assert.equal(j.worse, true);
  assert.equal(judgeDetail(['countdown stays past its second: 5s still shown with 4s left'], 'countdown stays past its second: 9s still shown with 4s left').worse, true);
});
test('judgeDetail: the same failure within tolerance is not worse', () => {
  assert.equal(judgeDetail([CLIP], '50s: 200px out (#D97757 at x 1290); 3 of 228 replay frames over 2px, worst 300.0px at 47.1 s').worse, false);
  assert.equal(judgeDetail([CLIP], '50s: 120px out (#D97757 at x 1288); 1 of 228 replay frames over 2px, worst 150.0px at 47.3 s').worse, false);
});
test('judgeDetail: other names in the same kind of failure, fewer offenders, are not worse (G-c)', () => {
  const base = 'Llama 4 Maverick wraps at 360px; Qwen3 235B A22B wraps at 360px; Claude Haiku 5.5 wraps at 360px';
  assert.equal(judgeDetail([base], 'Mistral Large 3 wraps at 360px; Nemotron 3.5 Super wraps at 360px').worse, false);
  assert.equal(judgeDetail(['5 offenders: Llama 4 Maverick, Qwen3 235B A22B, Claude Haiku 5.5, Mistral Large 3, DeepSeek V4 Flash'], '4 offenders: Cohere Command R7B, Nemotron 3.5 Super, Llama 3.1 8B, Qwen 3.7 Flash').worse, false);
});
test('judgeDetail: a different kind of failure, or more offenders, is worse (G-c)', () => {
  assert.equal(judgeDetail(['Llama 4 Maverick wraps at 360px'], 'Llama 4 Maverick is clipped by 30px').worse, true);
  assert.equal(judgeDetail(['Llama 4 Maverick wraps at 360px'], 'Llama 4 Maverick wraps at 360px; Mistral Large 3 wraps at 360px').worse, true);
  assert.equal(judgeDetail(['x is 10px'], 'x is 3px', 'higher').worse, true);
});
test('red list: used only when frozen on this base (R6-3)', () => {
  const red = { base: 'aaa', entries: [{ id: 'c', detail: 'd' }] };
  assert.equal(redFor(red, 'aaa'), red);
  assert.equal(redFor(red, 'bbb'), null);
  assert.equal(redFor(null, 'aaa'), null);
});
test('judgeG2: green on the base and red on the candidate fails even with a red-list entry (R6-3)', () => {
  const det = 'countdown stays past its second: 5s still shown with 4s left';
  const j = judgeG2({ rows: { c: { pass: true } } }, { rows: { c: { pass: false, detail: det } } });
  assert.deepEqual(j.fails.map(f => f.id), ['c']);
});
test('judgeG2: the union of rows; a check with a base result and none on the candidate fails (R6-5)', () => {
  const j = judgeG2({ rows: { a: { pass: true }, b: { pass: false, detail: 'x 1px' }, c: { pass: true } } }, { rows: { a: { pass: true } } });
  assert.deepEqual(j.fails.map(f => [f.id, f.why]).sort(), [['b', 'no result on the candidate'], ['c', 'no result on the candidate']]);
  assert.deepEqual(judgeG2({ rows: { a: { pass: true } } }, { rows: {} }).fails.map(f => f.id), ['a']);
});
test('scriptKey: two builds of the same scripts give the same keys, counted per kind (R6-6, G-f)', () => {
  const a = ['/_next/static/chunks/0cz1d0mv5g_q7.js', '/_next/static/chunks/turbopack-077hmtqrhcoji.js', '/_next/static/chunks/2-k1bp-mzg57u.js', '/_next/static/chunks/app/page-0123abcd4567.js', '/_next/static/AbC123dEf456/_buildManifest.js'];
  const b = ['/_next/static/chunks/3k238r4rfnwre.js', '/_next/static/chunks/turbopack-1xx88w9gdnuid.js', '/_next/static/chunks/44v6ks018blas.js', '/_next/static/chunks/app/page-89abcdef0123.js', '/_next/static/ZZZ999yyy888/_buildManifest.js'];
  assert.deepEqual(scriptCounts(a), scriptCounts(b));
  assert.notDeepEqual(scriptCounts(a), scriptCounts(a.slice(1)), 'one script fewer still shows');
  assert.equal(scriptKey('/vendor/foo.js'), '/vendor/foo.js');
});
test('path rule: added pinned files pass; modified, deleted or renamed pinned files fail (G-d)', () => {
  const r = pathRule(['A\tweb/scripts/lever-measure.mjs', 'A\tweb/src/lib/lever.test.mjs', 'M\tweb/src/app/page.tsx', 'A\tweb/src/lib/x.ts'].join('\n'));
  assert.deepEqual(r.touched, []);
  assert.deepEqual(r.added, ['web/scripts/lever-measure.mjs', 'web/src/lib/lever.test.mjs']);
  const bad = pathRule(['M\tweb/scripts/checks.mjs', 'D\tweb/scripts/gate-corpus/red-list.json', 'M\tllm/app.py', 'D\tweb/src/lib/amounts.test.mjs', 'A\tweb/scripts/checks2.mjs'].join('\n'));
  assert.deepEqual(bad.touched, ['web/scripts/checks.mjs (modified)', 'web/scripts/gate-corpus/red-list.json (deleted)', 'llm/app.py (modified)', 'web/src/lib/amounts.test.mjs (deleted)']);
});
test('quantile', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([0, 10], 0.9), 9);
  assert.equal(quantile([null], 0.5), null);
});

// ---------- review 7 ----------
test('judgeDetail R7-1: honest — a faster replay with more frames and less clip is not worse', () => {
  assert.equal(judgeDetail([CLIP], '50s: 120px out (#D97757 at x 1288); 2 of 280 replay frames over 2px, worst 150.0px at 47.3 s').worse, false);
  // the worst frame later in the replay is a timestamp, not badness
  assert.equal(judgeDetail([CLIP], '50s: 120px out (#D97757 at x 1288); 2 of 280 replay frames over 2px, worst 150.0px at 58.9 s').worse, false);
});
test('judgeDetail R7-1: honest — a better fill (85% -> 100%, 24% -> 40%) is not worse', () => {
  const base = 'fill 10s 100% (recent 100%), 30s 100% (recent 100%), 50s 85% (recent 153%), rest 24% (recent 100%); axis moved in 7% of frames (7 wider, 8 narrower), worst 0.5% per frame; tips outside the plot in 0 frames';
  assert.equal(judgeDetail([base], base.replace('50s 85%', '50s 100%').replace('rest 24%', 'rest 40%')).worse, false);
});
test('judgeDetail R7-1: regressions — the 15,000 px clip, more clipped frames, a 5s -> 9s stale countdown are worse', () => {
  assert.equal(judgeDetail([CLIP], '50s: 15000px out (#D97757 at x 1288); 3 of 228 replay frames over 2px, worst 15000.0px at 47.3 s').worse, true);
  assert.equal(judgeDetail([CLIP], '50s: 191px out (#D97757 at x 1288); 40 of 280 replay frames over 2px, worst 308.1px at 47.3 s').worse, true);
  assert.equal(judgeDetail(['countdown stays past its second: 5s still shown with 4s left'], 'countdown stays past its second: 9s still shown with 4s left').worse, true);
  assert.equal(judgeDetail(['the caption shows 300 ms late'], 'the caption shows 1,900 ms late').worse, true);
  assert.equal(judgeDetail(['the clock is 1 s late'], 'the clock is 6 s late').worse, true);
});
test('judgeDetail R7-1: a countdown read at another second with the same lag is not worse; a declared direction still applies to every figure', () => {
  assert.equal(judgeDetail(['countdown stays past its second: 5s still shown with 4s left'], 'countdown stays past its second: 38s still shown with 37s left').worse, false);
  assert.equal(judgeDetail(['fill 50s 85%'], 'fill 50s 40%', 'higher').worse, true);
  assert.equal(judgeDetail(['fill 50s 85%'], 'fill 50s 40%').worse, false, 'a percentage with no declared direction is not judged');
});

// A fake arm: each call returns the next result of a fixed sequence, or draws from a seeded generator.
const rng = seed => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const DET = 'countdown stays past its second: 6s still shown with 4s left';
const arm = next => (ids) => ({ rows: Object.fromEntries(ids.map(id => { const p = next(); return [id, p === null ? { pass: false, detail: 'no result (the run ended before it)', missing: true } : { pass: p, detail: p ? '' : DET }]; })) });
const judge = async (bres, cres, base, cand, red = null) => {
  const runs = { base: arm(base), cand: arm(cand) }; let calls = 0;
  const j = await g2Judge({ bres, cres, red, run: async (a, ids) => { calls++; return runs[a](ids); } });
  return { ...j, calls };
};
const seq = xs => { let i = 0; return () => xs[i++ % xs.length]; };
const one = (pass, detail = DET) => ({ rows: { c: { pass, detail: pass ? '' : detail } } });
test('g2Judge R7-2: a candidate that always fails a base-flaky check fails, even when the cached base sample is red', async () => {
  // (a) the cached base sample red, the base flaking every other run after it
  assert.deepEqual((await judge(one(false), one(false), seq([true, false]), () => false)).fails.map(f => f.id), ['c']);
  // (b) the cached base sample green, its rerun red
  assert.deepEqual((await judge(one(true), one(false), seq([false, true]), () => false)).fails.map(f => f.id), ['c']);
});
test('g2Judge R7-2: honest — an identical build on a base-flaky check passes', async () => {
  const j = await judge(one(false), one(false), seq([true, false]), seq([true, false]));
  assert.deepEqual(j.fails, []);
});
test('g2Judge R7-2: a check red on every base sample is still judged by detail (worse fails, the same detail passes)', async () => {
  assert.deepEqual((await judge(one(false), one(false), () => false, () => false)).fails, []);
  const worse = await g2Judge({ bres: one(false), cres: one(false, 'countdown stays past its second: 12s still shown with 4s left'), red: null, run: async (a, ids) => ({ rows: { c: { pass: false, detail: a === 'base' ? DET : 'countdown stays past its second: 12s still shown with 4s left' } } }) });
  assert.deepEqual(worse.fails.map(f => f.rule), ['detail']);
});
test(`g2Judge R7-3: the settle counts fresh runs only — an identical build with flake rate 0.5 fails under 5% of settles (seeded Monte Carlo), an always-failing candidate always fails against a green base`, async () => {
  const r = rng(7); let failed = 0; const N = 1500;
  // the selection: green on the base sample, red on the candidate's (the case that started a settle)
  for (let i = 0; i < N; i++) if ((await judge(one(true), one(false), () => r() >= 0.5, () => r() >= 0.5)).fails.length) failed++;
  assert.ok(failed / N < 0.05, `identical build failed ${failed} of ${N}`);
  let caught = 0; for (let i = 0; i < 200; i++) if ((await judge(one(true), one(false), () => r() >= 0.02, () => false)).fails.length) caught++;
  assert.equal(caught, 200);
  let p25 = 0; for (let i = 0; i < 400; i++) if ((await judge(one(true), one(false), () => r() >= 0.25, () => false)).fails.length) p25++;
  assert.ok(p25 / 400 > 0.9, `always-failing candidate against a base failing 25%: caught ${p25} of 400`);
});
test('g2Judge R7-3: stopping early never changes the verdict; an always-failing candidate stops after five runs a side', () => {
  for (let cf = 0; cf <= SETTLE_N; cf++) for (let bf = 0; bf <= SETTLE_N; bf++) assert.notEqual(countVerdict(cf, SETTLE_N, bf, SETTLE_N), 'open');
  assert.equal(countVerdict(5, 5, 0, 5), 'fail', 'an always-failing candidate against a green base is decided after five runs a side');
  assert.equal(countVerdict(4, 4, 0, 4), 'open');
  assert.ok(fisherP(6, 6, 0, 6) < 0.01);
});
test('g2Judge R7-4: --all — a missing base row is unknown, not a failure: green on the base reruns and red on the candidate fails', async () => {
  const j = await judge({ rows: {} }, one(false), () => true, () => false);
  assert.deepEqual(j.fails.map(f => f.id), ['c']);
});
test('g2Judge R7-4: a missing candidate row takes its reruns like any red row: green reruns pass, red reruns fail', async () => {
  const miss = { rows: {} };
  assert.deepEqual((await judge(one(true), miss, () => true, () => true)).fails, []);
  assert.deepEqual((await judge(one(true), miss, () => true, () => null)).fails.map(f => f.id), ['c']);
});

// N hash-only chunks, and the Lighthouse agent at the laptop size loading two fewer (as the base does)
const chunks = (n, salt = 'a') => Array.from({ length: n }, (_, i) => `/_next/static/chunks/${salt}${String(i).padStart(3, '0')}x9k2m4p7q.js`);
const ld = (n, dom = ['#race-panel'], salt) => ({ scripts: scriptCounts([...chunks(n, salt), '/_next/static/chunks/turbopack-1xx88w9gdnuid.js']), dom });
test('ua R7-0: honest — a code split that adds or removes one hash-only chunk on both agents passes', () => {
  const base = uaDiff(ld(16), ld(14));
  assert.deepEqual(base, ['-script /_next/static/chunks/<h>.js x2']);
  assert.deepEqual(uaExtra(base, uaDiff(ld(17, undefined, 'b'), ld(15, undefined, 'c'))), []);
  assert.deepEqual(uaExtra(base, uaDiff(ld(15, undefined, 'b'), ld(13, undefined, 'c'))), []);
});
test('ua R7-0: regressions — an extra script, or one script fewer, only under the Lighthouse agent fails; so does a DOM mark it drops', () => {
  const base = uaDiff(ld(16), ld(14));
  assert.deepEqual(uaExtra(base, uaDiff(ld(16), ld(15))), ['-script /_next/static/chunks/<h>.js x1']);
  assert.deepEqual(uaExtra(base, uaDiff(ld(16), ld(12))), ['-script /_next/static/chunks/<h>.js x4']);
  assert.deepEqual(uaExtra(base, uaDiff(ld(16), ld(14, []))), ['-dom #race-panel']);
});

test('checks R7-5: the checks read the arm under test\'s layout.ts and systemPrompt.ts, not their own worktree\'s', () => {
  const own = layoutOf(readSrc('lib/layout.ts', {}));
  const arm = mkdtempSync(join(tmpdir(), 'arm-')); mkdirSync(join(arm, 'web/src/lib'), { recursive: true });
  const layout = readFileSync(join(srcRoot({}), 'lib/layout.ts'), 'utf8').replace(/DESK_MIN_W = \d+/, 'DESK_MIN_W = 1024');
  writeFileSync(join(arm, 'web/src/lib/layout.ts'), layout);
  const prompt = readFileSync(join(srcRoot({}), 'lib/systemPrompt.ts'), 'utf8');
  const first = Object.keys(promptLinesOf(prompt))[0];
  writeFileSync(join(arm, 'web/src/lib/systemPrompt.ts'), prompt.replace(new RegExp(`(export const ${first} = \`)`), '$1An edited line. '));
  const env = checksEnv(arm);
  assert.equal(layoutOf(readSrc('lib/layout.ts', env)).DESK_MIN_W, 1024, 'the candidate\'s moved breakpoint');
  assert.notEqual(own.DESK_MIN_W, 1024);
  assert.match(promptLinesOf(readSrc('lib/systemPrompt.ts', env))[first], /^An edited line\. /);
  assert.equal(readSrc('lib/layout.ts', {}), readFileSync(join(srcRoot({}), 'lib/layout.ts'), 'utf8'), 'run by hand: the src beside the checks');
});
