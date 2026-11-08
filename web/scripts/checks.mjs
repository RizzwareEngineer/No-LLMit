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

// A fresh page at a window size, on the overview once the stats have loaded.
const pageAt = async (w, h, id = 'stats') => {
  const p = await browser.newPage(); await p.setViewport({ width: w, height: h });
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(id => document.getElementById(id), { timeout: 60000 }, id).catch(() => {});
  await sleep(3000); await goto(p, id); await sleep(2000);
  return p;
};
const rect = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }, sel);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--mute-audio'] });
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
await check('replay-no-reset', 'The replay never restarts on open, back or scroll', async () => {
  const playing = await pg.evaluate(() => [...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Skip' && e.getBoundingClientRect().width > 0));
  if (!playing && !(await clickText(pg, 'Replay'))) return { pass: false, detail: 'neither Skip nor Replay shown' };
  await sleep(2000); const h1 = await replayHand(pg);
  await clickText(pg, 'Back to overview'); await sleep(1500); const h2 = await replayHand(pg);
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
const nameOffsets = () => [...document.querySelectorAll('#stats-card tbody tr')].map(r => { const s = r.querySelector('th span'); return s ? { o: s.getBoundingClientRect().top - r.getBoundingClientRect().top, b: s.getBoundingClientRect() } : null; }).filter(Boolean);
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
      if (performance.now() - t0 < 9000 && mid < 3) requestAnimationFrame(loop); else res({ mid, frames, reorders });
    };
    requestAnimationFrame(loop);
  }), `(${nameOffsets})`);
  return { pass: r.mid >= 3, detail: `${r.reorders} reorders, ${r.mid} frames with a row mid-slide (of ${r.frames})` };
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
    await clickText(pg, 'Back to overview'); await sleep(1200);
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
// Was "Matchups is wider than Profiles"; the owner's 2026-11-07 priorities replace it: History leads the
// overview, and Matchups is at least comparable to Profiles.
await check('matchups-comparable', 'On the overview the Matchups tile is at least comparable to Profiles (70% of its area or more)', async () => {
  await goto(pg, 'stats'); await sleep(1200);
  const [p, m] = await pg.evaluate(() => ['#stats-panel', '#pairwise-panel'].map(s => { const b = document.querySelector(s).getBoundingClientRect(); return Math.round(b.width * b.height); }));
  return { pass: m >= 0.7 * p, detail: `Profiles ${p}px², Matchups ${m}px² (${(m / p * 100).toFixed(0)}%)` };
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
// and 80% of the window, with page around it (64px at the sides, 24px above and below).
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
    if (left < 64 || right < 64 || top < 24 || bottom < 24) bad.push(`${w}x${h}: page around the block ${left.toFixed(0)}/${right.toFixed(0)}/${top.toFixed(0)}/${bottom.toFixed(0)}px`);
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

// The overview must hold its proportions at any window size or browser zoom: rows and matrix
// cells are sized by content, never stretched by the window's height.
await check('stats-any-viewport', 'The overview keeps its proportions from 1280x720 to 3840x2160 (any zoom)', async () => {
  const bad = [];
  for (const [w, h] of [[1280, 720], [1440, 900], [2560, 1440], [3840, 2160]]) {
    const p2 = await browser.newPage(); await p2.setViewport({ width: w, height: h });
    await p2.goto(BASE, { waitUntil: 'domcontentloaded' }); await sleep(4000);
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

await browser.close();
const w = Math.max(...results.map(r => r.id.length));
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(w)}  ${r.detail}   (${r.rule})`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
