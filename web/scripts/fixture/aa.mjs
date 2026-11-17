// A/A noise run: the same build served twice (arm A and arm B), measured in interleaved pairs in a random order inside each
// pair, a fresh browser per run, against one running fixture (serve.sh). Two instruments per run:
//  - Lighthouse mobile (default simulated throttling), performance only: score, LCP, TBT, FCP, SI, CLS;
//  - a 4x-CPU load trace (perf-trace.mjs's phone window, applied throttling): main-thread time and long tasks over the first
//    10 s, and first real-data paint (the frame after a seated model's name first enters the DOM).
// It reports, per metric, each arm's mean and SD, the paired difference with its 95% interval, and the runs per arm needed to
// see a 5% change (two-sided 5%, 80% power, from the paired SD).
//   node scripts/fixture/run.sh V -- node scripts/fixture/aa.mjs --a http://localhost:3301 --b http://localhost:3302 --pairs 30 --out DIR [--lighthouse PATH]
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const A = arg('--a', 'http://localhost:3301'), B = arg('--b', 'http://localhost:3302'), PAIRS = +arg('--pairs', 30), OUT = arg('--out', 'aa-out');
const LH = arg('--lighthouse', 'lighthouse'), CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const UNTIL = arg('--until', ''); // an ISO time: start no new pair after it
const NAMES = arg('--names', 'GPT-OSS,Claude,Gemma,Llama,Mistral,DeepSeek,Phi-4,Qwen,Cohere,Nemotron,GLM,Kimi').split(',');
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const ROWS = `${OUT}/runs.jsonl`;

