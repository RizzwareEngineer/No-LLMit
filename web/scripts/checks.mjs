// Headless checks for the owner's locked UI rules. Each one can fail; a failure exits non-zero.
// Run: node scripts/checks.mjs [--base http://localhost:3100] [--skip id,id] [--only id,id]
// Needs a running dev server (web) and engine. Chrome is the system install (CHROME_PATH to override).
import puppeteer from 'puppeteer-core';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:3100');
const SKIP = new Set((arg('--skip', '') || '').split(',').filter(Boolean));
const ONLY = new Set((arg('--only', '') || '').split(',').filter(Boolean));
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const want = id => !SKIP.has(id) && (!ONLY.size || ONLY.has(id));
async function check(id, rule, fn) {
  if (!want(id)) return;
  try { const { pass, detail } = await fn(); results.push({ id, rule, pass, detail }); }
  catch (e) { results.push({ id, rule, pass: false, detail: `error: ${e.message.split('\n')[0]}` }); }
}

const goto = (pg, id) => pg.evaluate(id => { const el = document.getElementById(id); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: 'instant' }); }, id);
const clickText = (pg, t) => pg.evaluate(t => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === t && e.getBoundingClientRect().width > 0); if (b) b.click(); return !!b; }, t);
// A button whose text starts with `t` (a label that carries a short form for narrow screens, e.g. "Back to overviewOverview").
const clickPrefix = (pg, t) => pg.evaluate(t => { const b = [...document.querySelectorAll('button, a')].find(e => e.textContent.trim().startsWith(t) && e.getBoundingClientRect().width > 0); if (b) b.click(); return !!b; }, t);
const clickCenter = async (pg, sel) => { const r = await pg.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, sel); if (!r) throw new Error(`no ${sel}`); await pg.mouse.click(r[0], r[1]); };
// The biggest visible chart svg on screen: the History plot.
const chartBox = pg => pg.evaluate(() => {
  const s = [...document.querySelectorAll('svg')].map(e => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ e, r }) => r.width > 300 && r.bottom > 0 && r.top < innerHeight && e.querySelectorAll('path').length > 3)
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
  return s && { w: s.r.width, h: s.r.height, x: s.r.left, y: s.r.top };
});
const hands = pg => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-sync-hand]')]
  // A hook may sit on a display:contents wrapper (no box of its own): judge it by its panel's box.
  .filter(e => (e.closest('[id]') || e).getBoundingClientRect().width > 0)
  .map(e => [e.closest('[id]')?.id || 'x', { hand: +e.dataset.syncHand, step: +(e.dataset.syncStep || 0) }])));
const replayHand = async pg => {
  const h = await pg.evaluate(() => {
    const hook = [...document.querySelectorAll('[data-sync-hand]')].find(e => e.querySelector('svg') && e.getBoundingClientRect().width > 0);
    if (hook) return +hook.dataset.syncHand;
    const t = [...document.querySelectorAll('span')].find(e => /^Hand \d/.test(e.textContent) && / of /.test(e.textContent));
    return t ? +t.textContent.match(/\d[\d,]*/)[0].replace(/,/g, '') : null;
  });
  return h;
};

// The stats cards have their data (a loaded machine can take far longer than a fixed wait).
const waitStats = p => p.waitForFunction(() => document.querySelector('#pairwise-card td[data-cell]') && document.querySelector('#stats-panel tbody tr') && document.querySelector('#race-panel svg'), { timeout: 90000 }).catch(() => {});
// A fresh page at a window size, on the screen `id` once the stats have loaded.
const pageAt = async (w, h, id = 'stats') => {
  const p = await browser.newPage(); await p.setViewport({ width: w, height: h });
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitStats(p);
  await sleep(3000); await goto(p, id); await sleep(2000);
  return p;
};
const rect = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }, sel);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--mute-audio'] });
// Never leave a headless Chrome behind: close it on a crash or Ctrl-C too.
const bail = async e => { if (e) console.error(e); try { await browser.close(); } catch {} process.exit(1); };
process.on('uncaughtException', bail); process.on('unhandledRejection', bail); process.on('SIGINT', () => bail()); process.on('SIGTERM', () => bail());
const pg = await browser.newPage();
await pg.setViewport({ width: 1440, height: 900 });
await pg.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
// A loaded machine can take longer than a fixed wait to deal the table: wait for it, then settle.
await pg.waitForFunction(() => document.querySelector('td.w-\\[200px\\]'), { timeout: 60000 }).catch(() => {});
await sleep(5000);

// --- Table screen (locked) ---
await check('seat-size', 'Seat cells stay 200x128', async () => {
  // offsetWidth/offsetHeight: the unscaled CSS size (the stage's fit-to-screen zoom is uniform on top).
  const r = await pg.evaluate(() => { const b = document.querySelector('td.w-\\[200px\\]'); return [b.offsetWidth, b.offsetHeight]; });
  return { pass: Math.abs(r[0] - 200) <= 1 && Math.abs(r[1] - 128) <= 2, detail: r.join('x') };
});
await check('table-width', 'The table stays 1000px wide', async () => {
  const w = await pg.evaluate(() => document.querySelector('table').offsetWidth);
  return { pass: Math.abs(w - 1000) <= 1, detail: `${w}px` };
});
await check('no-currency', 'No ¤ sign anywhere on the table screen', async () => {
  const n = await pg.evaluate(() => (document.body.innerText.match(/¤/g) || []).length);
  return { pass: n === 0, detail: `${n} found` };
});

