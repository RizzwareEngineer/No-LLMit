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

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--mute-audio'] });
const pg = await browser.newPage();
await pg.setViewport({ width: 1440, height: 900 });
await pg.goto(BASE, { waitUntil: 'domcontentloaded' });
await sleep(5000);

// --- Table screen (locked) ---
await check('seat-size', 'Seat cells stay 200x128', async () => {
  const r = await pg.evaluate(() => { const b = document.querySelector('td.w-\\[200px\\]').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
  return { pass: Math.abs(r[0] - 200) <= 1 && Math.abs(r[1] - 128) <= 2, detail: r.join('x') };
});
await check('table-width', 'The table stays 1000px wide', async () => {
  const w = await pg.evaluate(() => Math.round(document.querySelector('table').getBoundingClientRect().width));
  return { pass: Math.abs(w - 1000) <= 1, detail: `${w}px` };
});
await check('no-currency', 'No ¤ sign anywhere on the table screen', async () => {
  const n = await pg.evaluate(() => (document.body.innerText.match(/¤/g) || []).length);
  return { pass: n === 0, detail: `${n} found` };
});

// --- History (overview tile, then the card) ---
await goto(pg, 'stats'); await sleep(2500);
// The unit is the default metric's, Chips won since 2026-11-07 (was bb/100).
await check('history-unit-once', '"Chips won" shows once on the History tile', async () => {
  const n = await pg.evaluate(() => [...document.querySelectorAll('#race-panel *')].filter(e => e.childElementCount === 0 && e.textContent.trim() === 'Chips won' && e.getBoundingClientRect().width > 0).length);
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
// --- History camera (owner 2026-11-07): "the models are just so close to each other that it's hard
// to tell"; "I don't see ... a 'camera' to track the LLMs". Chips by default, and a vertical camera:
// the y axis fits the lines in the x window and eases there. The card is open here. ---
await check('history-default-chips', 'History opens on Chips won; bb/100 is one click away', async () => {
  const r = await pg.evaluate(() => {
    const g = [...document.querySelectorAll('[role=group][aria-label=Metric]')].find(e => e.getBoundingClientRect().width > 0);
    const on = g && [...g.querySelectorAll('button')].find(b => b.getAttribute('aria-pressed') === 'true')?.textContent.trim();
    const other = g && [...g.querySelectorAll('button')].some(b => b.textContent.trim() === 'bb/100');
    const title = [...document.querySelectorAll('svg text')].some(t => t.textContent.trim() === 'Chips won' && t.getBoundingClientRect().width > 0);
    return { on, other, title };
  });
  return { pass: r.on === 'Chips' && r.other && r.title, detail: `Metric ${r.on ?? 'missing'}, bb/100 option ${r.other ? 'there' : 'missing'}, axis title ${r.title ? 'Chips won' : 'not Chips won'}` };
});
// One replay from the start, sampled every frame: how much of the plot's height the visible tips
// span, and how far the y axis moves per frame. Read at 5 s, 20 s and 40 s.
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
        const tys = [...plot.querySelectorAll('[data-pill]')].filter(e => +e.style.opacity > 0.5).map(e => +e.dataset.ty);
        const labels = [...plot.querySelectorAll('[data-y-tick]')].filter(e => +e.parentElement.getAttribute('opacity') > 0.5).map(e => e.textContent).join(' ');
        out.push({ t: performance.now() - t0, y0, y1, fill: tys.length > 1 ? (Math.max(...tys) - Math.min(...tys)) / h : null, out: tys.length ? Math.max(0, top - Math.min(...tys), Math.max(...tys) - top - h) : 0, labels });
      }
      if (performance.now() - t0 < 41_000) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await sleep(41_500);
  return (camSamples = await pg.evaluate(() => window.__cam));
};
const near = (ss, s) => ss.reduce((a, b) => (Math.abs(b.t - s * 1000) < Math.abs(a.t - s * 1000) ? b : a));
await check('history-y-fill', 'During the replay the visible tips span at least half the plot height (5 s, 20 s, 40 s) and never leave it', async () => {
  const ss = await camRun();
  const at = [5, 20, 40].map(s => near(ss, s));
  const outs = ss.filter(s => s.t > 1000 && s.out > 2);
  const ok = at.every(a => a.fill != null && a.fill >= 0.5) && !outs.length;
  return { pass: ok, detail: at.map((a, i) => `${[5, 20, 40][i]}s ${a.fill == null ? 'no tips' : `${(a.fill * 100).toFixed(0)}%`}`).join(', ') + `; tips outside the plot in ${outs.length} of ${ss.length} frames${outs.length ? ` (up to ${Math.max(...outs.map(s => s.out)).toFixed(0)}px)` : ''}` };
});
await check('history-y-smooth', 'The y axis follows the race (labels change early to late) and never moves more than 4% of its range per 60 Hz frame', async () => {
  const ss = (await camRun()).filter(s => s.t > 1000);
  let worst = 0;
  // Per 60 Hz frame: a slow frame (a loaded machine) may move further without being a jump.
  for (let i = 1; i < ss.length; i++) {
    const r = ss[i].y1 - ss[i].y0, k = 16.7 / Math.max(16.7, ss[i].t - ss[i - 1].t);
    worst = Math.max(worst, (Math.abs(ss[i].y0 - ss[i - 1].y0) / r) * k, (Math.abs(ss[i].y1 - ss[i - 1].y1) / r) * k);
  }
  const [a, b] = [near(ss, 5), near(ss, 40)];
  const dts = ss.slice(1).map((s, i) => s.t - ss[i].t).sort((x, y) => x - y);
  const p95 = dts[Math.floor(dts.length * 0.95)] ?? 0, mean = dts.reduce((x, y) => x + y, 0) / (dts.length || 1);
  return { pass: ss.length > 100 && a.labels !== b.labels && worst <= 0.04, detail: `labels 5s [${a.labels}] → 40s [${b.labels}], worst ${(worst * 100).toFixed(1)}% of the range per 60 Hz frame; frames ${mean.toFixed(1)}ms mean, ${p95.toFixed(1)}ms p95` };
});
await check('history-number-style', 'History numbers (ticks, pills, readout) use the body sans, tabular, at the Profiles cells\' 14px', async () => {
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
        if (Math.abs(px - 14) > 0.75) bad.add(`${px.toFixed(1)}px`);
      }
      return bad.size ? `${role}: ${[...bad].join(', ')}` : '';
    }).filter(Boolean);
  });
  await pg.mouse.move(5, 5);
  return { pass: !r.length, detail: r.length ? r.join('; ') : 'ticks, pills and readout: body sans, tabular, 14px on screen' };
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

