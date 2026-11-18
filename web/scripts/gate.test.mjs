// Unit tests for the gate's pure verdict helpers: node --test scripts/gate.test.mjs (from web/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeDetail, judgeG2, redFor, pathRule, scriptKey, scriptKeys, quantile } from './gate.mjs';

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
  const j = judgeG2({ rows: { c: { pass: true } } }, { rows: { c: { pass: false, detail: det } } }, { base: 'x', entries: [{ id: 'c', detail: det }] });
  assert.deepEqual(j.fails.map(f => f.id), ['c']);
});
test('judgeG2: the union of rows; a check with a base result and none on the candidate fails (R6-5)', () => {
  const j = judgeG2({ rows: { a: { pass: true }, b: { pass: false, detail: 'x 1px' }, c: { pass: true } } }, { rows: { a: { pass: true } } }, null);
  assert.deepEqual(j.fails.map(f => [f.id, f.why]).sort(), [['b', 'no result on the candidate'], ['c', 'no result on the candidate']]);
  assert.deepEqual(judgeG2({ rows: { a: { pass: true } } }, { rows: {} }, null).fails.map(f => f.id), ['a']);
});
test('scriptKey: two builds of the same scripts give the same keys, counted per kind (R6-6, G-f)', () => {
  const a = ['/_next/static/chunks/0cz1d0mv5g_q7.js', '/_next/static/chunks/turbopack-077hmtqrhcoji.js', '/_next/static/chunks/2-k1bp-mzg57u.js', '/_next/static/chunks/app/page-0123abcd4567.js', '/_next/static/AbC123dEf456/_buildManifest.js'];
  const b = ['/_next/static/chunks/3k238r4rfnwre.js', '/_next/static/chunks/turbopack-1xx88w9gdnuid.js', '/_next/static/chunks/44v6ks018blas.js', '/_next/static/chunks/app/page-89abcdef0123.js', '/_next/static/ZZZ999yyy888/_buildManifest.js'];
  assert.deepEqual(scriptKeys(a), scriptKeys(b));
  assert.notDeepEqual(scriptKeys(a), scriptKeys(a.slice(1)), 'one script fewer still shows');
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
