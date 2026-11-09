// Headless checks for the owner's locked UI rules. Each one can fail; a failure exits non-zero.
// Run: node scripts/checks.mjs [--base http://localhost:3100] [--skip id,id] [--only id,id] [--changed] [--replay-speed 4]
// Needs a running web server and engine; scripts/verify.sh provides both and the machine-wide lock.
// Chrome is the system install (CHROME_PATH to override).
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:3100');
const SKIP = new Set((arg('--skip', '') || '').split(',').filter(Boolean));
const ONLY = new Set((arg('--only', '') || '').split(',').filter(Boolean));
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
// The checks that watch a whole replay play it this many times faster (test-only: window.__replaySpeed, read by
// playReplay). Every replay-timed effect on the chart scales with it, and their samples are timed in replay time.
const SPEED = +arg('--replay-speed', 4);
// This script's lines and its checks' ids in order (for --changed, and to print results in order).
const SRC = readFileSync(new URL(import.meta.url), 'utf8').split('\n');
const CHECK = /^(?:  await |(?:group|late|main)\(\(\) => )check\('([\w-]+)'/, END = /^}\)\)?;$/;
const IDS = SRC.map(l => l.match(CHECK)?.[1]).filter(Boolean);
const want = id => !SKIP.has(id) && (!ONLY.size || ONLY.has(id));
let lastEnd = Date.now();
async function check(id, rule, fn) {
  if (!want(id)) return;
  const t0 = lane.getStore() ? Date.now() : lastEnd; // on the main page, with any shared setup since the previous check
  let r;
  try { const { pass, detail } = await fn(); r = { id, rule, pass, detail }; }
  catch (e) { r = { id, rule, pass: false, detail: `error: ${e.message.split('\n')[0]}` }; }
  results.push(r);
  await parkShared();
  r.ms = Date.now() - t0; if (!lane.getStore()) lastEnd = Date.now();
}
// The main page's steps (main) run in order on one page. Checks that bring their own pages run in lanes, each group
// in a browser context of its own: a window of its own, so input and frames work in every lane at once (a background
// tab gets neither); newPage() opens a page in the running group's context. The rest (group) run beside the main page
// in LANES - 1 lanes. Checks that time scroll gestures (late) misread a busy machine, so they wait for the main page,
// then take LANES - 1 lanes (scroll-consistency opens a second window of its own). All are only queued while this
// file runs top to bottom, and start at its end.
const LANES = +arg('--lanes', 3);
const lane = new AsyncLocalStorage(), groups = [], lates = [], steps = [];
const group = fn => groups.push(fn), late = fn => lates.push(fn), main = fn => steps.push(fn);
const newPage = () => (lane.getStore() ?? browser).newPage();
// Runs fn in a fresh browser context (its own window), beside whatever else is running.
const alone = async fn => { const ctx = await browser.createBrowserContext(); try { return await lane.run(ctx, fn); } finally { await ctx.close().catch(() => {}); } };
const drain = (fns, n) => Promise.all(Array.from({ length: n }, async () => { while (fns.length) await alone(fns.shift()); }));

// --changed: only the checks tied to the files changed against $BASE_REF (committed, uncommitted, untracked).
// A web file no rule names, or a change to this script outside a check's own block, selects every check.
const COVERS = [
  [/components\/(PokerTable|Player|TableFelt|ChipStack|Card|CornerBorders|ActionPanel|ReasoningPanel|WinningsPanel|SessionProgress|UsageIndicator|TypewriterText|SoundToggle)\.tsx|hooks\/|lib\/sound\./, /^(seat-size|table-|no-currency|main-scroll|stats-font-unified|stats-type-scale)/],
  [/components\/CumulativeChart\.tsx|lib\/families\./, /^(history-|replay-|sync-|leader-|trends-|small-screens|stats-any-viewport|overview-history-leads|detail-alone|page-edges)/],
  [/lib\/timeline\./, /^(history-|replay-|sync-|leader-|profiles-rows-|matchups-cells-still)/],
  [/components\/StatsTable\.tsx/, /^(profiles-|glide-smooth|stats-|sync-|small-screens|detail-alone|cards-no-scope|leader-scope|page-edges)/],
  [/components\/HeadToHead\.tsx/, /^(matchups-|glide-smooth|stats-|sync-|small-screens|detail-alone|cards-no-scope|tiles-no-scroll|leader-scope|overview-history-leads|page-edges)/],
  [/components\/About\.tsx|components\/about\/|app\/about\/|lib\/systemPrompt\./, /^(about-|pages-|page-edges|main-scroll|no-stats-hash|scroll-consistency)/],
];
function changedChecks() { // a Set of ids, or null for every check
  const git = c => execSync(c, { cwd: new URL('../..', import.meta.url), encoding: 'utf8' }).split('\n').filter(Boolean);
  const ref = process.env.BASE_REF || 'preview/ui', me = 'web/scripts/checks.mjs';
  const files = new Set(git(`git diff --name-only ${ref}...HEAD; git diff --name-only HEAD; git ls-files --others --exclude-standard --full-name`).filter(f => f.startsWith('web/')));
  const src = SRC, all = IDS, ids = new Set();
  for (const f of files) {
    if (f === me) {
      // Each changed line of this script belongs to the check whose block holds it, or to all of them.
      const lines = git(`git diff -U0 $(git merge-base ${ref} HEAD) -- ${me}`).flatMap(l => { const m = l.match(/^@@ .* \+(\d+)(?:,(\d+))? @@/); return m ? Array.from({ length: Math.max(1, +(m[2] ?? 1)) }, (_, i) => +m[1] + i - 1) : []; });
      for (const n of lines) {
        let i = n; while (i >= 0 && !CHECK.test(src[i]) && !(i < n && END.test(src[i]))) i--;
        const id = i >= 0 && src[i].match(CHECK)?.[1];
        if (!id) return null;
        ids.add(id);
      }
      continue;
    }
    const rules = COVERS.filter(([file]) => file.test(f));
    if (!rules.length) return null;
    for (const [, id] of rules) all.filter(x => id.test(x)).forEach(x => ids.add(x));
  }
  return ids;
}
if (process.argv.includes('--changed')) {
  const ids = changedChecks();
  if (ids && !ids.size) { console.log('--changed: no UI check covers the changed files'); process.exit(0); }
  if (ids) ids.forEach(id => ONLY.add(id));
  console.log(`--changed: ${ids ? [...ids].join(', ') : 'every check'}`);
}

const goto = (pg, id) => pg.evaluate(id => { const el = document.getElementById(id); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: 'instant' }); }, id);
const clickText = (pg, t) => pg.evaluate(t => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === t && e.getBoundingClientRect().width > 0); if (b) b.click(); return !!b; }, t);
// A button whose text starts with `t` (a label that carries a short form for narrow screens, e.g. "Back to overviewOverview").
const clickPrefix = (pg, t) => pg.evaluate(t => { const b = [...document.querySelectorAll('button, a')].find(e => e.textContent.trim().startsWith(t) && e.getBoundingClientRect().width > 0); if (b) b.click(); return !!b; }, t);
const clickCenter = async (pg, sel) => { const r = await pg.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, sel); if (!r) throw new Error(`no ${sel}`); await pg.mouse.click(r[0], r[1]); };
// The biggest visible chart svg on screen: the Trends plot.
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
const pageAt = async (w, h, id = 'stats', ctx = lane.getStore() ?? browser) => {
  const p = await ctx.newPage(); await p.setViewport({ width: w, height: h });
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitStats(p);
  await sleep(3000); await goto(p, id); await sleep(2000);
  return p;
};
// One page per window size for the checks that only read it (each scrolls to its screen): a fresh page costs a load
// and 5 s of settling. Checks that click, page, replay or navigate keep a fresh page of their own.
// A parked page is frozen (no script, no frames), so it never takes CPU from the check that is running. Shared pages
// live in a context of their own: a page left open in the main page's window would leave the main page a background
// tab, with no frames.
const shared = () => ((lane.getStore() ?? browser).__shared ??= new Map());
const life = (p, state) => p.__life.send('Page.setWebLifecycleState', { state });
const sharedAt = async (w, h, id = 'stats') => {
  const p = shared().get(`${w}x${h}`), owner = lane.getStore() ?? browser;
  if (!p) {
    const q = await pageAt(w, h, id, owner === browser ? (browser.__sharedCtx ??= await browser.createBrowserContext()) : owner);
    q.__life = await q.createCDPSession(); shared().set(`${w}x${h}`, q); return q;
  }
  await life(p, 'active');
  // A resumed page reconnects for a moment; measure once its connection bar is gone. Timer polling: a page
  // in a background tab draws no frames, so frame polling would never run.
  await p.waitForFunction(() => getComputedStyle(document.querySelector('[data-page]')).getPropertyValue('--bar-h').trim() === '0px', { polling: 250, timeout: 15000 }).catch(() => {});
  await goto(p, id); await sleep(2000);
  return p;
};
const parkShared = () => Promise.all([...shared().values()].map(p => life(p, 'frozen').catch(() => {})));
const rect = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }, sel);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--mute-audio'] });
// Never leave a headless Chrome behind: close it on a crash or Ctrl-C too.
const bail = async e => { if (e) console.error(e); try { await browser.close(); } catch {} process.exit(1); };
process.on('uncaughtException', bail); process.on('unhandledRejection', bail); process.on('SIGINT', () => bail()); process.on('SIGTERM', () => bail());
const pg = await newPage();
main(async () => {
  await pg.setViewport({ width: 1440, height: 900 });
  await pg.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // A loaded machine can take longer than a fixed wait to deal the table: wait for it, then settle.
  await pg.waitForFunction(() => document.querySelector('td.w-\\[200px\\]'), { timeout: 60000 }).catch(() => {});
  await sleep(5000);
});

// --- Table screen (locked) ---
main(() => check('seat-size', 'Seat cells stay 200x128', async () => {
  // offsetWidth/offsetHeight: the unscaled CSS size (the stage's fit-to-screen zoom is uniform on top).
  const r = await pg.evaluate(() => { const b = document.querySelector('td.w-\\[200px\\]'); return [b.offsetWidth, b.offsetHeight]; });
  return { pass: Math.abs(r[0] - 200) <= 1 && Math.abs(r[1] - 128) <= 2, detail: r.join('x') };
}));
main(() => check('table-width', 'The table stays 1000px wide', async () => {
  const w = await pg.evaluate(() => document.querySelector('table').offsetWidth);
  return { pass: Math.abs(w - 1000) <= 1, detail: `${w}px` };
}));
main(() => check('no-currency', 'No ¤ sign anywhere on the table screen', async () => {
  const n = await pg.evaluate(() => (document.body.innerText.match(/¤/g) || []).length);
  return { pass: n === 0, detail: `${n} found` };
}));