function lighthouse(url, tag) {
  const out = `${OUT}/lh-${tag}.json`;
  execFileSync(LH, [url, '--only-categories=performance', '--output=json', `--output-path=${out}`, '--quiet',
    '--chrome-flags=--headless=new --no-sandbox'], { stdio: 'ignore', timeout: 180000, env: { ...process.env } });
  const r = JSON.parse(readFileSync(out, 'utf8'));
  const n = id => r.audits[id]?.numericValue;
  const row = { score: Math.round(r.categories.performance.score * 100), lcp: n('largest-contentful-paint'), tbt: n('total-blocking-time'),
    fcp: n('first-contentful-paint'), si: n('speed-index'), cls: n('cumulative-layout-shift'), lhBenchmark: r.environment?.benchmarkIndex };
  writeFileSync(out, JSON.stringify({ row, lcpElement: r.audits['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet }));
  return row;
}

async function trace(url) {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    const p = await b.newPage();
    await p.setViewport({ width: 412, height: 823, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    await p.evaluateOnNewDocument(names => {
      // First real-data paint: two frames after a seated model's name is first in the page (data from the stream, not a skeleton).
      const seen = () => names.some(n => document.body?.innerText?.includes(n));
      const mo = new MutationObserver(() => { if (window.__dataAt == null && seen()) { window.__dataAt = -1; requestAnimationFrame(() => requestAnimationFrame(() => { window.__dataAt = performance.now(); })); mo.disconnect(); } });
      document.addEventListener('DOMContentLoaded', () => { mo.observe(document.body, { childList: true, subtree: true, characterData: true }); if (seen() && window.__dataAt == null) { window.__dataAt = -1; requestAnimationFrame(() => requestAnimationFrame(() => { window.__dataAt = performance.now(); })); } });
    }, NAMES);
    const c = await p.createCDPSession();
    await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await p.tracing.start({ categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'loading'] });
    await p.goto(url, { waitUntil: 'load' });
    await sleep(10000);
    const dataAt = await p.evaluate(() => window.__dataAt);
    const ev = JSON.parse(Buffer.from(await p.tracing.stop()).toString('utf8')).traceEvents;
    const busy = m => ev.filter(e => e.pid === m.pid && e.tid === m.tid && e.name === 'RunTask').reduce((a, e) => a + (e.dur ?? 0), 0);
    const main = ev.filter(e => e.name === 'thread_name' && e.args.name === 'CrRendererMain').sort((x, y) => busy(y) - busy(x))[0];
    const nav = ev.filter(e => e.name === 'navigationStart' && e.pid === main.pid).at(-1)?.ts;
    if (nav == null) throw new Error('no navigationStart in the trace');
    const tasks = ev.filter(e => e.pid === main.pid && e.tid === main.tid && e.name === 'RunTask' && e.ph === 'X' && e.ts >= nav && e.ts < nav + 10e6);
    const long = tasks.filter(t => t.dur > 50000);
    return { mainMs: tasks.reduce((a, t) => a + t.dur, 0) / 1000, longTasks: long.length, blockMs: long.reduce((a, t) => a + t.dur / 1000 - 50, 0),
      dataPaint: dataAt > 0 ? dataAt : null };
  } finally { await b.close(); }
}

const done = existsSync(ROWS) ? readFileSync(ROWS, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
for (let i = done.length ? Math.max(...done.map(r => r.pair)) + 1 : 0; i < PAIRS; i++) {
  if (UNTIL && Date.now() > Date.parse(UNTIL)) { console.log('stopping at --until'); break; }
  const order = Math.random() < 0.5 ? ['A', 'B'] : ['B', 'A'];
  for (const arm of order) {
    const url = (arm === 'A' ? A : B) + '/';
    try {
      const row = { pair: i, arm, at: new Date().toISOString(), ...lighthouse(url, `${i}${arm}`), ...(await trace(url)) };
      appendFileSync(ROWS, JSON.stringify(row) + '\n'); done.push(row);
      console.log(JSON.stringify(row));
    } catch (e) { console.log(`pair ${i} ${arm} failed: ${e.message.split('\n')[0]}`); }
  }
}

// Summary over complete pairs.
const METRICS = ['score', 'lcp', 'tbt', 'fcp', 'si', 'mainMs', 'blockMs', 'longTasks', 'dataPaint'];
const T95 = n => [12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.20, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.10, 2.09, 2.09, 2.08, 2.07, 2.07, 2.06, 2.06, 2.06, 2.05, 2.05, 2.05][n - 2] ?? 2.0;
const mean = x => x.reduce((a, b) => a + b, 0) / x.length;
const sd = x => Math.sqrt(x.reduce((a, b) => a + (b - mean(x)) ** 2, 0) / (x.length - 1));
const pairs = Object.values(Object.groupBy(done, r => r.pair)).filter(g => g.length === 2).map(g => ({ A: g.find(r => r.arm === 'A'), B: g.find(r => r.arm === 'B') }));
const lines = [`pairs: ${pairs.length}`, '', '| metric | A mean (SD) | B mean (SD) | B-A mean, 95% CI | CI width, % of mean | runs/arm for 5% (paired) | runs/arm for 5% (unpaired) |', '|---|---|---|---|---|---|---|'];
const summary = {};
for (const m of METRICS) {
  const ps = pairs.filter(p => p.A[m] != null && p.B[m] != null);
  if (ps.length < 3) continue;
  const a = ps.map(p => p.A[m]), b = ps.map(p => p.B[m]), d = ps.map(p => p.B[m] - p.A[m]);
  const mu = mean([...a, ...b]), half = T95(ps.length) * sd(d) / Math.sqrt(ps.length), delta = 0.05 * Math.abs(mu);
  const nPaired = Math.ceil(7.85 * (sd(d) / delta) ** 2), nUnpaired = Math.ceil(2 * 7.85 * ((sd(a) ** 2 + sd(b) ** 2) / 2) / delta ** 2);
  summary[m] = { n: ps.length, meanA: mean(a), sdA: sd(a), meanB: mean(b), sdB: sd(b), diff: mean(d), half, widthPct: 200 * half / Math.abs(mu), nPaired, nUnpaired };
  const f = v => Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(2);
  lines.push(`| ${m} | ${f(mean(a))} (${f(sd(a))}) | ${f(mean(b))} (${f(sd(b))}) | ${f(mean(d))} [${f(mean(d) - half)}, ${f(mean(d) + half)}] | ${(200 * half / Math.abs(mu)).toFixed(1)}% | ${nPaired} | ${nUnpaired} |`);
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
writeFileSync(`${OUT}/summary.md`, lines.join('\n') + '\n');
console.log(lines.join('\n'));
