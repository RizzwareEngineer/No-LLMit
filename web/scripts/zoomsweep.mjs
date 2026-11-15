// Browser-zoom sweep: loads the home page at each window size and zoom (a W x H window at zoom z is a viewport of
// round(W/z) x round(H/z) CSS px at deviceScaleFactor z), measures what zoom-tolerable asserts and saves contact sheets.
// Run: node scripts/zoomsweep.mjs --base http://localhost:3300 --out ../.cloud-out/zoom --tag before [--lanes 3]
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { measure } from './zoom-measure.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:3300'), OUT = arg('--out', '../.cloud-out/zoom'), TAG = arg('--tag', 'before');
const LANES = +arg('--lanes', 3), SHOTS = arg('--shots', '/tmp/zoomshots');
const ZOOMS = (arg('--zooms', '50,67,80,90,100,110,125,150,175,200,250,300,400,500')).split(',').map(z => +z / 100);
const WINDOWS = (arg('--windows', '1440x900,1512x982,1728x1117')).split(',');
const PHONES = (arg('--phones', '375x667,390x844,430x932,844x390')).split(',').filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(`${SHOTS}/${TAG}`, { recursive: true }); mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--mute-audio'] });
const report = [];
const jobs = [];
for (const win of WINDOWS) for (const z of ZOOMS) jobs.push({ win, z });
for (const win of PHONES) jobs.push({ win, z: 1, phone: true });

const shot = async (p, name) => { const f = `${SHOTS}/${TAG}/${name}.jpg`; await p.screenshot({ path: f, type: 'jpeg', quality: 70 }); return f; };
const scrollTo = (p, id) => p.evaluate(id => { const e = document.getElementById(id); if (e) window.scrollTo({ top: e.getBoundingClientRect().top + scrollY, behavior: 'instant' }); return !!e; }, id);