// --- Table screen fit-to-screen and browser zoom (industry practice: respect browser zoom, reflow
// or scroll, never clip; a fixed-proportion canvas fits the window between a floor and a cap) ---
const FIT_FLOOR = 0.75, FIT_CAP = 1.25;
// [width, height, devicePixelRatio]: browser zoom N% of W x H is a W/N x H/N viewport at ratio N.
const FIT_SIZES = [[1280, 720, 1], [1440, 900, 1], [1728, 1117, 1], [2560, 1440, 1], [720, 450, 2], [864, 558, 2]];
group(async () => {
  const fits = [];
  for (const [w, h, d] of FIT_SIZES) {
    if (!want('table-fit') && !want('table-reachable') && !want('table-no-hscroll')) break;
    const p2 = await newPage(); await p2.setViewport({ width: w, height: h, deviceScaleFactor: d });
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
});

// --- Trends (overview tile, then the card) ---
main(async () => { await goto(pg, 'stats'); await sleep(2500); });
// The unit is the default metric's: bb/100 again since 2026-11-08 (owner: "the default should be bb100 not chips").
main(() => check('history-unit-once', '"bb/100" shows once on the Trends tile', async () => {
  const n = await pg.evaluate(() => [...document.querySelectorAll('#race-panel *')].filter(e => e.childElementCount === 0 && e.textContent.trim() === 'bb/100' && e.getBoundingClientRect().width > 0).length);
  return { pass: n === 1, detail: `${n} times` };
}));
let tile, tileCard, card;
main(async () => {
  tile = await chartBox(pg);
  tileCard = await pg.evaluate(() => { const b = document.querySelector('#race-panel').getBoundingClientRect(); return { w: b.width, h: b.height }; });
  await clickCenter(pg, '#race-panel'); await sleep(1500);
  card = await chartBox(pg);
});
main(() => check('history-card-size', 'Opening Trends moves the tile to the middle and adds the filters; it does not balloon', async () => {
  const c = await pg.evaluate(() => { const svg = [...document.querySelectorAll('svg')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 300 && r.top < innerHeight && r.bottom > 0; }).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]; const b = svg.closest('.card-chrome').getBoundingClientRect(); const bar = [...svg.closest('.card-chrome').querySelectorAll('.flex-wrap')].find(e => e.textContent.startsWith('Metric')); return { w: b.width, h: b.height, bar: bar ? bar.getBoundingClientRect().height + 8 : 0 }; });
  // The card may add exactly its filter bar (however many rows it wraps to) and the legend (68px), plus 12px.
  const room = c.bar + 68 + 12;
  const ok = Math.abs(c.w - tileCard.w) / tileCard.w <= 0.05 && c.h - tileCard.h <= room;
  return { pass: ok, detail: `tile ${Math.round(tileCard.w)}x${Math.round(tileCard.h)} → card ${Math.round(c.w)}x${Math.round(c.h)} (allowed: same width ±5%, +${Math.round(room)}px: the filter bar and legend)` };
}));
main(() => check('history-no-stretch', 'The Trends chart keeps its shape from tile to card', async () => {
  const a = tile.w / tile.h, b = card.w / card.h;
  return { pass: Math.abs(a - b) / a < 0.02, detail: `tile ${a.toFixed(3)} vs card ${b.toFixed(3)}` };
}));
main(() => check('history-dead-space', 'The opened Trends card has at most 15% dead space', async () => {
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
}));
main(() => check('history-filters-still', 'The plot box does not move when a filter switches', async () => {
  const a = await chartBox(pg);
  if (!(await clickText(pg, 'Top 5'))) return { pass: false, detail: 'no Top 5 button' };
  await sleep(900); const b = await chartBox(pg);
  // Back to every model (Show's All: License and Hands have an All too), so the Trends checks after this see the default.
  await pg.evaluate(() => [...document.querySelectorAll('[role=group][aria-label="Top models"] button')].find(e => e.textContent.trim() === 'All' && e.getBoundingClientRect().width > 0)?.click()); await sleep(600);
  const d = Math.max(Math.abs(a.w - b.w), Math.abs(a.h - b.h), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  return { pass: d <= 1, detail: `moved ${d.toFixed(1)}px` };
}));
// Arena-style labels: pills ride the line tips (each pill carries data-tip-x, its tip's page x),
// and no column is reserved at the right; the camera keeps the leading tips still while history slides.
main(() => check('history-pills-at-tips', 'Model labels are pills at the line tips, not a reserved column', async () => {
  const r = await pg.evaluate(() => {
    const pills = [...document.querySelectorAll('[data-pill]')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.top < innerHeight && b.bottom > 0; });
    if (!pills.length) return { n: 0 };
    const gaps = pills.map(e => e.getBoundingClientRect().left - +e.dataset.tipX);
    return { n: pills.length, worst: Math.max(...gaps.map(Math.abs)) };
  });
  return { pass: r.n > 0 && r.worst <= 28, detail: r.n ? `${r.n} pills, farthest ${r.worst.toFixed(0)}px from its tip` : 'no [data-pill] labels' };
}));
main(() => check('history-camera-follows', 'While replaying, the leading tips stay put and history slides past', async () => {
  const lead = () => pg.evaluate(() => { const xs = [...document.querySelectorAll('[data-pill]')].map(e => +e.dataset.tipX).filter(Number.isFinite); return xs.length ? Math.max(...xs) : null; });
  const firstTick = () => pg.evaluate(() => { const t = [...document.querySelectorAll('[data-x-tick]')].filter(e => e.getBoundingClientRect().width > 0).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0]; return t ? [t.textContent, t.getBoundingClientRect().left] : null; });
  const a = await lead(), ta = await firstTick(); await sleep(1500); const b = await lead(), tb = await firstTick();
  if (a == null || b == null || !ta || !tb) return { pass: false, detail: 'needs [data-pill] with data-tip-x and [data-x-tick] hooks' };
  const slid = ta[0] !== tb[0] || Math.abs(ta[1] - tb[1]) > 4;
  return { pass: Math.abs(a - b) <= 6 && slid, detail: `lead tip ${a.toFixed(0)} → ${b.toFixed(0)}, first tick ${ta[0]}@${ta[1].toFixed(0)} → ${tb[0]}@${tb[1].toFixed(0)}` };
}));
// Like Arena: every line's tip is "now", so the tips share one x; and the plot is never mostly
// empty, because the window starts at the first hand until the lines reach the camera's edge.
main(() => check('history-tips-aligned', 'All line tips sit at the same x (one shared clock, like Arena)', async () => {
  const xs = await pg.evaluate(() => [...document.querySelectorAll('[data-pill]')].filter(e => getComputedStyle(e).opacity > 0.5).map(e => +e.dataset.tipX).filter(Number.isFinite));
  if (xs.length < 2) return { pass: false, detail: `${xs.length} pills` };
  const spread = Math.max(...xs) - Math.min(...xs);
  return { pass: spread <= 6, detail: `${xs.length} tips spread over ${spread.toFixed(0)}px` };
}));
main(() => check('history-no-empty-left', 'The lines start at the plot\'s left edge (no empty band before them)', async () => {
  const r = await pg.evaluate(() => {
    const svg = [...document.querySelectorAll('svg')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 300 && b.top < innerHeight && b.bottom > 0; }).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    const xs = [...svg.querySelectorAll('[data-x-tick]')].map(t => t.getBoundingClientRect().left);
    const paths = [...svg.querySelectorAll('path')].filter(p => (p.getAttribute('stroke') || '').startsWith('#') || (p.getAttribute('stroke') || '').startsWith('rgb') ).map(p => p.getBoundingClientRect()).filter(b => b.width > 10);
    const plotLeft = Math.min(...xs, ...paths.map(b => b.left)), leftmostLine = Math.min(...paths.map(b => b.left)), right = Math.max(...paths.map(b => b.right));
    const box = svg.getBoundingClientRect();
    return { gap: (leftmostLine - box.left) / box.width, width: (right - leftmostLine) / box.width };
  });
  return { pass: r.gap <= 0.12 && r.width >= 0.5, detail: `lines start ${(r.gap * 100).toFixed(0)}% in and span ${(r.width * 100).toFixed(0)}% of the plot` };
}));
// --- Trends overtakes (owner 2026-11-08): "the default should be bb100 not chips"; "its not as
// obvious when a given place change happens ... do we keep the y axis static the same way lmarena
// does?"; "the 'distance' between each llm is not that big and apparent"; "the y axis and x axis of
// history is not same font". bb/100 by default, a steady y axis, finer gridlines, pills with rank and
// value, and an overtake shown by a pill swap, a highlight and a crossing marker. The card is open here. ---
main(() => check('history-default-bb100', 'Trends opens on bb/100; Chips is one click away', async () => {
  const r = await pg.evaluate(() => {
    const g = [...document.querySelectorAll('[role=group][aria-label=Metric]')].find(e => e.getBoundingClientRect().width > 0);
    const on = g && [...g.querySelectorAll('button')].find(b => b.getAttribute('aria-pressed') === 'true')?.textContent.trim();
    const other = g && [...g.querySelectorAll('button')].some(b => b.textContent.trim() === 'Chips');
    const title = [...document.querySelectorAll('svg text')].some(t => t.textContent.trim() === 'bb/100' && t.getBoundingClientRect().width > 0);
    return { on, other, title };
  });
  return { pass: r.on === 'bb/100' && r.other && r.title, detail: `Metric ${r.on ?? 'missing'}, Chips option ${r.other ? 'there' : 'missing'}, axis title ${r.title ? 'bb/100' : 'not bb/100'}` };
}));
// The caption under the legend is gone (owner 2026-11-08, via the orchestrator): it said "Lines start at 20 hands · hover
// for every model · click a label for its 95% band", and the lines no longer start at 20 hands.
main(() => check('history-no-caption', 'No caption under the Trends legend (it said "Lines start at 20 hands · hover for every model · click a label for its 95% band")', async () => {
  const t = await pg.evaluate(() => [...document.querySelectorAll('span, p')].filter(e => e.childElementCount === 0 && e.getBoundingClientRect().width > 0 && /Lines start at|hover for every model|click a label for its|bb\/100 starts once/.test(e.textContent)).map(e => e.textContent.trim()));
  return { pass: !t.length, detail: t.length ? `still shows "${t[0]}"` : 'no caption' };
}));
// Lines start at hand 0, not 20 (owner 2026-11-08, via the orchestrator). At rest (every hand): the first x tick is 0 at the
// plot's left edge, the earliest line starts there, and every line starts at 0 (break-even with no hands played: a
// model that joined later starts on the zero line where it joined, not at its rate after 20 hands).
main(() => check('history-starts-at-zero', 'At rest the Trends x axis starts at hand 0, the first line starts there, and every line starts from 0 at its first hand (no 20-hand start)', async () => {
  await clickText(pg, 'Skip'); await sleep(1500);
  const r = await pg.evaluate(() => {
    const plot = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0);
    const [top, h] = plot.dataset.plot.split(',').map(Number), [y0, y1] = plot.dataset.yRange.split(',').map(Number);
    const zero = top + (y1 / (y1 - y0)) * h, x0 = +plot.querySelector('clipPath rect').getAttribute('x');
    const ticks = [...plot.querySelectorAll('[data-x-tick]')].map(e => ({ t: e.textContent, x: +e.getAttribute('x') })).sort((a, b) => a.x - b.x);
    const starts = [...plot.querySelectorAll('g[clip-path] > path[fill=none]:not([stroke-dasharray])')].map(p => { const [x, y] = (p.getAttribute('d') || 'M0,0').slice(1).split(/L/)[0].split(',').map(Number); return { who: p.getAttribute('stroke'), x, y }; });
    return { tick: ticks[0], x0, zero, starts };
  });
  const off = r.starts.filter(s => Math.abs(s.y - r.zero) > 0.5), first = Math.min(...r.starts.map(s => s.x));
  const ok = r.tick?.t === '0' && Math.abs(r.tick.x - r.x0) < 0.5 && r.starts.length > 1 && Math.abs(first - r.x0) < 0.5 && !off.length;
  return { pass: ok, detail: `first x tick ${r.tick ? `"${r.tick.t}" ${(r.tick.x - r.x0).toFixed(1)}px from the plot's left` : 'none'}; ${r.starts.length} lines, the first starting ${(first - r.x0).toFixed(1)}px from it; ${off.length} not starting at 0${off.length ? ` (${off.slice(0, 3).map(s => `${s.who} ${(r.zero - s.y).toFixed(0)}px off`).join(', ')})` : ''}` };
}));
// One replay from the start, sampled every frame until it has ended and settled: how much of the
// plot's height the visible tips span, and how far the y axis moves per frame.
let camSamples = null, camAnims = null;
const camRun = async () => {
  if (camSamples) return camSamples;
  await clickText(pg, 'Skip'); await sleep(300);
  await pg.evaluate(s => {
    window.__replaySpeed = s;
    // Every pill shake, tip pop and splash as it starts (a 4x shake lasts 75 ms, a frame or four): who, which, when, and
    // how far its keyframes reach (px across x for a shake, the scale for a pop).
    window.__anims = [];
    const orig = Element.prototype.animate;
    Element.prototype.animate = function (kf, opts) {
      const pill = this.matches?.('[data-pill]'), tip = this.dataset?.tip, splash = opts?.id === 'burst' && !this.previousElementSibling;
      if (pill || tip != null || splash) {
        const fs = parseFloat(getComputedStyle(this).fontSize), len = v => { const m = String(v ?? '').match(/(-?[\d.]+)(px|em)?/); return m ? Math.abs(+m[1]) * (m[2] === 'em' ? fs : 1) : 0; };
        const amp = Math.max(0, ...(Array.isArray(kf) ? kf : []).map(k => /pop/.test(opts?.id) ? +(String(k.transform).match(/scale\(([\d.]+)/)?.[1] ?? 1) : len(k.translate ?? String(k.transform ?? '').match(/translateX\(([^)]+)\)/)?.[1])));
        window.__anims.push({ at: performance.now(), id: opts?.id, amp, lead: splash && this.parentElement?.dataset.lead != null, name: splash ? this.parentElement?.dataset.burst : pill ? this.querySelector('[data-pill-name]')?.textContent : tip });
      }
      return orig.apply(this, arguments);
    };
  }, SPEED);
  const clicked = await clickText(pg, 'Replay');
  await pg.evaluate(() => { window.__replaySpeed = 1; }); // read once, by the click: later replays play at 1x
  if (!clicked) throw new Error('no Replay button');
  // Sample times are replay time (real ms x SPEED), so every window below is the same at any speed.
  await pg.evaluate(S => {
    const t0 = (window.__t0 = performance.now()), out = (window.__cam = []);
    const f = () => {
      const plot = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0);
      if (plot) {
        const [top, h] = plot.dataset.plot.split(',').map(Number), [y0, y1] = plot.dataset.yRange.split(',').map(Number);
        const pills = [...plot.querySelectorAll('[data-pill]')];
        const tys = pills.filter(e => +e.style.opacity > 0.5).map(e => +e.dataset.ty);
        const ticks = [...plot.querySelectorAll('[data-y-tick]')].map(e => e.textContent);
        const name = e => e.querySelector('[data-pill-name]')?.textContent;
        out.push({
          t: (performance.now() - t0) * S, y0, y1, fit: plot.dataset.yFit, fill: tys.length > 1 ? (Math.max(...tys) - Math.min(...tys)) / h : null,
          out: tys.length ? Math.max(0, top - Math.min(...tys), Math.max(...tys) - top - h) : 0, labels: ticks.join(' '), nTicks: ticks.length,
          // The worst vertical overlap (px) between two y labels that show at all (fading ones too), and which.
          ylab: (() => {
            const ls = [...plot.querySelectorAll('svg text[text-anchor=end]')].map(e => {
              let o = 1; for (let n = e; n && n !== plot; n = n.parentElement) o *= +getComputedStyle(n).opacity;
              const r = e.getBoundingClientRect(); return { t: e.textContent, o, top: r.top, bottom: r.bottom };
            }).filter(l => l.o > 0.05 && l.bottom > l.top);
            let worst = 0, pair = '';
            for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
              const ov = Math.min(ls[i].bottom, ls[j].bottom) - Math.max(ls[i].top, ls[j].top);
              if (ov > worst) [worst, pair] = [ov, `${ls[i].t}/${ls[j].t}`];
            }
            return { worst, pair, n: ls.length };
          })(),
          order: pills.slice().sort((a, b) => +a.dataset.rank - +b.dataset.rank).map(name).join('|'),
          emph: pills.filter(e => e.hasAttribute('data-emph')).map(name), lineEmph: plot.querySelectorAll('path[data-emph]').length,
          markers: [...plot.querySelectorAll('[data-overtake-marker]')].map(e => e.dataset.overtakeMarker),
          swaps: pills.filter(e => e.getAnimations().some(a => a.id === 'pill-swap' && a.playState === 'running')).map(name),
          playing: !!plot.querySelector('[data-race-clock]'), live: plot.dataset.live != null,
          vis: pills.filter(e => +e.style.opacity > 0.5).map(name),
          // Pills shaking now: which shake, and how far (px, any transform or translate) they sit off their place across x.
          shakes: pills.flatMap(e => {
            const a = e.getAnimations().find(a => /shake/.test(a.id) && a.playState === 'running');
            if (!a) return [];
            const cs = getComputedStyle(e), m = cs.transform.match(/matrix\(([^)]+)\)/);
            return [{ name: name(e), id: a.id, dx: (parseFloat(cs.translate) || 0) + (m ? +m[1].split(',')[4] : 0) }];
          }),
          // Line tips popping now (scaled up and back).
          pops: [...plot.querySelectorAll('[data-tip]')].filter(e => e.getAnimations().some(a => /pop/.test(a.id) && a.playState === 'running')).map(e => e.dataset.tip),
          // Overtake splashes on screen: which one, who, where (design units) and in what colour, beside the passer's pill.
          bursts: [...plot.querySelectorAll('[data-burst]')].map(b => {
            const pill = pills.find(e => name(e) === b.dataset.burst), dot = b.querySelector('span');
            return { id: b.dataset.n ?? b.dataset.burst, lead: b.dataset.lead != null, dots: b.childElementCount, size: dot ? parseFloat(getComputedStyle(dot).width) : 0, name: b.dataset.burst, x: +b.dataset.x, y: +b.dataset.y, color: dot && getComputedStyle(dot).backgroundColor, tx: pill ? +pill.dataset.tx : null, ty: pill ? +pill.dataset.ty : null, pillColor: pill && getComputedStyle(pill).borderTopColor };
          }),
          // How far (design px) any line's recent stretch (the last quarter of its drawn window) or tip lies outside the plot band.
          clip: (() => {
            const svg = plot.querySelector('svg'), x0 = +svg.querySelector('clipPath rect').getAttribute('x');
            const ls = [...svg.querySelectorAll('g[clip-path] > path[fill=none]:not([stroke-dasharray])')].map(p => ({ who: p.getAttribute('stroke'), q: (p.getAttribute('d') || '').split(/[ML]/).filter(Boolean).map(s => s.split(',').map(Number)) })).filter(l => l.q.length);
            const end = Math.max(...ls.map(l => l.q.at(-1)[0])), cut = x0 + 0.75 * (end - x0);
            let worst = 0, who = '', y0 = Infinity, y1 = -Infinity;
            for (const l of ls) for (const [px, py] of [...l.q.filter(q => q[0] >= cut), l.q.at(-1)]) {
              const d = Math.max(0, top - py, py - top - h);
              if (d > worst) [worst, who] = [d, `${l.who} at x ${px.toFixed(0)}`];
              [y0, y1] = [Math.min(y0, py), Math.max(y1, py)];
            }
            // span: how much of the plot's height the recent stretches and tips cover (the zoom onto them).
            return { worst, who, lines: ls.length, span: ls.length ? (y1 - y0) / h : null };
          })(),
        });
      }
      if (performance.now() - t0 < 63_000 / S) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }, SPEED);
  await sleep(63_500 / SPEED);
  camAnims = await pg.evaluate(S => window.__anims.map(a => ({ ...a, t: (a.at - window.__t0) * S })), SPEED);
  return (camSamples = await pg.evaluate(() => window.__cam));
};
const near = (ss, s) => ss.reduce((a, b) => (Math.abs(b.t - s * 1000) < Math.abs(a.t - s * 1000) ? b : a));
// A dynamic y axis (owner 2026-11-08: "its so hard to tell the true diff between each model so maybe a
// dynamic y axis will make those diffs much more apparent", pointing at Exa's chart). It replaces the
// steady axis (history-y-steady) and the one-third fill floor (history-y-fill): the axis follows the
// lines in view, narrowing as well as widening, so the pack fills the plot; it eases, never jumps.
// Since 2026-11-08 the lines' recent stretch is never clipped (history-no-recent-clip), so where a line ran
// beyond the tips lately (the leader's peak above its tip at rest) the zoom is judged on that stretch instead:
// the tips span ≥60% of the plot, or the recent stretches and tips span ≥80% (the axis hugs them, air aside).
main(() => check('history-y-dynamic', 'The y axis follows the lines in view: it moves in the replay (widens and narrows), the visible tips span ≥60% of the plot (or the recent stretches ≥80%) at 10 s, 30 s, 50 s and at rest, tips never leave the plot, and it eases (≤4% of its range per 60 Hz frame)', async () => {
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
  const fills = [...at, rest].map(a => a.fill), spans = [...at, rest].map(a => a.clip.span);
  const zoomed = fills.every((f, i) => (f != null && f >= 0.6) || (spans[i] != null && spans[i] >= 0.8));
  const ok = ss.length > 100 && moved / ss.length >= 0.25 && wider > 0 && narrower > 0 && zoomed && !outs.length && worst <= 0.04;
  const pct = f => (f == null ? 'no tips' : `${(f * 100).toFixed(0)}%`);
  const both = i => `${pct(fills[i])} (recent ${pct(spans[i])})`;
  return { pass: ok, detail: `fill 10s ${both(0)}, 30s ${both(1)}, 50s ${both(2)}, rest ${both(3)}; axis moved in ${((moved / (ss.length || 1)) * 100).toFixed(0)}% of frames (${wider} wider, ${narrower} narrower), worst ${(worst * 100).toFixed(1)}% per frame; tips outside the plot in ${outs.length} frames` };
}));
// Y labels never overlap (orchestrator 2026-11-08, from the pages-flow worker: Trends y-axis labels overlapped mid-
// animation, "800/750"): when the gridlines' step changes, the old labels fade out as the new fade in; one on its way
// out gives way at once to a label it would touch. Checked in every frame of the replay, fading labels included.
main(() => check('history-y-labels-apart', 'No two Trends y-axis labels overlap in any frame of the replay, fading ones included', async () => {
  const ss = (await camRun()).filter(s => s.ylab), bad = ss.filter(s => s.ylab.worst > 1);
  const worst = ss.reduce((m, s) => (s.ylab.worst > m.ylab.worst ? s : m), ss[0]);
  return { pass: ss.length > 100 && !bad.length, detail: `${bad.length} of ${ss.length} frames with labels overlapping${bad.length ? `; worst ${worst.ylab.worst.toFixed(1)}px (${worst.ylab.pair}) at ${(worst.t / 1000).toFixed(1)} s` : ''}` };
}));
// Gaps readable: 6–8 labelled gridlines at rest, and at least 6 through nearly all of the replay.
main(() => check('history-y-gridlines', 'At least 6 labelled y gridlines (6–8 at rest, ≥6 in 90% of replay frames)', async () => {
  const ss = (await camRun()).filter(s => s.t > 1000);
  const ok6 = ss.filter(s => s.nTicks >= 6).length / (ss.length || 1);
  await clickText(pg, 'Skip'); await sleep(1500);
  const rest = await pg.evaluate(() => [...[...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0).querySelectorAll('[data-y-tick]')].map(e => e.textContent));
  return { pass: rest.length >= 6 && rest.length <= 8 && ok6 >= 0.9, detail: `at rest ${rest.length} [${rest.join(' ')}]; ≥6 in ${(ok6 * 100).toFixed(0)}% of replay frames` };
}));
// Every pill says its rank (1, 2, … top to bottom) and its value, so the gap to its neighbour is explicit.
main(() => check('history-pill-rank-value', 'Every Trends pill shows its rank (in order, top to bottom) and its current value', async () => {
  const r = await pg.evaluate(() => {
    const plot = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0);
    const pills = [...plot.querySelectorAll('[data-pill]')].filter(e => +e.style.opacity > 0.5).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return pills.map(e => [e.querySelector('[data-pill-rank]')?.textContent, e.querySelector('[data-pill-name]')?.textContent, e.querySelector('[data-pill-value]')?.textContent]);
  });
  const bad = r.filter((p, i) => p[0] !== String(i + 1) || !/^[+−]?\d[\d,]*(\.\d+)?$/.test(p[2] ?? ''));
  return { pass: r.length > 1 && !bad.length, detail: bad.length ? `bad: ${JSON.stringify(bad.slice(0, 3))}` : r.map(p => `${p[0]} ${p[1]} ${p[2]}`).join(', ') };
}));
// Replay time with the page's stalls taken out: a frame over 50 ms of real time (a loaded machine, another lane's work)
// counts as 50 ms, and inside such a frame the clock stops after its first 50 ms. The overtake checks time the chart's
// effects against the swap on this clock, so the chart is never charged for time the page could not run.
const effOf = ss => {
  const cap = 50 * SPEED, stall = [0];
  for (let i = 1; i < ss.length; i++) stall.push(stall[i - 1] + Math.max(0, ss[i].t - ss[i - 1].t - cap));
  return t => {
    let lo = 0, hi = ss.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ss[m].t <= t) lo = m; else hi = m - 1; }
    return ss[lo].t - stall[lo] + Math.min(t - ss[lo].t, cap);
  };
};
// Every overtake the replay showed: a pill that moved above another between two frames (both there before and
// after) while it played (and was live); t in replay ms, `before` the frame before (the swap came after it). `lead`: the passer became #1. `vis`: either pill shows. `left`: replay
// ms until the replay ended (it clears what is still queued).
const overtakesOf = ss => {
  const end = ss.findLast(s => s.playing)?.t ?? 0, out = [];
  for (let i = 1; i < ss.length; i++) {
    // While it plays and no scene tween runs (the replay's first half second morphs from the resting chart: no overtakes).
    if (ss[i].order === ss[i - 1].order || !ss[i].live || !ss[i - 1].live) continue;
    const was = ss[i - 1].order.split('|'), is = ss[i].order.split('|'), pw = new Map(was.map((n, k) => [n, k]));
    is.forEach((a, ka) => is.slice(ka + 1).forEach(b => {
      if (pw.has(a) && pw.has(b) && pw.get(a) > pw.get(b)) out.push({ a, b, t: ss[i].t, before: ss[i - 1].t, lead: ka === 0 && was[0] !== a, vis: ss[i].vis.includes(a) || ss[i].vis.includes(b), left: end - ss[i].t });
    }));
  }
  return out;
};
// An overtake is obvious: the two pills swap with a slide, the passer's pill and line light up while
// the rest dim, and a marker shows the crossing; one highlight and ring at a time. Since 2026-11-08 the
// splash (history-overtake-burst) and the shake (history-overtake-shake) are back and no longer count here.
main(() => check('history-overtake', 'A rank change in the replay swaps the pills (slide), highlights the passer (pill and line) and marks the crossing; one highlight and ring at a time', async () => {
  const ss = await camRun();
  const starts = ss.filter((s, i) => s.markers.length && s.markers[0] !== ss[i - 1]?.markers[0]);
  const full = starts.filter(e => {
    const [a] = e.markers[0].split('|');
    const w = ss.filter(s => s.t >= e.t - 50 && s.t <= e.t + 400);
    return w.some(s => s.emph.includes(a) && s.lineEmph === 1) && w.some(s => s.swaps.includes(a));
  });
  const many = ss.filter(s => s.markers.length > 1 || s.emph.length > 1).length;
  const changes = ss.filter((s, i) => i && s.order !== ss[i - 1].order).length;
  return { pass: full.length >= 1 && !many, detail: `${starts.length} overtake events in ${((ss.at(-1)?.t ?? 0) / 1000).toFixed(0)} s (${changes} rank changes), ${full.length} with swap + highlight + marker; ${many} frames with two at once` };
}));
// The Arena-style overtake splash on every place change (owner 2026-11-08: "every time a place change happens in
// trends, why am I not seeing any shaking or anything? It doesn't look or feel the same as LMArena"): a burst in the
// passer's colour at its tip for every overtake with a pill on screen, at once or queued (150 ms apart) within 1 s;
// a tip that started splashing up to 200 ms before the swap (its dots still flying out) counts. At most 3 on screen. A lead
// change (a new #1) splashes bigger (more and larger dots). Where the two collide (the opening scramble: ~18 place
// changes in one second), the cap wins: an overtake may go without its own splash only while the layer is full
// (3 on screen in at least half the frames of that second) or the page stalled (a frame over 50 ms), for 15% of
// overtakes at most; no splash lasts over 1.2 s.
main(() => check('history-overtake-burst', 'Every overtake in the replay with a pill on screen splashes in the passer\'s colour at its tip (at once or queued within 1 s; the cap of 3 on screen wins in a crowd, for ≤15%), with the swap, highlight and ring; a lead change splashes bigger', async () => {
  const ss = await camRun(), eff = effOf(ss), ots = overtakesOf(ss).filter(o => o.vis && o.left >= 1000);
  const starts = ss.filter((s, i) => s.markers.length && s.markers[0] !== ss[i - 1]?.markers[0]);
  const bstarts = ss.flatMap((s, i) => s.bursts.filter(b => !ss[i - 1]?.bursts.some(c => c.id === b.id)).map(b => ({ ...b, t: s.t })));
  const went = camAnims.filter(a => a.id === 'burst'); // every splash as it started (the frames can miss a short one)
  const hit = o => went.some(b => b.name === o.a && eff(b.t) >= eff(o.before) - 210 && eff(b.t) - eff(o.t) <= 1000 && (!o.lead || b.lead));
  const full = o => { const w = ss.filter(s => s.t >= o.t && s.t <= o.t + 1000); return w.length > 0 && w.filter(s => s.bursts.length >= 3).length >= w.length / 2; };
  // A frame over 50 ms of real time around it (the queue's timers could not run, and it drops what waited a second): the
  // machine's doing, not the chart's.
  const stalled = o => ss.some((s, i) => i && s.t >= o.t - 100 && ss[i - 1].t <= o.t + 1000 && s.t - ss[i - 1].t > 50 * SPEED);
  const unhit = ots.filter(o => !hit(o)), capped = unhit.filter(full), stalls = unhit.filter(o => !full(o) && stalled(o));
  const missed = unhit.filter(o => !full(o) && !stalled(o)), excused = capped.length + stalls.length;
  // A splash that lingered would keep the layer full and excuse everything: each must be gone within 1.2 s (a lead's 800 ms, and frames).
  const seen = new Map(); for (const s of ss) for (const b of s.bursts) seen.set(b.id, [seen.get(b.id)?.[0] ?? eff(s.t), eff(s.t)]);
  const longest = Math.max(0, ...[...seen.values()].map(([a, z]) => z - a));
  const leads = ots.filter(o => o.lead);
  const good = starts.filter(e => {
    const [a] = e.markers[0].split('|');
    const w = ss.filter(s => s.t >= e.t - 50 && s.t <= e.t + 400);
    const cues = w.some(s => s.emph.includes(a) && s.lineEmph === 1) && w.some(s => s.swaps.includes(a));
    return cues && bstarts.some(b => b.name === a && Math.abs(b.t - e.t) <= 250);
  });
  const crowd = Math.max(0, ...ss.map(s => s.bursts.length));
  const offs = bstarts.filter(b => b.tx == null || Math.hypot(b.x - b.tx, b.y - b.ty) > 8 || b.color !== b.pillColor);
  const why = offs.slice(0, 3).map(b => `${b.name} at ${(b.t / 1000).toFixed(1)} s: ${b.tx == null ? 'no pill' : `${Math.hypot(b.x - b.tx, b.y - b.ty).toFixed(0)}px from its tip, ${b.color} vs ${b.pillColor}`}`).join(', ');
  const big = bstarts.filter(b => b.lead), small = bstarts.filter(b => !b.lead);
  const bigger = big.every(b => small.every(s => b.dots > s.dots && b.size > s.size));
  const miss = missed.slice(0, 3).map(o => `${o.a} past ${o.b}${o.lead ? ' (lead)' : ''} at ${(o.t / 1000).toFixed(1)} s, its splashes at ${went.filter(b => b.name === o.a && Math.abs(b.t - o.t) < 2000).map(b => `${((eff(b.t) - eff(o.t)) / 1000).toFixed(2)}${b.lead ? '*' : ''}`).join('/') || 'none'} s`).join(', ');
  return {
    pass: ots.length >= 1 && !missed.length && excused <= ots.length * 0.15 && longest <= 1200 && good.length >= 1 && crowd <= 3 && !offs.length && bigger && (!leads.length || big.length >= 1),
    detail: `${((ss.at(-1).t - eff(ss.at(-1).t)) / 1000).toFixed(1)} s of stalls taken out; ${ots.length} overtakes with a pill on screen (${leads.length} lead changes), ${went.length} splashes (${big.length} big, longest on screen ${longest.toFixed(0)} ms); ${ots.length - unhit.length} splashed within 1 s, ${capped.length} not while 3 were on screen (cap), ${stalls.length} not across a stalled frame, ${missed.length} missed${miss ? ` (${miss})` : ''}; ${good.length} of ${starts.length} ring events splash with swap + highlight; at most ${crowd} on screen; ${offs.length} off the tip or off colour${why ? ` (${why})` : ''}; lead splashes ${bigger ? 'bigger' : 'NOT bigger'} (${big[0]?.dots ?? '-'} vs ${small[0]?.dots ?? '-'} dots)`,
  };
}));
// LMArena's shake (owner 2026-11-08, same complaint): on every overtake with a pill on screen both pills shake
// across x (a few px, eased out) within 400 ms of the swap and the passer's tip pops (scales up and back); on a
// lead change the new #1's pill shakes harder. Each shake and pop is logged as it starts (at 4x a shake lasts a
// frame or four); the frames show the pills really move.
main(() => check('history-overtake-shake', 'Every overtake in the replay with a pill on screen shakes both pills across x within 400 ms and pops the passer\'s tip; a lead change shakes the new #1 harder', async () => {
  const ss = await camRun(), eff = effOf(ss), ots = overtakesOf(ss).filter(o => o.vis && o.left >= 400), an = camAnims;
  // From a frame before the swap is seen (the frame that commits it may come first) to 400 ms after, stalls taken out.
  const near = (o, n, f) => an.some(a => a.name === n && eff(a.t) - eff(o.t) >= -150 && eff(a.t) - eff(o.t) <= 400 && f(a));
  const shook = (o, n, lead) => near(o, n, a => /shake/.test(a.id) && a.amp >= 1 && (!lead || a.id === 'pill-shake-lead'));
  const why = o => [!shook(o, o.a, o.lead) && (o.lead ? 'no lead shake' : 'passer still'), !shook(o, o.b) && 'passed still', !near(o, o.a, a => /pop/.test(a.id) && a.amp >= 1.2) && 'no tip pop'].filter(Boolean);
  const bad = ots.filter(o => why(o).length), leads = ots.filter(o => o.lead);
  const amps = id => an.filter(a => a.id === id).map(a => a.amp);
  const [norm, lead] = [amps('pill-shake'), amps('pill-shake-lead')];
  const harder = !leads.length || (lead.length && Math.min(...lead) > Math.max(...norm) * 1.4);
  const seen = id => Math.max(0, ...ss.flatMap(s => s.shakes.filter(k => k.id === id).map(k => Math.abs(k.dx))));
  const moves = seen('pill-shake') >= 1 && (!leads.length || seen('pill-shake-lead') >= 1);
  const list = bad.slice(0, 3).map(o => `${o.a} past ${o.b} at ${(o.t / 1000).toFixed(1)} s: ${why(o).join(', ')}`).join('; ');
  return {
    pass: ots.length >= 1 && !bad.length && harder && moves,
    detail: `${((ss.at(-1).t - eff(ss.at(-1).t)) / 1000).toFixed(1)} s of stalls taken out; ${ots.length} overtakes with a pill on screen (${leads.length} lead changes); ${an.filter(a => /shake/.test(a.id)).length} shakes, ${an.filter(a => /pop/.test(a.id)).length} tip pops; ${bad.length} without both shakes and the pop${list ? ` (${list})` : ''}; shakes reach ${Math.max(0, ...norm).toFixed(1)}px, lead ${lead.length ? Math.min(...lead).toFixed(1) : '-'}px; seen in frames up to ${seen('pill-shake').toFixed(1)}px and ${seen('pill-shake-lead').toFixed(1)}px`,
  };
}));
// The y axis never clips the lines' recent stretch (owner 2026-11-08: "the end graph at the end cuts off part
// of the line for mistral"): at rest and through the replay, every line's last quarter and every tip lie
// inside the plot band (2px for the clip's own margin); only older history may be clamped at the edge.
main(() => check('history-no-recent-clip', 'No line\'s recent stretch (last quarter of the window) or tip lies outside the plot, at rest and at 10, 20, 30, 40 and 50 s of the replay', async () => {
  const all = await camRun(), ss = all.filter(s => s.t > 1000);
  const at = [...[10, 20, 30, 40, 50].map(s => ({ when: `${s}s`, s: near(ss, s) })), { when: 'rest', s: all.at(-1) }];
  const bad = at.filter(a => !a.s.clip.lines || a.s.clip.worst > 2);
  const frames = ss.filter(s => s.clip.worst > 2).length, worst = ss.reduce((m, s) => (s.clip.worst > m.clip.worst ? s : m), ss[0]);
  return { pass: !bad.length, detail: `${bad.length ? bad.map(a => `${a.when}: ${a.s.clip.worst.toFixed(0)}px out (${a.s.clip.who})`).join('; ') : 'rest and 10–50 s clear'}; ${frames} of ${ss.length} replay frames over 2px, worst ${worst.clip.worst.toFixed(1)}px at ${(worst.t / 1000).toFixed(1)} s` };
}));
// The pill column is for pills only (owner 2026-11-08: "why is the x axis and graph lines going beyond the left
// side of each model name in the trend graph ... the right side of trends where all the model names are should be
// cleared for model names only"): gridlines, axes, ticks, lines, markers and splashes stop at the plot's right edge,
// left of the pills. Measured on the opened card at rest and every frame from 8 s to 40 s of the replay (after the
// first seconds, when the tips are still growing toward the column), at 1440x900 and 1728x1117.
group(() => check('history-pill-column-clear', 'Nothing but pills and their leaders right of the leftmost pill: no gridline, axis, tick, line, marker or splash, at rest and through the replay, at 1440x900 and 1728x1117', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1728, 1117]]) {
    const p = await pageAt(w, h, 'race');
    try {
      await clickCenter(p, '#race-panel'); await sleep(1500);
      await p.evaluate(() => {
        // How far (px) anything drawn in the plot reaches past the leftmost visible pill's left edge.
        window.__over = () => {
          const plot = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0);
          const pills = [...plot.querySelectorAll('[data-pill]')].filter(e => +e.style.opacity > 0.5);
          if (!pills.length) return null;
          // Each pill's resting place (an overtake's shake moves it across x for 300 ms; the column stays where it rests).
          const rest = e => { const b = e.offsetParent, r = b.getBoundingClientRect(); return r.left + e.offsetLeft * (r.width / b.offsetWidth); };
          const edge = Math.min(...pills.map(rest));
          const op = e => { let o = 1; for (let n = e; n && n !== plot; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
          const els = [...plot.querySelectorAll('svg line, svg path:not([data-leader]), svg circle, svg text, [data-burst] > span')];
          let worst = 0, who = '';
          for (const e of els) {
            const r = e.getBoundingClientRect();
            if (r.width + r.height === 0 || op(e) < 0.05 || r.right - edge <= worst) continue;
            worst = r.right - edge; who = `${e.tagName}${e.dataset?.xTick !== undefined ? ' x tick ' + e.textContent : ''}${e.getAttribute('stroke') ? ' ' + e.getAttribute('stroke') : ''}`;
          }
          return { worst, who };
        };
      });
      await clickText(p, 'Skip'); await sleep(1500);
      const rest = await p.evaluate(() => window.__over());
      await p.evaluate(s => { window.__replaySpeed = s; }, SPEED);
      if (!(await clickText(p, 'Replay'))) { bad.push(`${w}x${h}: no Replay`); continue; }
      const run = await p.evaluate(S => new Promise(res => {
        const t0 = performance.now(); let worst = { worst: 0, who: '', t: 0 }, n = 0;
        const f = () => {
          const t = (performance.now() - t0) * S; // replay time
          if (t > 8000) { const o = window.__over(); if (o) { n++; if (o.worst > worst.worst) worst = { ...o, t }; } }
          if (t < 40000) requestAnimationFrame(f); else res({ ...worst, n });
        };
        requestAnimationFrame(f);
      }), SPEED);
      if (!rest) bad.push(`${w}x${h}: no pills at rest`);
      else if (rest.worst > 0.5) bad.push(`${w}x${h} at rest: ${rest.who} ${rest.worst.toFixed(0)}px into the pill column`);
      if (!run.n) bad.push(`${w}x${h}: no replay frames sampled`);
      else if (run.worst > 0.5) bad.push(`${w}x${h} at ${(run.t / 1000).toFixed(1)} s: ${run.who} ${run.worst.toFixed(0)}px into the pill column`);
      seen.push(`${w}x${h}: clear at rest and in ${run.n} replay frames (8–40 s)`);
    } finally { await p.close(); }
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
}));
// The filter bar breathes (owner 2026-11-08: "The filters on trends: make them a bit more spacey ... it just feels a little
// cluttered at the top"): 24px between groups on a row, every control (a tray or a chip) the same height, each name level
// with its control's first row, and fewer rows than before: it was 5 rows of controls at 1440x900 (Family's tray wrapped)
// and 4 at 1728x1117.
group(() => check('history-filters-spacing', 'The Trends card\'s filter bar: 24px between groups, every control the same height, each name level with its control, at most 4 rows at 1440x900 and 3 at 1728x1117 (was 5 and 4)', async () => {
  const bad = [], seen = [];
  for (const [w, h, most] of [[1440, 900, 4], [1728, 1117, 3]]) {
    const p = await pageAt(w, h, 'race');
    try {
      await clickCenter(p, '#race-panel'); await sleep(1500);
      const r = await p.evaluate(() => {
        const bar = [...document.querySelectorAll('.flex-wrap')].find(e => e.textContent.startsWith('Metric') && e.getBoundingClientRect().width > 0);
        if (!bar) return null;
        const groups = [...bar.children].map(e => e.getBoundingClientRect());
        const gaps = groups.slice(1).flatMap((g, i) => (Math.abs(g.top - groups[i].top) < 2 ? [g.left - groups[i].right] : []));
        // The controls: boxes with a background of their own (trays and chips), not the buttons inside a tray.
        const all = [...bar.querySelectorAll('*')], bg = e => !/^(rgba\(0, 0, 0, 0\)|transparent)$/.test(getComputedStyle(e).backgroundColor);
        const ctrls = all.filter(e => bg(e) && !all.some(a => a !== e && a.contains(e) && bg(a)) && e.getBoundingClientRect().width > 0);
        const heights = [...new Set(ctrls.map(e => e.getBoundingClientRect().height.toFixed(1)))];
        const rows = [...new Set(ctrls.map(e => Math.round(e.getBoundingClientRect().top / 4)))].length;
        // Each group's name against its first control.
        const level = [...bar.children].flatMap(f => {
          const name = f.querySelector(':scope > span'), c = ctrls.find(e => f.contains(e));
          if (!name || !c) return [];
          const a = name.getBoundingClientRect(), b = c.getBoundingClientRect();
          return [{ name: name.textContent, off: (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2 }];
        });
        return { gaps, heights, rows, level, n: ctrls.length };
      });
      if (!r) { bad.push(`${w}x${h}: no filter bar`); continue; }
      const offGap = r.gaps.filter(g => Math.abs(g - 24) > 1), offLevel = r.level.filter(l => Math.abs(l.off) > 1);
      if (offGap.length) bad.push(`${w}x${h}: gaps ${r.gaps.map(g => g.toFixed(0)).join(', ')}px`);
      if (r.heights.length !== 1) bad.push(`${w}x${h}: control heights ${r.heights.join(', ')}px`);
      if (r.rows > most) bad.push(`${w}x${h}: ${r.rows} rows (at most ${most})`);
      if (offLevel.length) bad.push(`${w}x${h}: ${offLevel.map(l => `${l.name} ${l.off.toFixed(1)}px off its control`).join(', ')}`);
      seen.push(`${w}x${h}: ${r.rows} rows, gaps ${[...new Set(r.gaps.map(g => g.toFixed(0)))].join('/')}px, ${r.n} controls all ${r.heights.join('/')}px`);
    } finally { await p.close(); }
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
}));
// A sound on every collision (owner 2026-11-08, via the orchestrator): a soft whoosh when one line passes another and a
// brighter chime for a new #1, through the site's sound system. Nothing before the viewer has clicked or pressed a key,
// nothing while muted; with sound on, one sound per frame of overtakes at most and never two at once. Sped-up test
// replays are silent, so this one plays at 1x: three 6.5 s stretches of the opening, where the places change most.
group(() => check('history-overtake-sound', 'Trends overtakes sound through the site\'s sound system: nothing before a click or key press, nothing while muted; with sound on, at most one sound per overtake frame and never two at once', async () => {
  const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
  try {
    // Every Web Audio source the page starts: when it starts and ends (AudioContext time). Sound is stored as on.
    await p.evaluateOnNewDocument(() => {
      window.__snd = [];
      // A buffer source (the whoosh) has a start of its own; an oscillator (the chime) inherits its node's.
      for (const N of [AudioScheduledSourceNode.prototype, AudioBufferSourceNode.prototype].filter(n => Object.hasOwn(n, 'start'))) {
        const start = N.start;
        N.start = function (when) { const at = when || this.context.currentTime; this.__r = { when: at, until: at + (this.buffer?.duration ?? 0) }; window.__snd.push(this.__r); return start.apply(this, arguments); };
      }
      const stop = AudioScheduledSourceNode.prototype.stop;
      AudioScheduledSourceNode.prototype.stop = function (when) { if (this.__r) this.__r.until = Math.max(this.__r.until, when || this.context.currentTime); return stop.apply(this, arguments); };
      try { localStorage.setItem('nollmit:sound', 'on'); } catch {}
    });
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitStats(p); await sleep(3000); await goto(p, 'race'); await sleep(1500);
    // No trusted input yet: open the card and replay with script clicks.
    await p.evaluate(() => document.querySelector('#race-panel').click()); await sleep(1500);
    // Replays the opening at 1x for 6.5 s: the sounds it started, and the frames whose order of pills on screen changed.
    const stretch = async () => {
      await clickText(p, 'Skip'); await sleep(400);
      const n0 = await p.evaluate(() => window.__snd.length);
      if (!(await clickText(p, 'Replay'))) throw new Error('no Replay button');
      const events = await p.evaluate(() => new Promise(res => {
        const t0 = performance.now(); let last = '', n = 0;
        const f = () => {
          const plot = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0);
          const order = [...plot.querySelectorAll('[data-pill]')].filter(e => +e.style.opacity > 0.5).sort((a, b) => +a.dataset.rank - +b.dataset.rank).map(e => e.querySelector('[data-pill-name]')?.textContent).join('|');
          if (last && order !== last) n++;
          last = order;
          if (performance.now() - t0 < 6500) requestAnimationFrame(f); else res(n);
        };
        requestAnimationFrame(f);
      }));
      const snd = await p.evaluate(n0 => window.__snd.slice(n0), n0);
      // One sound: sources starting within 100 ms of its first (the chime's two notes).
      const sounds = [];
      for (const r of snd.sort((a, b) => a.when - b.when)) {
        const s = sounds.at(-1);
        if (s && r.when - s.when < 0.1) s.until = Math.max(s.until, r.until); else sounds.push({ ...r });
      }
      const overlaps = sounds.slice(1).filter((s, i) => s.when < sounds[i].until - 0.005).length;
      return { events, sounds: sounds.length, overlaps };
    };
    const before = await stretch();
    await p.keyboard.press('Shift'); await sleep(300); // the first trusted key press unlocks audio
    const on = await stretch();
    await p.evaluate(() => document.querySelector('button[aria-label="Sounds"]').click()); await sleep(300); // mute
    const muted = await stretch();
    const ok = before.sounds === 0 && on.sounds >= 1 && on.sounds <= on.events && !on.overlaps && muted.sounds === 0 && on.events > 0;
    return { pass: ok, detail: `before any key press: ${before.sounds} sounds over ${before.events} overtake frames; sound on: ${on.sounds} sounds over ${on.events} overtake frames, ${on.overlaps} overlapping; muted: ${muted.sounds} sounds over ${muted.events}` };
  } finally { await p.close(); }
}));
// One type for the chart's furniture (owner: "the y axis and x axis of history is not same font").
main(() => check('history-type', 'Trends type: x and y ticks alike, axis titles alike (13px muted body sans), pills 13px (names medium, values tabular)', async () => {
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
}));
// Since 2026-11-08 ticks and pills are 13px (history-type, the orchestrator's type audit); the hover
// readout keeps the Profiles cells' 14px.
main(() => check('history-number-style', 'Trends numbers (ticks, pills, readout) use the body sans, tabular; the readout at the Profiles cells\' 14px, ticks and pills at 13px', async () => {
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
}));

// The overview tile gets its own Replay once the lines have stopped (owner 2026-11-08): hidden while
// the replay plays, it fades in after the replay ends or is skipped, restarts it, and never opens the card.
group(() => check('history-overview-replay', 'The Trends tile shows Replay only once the replay has ended or been skipped; it is keyboard-focusable, restarts the replay and leaves the card closed', async () => {
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
}));

main(() => check('replay-no-reset', 'The replay never restarts on open, back or scroll', async () => {
  const playing = await pg.evaluate(() => [...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Skip' && e.getBoundingClientRect().width > 0));
  if (!playing && !(await clickText(pg, 'Replay'))) return { pass: false, detail: 'neither Skip nor Replay shown' };
  await sleep(2000); const h1 = await replayHand(pg);
  await clickPrefix(pg, 'Back to overview'); await sleep(1500); const h2 = await replayHand(pg);
  await goto(pg, 'race'); await sleep(1500); const h3 = await replayHand(pg);
  return { pass: h1 != null && h2 != null && h3 != null && h1 <= h2 && h2 <= h3 && h3 > h1, detail: `${h1} → ${h2} → ${h3}` };
}));

// --- Time sync (the replay is running from the check above) ---
main(() => check('sync-in-step', 'While Trends replays, Profiles and Matchups stay within one step of its hand', async () => {
  await goto(pg, 'stats'); await sleep(1200);
  const h = await hands(pg);
  const race = h['race-panel'], prof = h['stats-panel'], mu = h['pairwise-panel'];
  if (!race || !prof || !mu) return { pass: false, detail: `hooks missing: ${JSON.stringify(h)}` };
  const step = prof.step || 25;
  const ok = race.hand - prof.hand >= 0 && race.hand - prof.hand <= step && Math.abs(race.hand - mu.hand) <= 1;
  return { pass: ok, detail: `history ${race.hand}, profiles ${prof.hand} (step ${step}), matchups ${mu.hand}` };
}));

// While the replay steps Profiles through its snapshots, rows never sit on top of each other. Rows
// now slide to a new place (each cell's content moves; Chrome ignores transforms on a table row), and
// two rows that swap cross mid-slide by design: the rule is judged on rows at rest.
// Each row's name (the content that moves) and its offset from the row's top; rows without one (dash rows) are left out.
const nameOffsets = () => [...document.querySelectorAll('#stats-card tbody tr')].map(r => { const s = r.querySelector('th > span.inline-block'); return s ? { o: s.getBoundingClientRect().top - r.getBoundingClientRect().top, b: s.getBoundingClientRect() } : null; }).filter(Boolean);
main(() => check('profiles-rows-no-overlap', 'During the replay, no two Profiles rows overlap (rows at rest)', async () => {
  await goto(pg, 'race'); await sleep(800); // Skip and Replay live on the Trends card
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
}));

// Owner, 2026-11-07: "the animation that you use to switch rows in profits and losses, I want that same
// animation for profiles". While the replay reorders Profiles, a row's content is seen mid-slide.
main(() => check('profiles-rows-slide', 'When the replay reorders Profiles, rows slide to their new place (not snap)', async () => {
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
}));

// Owner, 2026-11-07: "I still see the cells jiggle a bit when a number changes". A changed Matchups
// cell only changes colour and figure: every cell stays exactly in its grid slot, at its size.
main(() => check('matchups-cells-still', 'Matchups cells never move or scale when a value changes', async () => {
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
}));

// Owner, 2026-11-07: "Trends ... pretty smooth. For profiles, it's not as smooth" (the tile's text
// shrank to ~45% on the first frame of the glide and grew back, as the card's table replaced it scaled
// down), and the card took over from the gliding tile with a jump in size. While a tile glides to its
// card, Profiles' figures stay at their size, and the card takes over exactly where the tile ends.
main(() => check('glide-smooth', 'Opening Profiles and Matchups: no jump at the hand-over, Profiles text never shrinks', async () => {
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
}));

// --- Matchups and Profiles opened ---
main(() => check('matchups-no-fade', 'Opening Matchups grows the matrix without fading it', async () => {
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
}));
// Every matrix cell has one shape, and the matrix grows from the tile into the card without stretching: the card's
// cells have the tile's shape. Was "squares on the tile and in the card" until 2026-11-08, when the overview took the
// table stage's width (page-edges-match): square cells could not fill the wider Matchups tile, so they widen with the
// column (full figures), never taller than wide.
main(() => check('matchups-cell-shape', 'Matchups cells: one shape on the tile, never taller than wide; the card\'s cells the tile\'s shape (the matrix grows without stretching)', async () => {
  const shape = sel => pg.evaluate(sel => {
    const c = [...document.querySelectorAll(`${sel} td[data-cell]`)].map(e => e.getBoundingClientRect()).filter(r => r.width > 4 && r.height > 4).map(r => r.width / r.height);
    return c.length ? { lo: Math.min(...c), hi: Math.max(...c) } : null;
  }, sel);
  await goto(pg, 'stats'); await sleep(1500); const tile = await shape('#pairwise-panel');
  await goto(pg, 'pairwise'); await sleep(1500); const card = await shape('#pairwise-card');
  if (!tile || !card) return { pass: false, detail: 'no cells' };
  const ok = tile.hi / tile.lo <= 1.02 && tile.lo >= 0.98 && Math.abs(card.lo / tile.lo - 1) <= 0.05 && card.hi / card.lo <= 1.02;
  return { pass: ok, detail: `tile ${tile.lo.toFixed(2)}–${tile.hi.toFixed(2)}:1, card ${card.lo.toFixed(2)}–${card.hi.toFixed(2)}:1 (width:height)` };
}));
main(() => check('profiles-table-only', 'Opened Profiles shows the table only', async () => {
  await goto(pg, 'stats-table'); await sleep(1500);
  const t = await pg.evaluate(() => { const s = document.getElementById('stats-table'); const b = s.getBoundingClientRect(); return `${s.innerText}\n${[...document.querySelectorAll('.card-chrome')].filter(c => { const r = c.getBoundingClientRect(); return r.top >= -2 && r.top < innerHeight / 2 && r.width > 900; }).map(c => c.innerText).join('\n')}`; });
  const bad = ['with its 95% interval', '±'].filter(s => t.includes(s));
  return { pass: bad.length === 0, detail: bad.length ? `found ${bad.join(', ')}` : 'ok' };
}));

// A detail screen shows its own card alone: no other card peeking out behind or beside it.
main(() => check('detail-alone', 'An opened card is the only card visible (no card peeking out behind it)', async () => {
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
}));
// The Matchups tile is a readable preview: its cells show numbers.
main(() => check('matchups-tile-numbers', 'The Matchups tile shows a number in its cells', async () => {
  await goto(pg, 'stats'); await sleep(1500);
  const r = await pg.evaluate(() => { const cells = [...document.querySelectorAll('#pairwise-panel td')].filter(c => c.getBoundingClientRect().width > 4); const withNum = cells.filter(c => /[0-9]/.test(c.textContent)); const fs = withNum.length ? parseFloat(getComputedStyle(withNum[0]).fontSize) : 0; return { cells: cells.length, withNum: withNum.length, fs }; });
  return { pass: r.withNum >= r.cells * 0.5 && r.fs >= 10, detail: `${r.withNum}/${r.cells} cells with numbers, ${r.fs}px text` };
}));

// Owner's rules from 2026-11-07: Profiles leads with Hands (no bb/100, no rank spread); no scope line,
// session picker or Bars view on the cards; Matchups gets the wider tile; tiles never scroll.
main(() => check('profiles-columns', 'Profiles columns are Model, Hands, VPIP, PFR, AF (tile), then the trend (card)', async () => {
  const heads = sel => pg.evaluate(sel => [...document.querySelectorAll(`${sel} thead th`)].map(e => e.textContent.trim()).filter(Boolean), sel);
  await goto(pg, 'stats'); await sleep(1500); const tile = (await heads('#stats-panel')).join(',');
  // A card header also holds its tooltip's text: judge it by how it starts.
  await goto(pg, 'stats-table'); await sleep(1500); const card = (await heads('#stats-card')).map(h => ['Model', 'Hands', 'VPIP', 'PFR', 'AF', 'Last 50 hands', 'bb/100', 'Rank spread'].find(l => h.startsWith(l)) ?? h.slice(0, 12)).join(',');
  return { pass: tile === 'Model,Hands,VPIP,PFR,AF' && card === 'Model,Hands,VPIP,PFR,AF,Last 50 hands', detail: `tile ${tile} | card ${card}` };
}));
// The Profiles tile names its models (truncated if need be) at every overview size, not logos alone.
main(() => check('profiles-tile-names', 'The Profiles tile shows model names at 1440x900 and 1728x1117', async () => {
  const bad = [];
  for (const [w, h] of [[1440, 900], [1728, 1117]]) {
    const p2 = await sharedAt(w, h);
    const n = await p2.evaluate(() => [...document.querySelectorAll('#stats-panel tbody th span[translate=no]')].filter(e => e.getBoundingClientRect().width > 30).length);
    if (n < 5) bad.push(`${w}x${h}: ${n} names visible`);
  }
  return { pass: !bad.length, detail: bad.join(', ') || 'names visible at both sizes' };
}));
// No hole between the names and Hands on the Profiles tile (owner, repeatedly, 2026-11-08): the space from the
// end of the longest name to the Hands figures is no bigger than the space between two number columns.
main(() => check('profiles-no-name-gap', 'The Profiles tile has no gap between the model names and the Hands column', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1728, 1117], [1910, 1278]]) {
    const p2 = await sharedAt(w, h);
    // The Model column hugs the longest name (only its cell padding after it), and no name is cut short.
    const r = await p2.evaluate(() => {
      const ths = [...document.querySelectorAll('#stats-panel tbody th')].filter(t => t.getBoundingClientRect().height > 4);
      const names = ths.map(t => t.querySelector('[translate=no]')).filter(Boolean);
      const nameEnd = Math.max(...names.map(n => n.getBoundingClientRect().right));
      const colEnd = Math.max(...ths.map(t => t.getBoundingClientRect().right));
      return { slack: colEnd - nameEnd, cut: names.filter(n => n.scrollWidth > n.clientWidth + 1).length };
    });
    seen.push(`${w}x${h}: ${Math.round(r.slack)}px after the longest name, ${r.cut} cut`);
    if (r.slack > 24 || r.cut) bad.push(w);
  }
  return { pass: !bad.length, detail: seen.join(' | ') };
}));
main(() => check('cards-no-scope', 'No hands/all time/blinds line, Session picker or Bars view on Profiles and Matchups', async () => {
  const bad = [];
  for (const [id, card] of [['stats-table', '#stats-card'], ['pairwise', '#pairwise-card']]) {
    await goto(pg, id); await sleep(1500);
    const r = await pg.evaluate(c => { const e = document.querySelector(c); return { t: e.innerText, sel: !!e.querySelector('select'), bars: [...e.querySelectorAll('button')].some(b => b.textContent.trim() === 'Bars') }; }, card);
    if (/blinds \d|all time ·|Rank spread/.test(r.t)) bad.push(`${id}: scope text`);
    if (r.sel) bad.push(`${id}: session picker`);
    if (r.bars) bad.push(`${id}: Bars view`);
  }
  return { pass: !bad.length, detail: bad.join(', ') || 'none' };
}));
// Was "Matchups is wider than Profiles", then "at least comparable" (70% of Profiles' area). Owner, 2026-11-08:
// "matchups should be the bigger square compared to profiles. right now the numbers are too dense". At the
// three common laptop windows the Matchups tile is wider and larger than Profiles (Trends still leads:
// overview-history-leads). Reports Trends's share of the overview's tile area.
main(() => check('matchups-bigger', 'On the overview the Matchups tile is wider and larger than Profiles at 1440x900, 1512x982 and 1728x1117', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1512, 982], [1728, 1117]]) {
    const once = w === 1512, p = once ? await pageAt(w, h) : await sharedAt(w, h); // no other check uses 1512x982
    const [race, prof, mu] = await Promise.all(['#race-panel', '#stats-panel', '#pairwise-panel'].map(s => rect(p, s)));
    if (once) await p.close();
    const area = b => b.w * b.h;
    seen.push(`${w}x${h}: Matchups ${mu.w.toFixed(0)}x${mu.h.toFixed(0)} vs Profiles ${prof.w.toFixed(0)}x${prof.h.toFixed(0)} (${(area(mu) / area(prof)).toFixed(2)}x), Trends ${(area(race) / (area(race) + area(prof) + area(mu)) * 100).toFixed(0)}% of the area`);
    if (!(mu.w > prof.w && area(mu) > area(prof))) bad.push(`${w}x${h}: Matchups ${mu.w.toFixed(0)}x${mu.h.toFixed(0)} is not bigger than Profiles ${prof.w.toFixed(0)}x${prof.h.toFixed(0)}`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
// The same instruction: the tile's figures are not dense. Each cell is at least MIN px a side (td box),
// every figure sits at the tile's one size with at least 2px clear on each side (shortened to +1.1k when
// it would not), and no cell with a matchup is left without its figure.
// Owner, 2026-11-08: "matchups should be bigger so that the numbers are easier to read ... no need for a [Total]
// column for preview of matchups ... use that new space for the matchups graph". Was 32px / 40px; with the Total
// column and Profiles' spare width turned into height for the square: 33px / 42.5px (about 33.3 and 43.2; at 1440x900
// Trends' row cannot give more without its chart's text dropping under 13px, history-type). Since the overview took the
// table stage's width (2026-11-08, page-edges-match) the cells widen with the column instead (66px at 1440x900, 106px at
// 1728x1117): every figure shows in full (never +1.1k), and the height Trends' dominance leaves is at least 32.5px / 37.5px.
group(() => check('matchups-cells-roomy', 'Matchups tile cells show every figure in full, at least 32.5px (1440x900) / 37.5px (1728x1117) tall, one figure size, never edge to edge or blank', async () => {
  const bad = [], seen = [];
  for (const [w, h, min] of [[1440, 900, 32.5], [1728, 1117, 37.5]]) {
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
    const side = Math.min(...r.cells.map(c => c.h)), wide = Math.min(...r.cells.map(c => c.w));
    const tight = fig.filter(c => c.text && (c.w - c.tw) / 2 < 2);
    const blank = fig.filter(c => !c.text);
    const short = fig.filter(c => c.text && /k$/.test(c.text)); // shortened to +1.1k / +1k
    const sizes = new Set([...fig.map(c => c.size), ...r.totals]);
    seen.push(`${w}x${h}: cells ${wide.toFixed(1)}x${side.toFixed(1)}px, figures ${[...sizes].join('/')}, least clearance ${Math.min(...fig.filter(c => c.text).map(c => (c.w - c.tw) / 2)).toFixed(1)}px`);
    if (!r.cells.length) bad.push(`${w}x${h}: no cells`);
    if (side < min) bad.push(`${w}x${h}: cells ${side.toFixed(1)}px tall (< ${min})`);
    if (short.length) bad.push(`${w}x${h}: ${short.length} figures shortened (${short.slice(0, 3).map(c => c.text).join(', ')})`);
    if (sizes.size !== 1) bad.push(`${w}x${h}: figure sizes ${[...sizes].join(', ')}`);
    if (tight.length) bad.push(`${w}x${h}: ${tight.length} figures edge to edge (${tight.slice(0, 3).map(c => c.text).join(', ')})`);
    if (blank.length) bad.push(`${w}x${h}: ${blank.length} matchups without a figure`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
// The Matchups tile is its names, its square and its totals, edge to edge: no empty band beside them.
main(() => check('matchups-tile-filled', 'The Matchups matrix and its names fill the tile (no empty space beside them)', async () => {
  await goto(pg, 'stats'); await sleep(1200);
  const r = await pg.evaluate(() => {
    const t = document.querySelector('#pairwise-panel').getBoundingClientRect();
    const cells = [...document.querySelectorAll('#pairwise-panel td, #pairwise-panel a, #pairwise-panel th, #pairwise-panel div[data-cell]')].map(e => e.getBoundingClientRect()).filter(b => b.width > 2 && b.height > 2);
    const l = Math.min(...cells.map(b => b.left)), rt = Math.max(...cells.map(b => b.right));
    const names = [...document.querySelectorAll('#pairwise-panel a span')].map(e => e.getBoundingClientRect()).filter(b => b.width > 2);
    return { span: (rt - l) / (t.width - 32), nameLeft: names.length ? (Math.min(...names.map(b => b.left)) - t.left - 16) / (t.width - 32) : 1 };
  });
  return { pass: r.span >= 0.95 && r.nameLeft <= 0.12, detail: `matrix and names span ${(r.span * 100).toFixed(0)}% of the tile, longest name starts ${(r.nameLeft * 100).toFixed(0)}% in` };
}));
// Owner, 2026-11-08 (via the orchestrator): no model name cut short anywhere; the Matchups tile showed "Nemotron 3.5 S..."
// at 1728x1117. Every Matchups name shows whole, on the tile and in the card, at the owner's window sizes: its text is
// no wider than its box (a Range over the text, so a cut of a fraction of a pixel counts too).
const EDGE_SIZES = [[1440, 900], [1512, 982], [1728, 1117], [1910, 1278]];
group(() => check('matchups-names-full', 'No Matchups model name is cut short, on the tile or in the card, at 1440x900, 1512x982, 1728x1117 and 1910x1278', async () => {
  const bad = [], seen = [];
  const cut = (p, sel) => p.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().width > 0).filter(e => {
    const r = document.createRange(); r.selectNodeContents(e);
    const b = e.getBoundingClientRect(), s = getComputedStyle(e), k = b.width / (e.offsetWidth || 1); // k: a transform's scale
    return e.scrollWidth > e.clientWidth || r.getBoundingClientRect().width > b.width - (parseFloat(s.paddingLeft) + parseFloat(s.paddingRight)) * k + 0.25;
  }).map(e => e.textContent.trim()), sel);
  for (const [w, h] of EDGE_SIZES) {
    const p = await pageAt(w, h);
    try {
      const n = await p.evaluate(() => document.querySelectorAll('#pairwise-panel a [translate=no]').length);
      const tile = await cut(p, '#pairwise-panel a [translate=no]');
      await goto(p, 'pairwise'); await sleep(1500);
      const card = await cut(p, '#pairwise-card a [translate=no]');
      seen.push(`${w}x${h}: ${n} names, ${tile.length + card.length} cut`);
      if (!n) bad.push(`${w}x${h}: no names on the tile`);
      if (tile.length) bad.push(`${w}x${h} tile: ${tile.join(', ')}`);
      if (card.length) bad.push(`${w}x${h} card: ${card.join(', ')}`);
    } finally { await p.close(); }
  }
  return { pass: !bad.length, detail: bad.length ? `cut short: ${bad.join('; ')}` : seen.join(' | ') };
}));
main(() => check('tiles-no-scroll', 'Overview tiles never scroll (no scrollbar on a preview)', async () => {
  const bad = await pg.evaluate(() => ['#stats-panel', '#pairwise-panel', '#race-panel'].flatMap(s => [...document.querySelectorAll(`${s} *`)].filter(e => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)).map(() => s)));
  return { pass: !bad.length, detail: bad.length ? `scrollable inside ${[...new Set(bad)].join(', ')}` : 'none' };
}));

// Owner, 2026-11-07: the overview was "too big"; "the history graph should be the 'biggest' one ...
// the first thing that people look at"; not wall-to-wall. At 1440x900 and 1728x1117: Trends on top and
// the largest tile (1.5x the area of each other tile; the tallest row until 2026-11-08, when the second row
// grew to give Matchups bigger cells: now at most 1.1x Trends' row), with page around it (24px below; 16px above
// since 2026-11-08, when a short window gave its top margin to the "About ↓" band so Matchups' cells keep 32px).
// Beside it, since 2026-11-08 ("the same amount of white space that is to the left and right of the table ... for the
// stats page"), the table screen's page: the block spans the table stage's edges (±2px). Until then: at most 1400px
// and 80% of the window, 64px at the sides.
// Then the opened Matchups card ("so much white space to the left"; "takes up too much of the screen"):
// it hugs names, matrix and totals (no band over 8px between its edge and its content) and leaves
// page around it (at most 70% of the window's width and 85% of its height).
main(() => check('overview-history-leads', 'Trends is the dominant tile, first in reading order; the overview keeps page around it', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1728, 1117]]) {
    const p = await sharedAt(w, h);
    const [race, prof, mu] = await Promise.all(['#race-panel', '#stats-panel', '#pairwise-panel'].map(s => rect(p, s)));
    const area = b => b.w * b.h;
    const stage = await rect(p, '.stage-zoom');
    const left = Math.min(race.l, prof.l), right = Math.max(race.r, mu.r), top = race.t - 44, bottom = h - Math.max(prof.b, mu.b);
    seen.push(`${w}x${h}: Trends ${race.w.toFixed(0)}x${race.h.toFixed(0)}, Profiles ${prof.w.toFixed(0)}x${prof.h.toFixed(0)}, Matchups ${mu.w.toFixed(0)}x${mu.h.toFixed(0)}, block ${left.toFixed(0)}..${right.toFixed(0)} (table stage ${stage.l.toFixed(0)}..${stage.r.toFixed(0)}), ${top.toFixed(0)}/${bottom.toFixed(0)} above/below`);
    if (!(race.b <= Math.min(prof.t, mu.t))) bad.push(`${w}x${h}: Trends is not on top`);
    if (area(race) < 1.5 * Math.max(area(prof), area(mu))) bad.push(`${w}x${h}: Trends ${(area(race) / Math.max(area(prof), area(mu))).toFixed(2)}x the next tile's area`);
    if (race.h * 1.1 < Math.max(prof.h, mu.h) - 1) bad.push(`${w}x${h}: the second row is ${(Math.max(prof.h, mu.h) / race.h).toFixed(2)}x Trends' row (at most 1.1)`);
    if (Math.abs(left - stage.l) > 2 || Math.abs(right - stage.r) > 2) bad.push(`${w}x${h}: block ${left.toFixed(0)}..${right.toFixed(0)}, not the table stage's ${stage.l.toFixed(0)}..${stage.r.toFixed(0)}`);
    if (top < 15.5 || bottom < 23.5) bad.push(`${w}x${h}: page above/below the block ${top.toFixed(1)}/${bottom.toFixed(1)}px`); // less subpixel rounding: a block that fills its room sits at 16px
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
// Owner, 2026-11-08: "The same amount of white space that is to the left and right of the table and the profits and
// losses page, I think that's how much white space there should be for the stats page and also how much white space there
// should be for the About page." One column for every screen: the overview's tiles, each opened card (Trends, Profiles,
// Matchups) and About's column span the table stage's left and right edges (±2px) at the owner's window sizes, and the
// sticky bar's text starts where the cards' content does (a tile's title).
group(() => check('page-edges-match', 'The overview, every opened card and About span the table stage\'s left and right edges (±2px) at 1440x900, 1512x982, 1728x1117 and 1910x1278; the sticky bar\'s text starts at the cards\' content edge', async () => {
  const bad = [], seen = [];
  const edges = (p, sel) => p.evaluate(sel => {
    const bs = [...document.querySelectorAll(sel)].map(e => e.getBoundingClientRect()).filter(b => b.width > 0);
    return bs.length ? [Math.min(...bs.map(b => b.left)), Math.max(...bs.map(b => b.right))] : null;
  }, sel);
  for (const [w, h] of EDGE_SIZES) {
    const p = await pageAt(w, h);
    try {
      const stage = await edges(p, '.stage-zoom');
      const got = { overview: await edges(p, '#race-panel, #stats-panel, #pairwise-panel') };
      // The bar's first text (its "No-LLMit") against the Trends tile's title.
      const bar = await p.evaluate(() => {
        const el = [...document.querySelectorAll('div.fixed')].find(d => d.textContent.includes('Back to table'));
        const t = el && [...el.querySelectorAll('span')].find(e => e.textContent.trim() && e.getBoundingClientRect().width > 0);
        const title = document.querySelector('#race-panel h2');
        return t && title ? t.getBoundingClientRect().left - title.getBoundingClientRect().left : null;
      });
      for (const [id, name, sel] of [['race', 'Trends card', '#race-panel'], ['stats-table', 'Profiles card', '#stats-card .card-chrome'], ['pairwise', 'Matchups card', '#pairwise-card .card-chrome'], ['about', 'About', 'section[aria-label=About] .panel-scroll > div > div']]) {
        await goto(p, id); await sleep(1500);
        got[name] = await edges(p, sel);
      }
      const off = Object.entries(got).filter(([, e]) => !e || Math.abs(e[0] - stage[0]) > 2 || Math.abs(e[1] - stage[1]) > 2);
      seen.push(`${w}x${h}: stage ${stage.map(v => v.toFixed(0)).join('..')}, all within ${Math.max(...Object.values(got).filter(Boolean).flatMap(e => [Math.abs(e[0] - stage[0]), Math.abs(e[1] - stage[1])])).toFixed(1)}px; bar text ${bar === null ? 'missing' : `${bar.toFixed(1)}px`} from the titles`);
      for (const [name, e] of off) bad.push(`${w}x${h} ${name}: ${e ? e.map(v => v.toFixed(0)).join('..') : 'missing'}, not the stage's ${stage.map(v => v.toFixed(0)).join('..')}`);
      if (bar === null || Math.abs(bar) > 2) bad.push(`${w}x${h}: the sticky bar's text starts ${bar === null ? '(no bar)' : `${bar.toFixed(0)}px`} from the cards' content edge`);
    } finally { await p.close(); }
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
// Since 2026-11-08 the card spans the table stage's column like the overview (page-edges-match): its matrix widens to fill
// it (the tile's cell shape), so it still hugs; until then it was at most 70% of the window's width, 64px from its side.
main(() => check('matchups-card-hugs', 'The opened Matchups card spans the table stage\'s column, hugs its names, matrix and totals, and is not floor to ceiling', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1728, 1117]]) {
    const p = await sharedAt(w, h, 'pairwise');
    const r = await p.evaluate(() => {
      const card = document.querySelector('#pairwise-card .card-chrome'), c = card.getBoundingClientRect(), s = document.querySelector('.stage-zoom').getBoundingClientRect();
      const names = [...card.querySelectorAll('a span')].map(e => e.getBoundingClientRect()).filter(b => b.width > 2);
      const right = [...card.querySelectorAll('div[data-cell], td[data-cell]')].map(e => e.getBoundingClientRect().right);
      return { c: { l: c.left, r: c.right, w: c.width, h: c.height }, s: { l: s.left, r: s.right }, gapL: Math.min(...names.map(b => b.left)) - (c.left + 16), gapR: c.right - 16 - Math.max(...right) };
    });
    seen.push(`${w}x${h}: card ${r.c.w.toFixed(0)}x${r.c.h.toFixed(0)} at ${r.c.l.toFixed(0)}..${r.c.r.toFixed(0)} (table stage ${r.s.l.toFixed(0)}..${r.s.r.toFixed(0)}), bands ${r.gapL.toFixed(0)}/${r.gapR.toFixed(0)}px`);
    if (r.gapL > 8 || r.gapR > 8) bad.push(`${w}x${h}: empty band beside the matrix (${r.gapL.toFixed(0)}px left, ${r.gapR.toFixed(0)}px right)`);
    if (Math.abs(r.c.l - r.s.l) > 2 || Math.abs(r.c.r - r.s.r) > 2 || r.c.h > 0.85 * h) bad.push(`${w}x${h}: card ${r.c.w.toFixed(0)}x${r.c.h.toFixed(0)} at ${r.c.l.toFixed(0)}..${r.c.r.toFixed(0)}, not the table stage's ${r.s.l.toFixed(0)}..${r.s.r.toFixed(0)} or over 85% of the height`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
// Owner, 2026-11-07: "the font for the numbers in matchups doesn't feel like it matches ... unify all
// of the fonts". The reference is Profiles' cells (body sans, 14px, tabular figures): in the cards,
// Matchups' cells, its Total column and the Leader figure match it; the Matchups tile uses one size for
// every cell (no per-cell scaling); Profits & Losses uses the same family and tabular figures.
main(() => check('stats-font-unified', 'One number font across the stats cards (family, tabular figures, size by role)', async () => {
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
  const pl = await font('#table ol li div.tabular-nums');
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
}));

// Owner, 2026-11-08: "we need to do an audit on the fonts and sizes and all". One family (the body's sans),
// tabular figures, and one small scale by role on every stats tile and card (Trends's chart internals are
// checked by history-number-style): titles 20px bold; model names and data figures 14px; controls 14px
// medium; column headers and secondary text 13px (muted); the Matchups tile's figures one size (11px).
main(() => check('stats-type-scale', 'Every text role on the stats tiles and cards uses the agreed family, size, weight and colour', async () => {
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
      ['Matchups tile figures', '#pairwise-panel td[data-cell] [aria-hidden]', 11, [400], null, true],
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
      ['Matchups Total header', '#pairwise-card [title^="Big blinds won from the models shown"]', 13, [500], [MUTED]],
      ['Matchups figures', '#pairwise-card td[data-cell] [aria-hidden]', 14, [400], null, true],
      ['Matchups totals', '#pairwise-card div[data-cell] [aria-hidden]', 14, [700], null, true],
    ],
    '': [
      ['Profits & Losses', '#table ol li', 13, [700], null, true],
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
}));

// The overview must hold its proportions at any window size or browser zoom: rows and matrix
// cells are sized by content, never stretched by the window's height (cells were square until 2026-11-08: now they
// widen with the column, never taller than wide, at most 3:1), and it spans the table stage's column (page-edges-match).
group(() => check('stats-any-viewport', 'The overview keeps its proportions from 1280x720 to 3840x2160 (any zoom), in the table stage\'s column', async () => {
  const bad = [];
  for (const [w, h] of [[1280, 720], [1440, 900], [2560, 1440], [3840, 2160]]) {
    const p2 = await newPage(); await p2.setViewport({ width: w, height: h });
    await p2.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 }); await waitStats(p2); await sleep(1000);
    await goto(p2, 'stats'); await sleep(2000);
    const m = await p2.evaluate(() => {
      const rows = [...document.querySelectorAll('#stats-panel tbody tr, #stats-panel [role=row]')].map(r => r.getBoundingClientRect().height).filter(x => x > 0);
      const cells = [...document.querySelectorAll('#pairwise-panel td')].map(c => c.getBoundingClientRect()).filter(r => r.width > 4 && r.height > 4);
      const ratio = cells.length ? Math.max(...cells.map(r => r.width / r.height)) : 0, tall = cells.length ? Math.max(...cells.map(r => r.height / r.width)) : 0;
      const tiles = ['#race-panel', '#stats-panel', '#pairwise-panel'].map(s => document.querySelector(s).getBoundingClientRect()), stage = document.querySelector('.stage-zoom').getBoundingClientRect();
      const off = Math.max(Math.abs(Math.min(...tiles.map(b => b.left)) - stage.left), Math.abs(Math.max(...tiles.map(b => b.right)) - stage.right));
      const race = document.querySelector('#race-panel').getBoundingClientRect();
      const svg = [...document.querySelectorAll('#race-panel svg')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      const fill = svg ? svg.getBoundingClientRect().width / race.width : 0;
      // Profiles' rows split the second row evenly (the tile's height less its 72px header), whatever the scale.
      const tile = document.querySelector('#stats-panel').getBoundingClientRect().height;
      return { row: rows.length ? Math.max(...rows) : 0, even: (tile - 72) / 10, ratio, tall, fill, off };
    });
    await p2.close();
    const why = [];
    if (Math.abs(m.row - m.even) > 3) why.push(`Profiles rows ${m.row.toFixed(0)}px tall, not ${m.even.toFixed(0)}px`);
    if (m.tall > 1.05 || m.ratio > 3) why.push(`Matchups cells ${m.ratio.toFixed(2)}:1 (width:height)`);
    if (m.off > 2) why.push(`overview ${m.off.toFixed(0)}px off the table stage's edges`);
    if (m.fill < 0.8) why.push(`Trends chart fills ${(m.fill * 100).toFixed(0)}% of its tile`);
    if (why.length) bad.push(`${w}x${h}: ${why.join(', ')}`);
  }
  return { pass: bad.length === 0, detail: bad.length ? bad.join(' | ') : 'all four sizes hold' };
}));

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
group(() => check('about-button', '"About ↓" sits under the overview in the band below the tiles, 8px clear: identical to "Stats ↓" at 1728x1117, the same pill compact at 1440x900; it lands on About', async () => {
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
    // 8px clear, less subpixel rounding.
    if (r.clear < 7.5 || r.below < 7.5 || Math.abs(r.x) > 2) bad.push(`${w}x${h}: ${r.clear.toFixed(0)}px under the tiles, ${r.below.toFixed(0)}px above the edge, ${r.x.toFixed(0)}px off centre`);
    const clicked = await clickText(p, 'About');
    // Up to 5 s: a loaded machine can stretch the smooth scroll.
    const on = await p.waitForFunction(() => Math.abs(document.getElementById('about').getBoundingClientRect().top) < 2 && !location.hash, { timeout: 5000 }).then(() => true, () => false);
    if (!on) bad.push(`${w}x${h}: the click did not land on About (clicked ${clicked}; ${await p.evaluate(() => `y ${Math.round(scrollY)}, About at ${Math.round(document.getElementById('about').getBoundingClientRect().top)}, hash '${location.hash}', inert: ${[...document.querySelectorAll('[inert]')].map(e => e.id || e.className.toString().slice(0, 30)).join(' / ')}`)})`);
    await p.close();
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
// Owner, 2026-11-08: "the background color for the table page is different from the background color for the stats page
// and the About page. Why is it like a whole new window that shows up?" One page colour behind the table screen, the
// overview and About: the colour painted at the page's side margins (every box hit there composited over the canvas), at
// rest on each screen and half-way between two (no seam where one screen meets the next).
main(() => check('pages-one-background', 'One page background: the table screen, the stats overview and About show the same colour at their margins, at rest and half-way between them (no seam)', async () => {
  const p = await sharedAt(1440, 900);
  const r = await p.evaluate(() => {
    const rgba = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return v.length < 3 ? [0, 0, 0, 0] : [v[0], v[1], v[2], v[3] ?? 1]; };
    const alpha = e => { let o = 1; for (; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
    const [html, body] = [document.documentElement, document.body].map(e => rgba(getComputedStyle(e).backgroundColor));
    // The canvas takes the root's background, else the body's (which then paints nowhere else), else white.
    const canvas = html[3] > 0 ? html : body[3] > 0 ? body : [255, 255, 255, 1];
    const at = (x, y) => document.elementsFromPoint(x, y).reverse().reduce((col, e) => {
      if (e === document.documentElement || (e === document.body && html[3] === 0)) return col;
      const c = rgba(getComputedStyle(e).backgroundColor), a = c[3] * alpha(e);
      return col.map((v, i) => v * (1 - a) + c[i] * a);
    }, canvas.slice(0, 3)).map(Math.round).join(',');
    const top = el => el.getBoundingClientRect().top + scrollY;
    const t = top(document.querySelector('section[data-screen]')), s = top(document.getElementById('stats')), a = top(document.getElementById('about'));
    const w = document.documentElement.clientWidth, out = {};
    for (const [name, y] of [['table', t], ['table|overview', (t + s) / 2], ['overview', s], ['overview|About', (s + a) / 2], ['About', a]]) {
      window.scrollTo({ top: y, behavior: 'instant' });
      // Both side margins, top to bottom (the sticky bar and a connection bar aside).
      const seen = new Set();
      for (let py = 60; py < innerHeight - 50; py += 40) for (const px of [6, w - 6]) seen.add(at(px, py));
      out[name] = [...seen];
    }
    window.scrollTo({ top: s, behavior: 'instant' });
    return out;
  });
  const all = new Set(Object.values(r).flat());
  return { pass: all.size === 1, detail: Object.entries(r).map(([k, v]) => `${k} ${v.map(c => `rgb(${c})`).join(' + ')}`).join(', ') };
}));
// The same words: "All the assets in the stats stay put. I thought they would move because it just feels like we're
// overlaying a given page on top of the stats, rather than moving on to a new page." Paging table → overview → About and
// back, both screens move with the page: in every frame each one's content keeps its place on its own screen (nothing
// pinned, nothing sliding over), the outgoing content's top edge travels most of the window's height, and once the
// gesture lands nothing of the outgoing screen is left on screen.
late(() => check('pages-move', 'The main screens move like pages: table → overview → About and back (key and wheel), the outgoing screen\'s content scrolls away with the page while the next comes in, and none of it stays on screen when the gesture lands', async () => {
  const bad = [], seen = [];
  const p = await pageAt(1440, 900);
  await p.mouse.move(30, 450); // the page's side margin, as in main-scroll
  // Each main screen: its snap point and the top of its content (offsets are read against the snap point).
  const MARK = { table: ['section[data-screen]', 'section[data-screen] > div'], stats: ['#stats', '#race-panel'], about: ['#about', 'section[aria-label=About] :is(h1, h2)'] };
  const LEGS = [['table', 1, 'stats'], ['stats', 1, 'about'], ['about', -1, 'stats'], ['stats', -1, 'table']];
  // A key and a wheel notch: one gesture each (whether a long swipe stays one gesture is main-scroll's and scroll-consistency's).
  for (const kind of ['PageDown', 'wheel notch']) {
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await sleep(900);
    for (const [from, dir, to] of LEGS) {
      await p.evaluate(M => {
        const row = () => Object.fromEntries(Object.entries(M).map(([k, [snap, mark]]) => {
          const t = document.querySelector(mark).getBoundingClientRect().top;
          return [k, [t - document.querySelector(snap).getBoundingClientRect().top, t]];
        }));
        const m = (window.__pm = { f: [row()], on: true });
        const f = () => { m.f.push(row()); if (m.on) requestAnimationFrame(f); };
        requestAnimationFrame(f);
      }, MARK);
      const r = await step(p, kind, dir);
      const out = await p.evaluate((from, to) => {
        const m = window.__pm; m.on = false;
        // The worst frame's offset from where the screen's content sits on its own screen.
        const drift = k => Math.max(...m.f.map(row => Math.abs(row[k][0] - m.f[0][k][0])));
        // Everything of the outgoing screen still on screen: its content, and the overview's "About ↓".
        const SEL = { table: 'section[data-screen] > *', stats: '#race-panel, #stats-panel, #pairwise-panel', about: 'section[aria-label=About] :is(h1, h2, h3, p, a, button, footer, pre, .card-chrome)' };
        const els = [...document.querySelectorAll(SEL[from])];
        if (from === 'stats') els.push([...document.querySelectorAll('[data-stage] button')].find(b => b.textContent.trim() === 'About'));
        const left = els.filter(e => { const b = e?.getBoundingClientRect(); return b && b.width > 0 && b.height > 0 && b.bottom > 1 && b.top < innerHeight - 1; })
          .map(e => e.id || e.textContent.trim().slice(0, 16) || e.tagName.toLowerCase());
        return { out: drift(from), in: drift(to), travel: Math.abs(m.f.at(-1)[from][1] - m.f[0][from][1]), left, frames: m.f.length, h: innerHeight };
      }, from, to);
      const name = `${kind} ${from} ${dir > 0 ? '↓' : '↑'} ${to}`;
      seen.push(`${name}: out ${out.travel.toFixed(0)}px, drift ${out.out.toFixed(0)}/${out.in.toFixed(0)}px over ${out.frames} frames`);
      if (r.id !== to) { bad.push(`${name}: landed on ${r.id ?? `y ${r.y}`}`); break; }
      const why = [];
      if (out.out > 2) why.push(`${from} drifts ${out.out.toFixed(0)}px on its screen (pinned or sliding)`);
      if (out.in > 2) why.push(`${to} drifts ${out.in.toFixed(0)}px on its screen (pinned underneath or sliding over)`);
      if (out.travel < 0.8 * out.h) why.push(`${from} moved ${out.travel.toFixed(0)}px`);
      if (out.left.length) why.push(`still on screen: ${[...new Set(out.left)].slice(0, 4).join(', ')}`);
      if (why.length) bad.push(`${name}: ${why.join(', ')}`);
      await sleep(350);
    }
  }
  await p.close();
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
// Owner, 2026-11-08: "the About page in general just doesn't look like it belongs, so we need to change the UX/UI of the
// About page to fit in with the rest." Then: "this About page kind of sucks ... it's just too plain ... It's how we organize it",
// so About has drafts (about-drafts-switcher), each held to the same rules here. Its text is on the stats type scale: the thesis
// at the site title's 28px bold, card titles 20px bold, section labels 13px muted uppercase, figures 20px bold, body 14px, labels
// 13px muted, links and buttons blue, a number may take the stats' gain or loss colour, all in the body's sans (the code aside).
// Any card in it is a stats card (radius, ring and shadow, padding, white); cards are no longer required (a draft may set its
// sections on hairlines instead). No heading carries an emoji, and every draft fits one window at the overview's width and
// centre (not wall to wall) at 1440x900 and 1728x1117. The draft switcher is a temporary control and is left out.
const ABOUT_DRAFTS = [['a', 'Draft A'], ['b', 'Draft B'], ['current', 'Current']];
const pickDraft = (p, label) => p.evaluate(t => [...document.querySelectorAll('[data-draft-switcher] button')].find(b => b.textContent.trim() === t)?.click(), label);
// React has taken over the page (its props are on the switcher): the server's HTML shows Draft A and ignores clicks until then.
const aboutReady = p => p.waitForFunction(() => { const b = document.querySelector('[data-draft-switcher] button'); return !!b && Object.keys(b).some(k => k.startsWith('__react')); }, { timeout: 60000, polling: 100 }).catch(() => {});
main(() => check('about-fits', 'Every About draft (A, B, Current) is on the stats type scale (thesis 28px bold, titles and figures 20px bold, section labels 13px muted uppercase, body 14px, labels 13px muted, body sans), any card in it is a stats card, no heading has an emoji, and it fits one window at the overview\'s width and centre at 1440x900 and 1728x1117', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1728, 1117]]) {
    const p = await sharedAt(w, h, 'about');
    // The rule is for the page as it normally is: while the connection bar shows (a page resumed from a freeze reconnects,
    // about 2 s), every screen gives it 40px (--bar-h) and About may scroll inside itself. Wait for it to clear (30 s at
    // most), polling on a timer: a shared page can be its window's background tab, which draws no frames.
    const clear = await p.waitForFunction(() => getComputedStyle(document.querySelector('[data-page]')).getPropertyValue('--bar-h').trim() === '0px', { timeout: 30000, polling: 200 }).then(() => true, () => false);
    if (!clear) bad.push(`${w}x${h}: the connection bar never cleared (measured with it)`);
    for (const [draft, label] of ABOUT_DRAFTS) {
      await pickDraft(p, label);
      const on = await p.waitForFunction(d => document.querySelector(`[data-about-draft="${d}"]`), { timeout: 5000, polling: 100 }, draft).then(() => true, () => false);
      if (!on) { bad.push(`${w}x${h}: the switcher did not show ${label}`); continue; }
      await sleep(500);
      const r = await p.evaluate(() => {
        const TEXT = 'rgb(55, 53, 47)', MUTED = 'rgba(55, 53, 47, 0.65)', BLUE = 'rgb(35, 131, 226)', NET = ['rgb(15, 123, 108)', 'rgb(200, 50, 50)'];
        const about = document.querySelector('section[aria-label=About]'), race = document.getElementById('race-panel');
        const root = about.querySelector('[data-about-draft]'), view = root.firstElementChild;
        const why = new Set();
        // Cards: the stats cards' chrome, computed exactly as an overview tile's.
        const ref = getComputedStyle(race), KEYS = ['borderTopLeftRadius', 'boxShadow', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'backgroundColor'];
        const cards = [...view.querySelectorAll('.card-chrome')].filter(c => c.getBoundingClientRect().width > 0);
        for (const c of cards) { const s = getComputedStyle(c); for (const k of KEYS) if (s[k] !== ref[k]) why.add(`card ${k} ${s[k]}, not ${ref[k]}`); }
        // Every visible piece of text by its role.
        const body = getComputedStyle(document.body).fontFamily;
        const texts = [...view.querySelectorAll('*')].filter(e => !e.closest('pre, code, svg, .sr-only') && e.getBoundingClientRect().width > 0 && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
        for (const e of texts) {
          const s = getComputedStyle(e), size = parseFloat(s.fontSize), bold = +s.fontWeight >= 700, name = `"${e.textContent.trim().slice(0, 20)}"`;
          const control = !!e.closest('a, button'), number = /^[+−-]?[\d,.]+$/.test(e.textContent.trim());
          if (s.fontFamily !== body) why.add(`${name} in ${s.fontFamily.split(',')[0]}`);
          const ok = e.closest('h1, h2, h3, h4, h5, h6')
            ? ((size === 28 || size === 20) && bold && s.color === TEXT) || (size === 13 && s.color === MUTED && s.textTransform === 'uppercase')
            : size === 20 ? bold && s.color === TEXT
            : size === 14 ? s.color === TEXT || (control && s.color === BLUE) || (number && NET.includes(s.color))
            : size === 13 ? s.color === MUTED || (control && s.color === BLUE)
            : false;
          if (!ok) why.add(`${e.closest('h1, h2, h3, h4, h5, h6') ? 'heading ' : ''}${name} ${size}px ${s.fontWeight} ${s.color}${s.textTransform === 'none' ? '' : ` ${s.textTransform}`}`);
        }
        const emoji = [...view.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(e => e.textContent.trim()).filter(t => /\p{Extended_Pictographic}/u.test(t));
        // One window: nothing to scroll, the draft and its switcher under the sticky bar and above the window's edge, at the
        // overview's edges.
        const scroller = about.querySelector('.panel-scroll') ?? about;
        const b = view.getBoundingClientRect(), sw = root.querySelector('[data-draft-switcher]')?.getBoundingClientRect() ?? b, o = race.getBoundingClientRect();
        return { why: [...why], emoji, over: scroller.scrollHeight - scroller.clientHeight, T: Math.min(b.top, sw.top), B: Math.max(b.bottom, sw.bottom), L: b.left, R: b.right, oL: o.left, oR: o.right, h: innerHeight, n: cards.length };
      });
      seen.push(`${w}x${h} ${label}: ${r.n} cards ${r.L.toFixed(0)}..${r.R.toFixed(0)} x ${r.T.toFixed(0)}..${r.B.toFixed(0)}`);
      const why = [...r.why];
      if (r.emoji.length) why.push(`emoji in ${r.emoji.join(', ')}`);
      if (r.over > 1 || r.T < 44 || r.B > r.h) why.push(`does not fit the window (${r.over > 1 ? `scrolls ${r.over}px, ` : ''}${r.T.toFixed(0)}..${r.B.toFixed(0)} of ${r.h})`);
      if (Math.abs(r.L - r.oL) > 2 || Math.abs(r.R - r.oR) > 2) why.push(`${r.L.toFixed(0)}..${r.R.toFixed(0)} wide, not the overview's ${r.oL.toFixed(0)}..${r.oR.toFixed(0)}`);
      if (why.length) bad.push(`${w}x${h} ${label}: ${why.slice(0, 8).join('; ')}`);
    }
    await pickDraft(p, 'Draft A'); // the shared page as the other checks expect it
  }
  return { pass: !bad.length, detail: bad.length ? bad.join(' | ') : seen.join(' | ') };
}));
// Owner's rule (drafts on the site): drafts live on the real page, with real data and a switcher, never as chat mockups. About
// shows Draft A by default; ?about=a|b|current picks a draft on the home page's About screen and on /about (anything else: A);
// the switcher's buttons swap the drafts in place, the page staying on About, and keep the choice in the URL's query (never a
// hash: the URL never names a screen).
group(() => check('about-drafts-switcher', 'About shows Draft A by default; ?about=a|b|current picks Draft A, Draft B or Current (home page and /about); the switcher swaps them in place by click and keeps the choice in the query, never a hash', async () => {
  const bad = [], seen = [];
  const LABEL = Object.fromEntries(ABOUT_DRAFTS), MARK = { a: 'how a turn works', b: 'leaderboard', current: 'limitations' };
  const read = p => p.evaluate(() => {
    const root = document.querySelector('[data-about-draft]');
    const on = [...document.querySelectorAll('[data-draft-switcher] button')].find(b => b.getAttribute('aria-pressed') === 'true');
    return { draft: root?.dataset.aboutDraft, pressed: on?.textContent.trim(), text: (root?.innerText ?? '').toLowerCase(), search: location.search, hash: location.hash, top: document.getElementById('about')?.getBoundingClientRect().top };
  });
  const shows = (r, d) => r.draft === d && r.pressed === LABEL[d] && r.text.includes(MARK[d]);
  const open = async path => {
    const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
    await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await aboutReady(p); await sleep(500); // hydration swaps the server's default (A) for the URL's draft
    return p;
  };
  for (const [path, want] of [['/', 'a'], ['/?about=b', 'b'], ['/about?about=current', 'current'], ['/about?about=a', 'a'], ['/about?about=nonsense', 'a']]) {
    const p = await open(path), r = await read(p);
    await p.close();
    seen.push(`${path} → ${r.draft ?? 'none'}`);
    if (!shows(r, want)) bad.push(`${path}: shows ${r.draft ?? 'no draft'} (pressed ${r.pressed ?? 'none'}), not ${LABEL[want]}`);
  }
  // By click, on the home page's About screen.
  const p = await open('/');
  await goto(p, 'about'); await sleep(1500);
  for (const d of ['b', 'current', 'a']) {
    await pickDraft(p, LABEL[d]); await sleep(700);
    const r = await read(p);
    seen.push(`click ${LABEL[d]} → ${r.draft} ${r.search}`);
    if (!shows(r, d)) bad.push(`click ${LABEL[d]}: shows ${r.draft} (pressed ${r.pressed})`);
    if (r.search !== `?about=${d}` || r.hash) bad.push(`click ${LABEL[d]}: URL ${r.search}${r.hash}, not ?about=${d}`);
    if (Math.abs(r.top) > 1) bad.push(`click ${LABEL[d]}: the page moved off About (About at ${Math.round(r.top)})`);
  }
  await p.close();
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(', ') };
}));
// "All the content's there. It's how we organize it": every draft says everything the About said before the drafts (Current is
// the reference: its run proves each fact's pattern), with every panel and answer opened in turn: the pitch, the call and its
// system prompt, input and output (shown as code), no memory between calls, the hours, the budget's limits, what a donation
// pays for and where to give, what's coming next, and the GitHub and handle links.
const ABOUT_FACTS = [
  ['the pitch', /Watch SOTA LLMs play a No Limit Texas Hold'em cash game against each other, live/],
  ['explains its move', /Each one explains its move as it plays/],
  ['coming soon', /Playing against them, and tournaments, are coming soon/],
  ['one fresh call', /Each turn is one fresh call/],
  ['plain text', /hand so far in plain text/],
  ['same system prompt', /same system prompt/],
  ['system prompt shown', /no persona, no strategy hints[\s\S]*You are an expert No Limit Texas Hold'em poker player[\s\S]*RESPONSE FORMAT/],
  ['call input shown', /amount to call and its legal actions[\s\S]*Your hole cards: Ks Qh[\s\S]*Legal actions:/],
  ['call output shown', /Three lines: the action \(FOLD, CHECK, CALL, BET, RAISE or ALL_IN\), the amount if any, and a short reason[\s\S]*ACTION: BET\s+AMOUNT: 40\s+REASON:/],
  ['no memory', /No memory between calls/],
  ['what it never sees', /never sees earlier hands, how its opponents played, or its own earlier decisions in the hand/],
  ['hours', /Open 9am to 9pm ET, daily/],
  ['closed outside hours', /Outside those hours the table is closed and no LLMs are called/],
  ['~150 hands a day', /About 150 hands per day/],
  ['fixed budget', /The table runs on a fixed monthly budget/],
  ['~15 calls a hand', /A hand takes about 15 API calls across all 9 LLMs/],
  ['a session', /A 5-hour live cash game session has about 125 hands/],
  ['donate ask', /\$5 would be a huge help to cover/],
  ['donate: OpenRouter', /OpenRouter, the LLM calls/],
  ['donate: Railway', /Railway, the servers/],
  ['donate: Tinker', /Tinker, training LLMs to play like you/],
  ['next: datasets', /Open source datasets[\s\S]*Every action and reason each LLM gave, with what seasoned players weigh: hole cards, position, stacks and earlier actions/],
  ['next: train', /Train an LLM to play like you[\s\S]*Tinker by Thinking Machines Lab and your hands against the LLMs, without leaving the site/],
  ['next: council', /Andrej Karpathy's LLM Council will analyze how each LLM plays/],
  ['GitHub', /Open source on GitHub/],
  ['handle', /@RizzwareEngineer/],
];
const ABOUT_LINKS = ['https://openrouter.ai/', 'https://railway.com/', 'https://thinkingmachines.ai/tinker/', 'https://github.com/sponsors/RizzwareEngineer',
  'https://github.com/thinking-machines-lab/tinker-cookbook', 'https://github.com/karpathy/llm-council', 'https://github.com/RizzwareEngineer/No-LLMit', 'https://github.com/RizzwareEngineer'];
group(() => check('about-content-complete', 'Every fact and link of the About (Current) is in Draft A and Draft B, every panel and answer opened in turn: the pitch, each call (system prompt, input, output), no memory, hours, ~150 hands a day, ~15 calls a hand, budget, donate targets, coming next, GitHub and handle', async () => {
  const bad = [], seen = [];
  for (const [draft, label] of ABOUT_DRAFTS) {
    const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
    await p.goto(`${BASE}/about?about=${draft}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await aboutReady(p);
    const on = await p.waitForFunction(d => document.querySelector(`[data-about-draft="${d}"]`), { timeout: 10000 }, draft).then(() => true, () => false);
    if (!on) { bad.push(`${label}: not shown by /about?about=${draft}`); await p.close(); continue; }
    await sleep(500);
    // Opens every closed panel or answer once (one at a time where a draft allows only one), reading the text after each.
    const got = await p.evaluate(async () => {
      const root = document.querySelector('[data-about-draft]'), texts = [root.innerText], links = new Set(), done = new Set();
      const look = () => { texts.push(root.innerText); root.querySelectorAll('a[href]').forEach(a => links.add(a.href)); };
      look();
      for (let i = 0; i < 40; i++) {
        const b = [...root.querySelectorAll('button[aria-expanded=false]')].find(e => !done.has(e.textContent.trim()) && e.getBoundingClientRect().width > 0);
        if (!b) break;
        done.add(b.textContent.trim()); b.click();
        await new Promise(r => setTimeout(r, 200));
        look();
      }
      return { text: texts.join('\n'), links: [...links], opened: done.size };
    });
    await p.close();
    const missing = ABOUT_FACTS.filter(([, re]) => !re.test(got.text)).map(([name]) => name);
    const noLink = ABOUT_LINKS.filter(l => !got.links.includes(l));
    seen.push(`${label}: ${ABOUT_FACTS.length - missing.length}/${ABOUT_FACTS.length} facts, ${ABOUT_LINKS.length - noLink.length}/${ABOUT_LINKS.length} links, ${got.opened} panels opened`);
    if (missing.length || noLink.length) bad.push(`${label}: ${missing.length ? `missing ${missing.join(', ')}` : ''}${missing.length && noLink.length ? '; ' : ''}${noLink.length ? `no link to ${noLink.join(', ')}` : ''}`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join(' | ') : seen.join(' | ') };
}));
// Opens a card from the overview the way a visitor does (a click on its tile), and waits for the glide.
const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return Math.round(b[b.length >> 1]); };
const openTile = async (p, tile) => { await goto(p, 'stats'); await sleep(900); await clickCenter(p, tile); await sleep(1300); await p.mouse.move(p.viewport().width / 2, p.viewport().height / 2); };
late(() => check('scroll-consistency', 'Every wheel gesture (trackpad, gentle, notch, phased) and key (PageDown/Up, arrows, Space) moves exactly one screen, both ways, landing on a screen edge, at 1440x900 and 1728x1117: overview ↔ About, and Trends ↔ Profiles ↔ Matchups once a tile opened them; down and up move at the same speed and fade the card underneath alike; a gesture\'s ambiguous first wheel event is claimed', async () => {
  const bad = [], seen = [];
  const KEYS = new Set(['PageDown', 'ArrowDown', 'Space']);
  // [from, direction, to]: the main scroll's stats leg, then the cards' loop (entered by a click on Trends's tile).
  const MAIN = [['stats', 1, 'about'], ['about', -1, 'stats']];
  const LOOP = [['race', 1, 'stats-table'], ['stats-table', 1, 'pairwise'], ['pairwise', -1, 'stats-table'], ['stats-table', -1, 'race']];
  // The two sizes run side by side, each in a window of its own.
  const runs = await Promise.all([[1440, 900], [1728, 1117]].map(([w, h], i) => (i ? alone : f => f())(async () => {
    const bad = [], seen = [];
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
      else if (Math.abs(down - up) > Math.max(200, 0.4 * Math.max(down, up))) bad.push(`${w}x${h} ${kind}: down ${down}ms vs up ${up}ms`);
    }
    // The card underneath fades out going down and back in going up over the same time (keys: a fixed input).
    const fd = median(fades[1]), fu = median(fades[-1]);
    seen.push(`${w}x${h} fade under the incoming card ↓${fd}ms ↑${fu}ms`);
    if (!fades[1].length || !fades[-1].length || Math.abs(fd - fu) > Math.max(80, 0.4 * Math.max(fd, fu))) bad.push(`${w}x${h}: the card underneath fades ${fd}ms going down vs ${fu}ms going up`);
    await p.close();
    return { bad, seen };
  })));
  for (const r of runs) { bad.push(...r.bad); seen.push(...r.seen); }
  return { pass: !bad.length, detail: bad.length ? `${bad.slice(0, 8).join('; ')} || measured: ${seen.join(' | ')}` : seen.join(' | ') };
}));
late(() => check('main-scroll', 'The main scroll is table ↔ overview ↔ About, one gesture each (wheel or key); down on About stays on About', async () => {
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
}));
late(() => check('matchups-wraps', 'The cards loop back to the overview: down on Matchups and up on Trends (wheel or key) go back to it with the Back to overview glide, and stay there', async () => {
  const bad = [], seen = [];
  const p = await pageAt(1440, 900);
  await p.mouse.move(720, 450);
  for (const [kind, dir] of [['trackpad swipe', 1], ['wheel notch', 1], ['phased gesture', 1], ['PageDown', 1], ['ArrowDown', 1], ['Space', 1], ['trackpad swipe', -1], ['wheel notch', -1], ['PageDown', -1], ['Space', -1]]) {
    // Down on Matchups, up on Trends: each card reached from its tile, as a visitor does.
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
    const name = `${dir > 0 ? '↓ Matchups' : '↑ Trends'} ${kind}`;
    seen.push(`${name}: ${r.id ?? 'mid-way'}, ${sizes} tile sizes`);
    if (r.id !== 'stats' || !still) bad.push(`${name}: landed on ${r.id ?? `y ${r.y}`}${r.id === 'stats' && !still ? ', then moved on' : ''}`);
    else if (sizes < 4) bad.push(`${name}: no glide back (${sizes} tile sizes)`);
  }
  await p.close();
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(', ') };
}));
group(() => check('no-stats-hash', 'The URL never names a screen (open/close every card, Escape, paging, the About link, an old #race link), while #model= still opens the drawer and Back closes it; tiles open from the keyboard; /about still works', async () => {
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
  const q = await newPage(); await q.setViewport({ width: 1440, height: 900 });
  await q.goto(`${BASE}/#race`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await waitStats(q); await sleep(3000);
  const old = await q.evaluate(() => ({ y: Math.round(scrollY), h: location.hash }));
  await q.close();
  if (old.y > 2 || old.h) bad.push(`/#race: page at y ${old.y}, hash ${old.h || 'empty'}`);
  // /about stays its own page.
  const a = await newPage(); await a.setViewport({ width: 1440, height: 900 });
  const res = await a.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await sleep(1500);
  const txt = await a.evaluate(() => document.body.innerText); await a.close();
  if (res.status() !== 200 || !/Open source on GitHub/.test(txt)) bad.push(`/about: ${res.status()}${/Open source on GitHub/.test(txt) ? '' : ', no About content'}`);
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : 'hash empty throughout; #model= opens and Back closes the drawer; the About link scrolls to About; /#race opens at the top; /about works' };
}));
main(() => check('matchups-no-definition', 'The opened Matchups card has no definition line (no "Each cell" / "took the most from")', async () => {
  const p = await sharedAt(1440, 900, 'pairwise');
  const r = await p.evaluate(() => { const c = document.querySelector('#pairwise-card'); return { t: c.innerText, p: c.querySelectorAll('p').length }; });
  const found = ['Each cell', 'took the most from'].filter(x => r.t.includes(x));
  return { pass: !found.length && !r.p, detail: found.length || r.p ? `found ${found.join(', ')} (${r.p} p)` : 'no definition line' };
}));

// --- Batch 2 (owner, 2026-11-08) ---
// "History" is "Trends" everywhere a visitor sees it: tile, card, sticky bar, Back links and labels.
group(() => check('trends-name', 'No visible "History" on the stats screens or the sticky bar (text or labels); the tile and the opened card are titled Trends', async () => {
  const bad = [];
  const p = await pageAt(1440, 900);
  const look = () => p.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
    const text = [...document.querySelectorAll('body *')].filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && /History/.test(n.textContent))).map(e => e.textContent.trim().slice(0, 40));
    const labels = [...document.querySelectorAll('[aria-label], [title]')].filter(e => /History/.test(`${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`)).map(e => e.getAttribute('aria-label') ?? e.getAttribute('title'));
    return { text, labels, title: document.querySelector('#race-panel h2')?.textContent.trim() };
  });
  const a = await look();
  await clickCenter(p, '#race-panel'); await sleep(1500);
  const b = await look();
  for (const id of ['stats-table', 'pairwise']) { await goto(p, id); await sleep(1200); const c = await look(); bad.push(...c.text.map(t => `${id}: "${t}"`)); }
  await p.close();
  bad.push(...a.text.map(t => `overview: "${t}"`), ...b.text.map(t => `Trends card: "${t}"`), ...[...new Set([...a.labels, ...b.labels])].map(l => `label "${l}"`));
  if (a.title !== 'Trends' || b.title !== 'Trends') bad.push(`titles: tile "${a.title}", card "${b.title}"`);
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : 'Trends on the tile and the card; no History anywhere' };
}));
// The Leader line names its scope from the shared replay clock: "at hand N" while Trends replays, "all time"
// once it has finished or been skipped; every card says the same in the same frame.
group(() => check('leader-scope', 'The Leader says "at hand N" while the replay plays and "all time" after Skip, the same words on every card', async () => {
  const bad = [], seen = [];
  const p = await pageAt(1440, 900, 'race');
  const read = () => p.evaluate(() => [...document.querySelectorAll('span[data-scope]')].filter(e => /^Leader/.test(e.textContent) && e.getBoundingClientRect().width > 0).map(e => e.dataset.scope));
  const playing = () => p.evaluate(() => [...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Skip' && e.getBoundingClientRect().width > 0));
  if (!(await playing())) await clickText(p, 'Replay');
  await sleep(1500);
  for (const id of ['race', 'stats-table', 'pairwise']) {
    await goto(p, id); await sleep(700);
    const ls = await read();
    seen.push(`${id} playing: ${[...new Set(ls)].join(' / ')}`);
    if (!ls.length) bad.push(`${id}: no Leader`);
    else if (new Set(ls).size !== 1 || !/^at hand \d[\d,]*$/.test(ls[0])) bad.push(`${id} while playing: ${[...new Set(ls)].join(' / ')}`);
  }
  await goto(p, 'race'); await sleep(700);
  if (!(await clickText(p, 'Skip'))) bad.push('no Skip button');
  await sleep(800);
  for (const id of ['race', 'stats-table', 'pairwise']) {
    await goto(p, id); await sleep(700);
    const ls = await read();
    seen.push(`${id} after Skip: ${[...new Set(ls)].join(' / ')}`);
    if (!ls.length || ls.some(l => l !== 'all time')) bad.push(`${id} after Skip: ${[...new Set(ls)].join(' / ') || 'no Leader'}`);
  }
  await p.close();
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
}));
// Owner, 2026-11-08: "no need for a [Total] column for preview of matchups". The opened card keeps it.
main(() => check('matchups-tile-no-total', 'The Matchups tile has no Total column; the opened card does', async () => {
  await goto(pg, 'stats'); await sleep(1200);
  const tile = await pg.evaluate(() => ({ head: [...document.querySelectorAll('#pairwise-panel *')].some(e => e.childElementCount === 0 && e.textContent.trim() === 'Total'), cells: document.querySelectorAll('#pairwise-panel div[data-cell]').length }));
  await goto(pg, 'pairwise'); await sleep(1200);
  const card = await pg.evaluate(() => ({ head: [...document.querySelectorAll('#pairwise-card *')].some(e => e.childElementCount === 0 && e.textContent.trim() === 'Total' && e.getBoundingClientRect().width > 0), cells: document.querySelectorAll('#pairwise-card div[data-cell]').length, rows: document.querySelectorAll('#pairwise-card tbody tr').length }));
  const ok = !tile.head && !tile.cells && card.head && card.cells === card.rows && card.rows > 0;
  return { pass: ok, detail: `tile: ${tile.head ? 'Total header' : 'no Total header'}, ${tile.cells} totals; card: ${card.head ? 'Total header' : 'no Total header'}, ${card.cells} totals for ${card.rows} rows` };
}));

// Owner, 2026-11-08: "We should be using BB per 100 because, as we add more models, what's going to be the fair
// metric: chips all time or BB per 100?" Matchups cells are each pair's bb/100 (net chips / big blind / hands
// together x 100, as the engine counts them); the card's "All models" lineup shows everyone with hands at the
// seated lineup's cell size, scrolling inside the card with the names and logos pinned; a pair that never sat
// together is an empty cell whose readout says so; the Leader line is bb/100 among models with 500 hands.
// The engine's /api/stats, from the page's own request (the build's NEXT_PUBLIC_WS_URL); null if it never asked.
const engineStats = async p => {
  const url = await p.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).find(u => /\/api\/stats(\?|$)/.test(u)));
  return url ? { url, stats: await (await fetch(url)).json() } : null;
};
// bb/100 as the cards print it (lib/stats signedBrief): +12.3 below a thousand, +1.2k above.
const bbText = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n) < 1000 ? Math.abs(n).toFixed(1) : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(n)).toLowerCase()}`;
const bb100 = (v, bb) => (v.net_chips / bb / v.hands) * 100;
// The models the Seated now lineup shows (lib/stats seatedModels): the seated with stats when two or more have them, else all.
const seatedOf = stats => { const at = stats.models.filter(m => stats.seated?.includes(m.name)); return at.length >= 2 ? at : stats.models; };
// A button in the Matchups card's header (the Trends card has an "All models" of its own in the page's order).
const clickLineup = (p, t) => p.evaluate(t => { const b = [...document.querySelectorAll('#pairwise-card button')].find(e => e.textContent.trim() === t && e.getBoundingClientRect().width > 0); if (b) b.click(); return !!b; }, t);
const cardCells = p => p.evaluate(() => [...document.querySelectorAll('#pairwise-card td[data-cell]')].map(td => ({ key: td.dataset.cell, hands: td.dataset.hands ?? null, text: td.querySelector('[aria-hidden]')?.textContent ?? '' }))); // the visible figure (the sr-only copy aside)
group(() => check('matchups-bb100', 'Every Matchups card cell is the pair\'s bb/100: net_chips / big_blind / hands together x 100 from the engine, with those hands on it', async () => {
  const p = await pageAt(1440, 900, 'race');
  await clickText(p, 'Skip'); await sleep(800); await goto(p, 'pairwise'); await sleep(1500);
  const e = await engineStats(p);
  if (!e) { await p.close(); return { pass: false, detail: 'the page never fetched /api/stats' }; }
  const bb = e.stats.scope.big_blind, by = Object.fromEntries(e.stats.models.map(m => [m.name, m]));
  const cells = await cardCells(p);
  await p.close();
  const bad = []; let n = 0;
  for (const c of cells) {
    const [row, col] = c.key.split('|');
    if (!col || row === col) continue;
    const v = by[row]?.vs?.[col];
    if (!v?.hands) { if (c.text) bad.push(`${c.key}: "${c.text}" for a pair without hands together`); continue; }
    n++;
    const x = bb100(v, bb), want = bbText(x), whole = `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.round(Math.abs(x))}`; // a whole where the decimal does not fit
    if (c.text !== want && c.text !== whole) bad.push(`${c.key}: shows "${c.text}", engine ${v.net_chips} chips over ${v.hands} hands = ${want}`);
    if (+c.hands !== v.hands) bad.push(`${c.key}: data-hands ${c.hands}, engine ${v.hands}`);
  }
  if (n < 20) bad.push(`only ${n} pairs with hands together`);
  return { pass: !bad.length, detail: bad.length ? bad.slice(0, 5).join('; ') : `${n} cells match the engine's bb/100 (big blind ${bb})` };
}));
group(() => check('matchups-all-models', 'The Matchups card\'s "All models" shows every model with hands at the seated cell size; the grid scrolls inside the card with the row names, column logos and totals pinned', async () => {
  const p = await pageAt(1440, 900, 'race');
  await clickText(p, 'Skip'); await sleep(800); await goto(p, 'pairwise'); await sleep(1500);
  const e = await engineStats(p);
  if (!e) { await p.close(); return { pass: false, detail: 'the page never fetched /api/stats' }; }
  const seated = seatedOf(e.stats).length, all = e.stats.models.length;
  const state = () => p.evaluate(() => {
    const card = document.querySelector('#pairwise-card'), sc = card.querySelector('.panel-scroll'), box = sc.getBoundingClientRect();
    const rows = [...card.querySelectorAll('tbody tr')], cell = rows[0]?.querySelectorAll('td')[1]?.getBoundingClientRect();
    const names = [...card.querySelectorAll('a [translate=no]')].map(e => e.textContent);
    const inBox = r => r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
    // Pinned like a spreadsheet's headers: the names stay in the box as the grid scrolls sideways (their rows scroll
    // up and down with their cells, so the names of the rows in view are in the box); the logos' row stays at the
    // top as it scrolls down (its columns scroll sideways, so the logos over the columns in view are in the box).
    const inRows = [...card.querySelectorAll('a [translate=no]')].map(e => e.getBoundingClientRect()).filter(r => r.top >= box.top - 1 && r.bottom <= box.bottom + 1);
    const logos = [...card.querySelectorAll('thead th[scope=col]')].map(e => e.getBoundingClientRect()).filter(r => r.left >= box.left - 1 && r.right <= box.right + 1);
    const total = card.querySelector('[title^="Big blinds won"]')?.getBoundingClientRect();
    return { rows: rows.length, names, cell: cell && [cell.width, cell.height], scrolls: [sc.scrollWidth - sc.clientWidth, sc.scrollHeight - sc.clientHeight], pinned: { names: inRows.length > 0 && inRows.every(inBox), logos: logos.length > 0 && logos.every(inBox), total: total && inBox(total) }, scrolled: [sc.scrollLeft, sc.scrollTop] };
  });
  const before = await state();
  if (!(await clickLineup(p, 'All models'))) { await p.close(); return { pass: false, detail: 'no "All models" button on the Matchups card' }; }
  await sleep(900);
  const after = await state();
  // Scroll the card's box half way across and down, then look for the first name, the first logo and the Total header.
  await p.evaluate(() => { const sc = document.querySelector('#pairwise-card .panel-scroll'); sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2; sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2; });
  await sleep(500);
  const scrolled = await state();
  await clickLineup(p, 'Seated now'); await sleep(900);
  const back = await state();
  await p.close();
  const bad = [];
  if (before.rows !== seated) bad.push(`Seated now: ${before.rows} rows, ${seated} seated with stats`);
  if (after.rows !== all || after.names.length !== all) bad.push(`All models: ${after.rows} rows, ${after.names.length} names, ${all} models with hands`);
  if (!before.cell || !after.cell || Math.abs(before.cell[0] - after.cell[0]) > 1.5 || Math.abs(before.cell[1] - after.cell[1]) > 1.5) bad.push(`cell ${before.cell?.map(Math.round)} -> ${after.cell?.map(Math.round)}: All models changed the cell size`);
  if (all > seated && after.scrolls[0] < 10 && after.scrolls[1] < 10) bad.push(`All models: the grid does not outgrow the card (${after.scrolls.join('x')} px to scroll)`);
  if (scrolled.scrolled[0] + scrolled.scrolled[1] < 10) bad.push('the card did not scroll');
  for (const [k, v] of Object.entries(scrolled.pinned)) if (!v) bad.push(`scrolled ${scrolled.scrolled.map(Math.round)}: the ${k} in view are not pinned`);
  if (back.rows !== seated) bad.push(`back to Seated now: ${back.rows} rows`);
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `${seated} seated -> ${all} models at ${after.cell.map(Math.round).join('x')}px cells, ${after.scrolls.join('x')}px of scroll; names, logos and Total pinned at ${scrolled.scrolled.map(Math.round)}` };
}));
// No pair in the local data has never met, so the page is served a /api/stats with one seated pair's head-to-head removed.
group(() => check('matchups-never-met', 'A pair with no hands together is an empty Matchups cell whose readout says they never sat together', async () => {
  const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
  let pair = null;
  await p.setRequestInterception(true);
  p.on('request', async req => {
    if (!/\/api\/stats(\?|$)/.test(req.url()) || req.method() !== 'GET') return req.continue();
    try {
      const stats = await (await fetch(req.url())).json();
      pair ??= seatedOf(stats).slice(0, 2).map(m => m.name); // the first response picks the pair; every response (a session's too) loses it
      const [a, b] = pair;
      for (const m of stats.models) if (m.name === a || m.name === b) delete m.vs[m.name === a ? b : a];
      await req.respond({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(stats) });
    } catch (e) { req.continue(); }
  });
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 }); await waitStats(p); await sleep(3000);
  await goto(p, 'race'); await sleep(800); await clickText(p, 'Skip'); await sleep(800); await goto(p, 'pairwise'); await sleep(1500);
  if (!pair) { await p.close(); return { pass: false, detail: 'the page never fetched /api/stats' }; }
  const keys = [`${pair[0]}|${pair[1]}`, `${pair[1]}|${pair[0]}`];
  const cells = (await cardCells(p)).filter(c => keys.includes(c.key));
  const tips = [];
  for (const k of keys) {
    await p.hover(`#pairwise-card td[data-cell="${k}"]`).catch(() => {});
    await sleep(300);
    tips.push(await p.evaluate(() => document.querySelector('#pairwise-card [role=tooltip]')?.textContent ?? ''));
  }
  await p.close();
  const bad = [];
  if (cells.length !== 2) bad.push(`${cells.length} cells for ${keys.join(' and ')}`);
  for (const c of cells) if (c.text.trim()) bad.push(`${c.key}: shows "${c.text}"`);
  for (const [i, t] of tips.entries()) if (!/never sat together/.test(t)) bad.push(`${keys[i]}: readout "${t}"`);
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `${keys.join(' and ')}: empty cells, "${tips[0]}"` };
}));
group(() => check('leader-bb100', 'The Leader line is the best bb/100 among the models shown with at least 500 hands (Seated now, then All models on the Matchups card), in bb/100', async () => {
  const p = await pageAt(1440, 900, 'race');
  await clickText(p, 'Skip'); await sleep(800); await goto(p, 'pairwise'); await sleep(1500);
  const e = await engineStats(p);
  if (!e) { await p.close(); return { pass: false, detail: 'the page never fetched /api/stats' }; }
  const read = () => p.evaluate(() => { const l = [...document.querySelectorAll('#pairwise-card span[data-scope]')].find(e => e.getBoundingClientRect().width > 0); return l && { text: l.textContent, name: l.querySelector('[translate=no]')?.textContent ?? null, figure: l.querySelector('.font-bold.shrink-0')?.textContent ?? null }; });
  const want = ms => ms.filter(m => m.hands >= 500).sort((a, b) => b.bb100 - a.bb100)[0] ?? null;
  const bad = [], seen = [];
  for (const [label, ms] of [['Seated now', seatedOf(e.stats)], ['All models', e.stats.models]]) {
    if (label === 'All models' && !(await clickLineup(p, 'All models'))) { bad.push('no "All models" button'); break; }
    await sleep(900);
    const got = await read(), top = want(ms);
    seen.push(`${label}: ${got?.text}`);
    if (!got) { bad.push(`${label}: no Leader line`); continue; }
    if (!top) { if (!/No model has 500 hands yet/.test(got.text)) bad.push(`${label}: nobody has 500 hands, line "${got.text}"`); continue; }
    if (got.name !== top.name) bad.push(`${label}: names ${got.name}, the best bb/100 with 500 hands is ${top.name} (${top.hands} hands, ${top.bb100})`);
    if (got.figure !== `${bbText(top.bb100)} bb/100 all time`) bad.push(`${label}: figure "${got.figure}", want "${bbText(top.bb100)} bb/100 all time"`);
    const unqualified = ms.filter(m => m.hands < 500 && m.bb100 > top.bb100);
    if (unqualified.some(m => m.name === got.name)) bad.push(`${label}: ${got.name} leads with under 500 hands`);
  }
  await p.close();
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
// Phones and 200% browser zoom (CSS width under 768px). Owner's report: the opened Trends card collapsed to a
// strip, Matchups rows to 2-17px and overlapping, Profiles showed logos only with overlapping rows, the Matchups
// card cut off names and its last column, the overview cut off its last row. The Trends plot is at least 200px
// tall where the chart's 2.6:1 shape allows it at the card's full width (a 390px phone: about 129px; a taller
// plot there needs a phone shape in CumulativeChart).
group(() => check('small-screens', 'At 390x844 and 720x450@2x: the Trends card\'s plot fills its width (200px+ tall where the shape allows) and the card hugs it, table and matrix rows at least 24px and never overlapping, model names in Profiles and Matchups, nothing clipped without a way to scroll to it', async () => {
  const bad = [], seen = [];
  // Rows of `sel`: each at least 24px, none overlapping the next; names (`names`) visible: 5+ at least 30px wide;
  // every element of `reach` inside every clipping ancestor, and never before a scroller's start.
  const inspect = (p, rows, names, reach) => p.evaluate((rows, names, reach) => {
    const rs = [...document.querySelectorAll(rows)].map(e => e.getBoundingClientRect()).filter(b => b.width > 0);
    const short = rs.filter(b => b.height < 24).length;
    let overlap = 0; for (let i = 1; i < rs.length; i++) overlap = Math.max(overlap, rs[i - 1].bottom - rs[i].top);
    const named = [...document.querySelectorAll(names)].filter(e => e.getBoundingClientRect().width >= 30).length;
    const cut = [];
    for (const e of document.querySelectorAll(reach)) {
      const b = e.getBoundingClientRect(); if (b.width === 0 || b.height === 0) continue;
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a), r = a.getBoundingClientRect();
        for (const [ax, lo, hi, alo, ahi, sc] of [['X', b.left, b.right, r.left, r.right, a.scrollLeft], ['Y', b.top, b.bottom, r.top, r.bottom, a.scrollTop]]) {
          const o = s[`overflow${ax}`];
          if ((o === 'hidden' || o === 'clip') && (lo < alo - 1 || hi > ahi + 1)) cut.push(`${e.textContent.trim().slice(0, 14) || e.tagName} cut ${ax}`);
          if ((o === 'auto' || o === 'scroll') && lo - alo + sc < -1) cut.push(`${e.textContent.trim().slice(0, 14) || e.tagName} before its scroller ${ax}`);
        }
      }
    }
    return { rows: rs.length, short, overlap, named, cut: [...new Set(cut)] };
  }, rows, names, reach);
  const judge = (where, m, wantNames = true) => {
    seen.push(`${where} ${m.rows} rows${m.overlap > 0 ? `, overlap ${m.overlap.toFixed(0)}px` : ''}${wantNames ? `, ${m.named} names` : ''}`);
    if (!m.rows) bad.push(`${where}: no rows`);
    if (m.short) bad.push(`${where}: ${m.short} rows under 24px`);
    if (m.overlap > 1) bad.push(`${where}: rows overlap ${m.overlap.toFixed(0)}px`);
    if (wantNames && m.named < 5) bad.push(`${where}: ${m.named} names visible`);
    if (m.cut.length) bad.push(`${where}: ${m.cut.slice(0, 4).join(', ')}`);
  };
  for (const [w, h, d] of [[390, 844, 2], [720, 450, 2]]) {
    const size = `${w}x${h}${d > 1 ? `@${d}x` : ''}`;
    const p = await newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: d });
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 }); await waitStats(p); await sleep(3000);
    await goto(p, 'stats'); await sleep(1500);
    judge(`${size} Profiles tile`, await inspect(p, '#stats-panel tbody tr', '#stats-panel tbody th [translate=no]', '#stats-panel tbody th, #stats-panel tbody td, #stats-panel h2'));
    judge(`${size} Matchups tile`, await inspect(p, '#pairwise-panel tbody tr', '#pairwise-panel a [translate=no]', '#pairwise-panel td[data-cell], #pairwise-panel a, #pairwise-panel h2'));
    const tileH = await rect(p, '#race-panel');
    if (!tileH || tileH.h < 150) bad.push(`${size}: Trends tile ${tileH ? tileH.h.toFixed(0) : 'missing'}px tall`);
    await clickCenter(p, '#race-panel'); await sleep(2000);
    const c = await chartBox(p);
    const shape = c ? Math.min(200, (c.w * 470) / 1220) : 200; // the chart's height at its width, at most the 200px floor
    seen.push(`${size} Trends plot ${c ? `${c.w.toFixed(0)}x${c.h.toFixed(0)}` : 'missing'}`);
    if (!c || c.h < shape - 2) bad.push(`${size}: Trends plot ${c ? `${c.w.toFixed(0)}x${c.h.toFixed(0)}` : 'missing'} (want ${shape.toFixed(0)}px tall)`);
    // The card hugs its content: no band over 24px under its legend.
    const slack = await p.evaluate(() => { const c = document.getElementById('race-panel'), r = c.getBoundingClientRect(); const low = Math.max(...[...c.querySelectorAll('*')].filter(e => !e.childElementCount || e.tagName === 'svg').map(e => e.getBoundingClientRect()).filter(b => b.width > 0 && b.height > 0).map(b => b.bottom)); return r.bottom - 16 - low; });
    if (slack > 24) bad.push(`${size} Trends card: ${slack.toFixed(0)}px empty under its content`);
    const legend = await inspect(p, '#race-panel h2', '#none', '#race-panel h2, #race-panel [role=group]');
    if (legend.cut.length) bad.push(`${size} Trends card: ${legend.cut.slice(0, 4).join(', ')}`);
    await goto(p, 'stats-table'); await sleep(1500);
    judge(`${size} Profiles card`, await inspect(p, '#stats-card tbody tr', '#stats-card tbody th [translate=no]', '#stats-card tbody th, #stats-card tbody td'));
    await goto(p, 'pairwise'); await sleep(1500);
    judge(`${size} Matchups card`, await inspect(p, '#pairwise-card tbody tr', '#pairwise-card a [translate=no]', '#pairwise-card td[data-cell], #pairwise-card a, #pairwise-card div[data-cell]'));
    await p.close();
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
}));

const beside = drain(groups, Math.max(1, LANES - 1));
for (const step of steps) await step();
await Promise.all([pg, ...shared().values()].map(p => p.close()));
await browser.__sharedCtx?.close();
await Promise.all([beside, drain(lates, Math.max(1, LANES - 1))]);
await browser.close();
results.sort((a, b) => IDS.indexOf(a.id) - IDS.indexOf(b.id));
const w = Math.max(...results.map(r => r.id.length));
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(w)}  ${(r.ms / 1000).toFixed(1).padStart(5)}s  ${r.detail}   (${r.rule})`);
console.log(`\nslowest: ${results.slice().sort((a, b) => b.ms - a.ms).slice(0, 5).map(r => `${r.id} ${(r.ms / 1000).toFixed(0)}s`).join(', ')}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