// While the replay steps Profiles through its snapshots, rows never sit on top of each other.
await check('profiles-rows-no-overlap', 'During the replay, no two Profiles rows overlap', async () => {
  await goto(pg, 'race'); await sleep(800); // Skip and Replay live on the History card
  const playing = () => pg.evaluate(() => [...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Skip' && e.getBoundingClientRect().width > 0));
  if (!(await playing()) && !(await clickText(pg, 'Replay'))) return { pass: false, detail: 'neither Skip nor Replay shown' };
  await sleep(500); await goto(pg, 'stats-table'); await sleep(600);
  let worst = 0, samples = 0;
  for (let i = 0; i < 12; i++) {
    const o = await pg.evaluate(() => {
      const rs = [...document.querySelectorAll('#stats-card tbody tr')].map(r => r.getBoundingClientRect()).filter(r => r.height > 4);
      let w = 0;
      for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) w = Math.max(w, Math.min(rs[a].bottom, rs[b].bottom) - Math.max(rs[a].top, rs[b].top));
      return rs.length ? w : null;
    });
    if (o !== null) { samples++; worst = Math.max(worst, o); }
    await sleep(250);
  }
  return { pass: samples > 0 && worst <= 2, detail: samples ? `worst overlap ${worst.toFixed(1)}px over ${samples} samples` : 'no rows found' };
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
await check('matchups-wider', 'On the overview the Matchups tile is wider than the Profiles tile', async () => {
  await goto(pg, 'stats'); await sleep(1200);
  const [p, m] = await pg.evaluate(() => ['#stats-panel', '#pairwise-panel'].map(s => Math.round(document.querySelector(s).getBoundingClientRect().width)));
  return { pass: m > p, detail: `Profiles ${p}px, Matchups ${m}px` };
});
// The Matchups tile is its names and its square, edge to edge: no empty band beside them.
await check('matchups-tile-filled', 'The Matchups matrix and its names fill the tile (no empty space beside them)', async () => {
  await goto(pg, 'stats'); await sleep(1200);
  const r = await pg.evaluate(() => {
    const t = document.querySelector('#pairwise-panel').getBoundingClientRect();
    const cells = [...document.querySelectorAll('#pairwise-panel td, #pairwise-panel a, #pairwise-panel th')].map(e => e.getBoundingClientRect()).filter(b => b.width > 2 && b.height > 2);
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