async function run({ win, z, phone }) {
  const [W, H] = win.split('x').map(Number);
  const vw = Math.round(W / z), vh = Math.round(H / z);
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  const key = `${win}@${Math.round(z * 100)}`;
  const shots = {}, rows = {};
  try {
    if (phone) await p.emulate({ viewport: { width: W, height: H, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, userAgent: await browser.userAgent() });
    else await p.setViewport({ width: vw, height: vh, deviceScaleFactor: z });
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction(() => document.querySelector('[data-seat]') && document.querySelector('#stats-panel tbody tr'), { timeout: 60000 }).catch(() => {});
    await sleep(2500);
    rows.table = await p.evaluate(measure, '');
    rows.table.tableBox = await p.evaluate(() => { const t = document.querySelector('.stage-zoom') || document.querySelector('[data-felt]') || document.getElementById('table'); if (!t) return null; const r = t.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + scrollY) }; });
    shots.table = await shot(p, `${key}-table`);
    // Stats: the overview (desktop) or the first stats window (phone layout).
    const narrow = vw < 768;
    await scrollTo(p, narrow ? 'phone-stats' : 'stats'); await sleep(1200);
    rows.stats = await p.evaluate(measure, '');
    shots.stats = await shot(p, `${key}-stats`);
    if (!narrow) {
      // Open the Profiles card.
      const c = await p.evaluate(() => { const e = document.querySelector('#stats-panel'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + Math.min(40, r.height / 2)]; });
      if (c) { await p.mouse.click(c[0], c[1]); await sleep(1600); rows.card = await p.evaluate(measure, ''); shots.card = await shot(p, `${key}-card`); await p.keyboard.press('Escape'); await sleep(900); }
    } else {
      await scrollTo(p, 'stats-table'); await sleep(1000); rows.card = await p.evaluate(measure, ''); shots.card = await shot(p, `${key}-card`);
    }
    await scrollTo(p, 'about'); await sleep(1200);
    rows.about = await p.evaluate(measure, '');
    shots.about = await shot(p, `${key}-about`);
    // The prompt dialog.
    const opened = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => /Read the system prompt/.test(b.textContent) && b.getBoundingClientRect().width > 0); b?.click(); return !!b; });
    if (opened) {
      await sleep(700);
      rows.prompt = await p.evaluate(() => { const d = document.querySelector('dialog[open]'); if (!d) return null; const r = d.getBoundingClientRect(); const sc = d.querySelector('.overflow-y-auto'); return { inside: r.top >= -1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1, t: Math.round(r.top), b: Math.round(r.bottom), h: innerHeight, scrolls: sc ? sc.scrollHeight > sc.clientHeight : false, bodyH: sc ? sc.clientHeight : 0 }; });
      shots.prompt = await shot(p, `${key}-prompt`);
      await p.keyboard.press('Escape'); await sleep(400);
    }
    // The model drawer.
    const slug = await p.evaluate(() => document.querySelector('a[href^="#model="]')?.getAttribute('href'));
    if (slug) {
      await p.evaluate(h => { location.hash = h.slice(1); }, slug); await sleep(1000);
      rows.drawer = await p.evaluate(() => { const d = document.querySelector('dialog[open]'); if (!d) return null; const r = d.getBoundingClientRect(); return { inside: r.top >= -1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1, t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), scrollH: d.scrollHeight, clientH: d.clientHeight, ov: getComputedStyle(d).overflowY }; });
      shots.drawer = await shot(p, `${key}-drawer`);
      await p.keyboard.press('Escape'); await sleep(600);
    }
    if (narrow) {
      // Seat stats popup: tap a logo on the oval.
      await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await sleep(600);
      const a = await p.evaluate(() => { const e = [...document.querySelectorAll('a[aria-haspopup=dialog]')].find(e => e.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      if (a) {
        if (phone) await p.touchscreen.tap(a[0], a[1]); else await p.mouse.click(a[0], a[1]);
        await sleep(600);
        rows.seat = await p.evaluate(() => { const d = document.querySelector('[data-seat-stats]'); if (!d) return null; const r = d.getBoundingClientRect(); return { inside: r.top >= -1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1, t: Math.round(r.top), b: Math.round(r.bottom), h: innerHeight }; });
        shots.seat = await shot(p, `${key}-seat`);
        await p.keyboard.press('Escape'); await sleep(400);
      }
      // Trends filter sheet.
      await scrollTo(p, 'race'); await sleep(900);
      const f = await p.evaluate(() => { const b = [...document.querySelectorAll('button[aria-haspopup=dialog]')].find(b => /^Filters/.test(b.textContent.trim()) && b.getBoundingClientRect().width > 0); b?.click(); return !!b; });
      if (f) {
        await sleep(700);
        rows.filters = await p.evaluate(() => { const d = document.querySelector('dialog[open]'); if (!d) return null; const r = d.getBoundingClientRect(); return { inside: r.top >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1, t: Math.round(r.top), b: Math.round(r.bottom), scrollH: d.scrollHeight, clientH: d.clientHeight }; });
        shots.filters = await shot(p, `${key}-filters`);
        await p.keyboard.press('Escape'); await sleep(400);
      }
    }
  } catch (e) { rows.error = e.message.split('\n')[0]; }
  await ctx.close().catch(() => {});
  report.push({ key, win, z, vw, vh, phone: !!phone, rows, shots });
  console.log(key, `${vw}x${vh}`, JSON.stringify(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v && (v.chromePct !== undefined ? `h${v.hscroll} c${v.chromePct}% f${v.minFont}` : v.inside !== undefined ? (v.inside ? 'in' : `OUT ${v.t}-${v.b}`) : v)]))));
}

await Promise.all(Array.from({ length: LANES }, async () => { while (jobs.length) await run(jobs.shift()); }));
report.sort((a, b) => a.win.localeCompare(b.win) || a.z - b.z);
writeFileSync(`${OUT}/${TAG}-report.json`, JSON.stringify(report, null, 1));

// Contact sheets: one per window size, a row per zoom, a column per view, each thumb 260px wide.
const COLS = ['table', 'stats', 'card', 'about', 'prompt', 'drawer', 'seat', 'filters'];
const groupsBy = {};
for (const r of report) (groupsBy[r.phone ? 'phones' : r.win] ??= []).push(r);
const sp = await browser.newPage();
for (const [name, list] of Object.entries(groupsBy)) {
  const cols = COLS.filter(c => list.some(r => r.shots[c]));
  const TW = Math.floor(1560 / cols.length);
  const html = `<body style="margin:0;font:12px sans-serif;background:#ddd;width:1600px"><table style="border-spacing:4px">${list.map(r => `<tr><td style="width:30px;writing-mode:vertical-rl">${r.key}</td>${cols.map(c => `<td style="vertical-align:top">${r.shots[c] ? `<img src="file://${r.shots[c]}" style="width:${TW - 8}px;display:block">` : ''}</td>`).join('')}</tr>`).join('')}</table></body>`;
  const hf = `${SHOTS}/${TAG}-sheet-${name}.html`; writeFileSync(hf, html);
  await sp.setViewport({ width: 1600, height: 800 });
  await sp.goto(`file://${hf}`, { waitUntil: 'load' });
  await sp.screenshot({ path: `${OUT}/${TAG}-${name}.png`, fullPage: true, type: 'png' });
  console.log('sheet', name);
}
await browser.close();