// --- Table screen fit-to-screen and browser zoom (industry practice: respect browser zoom, reflow
// or scroll, never clip; a fixed-proportion canvas fits the window between a floor and a cap) ---
const FIT_FLOOR = 0.75, FIT_CAP = 1.25;
// [width, height, devicePixelRatio]: browser zoom N% of W x H is a W/N x H/N viewport at ratio N.
const FIT_SIZES = [[1280, 720, 1], [1440, 900, 1], [1728, 1117, 1], [2560, 1440, 1], [720, 450, 2], [864, 558, 2]];
const fits = [];
for (const [w, h, d] of FIT_SIZES) {
  if (!want('table-fit') && !want('table-reachable') && !want('table-no-hscroll')) break;
  const p2 = await browser.newPage(); await p2.setViewport({ width: w, height: h, deviceScaleFactor: d });
  await p2.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // Wait for the live, hydrated table: the grid with its fitted zoom, or on phones the seat list
  // (its Hand # in the status row). A dev server on a loaded machine can take a minute or more.
  const loaded = await p2.waitForFunction(() => (document.querySelector('table') && document.querySelector('.stage-zoom')?.style.zoom) || (innerWidth < 768 && /Hand #\d/.test(document.body.innerText)), { timeout: 150000 }).then(() => true, () => false);
  await sleep(2500);
  const m = await p2.evaluate(() => {
    const sec = document.querySelector('section[data-screen]'), stage = document.querySelector('.stage-zoom');
    const sr = sec.getBoundingClientRect(), sy = scrollY;
    const docH = document.documentElement.scrollHeight;
    // A clipped screen (overflow hidden/clip) reaches only its own width; a scrolling one, its scroll width.
    const reachW = ['auto', 'scroll'].includes(getComputedStyle(sec).overflowX) ? sec.scrollWidth : sec.clientWidth;
    // The pieces of the screen: header rows, the stage's boxes, the Stats button.
    const els = [...sec.children, ...stage.querySelectorAll('table, #table > *, .stage-zoom > *')].filter(e => e.getBoundingClientRect().width > 0);
    const bad = [];
    for (const e of els) {
      const r = e.getBoundingClientRect();
      const name = e.id || e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '');
      // Reachable: inside the screen's scroll width sideways, inside the page's scroll height downwards.
      if (r.left < sr.left - 1 || r.right > sr.left + reachW + 1) bad.push(`${name} x ${Math.round(r.left)}..${Math.round(r.right)}`);
      if (r.top + sy < -1 || r.bottom + sy > docH + 1) bad.push(`${name} y ${Math.round(r.top + sy)}..${Math.round(r.bottom + sy)}`);
    }
    const zoom = parseFloat(getComputedStyle(stage).zoom) || 1;
    return { zoom, phone: innerWidth < 768, bad, pageScroll: document.documentElement.scrollWidth - innerWidth, screenScroll: sec.scrollWidth - sec.clientWidth,
      tallBy: Math.round(sec.getBoundingClientRect().height - document.documentElement.clientHeight), slackW: (sec.clientWidth - stage.getBoundingClientRect().width) / sec.clientWidth,
      slackH: (document.documentElement.clientHeight - (sec.lastElementChild.getBoundingClientRect().bottom + parseFloat(getComputedStyle(sec).paddingBottom))) / document.documentElement.clientHeight };
  });
  await p2.close();
  fits.push({ size: `${w}x${h}${d > 1 ? `@${d}x` : ''}`, ...m, loaded });
}
await check('table-fit', `The table screen takes one uniform scale in [${FIT_FLOOR}, ${FIT_CAP}], fitting the window (phones: list layout at 1)`, async () => {
  const bad = [];
  for (const f of fits) {
    if (!f.loaded) { bad.push(`${f.size}: the table never loaded`); continue; }
    if (f.phone) { if (f.zoom !== 1) bad.push(`${f.size}: phone layout at ${f.zoom}`); continue; }
    if (f.zoom < FIT_FLOOR - 1e-3 || f.zoom > FIT_CAP + 1e-3) bad.push(`${f.size}: scale ${f.zoom}`);
    const floor = f.zoom <= FIT_FLOOR + 1e-3, cap = f.zoom >= FIT_CAP - 1e-3;
    // Above the floor the whole screen fits the window; between floor and cap one side is tight (it is the largest that fits).
    if (!floor && f.tallBy > 1) bad.push(`${f.size}: screen ${f.tallBy}px taller than the window at ${f.zoom}`);
    if (!floor && !cap && Math.min(f.slackW, f.slackH) > 0.02) bad.push(`${f.size}: ${f.zoom} leaves ${(Math.min(f.slackW, f.slackH) * 100).toFixed(1)}% spare`);
  }
  return { pass: fits.length > 0 && !bad.length, detail: bad.length ? bad.join(' | ') : fits.map(f => `${f.size} ${f.phone ? 'list' : f.zoom}`).join(', ') };
});
await check('table-reachable', 'Nothing on the table screen is clipped or off-screen-unreachable at any size or browser zoom', async () => {
  const bad = fits.filter(f => f.bad.length).map(f => `${f.size}: ${f.bad.slice(0, 3).join(', ')}`);
  return { pass: fits.length > 0 && !bad.length, detail: bad.length ? bad.join(' | ') : `${fits.length} sizes, all reachable` };
});
await check('table-no-hscroll', 'No sideways scroll on the page; the table screen scrolls sideways only at the floor', async () => {
  const bad = fits.filter(f => f.pageScroll > 0 || (f.screenScroll > 0 && (f.phone || f.zoom > FIT_FLOOR + 1e-3))).map(f => `${f.size}: page +${f.pageScroll}px, screen +${f.screenScroll}px at ${f.zoom}`);
  return { pass: fits.length > 0 && !bad.length, detail: bad.length ? bad.join(' | ') : fits.map(f => `${f.size}${f.screenScroll > 0 ? ' (scrolls at floor)' : ''}`).join(', ') };
});

// --- History (overview tile, then the card) ---
await goto(pg, 'stats'); await sleep(2500);
// The unit is the default metric's: bb/100 again since 2026-11-08 (owner: "the default should be bb100 not chips").
await check('history-unit-once', '"bb/100" shows once on the History tile', async () => {
  const n = await pg.evaluate(() => [...document.querySelectorAll('#race-panel *')].filter(e => e.childElementCount === 0 && e.textContent.trim() === 'bb/100' && e.getBoundingClientRect().width > 0).length);
  return { pass: n === 1, detail: `${n} times` };
});
const tile = await chartBox(pg);
const tileCard = await pg.evaluate(() => { const b = document.querySelector('#race-panel').getBoundingClientRect(); return { w: b.width, h: b.height }; });
await clickCenter(pg, '#race-panel'); await sleep(1500);
const card = await chartBox(pg);
await check('history-card-size', 'Opening History moves the tile to the middle and adds the filters; it does not balloon', async () => {
  const c = await pg.evaluate(() => { const svg = [...document.querySelectorAll('svg')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 300 && r.top < innerHeight && r.bottom > 0; }).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]; const b = svg.closest('.card-chrome').getBoundingClientRect(); const bar = [...svg.closest('.card-chrome').querySelectorAll('.flex-wrap')].find(e => e.textContent.startsWith('Metric')); return { w: b.width, h: b.height, bar: bar ? bar.getBoundingClientRect().height + 8 : 0 }; });
  // The card may add exactly its filter bar (however many rows it wraps to) and the legend (68px), plus 12px.
  const room = c.bar + 68 + 12;
  const ok = Math.abs(c.w - tileCard.w) / tileCard.w <= 0.05 && c.h - tileCard.h <= room;
  return { pass: ok, detail: `tile ${Math.round(tileCard.w)}x${Math.round(tileCard.h)} → card ${Math.round(c.w)}x${Math.round(c.h)} (allowed: same width ±5%, +${Math.round(room)}px: the filter bar and legend)` };
});
await check('history-no-stretch', 'The History chart keeps its shape from tile to card', async () => {
  const a = tile.w / tile.h, b = card.w / card.h;
  return { pass: Math.abs(a - b) / a < 0.02, detail: `tile ${a.toFixed(3)} vs card ${b.toFixed(3)}` };
});
await check('history-dead-space', 'The opened History card has at most 15% dead space', async () => {
  const ws = await pg.evaluate(() => {
    const svg = [...document.querySelectorAll('svg')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 300 && r.top < innerHeight && r.bottom > 0; }).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    const cardEl = svg.closest('.card-chrome'); const c = cardEl.getBoundingClientRect();
    let [l, t, r, bt] = [Infinity, Infinity, -Infinity, -Infinity];
    const content = [...cardEl.querySelectorAll('h2, button, svg')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2 && getComputedStyle(e).visibility !== 'hidden'; });
    for (const e of content) { const b = e.getBoundingClientRect(); l = Math.min(l, b.left); t = Math.min(t, b.top); r = Math.max(r, b.right); bt = Math.max(bt, b.bottom); }
    const pad = 16; // the card's own padding is not dead space
    return 1 - ((r - l) * (bt - t)) / ((c.width - 2 * pad) * (c.height - 2 * pad));
  });
  return { pass: ws <= 0.15, detail: `${(ws * 100).toFixed(1)}%` };
});
await check('history-filters-still', 'The plot box does not move when a filter switches', async () => {
  const a = await chartBox(pg);
  if (!(await clickText(pg, 'Top 5'))) return { pass: false, detail: 'no Top 5 button' };
  await sleep(900); const b = await chartBox(pg); await clickText(pg, 'All'); await sleep(600);
  const d = Math.max(Math.abs(a.w - b.w), Math.abs(a.h - b.h), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  return { pass: d <= 1, detail: `moved ${d.toFixed(1)}px` };
});
// Arena-style labels: pills ride the line tips (each pill carries data-tip-x, its tip's page x),
// and no column is reserved at the right; the camera keeps the leading tips still while history slides.
await check('history-pills-at-tips', 'Model labels are pills at the line tips, not a reserved column', async () => {
  const r = await pg.evaluate(() => {
    const pills = [...document.querySelectorAll('[data-pill]')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.top < innerHeight && b.bottom > 0; });
    if (!pills.length) return { n: 0 };
    const gaps = pills.map(e => e.getBoundingClientRect().left - +e.dataset.tipX);
    return { n: pills.length, worst: Math.max(...gaps.map(Math.abs)) };
  });
  return { pass: r.n > 0 && r.worst <= 28, detail: r.n ? `${r.n} pills, farthest ${r.worst.toFixed(0)}px from its tip` : 'no [data-pill] labels' };
});
await check('history-camera-follows', 'While replaying, the leading tips stay put and history slides past', async () => {
  const lead = () => pg.evaluate(() => { const xs = [...document.querySelectorAll('[data-pill]')].map(e => +e.dataset.tipX).filter(Number.isFinite); return xs.length ? Math.max(...xs) : null; });
  const firstTick = () => pg.evaluate(() => { const t = [...document.querySelectorAll('[data-x-tick]')].filter(e => e.getBoundingClientRect().width > 0).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0]; return t ? [t.textContent, t.getBoundingClientRect().left] : null; });
  const a = await lead(), ta = await firstTick(); await sleep(1500); const b = await lead(), tb = await firstTick();
  if (a == null || b == null || !ta || !tb) return { pass: false, detail: 'needs [data-pill] with data-tip-x and [data-x-tick] hooks' };
  const slid = ta[0] !== tb[0] || Math.abs(ta[1] - tb[1]) > 4;
  return { pass: Math.abs(a - b) <= 6 && slid, detail: `lead tip ${a.toFixed(0)} → ${b.toFixed(0)}, first tick ${ta[0]}@${ta[1].toFixed(0)} → ${tb[0]}@${tb[1].toFixed(0)}` };
});
// Like Arena: every line's tip is "now", so the tips share one x; and the plot is never mostly
// empty, because the window starts at the first hand until the lines reach the camera's edge.
await check('history-tips-aligned', 'All line tips sit at the same x (one shared clock, like Arena)', async () => {
  const xs = await pg.evaluate(() => [...document.querySelectorAll('[data-pill]')].filter(e => getComputedStyle(e).opacity > 0.5).map(e => +e.dataset.tipX).filter(Number.isFinite));
  if (xs.length < 2) return { pass: false, detail: `${xs.length} pills` };
  const spread = Math.max(...xs) - Math.min(...xs);
  return { pass: spread <= 6, detail: `${xs.length} tips spread over ${spread.toFixed(0)}px` };
});
await check('history-no-empty-left', 'The lines start at the plot\'s left edge (no empty band before them)', async () => {
  const r = await pg.evaluate(() => {
    const svg = [...document.querySelectorAll('svg')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 300 && b.top < innerHeight && b.bottom > 0; }).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    const xs = [...svg.querySelectorAll('[data-x-tick]')].map(t => t.getBoundingClientRect().left);
    const paths = [...svg.querySelectorAll('path')].filter(p => (p.getAttribute('stroke') || '').startsWith('#') || (p.getAttribute('stroke') || '').startsWith('rgb') ).map(p => p.getBoundingClientRect()).filter(b => b.width > 10);
    const plotLeft = Math.min(...xs, ...paths.map(b => b.left)), leftmostLine = Math.min(...paths.map(b => b.left)), right = Math.max(...paths.map(b => b.right));
    const box = svg.getBoundingClientRect();
    return { gap: (leftmostLine - box.left) / box.width, width: (right - leftmostLine) / box.width };
  });
  return { pass: r.gap <= 0.12 && r.width >= 0.5, detail: `lines start ${(r.gap * 100).toFixed(0)}% in and span ${(r.width * 100).toFixed(0)}% of the plot` };
});
// --- History overtakes (owner 2026-11-08): "the default should be bb100 not chips"; "its not as
// obvious when a given place change happens ... do we keep the y axis static the same way lmarena
// does?"; "the 'distance' between each llm is not that big and apparent"; "the y axis and x axis of
// history is not same font". bb/100 by default, a steady y axis, finer gridlines, pills with rank and
// value, and an overtake shown by a pill swap, a highlight and a crossing marker. The card is open here. ---
await check('history-default-bb100', 'History opens on bb/100; Chips is one click away', async () => {
  const r = await pg.evaluate(() => {
    const g = [...document.querySelectorAll('[role=group][aria-label=Metric]')].find(e => e.getBoundingClientRect().width > 0);
    const on = g && [...g.querySelectorAll('button')].find(b => b.getAttribute('aria-pressed') === 'true')?.textContent.trim();
    const other = g && [...g.querySelectorAll('button')].some(b => b.textContent.trim() === 'Chips');
    const title = [...document.querySelectorAll('svg text')].some(t => t.textContent.trim() === 'bb/100' && t.getBoundingClientRect().width > 0);
    return { on, other, title };
  });
  return { pass: r.on === 'bb/100' && r.other && r.title, detail: `Metric ${r.on ?? 'missing'}, Chips option ${r.other ? 'there' : 'missing'}, axis title ${r.title ? 'bb/100' : 'not bb/100'}` };
});
// One replay from the start, sampled every frame until it has ended and settled: how much of the
// plot's height the visible tips span, and how far the y axis moves per frame.
let camSamples = null;
const camRun = async () => {
  if (camSamples) return camSamples;
  await clickText(pg, 'Skip'); await sleep(300);
  if (!(await clickText(pg, 'Replay'))) throw new Error('no Replay button');
  await pg.evaluate(() => {
    const t0 = performance.now(), out = (window.__cam = []);
    const f = () => {
      const plot = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0);
      if (plot) {
        const [top, h] = plot.dataset.plot.split(',').map(Number), [y0, y1] = plot.dataset.yRange.split(',').map(Number);
        const pills = [...plot.querySelectorAll('[data-pill]')];
        const tys = pills.filter(e => +e.style.opacity > 0.5).map(e => +e.dataset.ty);
        const ticks = [...plot.querySelectorAll('[data-y-tick]')].map(e => e.textContent);
        const name = e => e.querySelector('[data-pill-name]')?.textContent;
        out.push({
          t: performance.now() - t0, y0, y1, fit: plot.dataset.yFit, fill: tys.length > 1 ? (Math.max(...tys) - Math.min(...tys)) / h : null,
          out: tys.length ? Math.max(0, top - Math.min(...tys), Math.max(...tys) - top - h) : 0, labels: ticks.join(' '), nTicks: ticks.length,
          order: pills.slice().sort((a, b) => +a.dataset.rank - +b.dataset.rank).map(name).join('|'),
          emph: pills.filter(e => e.hasAttribute('data-emph')).map(name), lineEmph: plot.querySelectorAll('path[data-emph]').length,
          markers: [...plot.querySelectorAll('[data-overtake-marker]')].map(e => e.dataset.overtakeMarker),
          swaps: pills.filter(e => e.getAnimations().some(a => a.id === 'pill-swap' && a.playState === 'running')).map(name),
          jiggle: document.getAnimations().filter(a => /shake|burst/.test(a.id)).length,
        });
      }
      if (performance.now() - t0 < 63_000) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await sleep(63_500);
  return (camSamples = await pg.evaluate(() => window.__cam));
};
const near = (ss, s) => ss.reduce((a, b) => (Math.abs(b.t - s * 1000) < Math.abs(a.t - s * 1000) ? b : a));
// A dynamic y axis (owner 2026-11-08: "its so hard to tell the true diff between each model so maybe a
// dynamic y axis will make those diffs much more apparent", pointing at Exa's chart). It replaces the
// steady axis (history-y-steady) and the one-third fill floor (history-y-fill): the axis follows the
// lines in view, narrowing as well as widening, so the pack fills the plot; it eases, never jumps.
await check('history-y-dynamic', 'The y axis follows the lines in view: it moves in the replay (widens and narrows), the visible tips span ≥60% of the plot at 10 s, 30 s, 50 s and at rest, tips never leave the plot, and it eases (≤4% of its range per 60 Hz frame)', async () => {
  const all = await camRun(), ss = all.filter(s => s.t > 1000);
  const at = [10, 30, 50].map(s => near(ss, s)), rest = all.at(-1);
  let moved = 0, wider = 0, narrower = 0, worst = 0;
  for (let i = 2; i < ss.length; i++) {
    const r = ss[i].y1 - ss[i].y0, r0 = ss[i - 1].y1 - ss[i - 1].y0, eps = r * 1e-4;
    if (Math.abs(ss[i].y0 - ss[i - 1].y0) > eps || Math.abs(ss[i].y1 - ss[i - 1].y1) > eps) moved++;
    if (r > r0 + eps) wider++;
    if (r < r0 - eps) narrower++;
    // Per 60 Hz frame: a slow frame (a loaded machine), or the one after it, may carry more motion without being a jump.
    const k = 16.7 / Math.max(16.7, ss[i].t - ss[i - 1].t, ss[i - 1].t - ss[i - 2].t);
    worst = Math.max(worst, (Math.abs(ss[i].y0 - ss[i - 1].y0) / r) * k, (Math.abs(ss[i].y1 - ss[i - 1].y1) / r) * k);
  }
  const outs = ss.filter(s => s.out > 2);
  const fills = [...at, rest].map(a => a.fill);
  const ok = ss.length > 100 && moved / ss.length >= 0.25 && wider > 0 && narrower > 0 && fills.every(f => f != null && f >= 0.6) && !outs.length && worst <= 0.04;
  const pct = f => (f == null ? 'no tips' : `${(f * 100).toFixed(0)}%`);
  return { pass: ok, detail: `fill 10s ${pct(fills[0])}, 30s ${pct(fills[1])}, 50s ${pct(fills[2])}, rest ${pct(fills[3])}; axis moved in ${((moved / (ss.length || 1)) * 100).toFixed(0)}% of frames (${wider} wider, ${narrower} narrower), worst ${(worst * 100).toFixed(1)}% per frame; tips outside the plot in ${outs.length} frames` };
});
// Gaps readable: 6–8 labelled gridlines at rest, and at least 6 through nearly all of the replay.
await check('history-y-gridlines', 'At least 6 labelled y gridlines (6–8 at rest, ≥6 in 90% of replay frames)', async () => {
  const ss = (await camRun()).filter(s => s.t > 1000);
  const ok6 = ss.filter(s => s.nTicks >= 6).length / (ss.length || 1);
  await clickText(pg, 'Skip'); await sleep(1500);
  const rest = await pg.evaluate(() => [...[...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0).querySelectorAll('[data-y-tick]')].map(e => e.textContent));
  return { pass: rest.length >= 6 && rest.length <= 8 && ok6 >= 0.9, detail: `at rest ${rest.length} [${rest.join(' ')}]; ≥6 in ${(ok6 * 100).toFixed(0)}% of replay frames` };
});
// Every pill says its rank (1, 2, … top to bottom) and its value, so the gap to its neighbour is explicit.
await check('history-pill-rank-value', 'Every History pill shows its rank (in order, top to bottom) and its current value', async () => {
  const r = await pg.evaluate(() => {
    const plot = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0);
    const pills = [...plot.querySelectorAll('[data-pill]')].filter(e => +e.style.opacity > 0.5).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return pills.map(e => [e.querySelector('[data-pill-rank]')?.textContent, e.querySelector('[data-pill-name]')?.textContent, e.querySelector('[data-pill-value]')?.textContent]);
  });
  const bad = r.filter((p, i) => p[0] !== String(i + 1) || !/^[+−]?\d[\d,]*(\.\d+)?$/.test(p[2] ?? ''));
  return { pass: r.length > 1 && !bad.length, detail: bad.length ? `bad: ${JSON.stringify(bad.slice(0, 3))}` : r.map(p => `${p[0]} ${p[1]} ${p[2]}`).join(', ') };
});
// An overtake is obvious: the two pills swap with a slide, the passer's pill and line light up while
// the rest dim, and a marker shows the crossing. One event at a time; no shake or burst (calm motion).
await check('history-overtake', 'A rank change in the replay swaps the pills (slide), highlights the passer (pill and line) and marks the crossing; one at a time, no shake', async () => {
  const ss = await camRun();
  const starts = ss.filter((s, i) => s.markers.length && s.markers[0] !== ss[i - 1]?.markers[0]);
  const full = starts.filter(e => {
    const [a] = e.markers[0].split('|');
    const w = ss.filter(s => s.t >= e.t - 50 && s.t <= e.t + 400);
    return w.some(s => s.emph.includes(a) && s.lineEmph === 1) && w.some(s => s.swaps.includes(a));
  });
  const many = ss.filter(s => s.markers.length > 1 || s.emph.length > 1).length, jiggle = ss.filter(s => s.jiggle).length;
  const changes = ss.filter((s, i) => i && s.order !== ss[i - 1].order).length;
  return { pass: full.length >= 1 && !many && !jiggle, detail: `${starts.length} overtake events in ${((ss.at(-1)?.t ?? 0) / 1000).toFixed(0)} s (${changes} rank changes), ${full.length} with swap + highlight + marker; ${many} frames with two at once, ${jiggle} with shake/burst` };
});
// One type for the chart's furniture (owner: "the y axis and x axis of history is not same font").
await check('history-type', 'History type: x and y ticks alike, axis titles alike (13px muted body sans), pills 13px (names medium, values tabular)', async () => {
  const r = await pg.evaluate(() => {
    const plot = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0);
    const svg = plot.querySelector('svg'), k = plot.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const body = getComputedStyle(document.body).fontFamily;
    const st = e => { const c = getComputedStyle(e); return { family: c.fontFamily === body ? 'body' : c.fontFamily.slice(0, 24), px: Math.round(parseFloat(c.fontSize) * k * 4) / 4, weight: c.fontWeight, color: e instanceof SVGElement ? c.fill : c.color, tab: c.fontVariantNumeric.includes('tabular-nums') }; };
    const all = sel => [...plot.querySelectorAll(sel)].map(st);
    return { y: all('[data-y-tick]'), x: all('[data-x-tick]'), titles: all('[data-axis-title]'), names: all('[data-pill-name]'), values: all('[data-pill-value]') };
  });
  const bad = [];
  const one = (role, xs, want) => {
    if (!xs.length) return bad.push(`${role}: none`);
    const keys = [...new Set(xs.map(s => JSON.stringify(s)))];
    if (keys.length > 1) bad.push(`${role}: ${keys.length} styles`);
    for (const [k, v] of Object.entries(want)) if (xs[0][k] !== v) bad.push(`${role} ${k} ${xs[0][k]} (want ${v})`);
  };
  const MUTED = 'rgba(55, 53, 47, 0.65)';
  one('ticks', [...r.y, ...r.x], { family: 'body', px: 13, color: MUTED, tab: true });
  one('axis titles', r.titles, { family: 'body', px: 13, color: MUTED });
  one('pill names', r.names, { family: 'body', px: 13, weight: '500' });
  for (const v of r.values) if (v.family !== 'body' || v.px !== 13 || !v.tab) { bad.push(`pill value ${JSON.stringify(v)}`); break; }
  const s = o => o ? `${o.family} ${o.px}px ${o.weight} ${o.color ?? ''}${o.tab ? ' tabular' : ''}` : 'none';
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `ticks ${s(r.y[0])}; titles ${s(r.titles[0])}; pill names ${s(r.names[0])}; values ${s(r.values[0])}` };
});
// Since 2026-11-08 ticks and pills are 13px (history-type, the orchestrator's type audit); the hover
// readout keeps the Profiles cells' 14px.
await check('history-number-style', 'History numbers (ticks, pills, readout) use the body sans, tabular; the readout at the Profiles cells\' 14px, ticks and pills at 13px', async () => {
  const c = await pg.evaluate(() => { const p = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0).getBoundingClientRect(); return [p.left + p.width * 0.45, p.top + p.height * 0.5]; });
  await pg.mouse.move(c[0], c[1]); await sleep(300);
  const r = await pg.evaluate(() => {
    const plot = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0);
    const svg = plot.querySelector('svg'), k = plot.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const ref = document.querySelector('#stats-panel td, #stats-card td') || document.body;
    const roles = { 'y ticks': '[data-y-tick]', 'x ticks': '[data-x-tick]', pills: '[data-pill]', readout: '[data-readout-value]' };
    return Object.entries(roles).map(([role, sel]) => {
      const es = [...plot.querySelectorAll(sel)];
      if (!es.length) return `${role}: none`;
      const bad = new Set();
      for (const e of es) {
        const cs = getComputedStyle(e), px = parseFloat(cs.fontSize) * k;
        if (cs.fontFamily !== getComputedStyle(ref).fontFamily) bad.add(`font ${cs.fontFamily.slice(0, 20)}`);
        if (!cs.fontVariantNumeric.includes('tabular-nums')) bad.add('not tabular');
        if (Math.abs(px - (role === 'readout' ? 14 : 13)) > 0.75) bad.add(`${px.toFixed(1)}px`);
      }
      return bad.size ? `${role}: ${[...bad].join(', ')}` : '';
    }).filter(Boolean);
  });
  await pg.mouse.move(5, 5);
  return { pass: !r.length, detail: r.length ? r.join('; ') : 'ticks, pills and readout: body sans, tabular; readout 14px, ticks and pills 13px on screen' };
});

