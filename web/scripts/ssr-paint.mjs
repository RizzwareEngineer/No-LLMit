// Time to the first real-data paint: navigation start to the first frame in which a seated model's name (from the
// engine's own snapshot) is visible on the table (effective opacity > 0.5), on a phone profile at 4x CPU, fresh
// browser context per run. Interleaved, paired arms: A (default) and B (draft), alternating which loads first.
// node scripts/ssr-paint.mjs --a http://localhost:3301/ --b 'http://localhost:3300/?ssr=1' --runs 24 --out file.json
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const A = arg('a'), B = arg('b'), RUNS = +arg('runs', 20), OUT = arg('out'), CPU = +arg('cpu', 4), ENGINE = arg('engine', 'http://localhost:8080');

async function names() { // the seated models, from the engine's own stream
  const ac = new AbortController(); const res = await fetch(`${ENGINE}/stream`, { signal: ac.signal });
  const r = res.body.getReader(), d = new TextDecoder(); let buf = '';
  for (;;) { const { value } = await r.read(); buf += d.decode(value, { stream: true }); const i = buf.indexOf('\n\n'); if (i > 0) { ac.abort(); const m = JSON.parse(buf.slice(6, i)); return Object.values(m.payload.tables)[0].state.players.map(p => p.name); } }
}
const DETECT = (list) => {
  const t0 = performance.now(); window.__rd = null;
  const vis = e => { for (let x = e; x && x.nodeType === 1; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.5) return false; } const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight; };
  const tick = () => {
    const root = document.getElementById('table');
    if (root) for (const e of root.querySelectorAll('*')) if (!e.children.length && list.includes(e.textContent.trim()) && vis(e)) { window.__rd = performance.now(); return; }
    if (performance.now() - t0 < 20000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox'] });
const out = [];
for (let i = 0; i < RUNS; i++) {
  const list = await names();
  const pair = {};
  for (const arm of i % 2 ? ['B', 'A'] : ['A', 'B']) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    await page.emulateCPUThrottling(CPU);
    await page.evaluateOnNewDocument(`(${DETECT})(${JSON.stringify(list)})`);
    await page.goto(arm === 'A' ? A : B, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__rd !== null', { timeout: 25000 }).catch(() => {});
    pair[arm] = await page.evaluate(() => ({ rd: window.__rd, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null, ttfb: performance.getEntriesByType('navigation')[0].responseStart, bytes: performance.getEntriesByType('navigation')[0].transferSize }));
    await ctx.close();
  }
  out.push(pair);
  console.log(i, JSON.stringify(pair));
}
await browser.close();
const d = out.filter(p => p.A.rd && p.B.rd).map(p => p.B.rd - p.A.rd).sort((x, y) => x - y);
const med = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const boots = []; for (let k = 0; k < 5000; k++) { const s = d.map(() => d[Math.floor(Math.random() * d.length)]); boots.push(med(s)); }
boots.sort((x, y) => x - y);
const summary = { pairs: d.length, failed: out.length - d.length, medA: med(out.map(p => p.A.rd).filter(Boolean)), medB: med(out.map(p => p.B.rd).filter(Boolean)), medDiff: med(d), ci95: [boots[124], boots[4874]], medFcpA: med(out.map(p => p.A.fcp).filter(Boolean)), medFcpB: med(out.map(p => p.B.fcp).filter(Boolean)), medTtfbA: med(out.map(p => p.A.ttfb)), medTtfbB: med(out.map(p => p.B.ttfb)) };
console.log(JSON.stringify(summary));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, runs: out }, null, 1));
