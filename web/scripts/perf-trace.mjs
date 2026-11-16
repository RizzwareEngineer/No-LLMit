// Load-time main-thread profile: a phone-sized window (412x823 at 2.625x, as Lighthouse's mobile preset) at 4x CPU
// throttle, traced with puppeteer; prints the long tasks and the time by category, and saves the trace.
// Run: node scripts/perf-trace.mjs --base http://localhost:3300 [--path /] [--out trace.json] [--desk]
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:3300'), PATH = arg('--path', '/'), OUT = arg('--out', '/tmp/trace.json');
const desk = process.argv.includes('--desk');
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport(desk ? { width: 1350, height: 940, deviceScaleFactor: 1 } : { width: 412, height: 823, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
const c = await p.createCDPSession();
await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await p.tracing.start({ path: OUT, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink.user_timing', 'loading'] });
const t0 = Date.now();
if (process.argv.includes('--no-idle')) await p.evaluateOnNewDocument(() => { window.__noIdle = 1; });
await p.goto(BASE + PATH, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 6000));
const lcp = await p.evaluate(() => new Promise(r => new PerformanceObserver(l => { const e = l.getEntries().at(-1); r({ t: Math.round(e.startTime), el: e.element?.textContent?.slice(0, 40) }); }).observe({ type: 'largest-contentful-paint', buffered: true })));
await p.tracing.stop();
await b.close();
const ev = JSON.parse((await import('node:fs')).readFileSync(OUT, 'utf8')).traceEvents;
// The page's main thread: the renderer main thread that ran the most.
const busy = m => ev.filter(e => e.pid === m.pid && e.tid === m.tid && e.name === 'RunTask').reduce((a, e) => a + (e.dur ?? 0), 0);
const main = ev.filter(e => e.name === 'thread_name' && e.args.name === 'CrRendererMain').sort((a, b) => busy(b) - busy(a))[0];
const on = ev.filter(e => e.pid === main.pid && e.tid === main.tid && e.ph === 'X');
const nav = ev.filter(e => e.name === 'navigationStart' && e.pid === main.pid).at(-1)?.ts ?? on[0].ts;
const tasks = on.filter(e => e.name === 'RunTask' && e.dur > 50000);
const kinds = {};
for (const e of on) if (['EvaluateScript', 'v8.compile', 'FunctionCall', 'UpdateLayoutTree', 'Layout', 'Paint', 'ParseHTML', 'TimerFire', 'FireAnimationFrame', 'EventDispatch', 'RunMicrotasks', 'MajorGC', 'MinorGC'].includes(e.name)) kinds[e.name] = (kinds[e.name] ?? 0) + e.dur / 1000;
console.log('LCP', JSON.stringify(lcp));
console.log('long tasks (start ms, dur ms, top child):');
let tbt = 0;
for (const t of tasks) {
  tbt += t.dur / 1000 - 50;
  const kids = on.filter(e => e.ts >= t.ts && e.ts < t.ts + t.dur && e !== t && e.dur > 5000 && e.name !== 'RunTask').sort((a, b) => b.dur - a.dur).slice(0, 3);
  console.log(' ', Math.round((t.ts - nav) / 1000), Math.round(t.dur / 1000), kids.map(k => `${k.name}${k.args?.data?.url ? ':' + k.args.data.url.split('/').pop() : k.args?.data?.functionName ? ':' + k.args.data.functionName : ''} ${Math.round(k.dur / 1000)}`).join(', '));
}
for (const m of ev.filter(e => e.pid === main.pid && e.cat?.includes('user_timing') && e.ph !== 'e')) console.log('mark', m.name, Math.round((m.ts - nav) / 1000));
console.log('sum(long - 50ms)', Math.round(tbt));
console.log('by kind (ms):', Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v)}`).join(', '));