// The overview tile gets its own Replay once the lines have stopped (owner 2026-11-08): hidden while
// the replay plays, it fades in after the replay ends or is skipped, restarts it, and never opens the card.
await check('history-overview-replay', 'The Trends tile shows Replay only once the replay has ended or been skipped; it is keyboard-focusable, restarts the replay and leaves the card closed', async () => {
  const p = await pageAt(1440, 900, 'race');
  try {
    const btn = () => p.evaluate(() => { const b = document.querySelector('#race-panel [data-tile-replay]'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: r.width, o: +getComputedStyle(b).opacity, x: r.left + r.width / 2, y: r.top + r.height / 2, tab: b.tabIndex, hidden: !!b.closest('[aria-hidden=true]') }; });
    const cardOpen = () => p.evaluate(() => [...document.querySelectorAll('[role=group][aria-label=Metric]')].some(e => e.getBoundingClientRect().width > 0));
    const clock = () => p.evaluate(() => { const c = document.querySelector('#race-panel [data-race-clock]'); return c && c.getBoundingClientRect().width > 0 ? +c.querySelector('b').textContent.replace(/,/g, '') : null; });
    await p.waitForFunction(() => document.querySelector('#race-panel [data-race-clock]'), { timeout: 15000 }).catch(() => {});
    const playing = [];
    for (let i = 0; i < 3; i++) { playing.push(await btn()); await sleep(400); }
    const shownWhilePlaying = playing.some(b => b && b.w > 0 && b.o > 0.05);
    // Skip from the card, then back to the overview.
    await clickCenter(p, '#race-panel'); await sleep(1500);
    const skipped = await clickText(p, 'Skip'); await sleep(300);
    await clickPrefix(p, 'Back to overview'); await sleep(2500);
    const after = await btn();
    if (!after || after.w === 0) return { pass: false, detail: `${shownWhilePlaying ? 'shown while playing; ' : ''}no tile Replay after ${skipped ? 'Skip' : 'the replay'} ([data-tile-replay])` };
    const focusable = after.tab >= 0 && !after.hidden && await p.evaluate(() => { const b = document.querySelector('#race-panel [data-tile-replay]'); b.focus(); return document.activeElement === b; });
    const hand0 = await clock();
    await p.mouse.click(after.x, after.y); await sleep(1200);
    const hand1 = await clock(), opened = await cardOpen(), gone = await btn();
    const restarted = hand0 == null && hand1 != null;
    const ok = !shownWhilePlaying && after.o > 0.95 && focusable && restarted && !opened && !(gone && gone.w > 0 && gone.o > 0.05);
    return { pass: ok, detail: `while playing ${shownWhilePlaying ? 'shown' : 'hidden'}; after Skip opacity ${after.o.toFixed(2)}, ${focusable ? 'focusable' : 'not focusable'}; click: ${restarted ? `replay restarted (hand ${hand1})` : 'replay did not restart'}, card ${opened ? 'opened' : 'stayed closed'}, button ${gone && gone.w > 0 && gone.o > 0.05 ? 'still shown' : 'hidden'}` };
  } finally { await p.close(); }
});

await check('replay-no-reset', 'The replay never restarts on open, back or scroll', async () => {
  const playing = await pg.evaluate(() => [...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Skip' && e.getBoundingClientRect().width > 0));
  if (!playing && !(await clickText(pg, 'Replay'))) return { pass: false, detail: 'neither Skip nor Replay shown' };
  await sleep(2000); const h1 = await replayHand(pg);
  await clickPrefix(pg, 'Back to overview'); await sleep(1500); const h2 = await replayHand(pg);
  await goto(pg, 'race'); await sleep(1500); const h3 = await replayHand(pg);
  return { pass: h1 != null && h2 != null && h3 != null && h1 <= h2 && h2 <= h3 && h3 > h1, detail: `${h1} → ${h2} → ${h3}` };
});

// --- Time sync (the replay is running from the check above) ---
await check('sync-in-step', 'While History replays, Profiles and Matchups stay within one step of its hand', async () => {
  await goto(pg, 'stats'); await sleep(1200);
  const h = await hands(pg);
  const race = h['race-panel'], prof = h['stats-panel'], mu = h['pairwise-panel'];
  if (!race || !prof || !mu) return { pass: false, detail: `hooks missing: ${JSON.stringify(h)}` };
  const step = prof.step || 25;
  const ok = race.hand - prof.hand >= 0 && race.hand - prof.hand <= step && Math.abs(race.hand - mu.hand) <= 1;
  return { pass: ok, detail: `history ${race.hand}, profiles ${prof.hand} (step ${step}), matchups ${mu.hand}` };
});

// While the replay steps Profiles through its snapshots, rows never sit on top of each other. Rows
// now slide to a new place (each cell's content moves; Chrome ignores transforms on a table row), and
// two rows that swap cross mid-slide by design: the rule is judged on rows at rest.
// Each row's name (the content that moves) and its offset from the row's top; rows without one (dash rows) are left out.
const nameOffsets = () => [...document.querySelectorAll('#stats-card tbody tr')].map(r => { const s = r.querySelector('th > span.inline-block'); return s ? { o: s.getBoundingClientRect().top - r.getBoundingClientRect().top, b: s.getBoundingClientRect() } : null; }).filter(Boolean);
await check('profiles-rows-no-overlap', 'During the replay, no two Profiles rows overlap (rows at rest)', async () => {
  await goto(pg, 'race'); await sleep(800); // Skip and Replay live on the History card
  const playing = () => pg.evaluate(() => [...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Skip' && e.getBoundingClientRect().width > 0));
  if (!(await playing()) && !(await clickText(pg, 'Replay'))) return { pass: false, detail: 'neither Skip nor Replay shown' };
  await sleep(500); await goto(pg, 'stats-table'); await sleep(600);
  let worst = 0, samples = 0;
  for (let i = 0; i < 16; i++) {
    const o = await pg.evaluate(src => {
      const rows = (0, eval)(src)();
      if (!rows.length) return null;
      const rest = Math.min(...rows.map(r => r.o));
      if (rows.some(r => Math.abs(r.o - rest) > 3)) return 'moving';
      let w = 0;
      for (let a = 0; a < rows.length; a++) for (let b = a + 1; b < rows.length; b++) w = Math.max(w, Math.min(rows[a].b.bottom, rows[b].b.bottom) - Math.max(rows[a].b.top, rows[b].b.top));
      return w;
    }, `(${nameOffsets})`);
    if (typeof o === 'number') { samples++; worst = Math.max(worst, o); }
    await sleep(250);
  }
  return { pass: samples > 0 && worst <= 2, detail: samples ? `worst overlap ${worst.toFixed(1)}px over ${samples} samples at rest` : 'no rows at rest found' };
});

// Owner, 2026-11-07: "the animation that you use to switch rows in profits and losses, I want that same
// animation for profiles". While the replay reorders Profiles, a row's content is seen mid-slide.
await check('profiles-rows-slide', 'When the replay reorders Profiles, rows slide to their new place (not snap)', async () => {
  await goto(pg, 'stats-table'); await sleep(300);
  const r = await pg.evaluate(src => new Promise(res => {
    const read = (0, eval)(src);
    const t0 = performance.now(); let mid = 0, frames = 0, order = null, reorders = 0;
    const loop = () => {
      frames++;
      const rows = read();
      const names = [...document.querySelectorAll('#stats-card tbody tr th')].map(e => e.textContent).join('|');
      if (order !== null && names !== order) reorders++;
      order = names;
      if (rows.length) { const rest = Math.min(...rows.map(x => x.o)); if (rows.some(x => x.o - rest > 4)) mid++; }
      if (performance.now() - t0 < 9000 && (mid < 3 || !reorders)) requestAnimationFrame(loop); else res({ mid, frames, reorders });
    };
    requestAnimationFrame(loop);
  }), `(${nameOffsets})`);
  return { pass: r.mid >= 3 && r.reorders > 0, detail: `${r.reorders} reorders, ${r.mid} frames with a row mid-slide (of ${r.frames})` };
});

// Owner, 2026-11-07: "I still see the cells jiggle a bit when a number changes". A changed Matchups
// cell only changes colour and figure: every cell stays exactly in its grid slot, at its size.
await check('matchups-cells-still', 'Matchups cells never move or scale when a value changes', async () => {
  await goto(pg, 'stats'); await sleep(800);
  const r = await pg.evaluate(() => new Promise(res => {
    const sel = '#pairwise-panel [data-cell]';
    const box = c => c.getBoundingClientRect();
    const first = [...document.querySelectorAll(sel)];
    const xs = new Set(first.map(c => Math.round(box(c).left * 2) / 2)), ys = new Set(first.map(c => Math.round(box(c).top * 2) / 2));
    const size = new Map(first.map(c => [c.dataset.cell, [box(c).width, box(c).height]]));
    const text0 = new Map(first.map(c => [c.dataset.cell, c.textContent]));
    const near = (set, v) => [...set].some(x => Math.abs(x - v) <= 0.5);
    let worst = 0, off = 0, changed = 0; const t0 = performance.now();
    const loop = () => {
      for (const c of document.querySelectorAll(sel)) {
        const b = box(c), s = size.get(c.dataset.cell);
        if (!near(xs, b.left) || !near(ys, b.top)) off++;
        if (s) worst = Math.max(worst, Math.abs(b.width - s[0]), Math.abs(b.height - s[1]));
        if (text0.has(c.dataset.cell) && text0.get(c.dataset.cell) !== c.textContent) { changed++; text0.set(c.dataset.cell, c.textContent); }
      }
      if (performance.now() - t0 < 4000) requestAnimationFrame(loop); else res({ worst, off, changed });
    };
    requestAnimationFrame(loop);
  }));
  return { pass: r.changed > 0 && r.off === 0 && r.worst <= 0.5, detail: r.changed ? `${r.changed} value changes; ${r.off} cell frames off their grid slot, worst size change ${r.worst.toFixed(1)}px` : 'no value changed in 4s (is the replay running?)' };
});

// Owner, 2026-11-07: "History ... pretty smooth. For profiles, it's not as smooth" (the tile's text
// shrank to ~45% on the first frame of the glide and grew back, as the card's table replaced it scaled
// down), and the card took over from the gliding tile with a jump in size. While a tile glides to its
// card, Profiles' figures stay at their size, and the card takes over exactly where the tile ends.
await check('glide-smooth', 'Opening Profiles and Matchups: no jump at the hand-over, Profiles text never shrinks', async () => {
  const bad = [], seen = [];
  for (const [tile, card, id] of [['#stats-panel', '#stats-card', 'stats-table'], ['#pairwise-panel', '#pairwise-card', 'pairwise']]) {
    await goto(pg, 'stats'); await sleep(1500);
    const pt = await pg.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return [b.left + b.width / 2, b.top + 20]; }, tile);
    const run = pg.evaluate(([tile, card]) => new Promise(res => {
      const y0 = scrollY, out = []; const t0 = performance.now();
      const loop = () => {
        const on = scrollY === y0;
        const el = on ? document.querySelector(tile) : document.querySelector(`${card} .card-chrome`);
        const b = el.getBoundingClientRect();
        // A figure's drawn text height (a Range over its text, so every transform above it counts).
        const td = [...el.querySelectorAll('tbody td')].find(e => /^\d/.test(e.textContent.trim()));
        const text = td && [...td.querySelectorAll('*'), td].flatMap(e => [...e.childNodes]).find(n => n.nodeType === 3 && /\d/.test(n.textContent));
        let s = 0; if (text) { const r = document.createRange(); r.selectNodeContents(text); s = r.getBoundingClientRect().height; }
        out.push({ on, b: [b.left, b.top, b.right, b.bottom], s });
        if (performance.now() - t0 < 1200) requestAnimationFrame(loop); else res(out);
      };
      requestAnimationFrame(loop);
    }), [tile, card]);
    await pg.mouse.click(pt[0], pt[1]);
    const f = await run;
    const i = f.findIndex(x => !x.on);
    if (i < 1) { bad.push(`${id}: never reached its card`); continue; }
    const jump = Math.max(...f[i].b.map((v, k) => Math.abs(v - f[i - 1].b[k])));
    const rest = f.at(-1).s || 1; // the text's height once the card has landed
    const lo = Math.min(...f.map(x => x.s / rest)), hi = Math.max(...f.map(x => x.s / rest));
    seen.push(`${id} hand-over ${jump.toFixed(1)}px${id === 'stats-table' ? `, text ×${lo.toFixed(2)}–${hi.toFixed(2)}` : ''}`);
    if (jump > 2) bad.push(`${id}: the card takes over ${jump.toFixed(0)}px off the tile`);
    if (id === 'stats-table' && (lo < 0.85 || hi > 1.15)) bad.push(`Profiles text drawn at ×${lo.toFixed(2)}–${hi.toFixed(2)} of its size mid-glide`);
    await clickPrefix(pg, 'Back to overview'); await sleep(1200);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
});

// --- Matchups and Profiles opened ---
await check('matchups-no-fade', 'Opening Matchups grows the matrix without fading it', async () => {
  await goto(pg, 'stats'); await sleep(1500);
  const box = await pg.evaluate(() => { const b = document.querySelector('#pairwise-panel').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
  await pg.mouse.click(box[0], box[1]);
  let min = 1;
  for (let i = 0; i < 14; i++) {
    await sleep(50);
    const o = await pg.evaluate(() => {
      const op = e => { let v = 1; for (; e; e = e.parentElement) v *= +getComputedStyle(e).opacity; return v; };
      const ts = [...document.querySelectorAll('table')].filter(t => { const b = t.getBoundingClientRect(); return b.width > 200 && b.top < innerHeight && b.bottom > 0 && b.left < innerWidth && b.right > 0; });
      return ts.length ? Math.max(...ts.map(op)) : 1;
    });
    min = Math.min(min, o);
  }
  return { pass: min >= 0.95, detail: `lowest matrix opacity ${min.toFixed(2)}` };
});
// Every matrix cell is a square, on the overview tile and in the card (the matrix grows uniformly, never stretched).
await check('matchups-square-cells', 'Matchups cells are squares on the tile and in the card', async () => {
  const ratio = sel => pg.evaluate(sel => {
    const c = [...document.querySelectorAll(`${sel} td[data-cell]`)].map(e => e.getBoundingClientRect()).filter(r => r.width > 4 && r.height > 4);
    return c.length ? Math.max(...c.map(r => Math.max(r.width / r.height, r.height / r.width))) : 0;
  }, sel);
  await goto(pg, 'stats'); await sleep(1500); const tile = await ratio('#pairwise-panel');
  await goto(pg, 'pairwise'); await sleep(1500); const card = await ratio('#pairwise-card');
  return { pass: tile > 0 && card > 0 && tile <= 1.05 && card <= 1.05, detail: `tile ${tile.toFixed(3)}:1, card ${card.toFixed(3)}:1` };
});
await check('profiles-table-only', 'Opened Profiles shows the table only', async () => {
  await goto(pg, 'stats-table'); await sleep(1500);
  const t = await pg.evaluate(() => { const s = document.getElementById('stats-table'); const b = s.getBoundingClientRect(); return `${s.innerText}\n${[...document.querySelectorAll('.card-chrome')].filter(c => { const r = c.getBoundingClientRect(); return r.top >= -2 && r.top < innerHeight / 2 && r.width > 900; }).map(c => c.innerText).join('\n')}`; });
  const bad = ['with its 95% interval', '±'].filter(s => t.includes(s));
  return { pass: bad.length === 0, detail: bad.length ? `found ${bad.join(', ')}` : 'ok' };
});

// A detail screen shows its own card alone: no other card peeking out behind or beside it.
await check('detail-alone', 'An opened card is the only card visible (no card peeking out behind it)', async () => {
  const bad = [];
  for (const id of ['race', 'stats-table', 'pairwise']) {
    await goto(pg, id); await sleep(1500);
    const n = await pg.evaluate(() => [...document.querySelectorAll('.card-chrome')].filter(c => {
      const r = c.getBoundingClientRect(); if (r.width < 40 || r.height < 40) return false;
      const vis = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 44)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
      let o = 1; for (let e = c; e; e = e.parentElement) o *= +getComputedStyle(e).opacity;
      return vis > 400 && o > 0.05;
    }).length);
    if (n > 1) bad.push(`${id}: ${n} cards visible`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join(', ') : 'each opened card is alone' };
});
// The Matchups tile is a readable preview: its cells show numbers.
await check('matchups-tile-numbers', 'The Matchups tile shows a number in its cells', async () => {
  await goto(pg, 'stats'); await sleep(1500);
  const r = await pg.evaluate(() => { const cells = [...document.querySelectorAll('#pairwise-panel td')].filter(c => c.getBoundingClientRect().width > 4); const withNum = cells.filter(c => /[0-9]/.test(c.textContent)); const fs = withNum.length ? parseFloat(getComputedStyle(withNum[0]).fontSize) : 0; return { cells: cells.length, withNum: withNum.length, fs }; });
  return { pass: r.withNum >= r.cells * 0.5 && r.fs >= 10, detail: `${r.withNum}/${r.cells} cells with numbers, ${r.fs}px text` };
});

// Owner's rules from 2026-11-07: Profiles leads with Hands (no bb/100, no rank spread); no scope line,
// session picker or Bars view on the cards; Matchups gets the wider tile; tiles never scroll.
await check('profiles-columns', 'Profiles columns are Model, Hands, VPIP, PFR, AF (tile), then the trend (card)', async () => {
  const heads = sel => pg.evaluate(sel => [...document.querySelectorAll(`${sel} thead th`)].map(e => e.textContent.trim()).filter(Boolean), sel);
  await goto(pg, 'stats'); await sleep(1500); const tile = (await heads('#stats-panel')).join(',');
  // A card header also holds its tooltip's text: judge it by how it starts.
  await goto(pg, 'stats-table'); await sleep(1500); const card = (await heads('#stats-card')).map(h => ['Model', 'Hands', 'VPIP', 'PFR', 'AF', 'Last 50 hands', 'bb/100', 'Rank spread'].find(l => h.startsWith(l)) ?? h.slice(0, 12)).join(',');
  return { pass: tile === 'Model,Hands,VPIP,PFR,AF' && card === 'Model,Hands,VPIP,PFR,AF,Last 50 hands', detail: `tile ${tile} | card ${card}` };
});
// The Profiles tile names its models (truncated if need be) at every overview size, not logos alone.
await check('profiles-tile-names', 'The Profiles tile shows model names at 1440x900 and 1728x1117', async () => {
  const bad = [];
  for (const [w, h] of [[1440, 900], [1728, 1117]]) {
    const p2 = await browser.newPage(); await p2.setViewport({ width: w, height: h });
    await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p2.waitForFunction(() => document.querySelectorAll('#stats-panel tbody tr').length > 3, { timeout: 120000 });
    await goto(p2, 'stats'); await sleep(1500);
    const n = await p2.evaluate(() => [...document.querySelectorAll('#stats-panel tbody th span[translate=no]')].filter(e => e.getBoundingClientRect().width > 30).length);
    await p2.close();
    if (n < 5) bad.push(`${w}x${h}: ${n} names visible`);
  }
  return { pass: !bad.length, detail: bad.join(', ') || 'names visible at both sizes' };
});
await check('cards-no-scope', 'No hands/all time/blinds line, Session picker or Bars view on Profiles and Matchups', async () => {
  const bad = [];
  for (const [id, card] of [['stats-table', '#stats-card'], ['pairwise', '#pairwise-card']]) {
    await goto(pg, id); await sleep(1500);
    const r = await pg.evaluate(c => { const e = document.querySelector(c); return { t: e.innerText, sel: !!e.querySelector('select'), bars: [...e.querySelectorAll('button')].some(b => b.textContent.trim() === 'Bars') }; }, card);
    if (/blinds \d|all time ·|Rank spread/.test(r.t)) bad.push(`${id}: scope text`);
    if (r.sel) bad.push(`${id}: session picker`);
    if (r.bars) bad.push(`${id}: Bars view`);
  }
  return { pass: !bad.length, detail: bad.join(', ') || 'none' };
});
// Was "Matchups is wider than Profiles", then "at least comparable" (70% of Profiles' area). Owner, 2026-11-08:
// "matchups should be the bigger square compared to profiles. right now the numbers are too dense". At the
// three common laptop windows the Matchups tile is wider and larger than Profiles (History still leads:
// overview-history-leads). Reports History's share of the overview's tile area.
await check('matchups-bigger', 'On the overview the Matchups tile is wider and larger than Profiles at 1440x900, 1512x982 and 1728x1117', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1512, 982], [1728, 1117]]) {
    const p = await pageAt(w, h);
    const [race, prof, mu] = await Promise.all(['#race-panel', '#stats-panel', '#pairwise-panel'].map(s => rect(p, s)));
    await p.close();
    const area = b => b.w * b.h;
    seen.push(`${w}x${h}: Matchups ${mu.w.toFixed(0)}x${mu.h.toFixed(0)} vs Profiles ${prof.w.toFixed(0)}x${prof.h.toFixed(0)} (${(area(mu) / area(prof)).toFixed(2)}x), History ${(area(race) / (area(race) + area(prof) + area(mu)) * 100).toFixed(0)}% of the area`);
    if (!(mu.w > prof.w && area(mu) > area(prof))) bad.push(`${w}x${h}: Matchups ${mu.w.toFixed(0)}x${mu.h.toFixed(0)} is not bigger than Profiles ${prof.w.toFixed(0)}x${prof.h.toFixed(0)}`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
});
// The same instruction: the tile's figures are not dense. Each cell is at least MIN px a side (td box),
// every figure sits at the tile's one size with at least 2px clear on each side (shortened to +1.1k when
// it would not), and no cell with a matchup is left without its figure.
await check('matchups-cells-roomy', 'Matchups tile cells are at least 32px (1440x900) / 40px (1728x1117), one figure size, never edge to edge or blank', async () => {
  const bad = [], seen = [];
  for (const [w, h, min] of [[1440, 900, 32], [1728, 1117, 40]]) {
    const p = await pageAt(w, h);
    // Skip the replay: the final figures are the widest.
    await goto(p, 'race'); await sleep(800); await clickText(p, 'Skip'); await sleep(800); await goto(p, 'stats'); await sleep(1500);
    const r = await p.evaluate(() => {
      const cells = [...document.querySelectorAll('#pairwise-panel td[data-cell]')].map(td => {
        const b = td.getBoundingClientRect(), fig = td.querySelector('[aria-hidden]');
        let tw = 0; if (fig && fig.textContent) { const g = document.createRange(); g.selectNodeContents(fig); tw = g.getBoundingClientRect().width; }
        return { w: b.width, h: b.height, tw, text: fig?.textContent ?? null, size: fig ? getComputedStyle(fig).fontSize : null };
      });
      const totals = [...document.querySelectorAll('#pairwise-panel div[data-cell] [aria-hidden]')].map(e => getComputedStyle(e).fontSize);
      return { cells, totals };
    });
    await p.close();
    const fig = r.cells.filter(c => c.text !== null);
    const side = Math.min(...r.cells.map(c => Math.min(c.w, c.h)));
    const tight = fig.filter(c => c.text && (c.w - c.tw) / 2 < 2);
    const blank = fig.filter(c => !c.text);
    const sizes = new Set([...fig.map(c => c.size), ...r.totals]);
    seen.push(`${w}x${h}: cells ${side.toFixed(1)}px, figures ${[...sizes].join('/')}, least clearance ${Math.min(...fig.filter(c => c.text).map(c => (c.w - c.tw) / 2)).toFixed(1)}px`);
    if (!r.cells.length) bad.push(`${w}x${h}: no cells`);
    if (side < min) bad.push(`${w}x${h}: cells ${side.toFixed(1)}px (< ${min})`);
    if (sizes.size !== 1) bad.push(`${w}x${h}: figure sizes ${[...sizes].join(', ')}`);
    if (tight.length) bad.push(`${w}x${h}: ${tight.length} figures edge to edge (${tight.slice(0, 3).map(c => c.text).join(', ')})`);
    if (blank.length) bad.push(`${w}x${h}: ${blank.length} matchups without a figure`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
});
// The Matchups tile is its names, its square and its totals, edge to edge: no empty band beside them.
await check('matchups-tile-filled', 'The Matchups matrix and its names fill the tile (no empty space beside them)', async () => {
  await goto(pg, 'stats'); await sleep(1200);
  const r = await pg.evaluate(() => {
    const t = document.querySelector('#pairwise-panel').getBoundingClientRect();
    const cells = [...document.querySelectorAll('#pairwise-panel td, #pairwise-panel a, #pairwise-panel th, #pairwise-panel div[data-cell]')].map(e => e.getBoundingClientRect()).filter(b => b.width > 2 && b.height > 2);
    const l = Math.min(...cells.map(b => b.left)), rt = Math.max(...cells.map(b => b.right));
    const names = [...document.querySelectorAll('#pairwise-panel a span')].map(e => e.getBoundingClientRect()).filter(b => b.width > 2);
    return { span: (rt - l) / (t.width - 32), nameLeft: names.length ? (Math.min(...names.map(b => b.left)) - t.left - 16) / (t.width - 32) : 1 };
  });
  return { pass: r.span >= 0.95 && r.nameLeft <= 0.12, detail: `matrix and names span ${(r.span * 100).toFixed(0)}% of the tile, longest name starts ${(r.nameLeft * 100).toFixed(0)}% in` };
});
await check('tiles-no-scroll', 'Overview tiles never scroll (no scrollbar on a preview)', async () => {
  const bad = await pg.evaluate(() => ['#stats-panel', '#pairwise-panel', '#race-panel'].flatMap(s => [...document.querySelectorAll(`${s} *`)].filter(e => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)).map(() => s)));
  return { pass: !bad.length, detail: bad.length ? `scrollable inside ${[...new Set(bad)].join(', ')}` : 'none' };
});

// Owner, 2026-11-07: the overview was "too big"; "the history graph should be the 'biggest' one ...
// the first thing that people look at"; not wall-to-wall. At 1440x900 and 1728x1117: History on top and
// the largest tile (1.5x the area of each other tile, and the tallest row), the block at most 1400px wide
// and 80% of the window, with page around it (64px at the sides, 24px below; 16px above since 2026-11-08,
// when a short window gave its top margin to the "About ↓" band so Matchups' cells keep 32px).
// Then the opened Matchups card ("so much white space to the left"; "takes up too much of the screen"):
// it hugs names, matrix and totals (no band over 8px between its edge and its content) and leaves
// page around it (at most 70% of the window's width and 85% of its height).
await check('overview-history-leads', 'History is the dominant tile, first in reading order; the overview keeps page around it', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1728, 1117]]) {
    const p = await pageAt(w, h);
    const [race, prof, mu] = await Promise.all(['#race-panel', '#stats-panel', '#pairwise-panel'].map(s => rect(p, s)));
    await p.close();
    const area = b => b.w * b.h;
    const left = race.l, right = w - Math.max(race.r, mu.r), top = race.t - 44, bottom = h - Math.max(prof.b, mu.b), width = Math.max(race.r, mu.r) - race.l;
    seen.push(`${w}x${h}: History ${race.w.toFixed(0)}x${race.h.toFixed(0)}, Profiles ${prof.w.toFixed(0)}x${prof.h.toFixed(0)}, Matchups ${mu.w.toFixed(0)}x${mu.h.toFixed(0)}, block ${width.toFixed(0)}px, page ${left.toFixed(0)}/${right.toFixed(0)} beside, ${top.toFixed(0)}/${bottom.toFixed(0)} above/below`);
    if (!(race.b <= Math.min(prof.t, mu.t))) bad.push(`${w}x${h}: History is not on top`);
    if (area(race) < 1.5 * Math.max(area(prof), area(mu))) bad.push(`${w}x${h}: History ${(area(race) / Math.max(area(prof), area(mu))).toFixed(2)}x the next tile's area`);
    if (race.h <= Math.max(prof.h, mu.h)) bad.push(`${w}x${h}: History's row is not the tallest`);
    if (width > 1400 || width > 0.8 * w) bad.push(`${w}x${h}: block ${width.toFixed(0)}px wide`);
    if (left < 64 || right < 64 || top < 16 || bottom < 24) bad.push(`${w}x${h}: page around the block ${left.toFixed(0)}/${right.toFixed(0)}/${top.toFixed(0)}/${bottom.toFixed(0)}px`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
});
await check('matchups-card-hugs', 'The opened Matchups card hugs its names, matrix and totals, and leaves page around it', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1728, 1117]]) {
    const p = await pageAt(w, h, 'pairwise');
    const r = await p.evaluate(() => {
      const card = document.querySelector('#pairwise-card .card-chrome'), c = card.getBoundingClientRect();
      const names = [...card.querySelectorAll('a span')].map(e => e.getBoundingClientRect()).filter(b => b.width > 2);
      const right = [...card.querySelectorAll('div[data-cell], td[data-cell]')].map(e => e.getBoundingClientRect().right);
      return { c: { l: c.left, t: c.top, w: c.width, h: c.height }, gapL: Math.min(...names.map(b => b.left)) - (c.left + 16), gapR: c.right - 16 - Math.max(...right) };
    });
    await p.close();
    seen.push(`${w}x${h}: card ${r.c.w.toFixed(0)}x${r.c.h.toFixed(0)}, bands ${r.gapL.toFixed(0)}/${r.gapR.toFixed(0)}px`);
    if (r.gapL > 8 || r.gapR > 8) bad.push(`${w}x${h}: empty band beside the matrix (${r.gapL.toFixed(0)}px left, ${r.gapR.toFixed(0)}px right)`);
    if (r.c.w > 0.7 * w || r.c.h > 0.85 * h || r.c.l < 64) bad.push(`${w}x${h}: card ${r.c.w.toFixed(0)}x${r.c.h.toFixed(0)} at x ${r.c.l.toFixed(0)}`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
});
// Owner, 2026-11-07: "the font for the numbers in matchups doesn't feel like it matches ... unify all
// of the fonts". The reference is Profiles' cells (body sans, 14px, tabular figures): in the cards,
// Matchups' cells, its Total column and the Leader figure match it; the Matchups tile uses one size for
// every cell (no per-cell scaling); Profits & Losses uses the same family and tabular figures.
await check('stats-font-unified', 'One number font across the stats cards (family, tabular figures, size by role)', async () => {
  // Every visible element under `sel` that holds a figure's text itself (screen-reader copies aside).
  const font = sel => pg.evaluate(sel => [...document.querySelectorAll(sel)].flatMap(e => [e, ...e.querySelectorAll('*')])
    .filter(e => !e.closest('.sr-only') && e.getBoundingClientRect().width > 0 && [...e.childNodes].some(n => n.nodeType === 3 && /\d/.test(n.textContent)))
    .map(e => { const s = getComputedStyle(e); return `${s.fontFamily.split(',')[0]}|${s.fontVariantNumeric}|${s.fontSize}`; }), sel);
  await goto(pg, 'stats-table'); await sleep(1500);
  const prof = await font('#stats-card tbody td');
  await goto(pg, 'pairwise'); await sleep(1500);
  const cells = await font('#pairwise-card td[data-cell]');
  const totals = await font('#pairwise-card div[data-cell]');
  const leader = (await font('#pairwise-card h2 ~ div span.font-bold')).slice(-1); // its figure, after the name
  await goto(pg, 'stats'); await sleep(1500);
  const tile = await font('#pairwise-panel td[data-cell]');
  await pg.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await sleep(800);
  const pl = await font('ol li div.tabular-nums');
  const ref = prof[0];
  const fam = f => f?.split('|').slice(0, 2).join('|');
  const bad = [];
  for (const [name, fs] of [['Matchups cells', cells], ['Totals', totals], ['Leader', leader]]) {
    if (!fs.length) bad.push(`${name}: none found`);
    else if (fs.some(f => f !== ref)) bad.push(`${name}: ${[...new Set(fs)].join(', ')}`);
  }
  if (!ref || !ref.endsWith('|14px') || !ref.includes('tabular-nums')) bad.push(`Profiles cells: ${ref}`);
  if (new Set(tile).size !== 1 || fam(tile[0]) !== fam(ref)) bad.push(`Matchups tile: ${[...new Set(tile)].join(', ')}`);
  if (!pl.length || pl.some(f => fam(f) !== fam(ref))) bad.push(`Profits & Losses: ${[...new Set(pl)].join(', ') || 'none found'}`);
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `cards ${ref}; tile ${tile[0]}; P&L ${pl[0]}` };
});

// Owner, 2026-11-08: "we need to do an audit on the fonts and sizes and all". One family (the body's sans),
// tabular figures, and one small scale by role on every stats tile and card (History's chart internals are
// checked by history-number-style): titles 20px bold; model names and data figures 14px; controls 14px
// medium; column headers and secondary text 13px (muted); the Matchups tile's figures one size (11px).
await check('stats-type-scale', 'Every text role on the stats tiles and cards uses the agreed family, size, weight and colour', async () => {
  const TEXT = 'rgb(55, 53, 47)', MUTED = 'rgba(55, 53, 47, 0.65)', BLUE = 'rgb(35, 131, 226)';
  // [role, selector, size px, weights, colours (null: any), figures must be tabular]
  const roles = {
    stats: [
      ['tile titles', '#race-panel h2, #stats-panel h2, #pairwise-panel h2', 20, [700], [TEXT]],
      ['Open ↓', '#race-panel h2 ~ div > span[aria-hidden], #stats-panel h2 ~ div > span[aria-hidden], #pairwise-panel h2 ~ div > span[aria-hidden]', 14, [500], [BLUE]],
      ['Leader line', '#race-panel h2 ~ div span.tabular-nums', 14, [400, 700], null, true],
      ['Profiles headers', '#stats-panel thead th', 13, [500], [MUTED]],
      ['Profiles names', '#stats-panel tbody th [translate=no]', 14, [700], [TEXT]],
      ['Profiles figures', '#stats-panel tbody td', 14, [400], null, true],
      ['Matchups names', '#pairwise-panel a [translate=no]', 14, [700], [TEXT]],
      ['Matchups Total header', '#pairwise-panel [title="The row\'s cells added up"]', 13, [500], [MUTED]],
      ['Matchups tile figures', '#pairwise-panel td[data-cell] [aria-hidden]', 11, [400], null, true],
      ['Matchups tile totals', '#pairwise-panel div[data-cell] [aria-hidden]', 11, [700], null, true],
    ],
    'stats-table': [
      ['card title', '#stats-card h2', 20, [700], [TEXT]],
      ['Leader line', '#stats-card h2 ~ div span.tabular-nums', 14, [400, 700], null, true],
      ['definition', '#stats-card p', 13, [400], [MUTED]],
      ['Profiles headers', '#stats-card thead th', 13, [500], [MUTED, TEXT]],
      ['Profiles names', '#stats-card tbody th [translate=no]', 14, [700], [TEXT]],
      ['Profiles figures', '#stats-card tbody td > span', 14, [400], null, true],
      ['toggles', '#stats-card div.add-in > button', 14, [500], [BLUE]],
    ],
    pairwise: [
      ['card title', '#pairwise-card h2', 20, [700], [TEXT]],
      ['Leader line', '#pairwise-card h2 ~ div span.tabular-nums', 14, [400, 700], null, true],
      ['Matchups names', '#pairwise-card a [translate=no]', 14, [700], [TEXT]],
      ['Matchups Total header', '#pairwise-card [title="The row\'s cells added up"]', 13, [500], [MUTED]],
      ['Matchups figures', '#pairwise-card td[data-cell] [aria-hidden]', 14, [400], null, true],
      ['Matchups totals', '#pairwise-card div[data-cell] [aria-hidden]', 14, [700], null, true],
    ],
    '': [
      ['Profits & Losses', 'ol li', 13, [700], null, true],
    ],
  };
  const bad = [], seen = [];
  for (const [screen, list] of Object.entries(roles)) {
    if (screen) { await goto(pg, screen); await sleep(1500); } else { await pg.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await sleep(800); }
    const out = await pg.evaluate(list => {
      const body = getComputedStyle(document.body).fontFamily;
      return list.map(([role, sel, size, weights, colours, tab]) => {
        // Every visible element under the selector that holds text itself (screen-reader copies, closed tooltips
        // and Profiles' 13px ▲▼ marks aside).
        const els = [...document.querySelectorAll(sel)].flatMap(e => [e, ...e.querySelectorAll('*')])
          .filter(e => !e.closest('.sr-only, [role=tooltip], svg, [title=Highest], [title=Lowest]') && e.getBoundingClientRect().width > 0 && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
        const why = new Set();
        for (const e of els) {
          const s = getComputedStyle(e), own = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
          if (s.fontFamily !== body) why.add(`family ${s.fontFamily.split(',')[0]}`);
          if (parseFloat(s.fontSize) !== size) why.add(`${s.fontSize}`);
          if (!weights.includes(+s.fontWeight)) why.add(`weight ${s.fontWeight}`);
          if (colours && !colours.includes(s.color)) why.add(`colour ${s.color}`);
          // A figure (not a name with a digit in it, like GPT-OSS 120B) is tabular.
          if (tab && /^[+−-]?\$?\d[\d,.]*(%|k| s)?\.?$/.test(own.trim()) && !s.fontVariantNumeric.includes('tabular-nums')) why.add('not tabular');
        }
        return { role, n: els.length, why: [...why] };
      });
    }, list);
    for (const o of out) {
      if (!o.n) bad.push(`${screen || 'table'} ${o.role}: none found`);
      else if (o.why.length) bad.push(`${screen || 'table'} ${o.role}: ${o.why.join(', ')}`);
    }
    seen.push(`${screen || 'table'} ${out.reduce((a, o) => a + o.n, 0)} elements`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `${seen.join(', ')}: all on the scale` };
});

// The overview must hold its proportions at any window size or browser zoom: rows and matrix
// cells are sized by content, never stretched by the window's height.
await check('stats-any-viewport', 'The overview keeps its proportions from 1280x720 to 3840x2160 (any zoom)', async () => {
  const bad = [];
  for (const [w, h] of [[1280, 720], [1440, 900], [2560, 1440], [3840, 2160]]) {
    const p2 = await browser.newPage(); await p2.setViewport({ width: w, height: h });
    await p2.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 }); await waitStats(p2); await sleep(1000);
    await goto(p2, 'stats'); await sleep(2000);
    const m = await p2.evaluate(() => {
      const rows = [...document.querySelectorAll('#stats-panel tbody tr, #stats-panel [role=row]')].map(r => r.getBoundingClientRect().height).filter(x => x > 0);
      const cells = [...document.querySelectorAll('#pairwise-panel td')].map(c => c.getBoundingClientRect()).filter(r => r.width > 4 && r.height > 4);
      const ratio = cells.length ? Math.max(...cells.map(r => Math.max(r.width / r.height, r.height / r.width))) : 0;
      const race = document.querySelector('#race-panel').getBoundingClientRect();
      const svg = [...document.querySelectorAll('#race-panel svg')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      const fill = svg ? svg.getBoundingClientRect().width / race.width : 0;
      // Profiles' rows split the second row evenly (the tile's height less its 72px header), whatever the scale.
      const tile = document.querySelector('#stats-panel').getBoundingClientRect().height;
      return { row: rows.length ? Math.max(...rows) : 0, even: (tile - 72) / 10, ratio, fill };
    });
    await p2.close();
    const why = [];
    if (Math.abs(m.row - m.even) > 3) why.push(`Profiles rows ${m.row.toFixed(0)}px tall, not ${m.even.toFixed(0)}px`);
    if (m.ratio > 1.15) why.push(`Matchups cells ${m.ratio.toFixed(2)}:1`);
    if (m.fill < 0.8) why.push(`History chart fills ${(m.fill * 100).toFixed(0)}% of its tile`);
    if (why.length) bad.push(`${w}x${h}: ${why.join(', ')}`);
  }
  return { pass: bad.length === 0, detail: bad.length ? bad.join(' | ') : 'all four sizes hold' };
});

// --- Stats paging. Owner, 2026-11-08: "scrolling up and down profiles stats history is not consistent";
// "when i get all the way down to matchups i should be able to scroll down again and then it takes me back
// to overview"; "why is there a url for stats? there shouldn't be right now". ---
const decay = (ramp, k) => { const d = [...ramp]; let v = ramp.at(-1); while (v > 1) { v *= k; d.push(Math.max(1, Math.round(v))); } return d; };
const SWIPE = decay([2, 5, 10, 18, 28, 36, 40], 0.93); // a trackpad flick: ramp, then about a second of momentum
const GENTLE = decay([1, 2, 3, 5, 7, 9, 10], 0.9); // a slow two-finger scroll, small deltas
// Wheel events 16 ms apart without waiting for each to be handled: a trackpad's cadence (the renderer may coalesce).
const fireWheel = async (p, ds, dir) => { const ps = []; for (const d of ds) { ps.push(p.mouse.wheel({ deltaY: d * dir })); await sleep(16); } await Promise.all(ps); };
const shiftSpace = async p => { await p.keyboard.down('Shift'); await p.keyboard.press('Space'); await p.keyboard.up('Shift'); };
const GESTURES = {
  'trackpad swipe': (p, dir) => fireWheel(p, SWIPE, dir),
  'gentle swipe': (p, dir) => fireWheel(p, GENTLE, dir),
  'wheel notch': (p, dir) => p.mouse.wheel({ deltaY: 100 * dir }),
  // Chrome's own touchpad path (began/changed/ended phases, one latched gesture).
  'phased gesture': async (p, dir) => { const v = p.viewport(); p.__cdp ??= await p.target().createCDPSession(); await p.__cdp.send('Input.synthesizeScrollGesture', { x: v.width / 2, y: v.height / 2, yDistance: -300 * dir, gestureSourceType: 'mouse', speed: 1500 }); },
  PageDown: (p, dir) => p.keyboard.press(dir > 0 ? 'PageDown' : 'PageUp'),
  ArrowDown: (p, dir) => p.keyboard.press(dir > 0 ? 'ArrowDown' : 'ArrowUp'),
  Space: (p, dir) => (dir > 0 ? p.keyboard.press('Space') : shiftSpace(p)),
};
// The card that recedes under each transition's incoming card (the stage under Profiles, Profiles under Matchups).
const UNDER = { 'race>stats-table': '#race-panel', 'stats-table>pairwise': '#stats-card .card-chrome' };
// Runs one gesture and waits for the page to rest: the screen it rests on (null: between two), how long from the
// input's start until the page stopped, and, for a card transition, how long the card underneath took to fade
// (opacity 0.9 to 0.1, either way).
async function step(p, kind, dir, under) {
  await p.evaluate(under => {
    const vis = el => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
    const m = (window.__mv = { t0: performance.now(), first: null, last: performance.now(), y: scrollY, hi: null, lo: null, done: false });
    const el = under && document.querySelector(under), o0 = el ? vis(el) : 0;
    const f = () => {
      if (scrollY !== m.y) { m.y = scrollY; m.last = performance.now(); m.first ??= m.last; }
      if (el) { const o = vis(el); if (o0 > 0.5 ? o < 0.9 && m.hi === null : o > 0.1 && m.lo === null) (o0 > 0.5 ? (m.hi = performance.now()) : (m.lo = performance.now())); if (o0 > 0.5 ? o < 0.1 && m.lo === null : o > 0.9 && m.hi === null) (o0 > 0.5 ? (m.lo = performance.now()) : (m.hi = performance.now())); }
      if (!m.done) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }, under ?? null);
  await GESTURES[kind](p, dir);
  // A loaded machine can handle the input late: wait up to 1.5 s for the page to start moving (none: it stays put).
  await p.waitForFunction(() => window.__mv.first !== null, { timeout: 1500, polling: 50 }).catch(() => {});
  // At rest: still for 450 ms and on a screen edge (a loaded machine can stall a scroll's frames), or 5 s at most.
  for (let t = Date.now(); Date.now() - t < 5000; await sleep(60)) {
    const r = await p.evaluate(() => ({ quiet: performance.now() - __mv.last, edge: [...document.querySelectorAll('[data-screen]')].some(e => Math.abs(e.getBoundingClientRect().top) < 2) }));
    if (r.quiet >= 450 && r.edge) break;
  }
  return p.evaluate(() => {
    const m = window.__mv; m.done = true;
    const hit = [...document.querySelectorAll('[data-screen]')].find(e => Math.abs(e.getBoundingClientRect().top) < 2);
    return { id: hit ? (hit.id || 'table') : null, y: Math.round(scrollY), ms: m.first === null ? 0 : Math.round(m.last - m.first), fade: m.hi !== null && m.lo !== null ? Math.round(Math.abs(m.lo - m.hi)) : null, hash: location.hash };
  });
}
// Owner, 2026-11-08: "include the same down arrow for about as we do for stats". Under the overview, "About ↓"
// in the Stats ↓ button's exact style, in the band under the tiles (not over them), landing on About like a gesture.
await check('about-button', '"About ↓" sits under the overview in the band below the tiles, 8px clear: identical to "Stats ↓" at 1728x1117, the same pill compact at 1440x900; it lands on About', async () => {
  const bad = [], seen = [];
  const STYLE = ['fontSize', 'fontWeight', 'fontFamily', 'color', 'backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'paddingTop', 'paddingLeft', 'boxShadow', 'height'];
  for (const [w, h] of [[1440, 900], [1728, 1117]]) {
    const p = await pageAt(w, h);
    const r = await p.evaluate(STYLE => {
      const find = t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t && b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().top >= 0 && b.getBoundingClientRect().bottom <= innerHeight);
      const about = find('About'), stats = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Stats');
      if (!about || !stats) return { missing: !about ? 'About ↓' : 'Stats ↓' };
      const st = e => { const c = getComputedStyle(e); return Object.fromEntries(STYLE.map(k => [k, c[k]])); };
      // The compact pill (a short window) differs only in its height, padding and text size.
      const compact = innerHeight < 960, SIZE = ['fontSize', 'paddingTop', 'height'];
      const a = st(about), s = st(stats), diff = STYLE.filter(k => !(compact && SIZE.includes(k)) && a[k] !== s[k]).map(k => `${k} ${a[k]} vs ${s[k]}`);
      if (compact && !(parseFloat(a.height) < parseFloat(s.height) && a.fontSize === '14px')) diff.push(`not the compact pill (${a.height}, ${a.fontSize})`);
      const arrow = !!about.querySelector('svg');
      const b = about.getBoundingClientRect(), tiles = Math.max(...['#race-panel', '#stats-panel', '#pairwise-panel'].map(q => document.querySelector(q).getBoundingClientRect().bottom));
      return { diff, arrow, compact, h: b.height, clear: b.top - tiles, below: innerHeight - b.bottom, x: b.left + b.width / 2 - innerWidth / 2 };
    }, STYLE);
    if (r.missing) { bad.push(`${w}x${h}: no ${r.missing} button on screen`); await p.close(); continue; }
    seen.push(`${w}x${h}: ${r.compact ? 'compact' : 'full-size'} ${r.h.toFixed(1)}px, ${r.clear.toFixed(0)}px under the tiles, ${r.below.toFixed(0)}px above the window's edge`);
    if (r.diff.length) bad.push(`${w}x${h}: style differs: ${r.diff.join(', ')}`);
    if (!r.arrow) bad.push(`${w}x${h}: no ↓ arrow`);
    if (r.clear < 7.5 || r.below < 7.5 || Math.abs(r.x) > 2) // 8px, less subpixel rounding bad.push(`${w}x${h}: ${r.clear.toFixed(0)}px under the tiles, ${r.below.toFixed(0)}px above the edge, ${r.x.toFixed(0)}px off centre`);
    await clickText(p, 'About');
    // Up to 5 s: a loaded machine can stretch the smooth scroll.
    const on = await p.waitForFunction(() => Math.abs(document.getElementById('about').getBoundingClientRect().top) < 2 && !location.hash, { timeout: 5000 }).then(() => true, () => false);
    if (!on) bad.push(`${w}x${h}: the click did not land on About`);
    await p.close();
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
});
// Opens a card from the overview the way a visitor does (a click on its tile), and waits for the glide.
const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return Math.round(b[b.length >> 1]); };
const openTile = async (p, tile) => { await goto(p, 'stats'); await sleep(900); await clickCenter(p, tile); await sleep(1300); await p.mouse.move(p.viewport().width / 2, p.viewport().height / 2); };
await check('scroll-consistency', 'Every wheel gesture (trackpad, gentle, notch, phased) and key (PageDown/Up, arrows, Space) moves exactly one screen, both ways, landing on a screen edge, at 1440x900 and 1728x1117: overview ↔ About, and History ↔ Profiles ↔ Matchups once a tile opened them; down and up move at the same speed and fade the card underneath alike; a gesture\'s ambiguous first wheel event is claimed', async () => {
  const bad = [], seen = [];
  const KEYS = new Set(['PageDown', 'ArrowDown', 'Space']);
  // [from, direction, to]: the main scroll's stats leg, then the cards' loop (entered by a click on History's tile).
  const MAIN = [['stats', 1, 'about'], ['about', -1, 'stats']];
  const LOOP = [['race', 1, 'stats-table'], ['stats-table', 1, 'pairwise'], ['pairwise', -1, 'stats-table'], ['stats-table', -1, 'race']];
  for (const [w, h] of [[1440, 900], [1728, 1117]]) {
    const p = await pageAt(w, h);
    // Chrome lets a page cancel a wheel gesture only from its first event: the page must claim a start that is not
    // clearly sideways (no delta, diagonal jitter), and leave a clear sideways swipe (back/forward) to the browser.
    const claim = await p.evaluate(() => [[0, 0], [1, 0], [2, 1], [20, 3]].map(([dx, dy]) => {
      const e = new WheelEvent('wheel', { deltaX: dx, deltaY: dy, cancelable: true, bubbles: true });
      document.querySelector('#race-panel').dispatchEvent(e); return e.defaultPrevented;
    }));
    if (claim.slice(0, 3).some(c => !c) || claim[3]) bad.push(`${w}x${h}: gesture starts (0,0) (1,0) (2,1) claimed ${claim.slice(0, 3).join('/')}, sideways (20,3) claimed ${claim[3]}`);
    await p.mouse.move(w / 2, h / 2);
    const fades = { 1: [], [-1]: [] };
    for (const kind of Object.keys(GESTURES)) {
      const t = { 1: [], [-1]: [] }, wrong = [];
      for (const [legs, enter] of [[MAIN, () => goto(p, 'stats').then(() => sleep(900))], [LOOP, () => openTile(p, '#race-panel')]]) {
        await enter();
        for (const [from, dir, want] of legs) {
          const pair = dir > 0 ? `${from}>${want}` : `${want}>${from}`;
          const r = await step(p, kind, dir, KEYS.has(kind) ? UNDER[pair] : null);
          if (r.id !== want) { wrong.push(`${dir > 0 ? '↓' : '↑'} ${from} → ${r.id ?? `mid-way (y ${r.y})`}`); break; }
          t[dir].push(r.ms);
          if (UNDER[pair] && KEYS.has(kind) && r.fade !== null) fades[dir].push(r.fade);
          await sleep(350);
        }
      }
      // Medians: one stalled frame on a loaded machine must not read as a direction being slower.
      const down = median(t[1]), up = median(t[-1]);
      seen.push(`${w}x${h} ${kind}: ${wrong.length ? 'WRONG' : '6/6'} ↓${down}ms ↑${up}ms`);
      if (wrong.length) bad.push(`${w}x${h} ${kind}: ${wrong.join(', ')}`);
      // The same speed both ways: the scroll's own time, from its first frame to rest (input latency aside).
      else if (Math.abs(down - up) > Math.max(150, 0.3 * Math.max(down, up))) bad.push(`${w}x${h} ${kind}: down ${down}ms vs up ${up}ms`);
    }
    // The card underneath fades out going down and back in going up over the same time (keys: a fixed input).
    const fd = median(fades[1]), fu = median(fades[-1]);
    seen.push(`${w}x${h} fade under the incoming card ↓${fd}ms ↑${fu}ms`);
    if (!fades[1].length || !fades[-1].length || Math.abs(fd - fu) > Math.max(80, 0.4 * Math.max(fd, fu))) bad.push(`${w}x${h}: the card underneath fades ${fd}ms going down vs ${fu}ms going up`);
    await p.close();
  }
  return { pass: !bad.length, detail: bad.length ? `${bad.slice(0, 8).join('; ')} || measured: ${seen.join(' | ')}` : seen.join(' | ') };
});
await check('main-scroll', 'The main scroll is table ↔ overview ↔ About, one gesture each (wheel or key); down on About stays on About', async () => {
  const bad = [], seen = [];
  const p = await pageAt(1440, 900);
  await p.mouse.move(30, 450); // the page's side margin: the table screen's own panels scroll inside themselves
  const PLAN = [['table', 1, 'stats'], ['stats', 1, 'about'], ['about', 1, 'about'], ['about', -1, 'stats'], ['stats', -1, 'table']];
  for (const kind of ['trackpad swipe', 'wheel notch', 'phased gesture', 'PageDown', 'Space']) {
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await sleep(900);
    const got = [];
    for (const [from, dir, want] of PLAN) {
      const r = await step(p, kind, dir);
      got.push(r.id ?? `y${r.y}`);
      if (r.id !== want) { bad.push(`${kind}: ${dir > 0 ? '↓' : '↑'} ${from} → ${r.id ?? `mid-way (y ${r.y})`}`); break; }
      await sleep(350);
    }
    seen.push(`${kind}: ${got.join(' → ')}`);
  }
  await p.close();
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
});
await check('matchups-wraps', 'The cards loop back to the overview: down on Matchups and up on History (wheel or key) go back to it with the Back to overview glide, and stay there', async () => {
  const bad = [], seen = [];
  const p = await pageAt(1440, 900);
  await p.mouse.move(720, 450);
  for (const [kind, dir] of [['trackpad swipe', 1], ['wheel notch', 1], ['phased gesture', 1], ['PageDown', 1], ['ArrowDown', 1], ['Space', 1], ['trackpad swipe', -1], ['wheel notch', -1], ['PageDown', -1], ['Space', -1]]) {
    // Down on Matchups, up on History: each card reached from its tile, as a visitor does.
    const [tile, sel] = dir > 0 ? ['#pairwise-panel', '#pairwise-panel'] : ['#race-panel', '#race-panel'];
    await openTile(p, tile);
    // The tile's box per frame (4 s: a loaded machine draws few frames): the glide back shows it between its card place and its tile place.
    await p.evaluate(sel => { const out = (window.__gl = []); const t0 = performance.now(); const f = () => { const b = document.querySelector(sel).getBoundingClientRect(); out.push([Math.round(b.left), Math.round(b.width), Math.round(b.height)]); if (performance.now() - t0 < 4000) requestAnimationFrame(f); }; requestAnimationFrame(f); }, sel);
    const r = await step(p, kind, dir);
    await sleep(900); // the gesture's tail must not page on from the overview
    const still = await p.evaluate(() => Math.abs(document.getElementById('stats').getBoundingClientRect().top) < 2);
    const frames = await p.evaluate(() => window.__gl);
    // A glide passes through in-between sizes (card to tile); a jump shows two.
    const sizes = new Set(frames.map(f => `${f[1]}x${f[2]}`)).size;
    const name = `${dir > 0 ? '↓ Matchups' : '↑ History'} ${kind}`;
    seen.push(`${name}: ${r.id ?? 'mid-way'}, ${sizes} tile sizes`);
    if (r.id !== 'stats' || !still) bad.push(`${name}: landed on ${r.id ?? `y ${r.y}`}${r.id === 'stats' && !still ? ', then moved on' : ''}`);
    else if (sizes < 4) bad.push(`${name}: no glide back (${sizes} tile sizes)`);
  }
  await p.close();
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(', ') };
});
await check('no-stats-hash', 'The URL never names a screen (open/close every card, Escape, paging, the About link, an old #race link), while #model= still opens the drawer and Back closes it; tiles open from the keyboard; /about still works', async () => {
  const bad = [];
  const p = await pageAt(1440, 900);
  const hash = () => p.evaluate(() => location.hash);
  const note = async what => { const h = await hash(); if (h) bad.push(`${what}: ${h}`); };
  const links = await p.evaluate(() => [...document.querySelectorAll('a[href^="#"]:not([href^="#model="])')].map(a => a.getAttribute('href')));
  if (links.length) bad.push(`hash links ${[...new Set(links)].join(' ')}`);
  for (const [tile, card] of [['#race-panel', 'race'], ['#stats-panel', 'stats-table'], ['#pairwise-panel', 'pairwise']]) {
    await goto(p, 'stats'); await sleep(900);
    await clickCenter(p, tile); await sleep(1300); await note(`open ${card}`);
    await clickPrefix(p, 'Back to overview'); await sleep(1300); await note(`back from ${card}`);
    // Keyboard: the tile is a tab stop and Enter opens it.
    await p.focus(tile); await p.keyboard.press('Enter'); await sleep(1300);
    const on = await p.evaluate(id => Math.abs(document.getElementById(id).getBoundingClientRect().top) < 2, card);
    if (!on) bad.push(`Enter on ${tile} did not open ${card}`);
    await note(`Enter on ${card}`);
    await p.keyboard.press('Escape'); await sleep(1300); await note(`Escape from ${card}`);
  }
  for (const k of ['PageDown', 'PageDown', 'PageUp', 'PageUp']) { await p.keyboard.press(k); await sleep(900); }
  await note('paging');
  // The header's About link scrolls to the About screen, hash-free.
  await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await sleep(600);
  await p.evaluate(() => [...document.querySelectorAll('a[href="/about"]')].find(a => a.getBoundingClientRect().width > 0)?.click()); await sleep(1500);
  const onAbout = await p.evaluate(() => ({ at: Math.abs(document.getElementById('about').getBoundingClientRect().top) < 2, path: location.pathname }));
  if (!onAbout.at || onAbout.path !== '/') bad.push(`About link: ${onAbout.path}, ${onAbout.at ? 'on' : 'not on'} the About screen`);
  await note('About link');
  // The model drawer keeps its hash: a model link opens it, Back closes it.
  await goto(p, 'stats'); await sleep(900);
  const opened = await p.evaluate(() => { const a = [...document.querySelectorAll('a[href^="#model="]')].find(e => e.getBoundingClientRect().width > 0); a?.click(); return !!a; });
  await sleep(1000);
  const d1 = await p.evaluate(() => ({ h: location.hash, open: !!document.querySelector('dialog[open]') }));
  await p.goBack(); await sleep(1000);
  const d2 = await p.evaluate(() => ({ h: location.hash, open: !!document.querySelector('dialog[open]') }));
  if (!opened || !d1.h.startsWith('#model=') || !d1.open) bad.push(`model link: ${opened ? `hash ${d1.h || 'empty'}, drawer ${d1.open ? 'open' : 'closed'}` : 'none found'}`);
  if (d2.h || d2.open) bad.push(`Back from the drawer: hash ${d2.h || 'empty'}, drawer ${d2.open ? 'still open' : 'closed'}`);
  await p.close();
  // An old link to a stats screen opens the page at its top, with the hash gone.
  const q = await browser.newPage(); await q.setViewport({ width: 1440, height: 900 });
  await q.goto(`${BASE}/#race`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await waitStats(q); await sleep(3000);
  const old = await q.evaluate(() => ({ y: Math.round(scrollY), h: location.hash }));
  await q.close();
  if (old.y > 2 || old.h) bad.push(`/#race: page at y ${old.y}, hash ${old.h || 'empty'}`);
  // /about stays its own page.
  const a = await browser.newPage(); await a.setViewport({ width: 1440, height: 900 });
  const res = await a.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await sleep(1500);
  const txt = await a.evaluate(() => document.body.innerText); await a.close();
  if (res.status() !== 200 || !/Limitations/.test(txt)) bad.push(`/about: ${res.status()}${/Limitations/.test(txt) ? '' : ', no About content'}`);
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : 'hash empty throughout; #model= opens and Back closes the drawer; the About link scrolls to About; /#race opens at the top; /about works' };
});
await check('matchups-no-definition', 'The opened Matchups card has no definition line (no "Each cell" / "took the most from")', async () => {
  const p = await pageAt(1440, 900, 'pairwise');
  const r = await p.evaluate(() => { const c = document.querySelector('#pairwise-card'); return { t: c.innerText, p: c.querySelectorAll('p').length }; });
  await p.close();
  const found = ['Each cell', 'took the most from'].filter(x => r.t.includes(x));
  return { pass: !found.length && !r.p, detail: found.length || r.p ? `found ${found.join(', ')} (${r.p} p)` : 'no definition line' };
});

await browser.close();
const w = Math.max(...results.map(r => r.id.length));
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(w)}  ${r.detail}   (${r.rule})`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
