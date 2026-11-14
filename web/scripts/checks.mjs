// Headless checks for the owner's locked UI rules. Each one can fail; a failure exits non-zero.
// Run: node scripts/checks.mjs [--base http://localhost:3100] [--skip id,id] [--only id,id] [--changed] [--replay-speed 4]
// Needs a running web server and an engine (the build's NEXT_PUBLIC_API_URL, default :8080); scripts/verify.sh starts the server, holds the machine-wide lock and checks the engine is up.
// Chrome is the system install (CHROME_PATH to override).
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
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
// in LANES - 1 lanes (with --lanes 1, after it). Checks that time scroll gestures (late) misread a busy machine, so they wait
// for the main page, then take LANES - 1 lanes (scroll-consistency opens a second window of its own). All are only
// queued while this file runs top to bottom, and start at its end.
const LANES = +arg('--lanes', 3);
const lane = new AsyncLocalStorage(), groups = [], lates = [], steps = [];
const group = fn => groups.push(fn), late = fn => lates.push(fn), main = fn => steps.push(fn);
// Every page remembers the engine stream it opened (an open EventSource has no resource timing entry), so a check can
// ask the same engine for its stats (engineStats).
const watchStream = p => { p.on('request', r => { if (/\/stream$/.test(r.url())) p.__stream = r.url(); }); return p; };
const newPage = async () => watchStream(await (lane.getStore() ?? browser).newPage());
// Runs fn in a fresh browser context (its own window), beside whatever else is running.
const alone = async fn => { const ctx = await browser.createBrowserContext(); try { return await lane.run(ctx, fn); } finally { await ctx.close().catch(() => {}); } };
const drain = (fns, n) => Promise.all(Array.from({ length: n }, async () => { while (fns.length) await alone(fns.shift()).catch(e => console.error(e)); }));

// --changed: only the checks tied to the files changed against $BASE_REF (committed, uncommitted, untracked).
// A web file no rule names, or a change to this script outside a check's own block, selects every check.
const COVERS = [
  [/components\/(PokerTable|Player|TableFelt|TableMotion|ChipStack|Card|ReasoningPanel|WinningsPanel|SessionProgress|UsageIndicator|TypewriterText|SoundToggle)\.tsx|hooks\/|lib\/(sound|amounts)\./, /^(seat-size|table-|no-currency|main-scroll|stats-type-scale)/],
  [/components\/CumulativeChart\.tsx|lib\/families\./, /^(history-|replay-|sync-|leader-|trends-|small-screens|stats-any-viewport|overview-history-leads|detail-alone|page-edges|handover-|glide-clean)/],
  [/lib\/timeline\./, /^(history-|replay-|sync-|leader-|profiles-rows-|matchups-cells-still)/],
  [/components\/StatsTable\.tsx/, /^(profiles-|glide-smooth|handover-|glide-clean|stats-|sync-|small-screens|detail-alone|cards-no-scope|leader-scope|page-edges)/],
  [/components\/HeadToHead\.tsx/, /^(matchups-|glide-smooth|handover-|glide-clean|stats-|sync-|small-screens|detail-alone|cards-no-scope|tiles-no-scroll|leader-scope|overview-history-leads|page-edges)/],
  [/components\/About\.tsx|components\/about\/|app\/about\/|lib\/systemPrompt\./, /^(about-|pages-|page-edges|main-scroll|no-stats-hash|scroll-consistency)/],
  [/components\/StickyBar\.tsx|lib\/amounts\./, /^(sticky-|table-bb-toggle)/],
  [/components\/(PokerTable|Player|TableFelt|WinningsPanel|UsageIndicator|ReasoningPanel|StickyBar|StatsTable|HeadToHead|CumulativeChart|About)\.tsx|lib\/boxes\./, /^skeleton-/],
  [/(^|\/)AGENTS\.md$/, /(?!)/], // the file next dev writes: no check covers it
];
function changedChecks() { // a Set of ids, or null for every check
  const git = c => execSync(c, { cwd: new URL('../..', import.meta.url), encoding: 'utf8' }).split('\n').filter(Boolean);
  const ref = process.env.BASE_REF || 'origin/main', me = 'web/scripts/checks.mjs';
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

const unknown = [...ONLY].filter(id => !IDS.includes(id));
if (unknown.length) { console.error(`unknown check id: ${unknown.join(', ')}`); process.exit(2); }

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
  const p = watchStream(await ctx.newPage()); await p.setViewport({ width: w, height: h });
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitStats(p);
  await sleep(3000); await goto(p, id); await sleep(2000);
  return p;
};
// One page per window size for the checks that only read it (each scrolls to its screen): a fresh page costs a load
// and 5 s of settling. Checks that click, page, replay or navigate keep a fresh page of their own.
// A parked page is a background tab behind a blank one (no frames, its timers throttled), so it takes little CPU from the
// check that is running; the page asked for is brought to the front again, where it draws (a page frozen through CDP came
// back hidden and drew nothing: its observers and scroll-driven state stood still at the screen it was left on). Shared
// pages live in a context of their own: a page left open in the main page's window would leave the main page a background
// tab, with no frames.
const shared = () => ((lane.getStore() ?? browser).__shared ??= new Map());
const sharedAt = async (w, h, id = 'stats') => {
  const p = shared().get(`${w}x${h}`), owner = lane.getStore() ?? browser;
  if (!p) {
    const ctx = owner === browser ? (browser.__sharedCtx ??= await browser.createBrowserContext()) : owner;
    const q = await pageAt(w, h, id, ctx);
    shared().__park ??= await ctx.newPage(); shared().set(`${w}x${h}`, q); await q.bringToFront(); return q;
  }
  await p.bringToFront();
  // A resumed page reconnects for a moment; measure once its connection bar is gone.
  await p.waitForFunction(() => getComputedStyle(document.querySelector('[data-page]')).getPropertyValue('--bar-h').trim() === '0px', { polling: 250, timeout: 15000 }).catch(() => {});
  await goto(p, id); await sleep(2000);
  return p;
};
const parkShared = () => shared().__park?.bringToFront().catch(() => {});
// The table's game stream, scripted (test-only). Before the page's scripts run, EventSource is wrapped: the engine's
// messages reach the page until a check takes over, then only the messages the check plays, built from the engine's
// last state (a game_state or a snapshot's) and sent to its table. So a check can put bets out, end a hand and deal the
// next on cue, whatever the shared table is doing (it may be closed or at its daily call cap). Each of window.__stream's
// plays returns when it was fed (performance.now()).
const scriptStream = p => p.evaluateOnNewDocument(() => {
  const Real = window.EventSource, s = window.__stream = { last: null, table: null, scripted: false, feed: null };
  window.EventSource = class extends Real {
    set onmessage(fn) {
      s.feed = m => fn(new MessageEvent('message', { data: JSON.stringify({ table: s.table, ...m }) }));
      super.onmessage = e => {
        if (s.scripted) return;
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'game_state') { s.last = m.payload; s.table = m.table; }
          const [id, t] = m.type === 'snapshot' ? Object.entries(m.payload.tables)[0] ?? [] : [];
          if (t) { s.last = t.state; s.table = id; }
        } catch {}
        fn(e);
      };
    }
    get onmessage() { return super.onmessage; }
  };
  const play = (...msgs) => {
    s.scripted = true;
    for (const m of msgs) { if (m.type === 'game_state') s.last = m.payload; s.feed(m); }
    return performance.now();
  };
  const open = { type: 'table_notice', payload: { kind: '', message: '' } };
  // Bets out: 5, 10 and a raise to 35 in front of seats 1-3, the raise also in the reasoning panel ("35" in its words).
  s.bets = () => {
    const l = s.last, raiser = l.players[3].name, bet = [0, 5, 10, 35];
    return play(open, { type: 'game_state', payload: { ...l, street: 'preflop', pot: 50, currentBet: 35, winners: undefined, nextHandInMs: undefined,
      players: l.players.map((q, i) => ({ ...q, status: 'active', currentBet: bet[i] ?? 0, lastAction: i === 3 ? 'RAISE' : '', lastAmount: i === 3 ? 35 : 0 })) } },
    { type: 'llm_thinking', payload: { playerIdx: 3, playerName: raiser, budgetMs: 45000, elapsedMs: 0 } },
    { type: 'llm_action', payload: { playerIdx: 3, playerName: raiser, action: 'RAISE', amount: 35, reason: 'Raising to 35 with a strong hand.' } });
  };
  // The hand ends: seat 0 takes the pot at showdown, and the next hand is due in `ms`.
  s.end = ms => {
    const l = s.last;
    return play(open, { type: 'game_state', payload: { ...l, street: 'complete', nextHandInMs: ms, currentPlayerIdx: -1, communityCards: ['Kh', '7d', '2c', '9s', 'Ks'],
      players: l.players.map((q, i) => ({ ...q, currentBet: 0, stack: i === 0 ? q.stack + l.pot : q.stack })),
      winners: [{ playerIdx: 0, amount: l.pot, handType: 'Pair', handDesc: 'Pair of Kings', eligiblePlayers: l.players.map((_, i) => i), potNumber: 1 }] } });
  };
  // The next hand: the button and the engine's position names move on a seat, two cards to every seat, the blinds posted.
  s.deal = () => {
    const l = s.last, n = l.players.length, btn = (l.players.findIndex(q => q.isButton) + 1) % n;
    const deck = [...'23456789TJQKA'].flatMap(r => [...'hdcs'].map(x => r + x));
    const blind = i => (i === (btn + 1) % n ? 5 : i === (btn + 2) % n ? 10 : 0);
    return play({ type: 'hand_start', payload: { handNumber: l.handNumber + 1 } }, { type: 'game_state', payload: { ...l, handNumber: l.handNumber + 1, street: 'preflop',
      pot: 15, currentBet: 10, communityCards: [], winners: undefined, nextHandInMs: undefined, currentPlayerIdx: (btn + 3) % n,
      players: l.players.map((q, i) => ({ ...q, isButton: i === btn, position: l.players[(i + n - 1) % n].position, holeCards: [deck[2 * i], deck[2 * i + 1]], status: 'active', lastAction: '', lastAmount: 0, currentBet: blind(i), stack: q.stack - blind(i) })) } });
  };
});
// A page at a window size on the live table, its game stream scripted, once the engine's state is in.
const scriptedTable = async (w, h, reduced = false, query = '') => {
  const p = await newPage(); await p.setViewport({ width: w, height: h });
  if (reduced) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await scriptStream(p);
  await p.goto(`${BASE}/${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => window.__stream?.last?.players?.length && document.querySelector('td.w-\\[200px\\]'), { timeout: 120000 });
  await sleep(2000);
  return p;
};
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
main(() => check('type-2-locked-boxes', 'With ?type=2 the seats are 200x128, the table 1000px, and the page is on the second type scale (data-type="2", the badge text 10px)', async () => {
  const p2 = await newPage(); await p2.setViewport({ width: 1440, height: 900 });
  await p2.goto(`${BASE}${BASE.includes('?') ? '&' : '?'}type=2`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p2.waitForFunction(() => document.querySelector('td.w-\\[200px\\]') && document.documentElement.dataset.type === '2', { timeout: 60000 }).catch(() => {});
  await sleep(2000);
  const r = await p2.evaluate(() => { const b = document.querySelector('td.w-\\[200px\\]'), t = document.querySelector('table'), g = document.querySelector('[data-position]'); return { type: document.documentElement.dataset.type, seat: [b.offsetWidth, b.offsetHeight], table: t.offsetWidth, badge: g ? getComputedStyle(g).fontSize : 'none' }; });
  await p2.close();
  return { pass: r.type === '2' && Math.abs(r.seat[0] - 200) <= 1 && Math.abs(r.seat[1] - 128) <= 2 && Math.abs(r.table - 1000) <= 1 && r.badge === '10px', detail: `type ${r.type}, seat ${r.seat.join('x')}, table ${r.table}px, badge ${r.badge}` };
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

// The felt's edge bets line up with the desktop ring of seats, and with the phone's ring (owner 2026-11-14: the seats
// on the table, not below it), where each sits beside its seat. The old phone layout (?m=1, kept to compare) has its seats
// in a grid below the felt, so its felt draws none (they lined up with no seat and could cover the board).
group(() => check('phone-felt-no-bets', 'With bets out, the felt draws them at 1440x900 and in the phone ring at 390x844, and none in the old phone layout (390x844, ?m=1)', async () => {
  const bad = [], seen = [];
  for (const [w, h, want, query] of [[1440, 900, true], [390, 844, true], [390, 844, false, '?m=1']]) {
    const p = await scriptedTable(w, h, false, query);
    await p.evaluate(() => window.__stream.bets()); await sleep(1000);
    const r = await p.evaluate(() => { const all = [...document.querySelectorAll('[data-bet]')]; return { all: all.length, shown: all.filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 || b.height > 0; }).length }; });
    seen.push(`${w}x${h}${query ?? ''}: ${r.shown} of ${r.all} bets drawn`);
    if (!r.all) bad.push(`${w}x${h}${query ?? ''}: no bets in the page`);
    else if (want ? r.shown < 3 : r.shown) bad.push(`${w}x${h}${query ?? ''}: ${r.shown} of ${r.all} bets drawn on the felt`);
    await p.close();
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));

// Owner 2026-11-14: "on mobile view it should just be the table with the players on there. the players shouldn't be at
// the bottom." Phones fold the desktop ring for a tall screen (three seats across the top, two down each side, two across
// the bottom), small enough that the reasoning bar is on the first screen. Scripted: bets out on seats 1-3 and a full board.
group(() => check('phone-table-ring', 'At 390x844 and 375x667 the table is one ring: all nine seats inside the table\'s box, none below the felt\'s bottom edge by more than one seat row, no two overlapping, none over the board or the pot, no bet on the board, the pot or a seat; every seat\'s name, stack and badge visible and not cut (the name may end in an ellipsis); the table at most 400px tall and the reasoning bar\'s top on the first screen', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[390, 844], [375, 667]]) {
    const size = `${w}x${h}`, p = await scriptedTable(w, h);
    try {
      await p.evaluate(() => { window.__stream.bets(); const s = window.__stream; s.last = { ...s.last, communityCards: ['Kh', '7d', '2c', '9s', 'Ks'] }; s.feed({ type: 'game_state', payload: s.last }); });
      await sleep(1500);
      const r = await p.evaluate(() => {
        const vis = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
        const ring = [...document.querySelectorAll('[data-ring]')].find(vis);
        if (!ring) return null;
        const box = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const meet = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
        const inside = (a, b) => a.l >= b.l - 1 && a.r <= b.r + 1 && a.t >= b.t - 1 && a.b <= b.b + 1;
        const table = box(ring), felt = box(ring.querySelector('[data-felt]')), out = [];
        const seats = [...ring.querySelectorAll('[data-seat]')].filter(vis).map(e => ({ e, i: e.dataset.seat, b: box(e) }));
        const board = [...ring.querySelectorAll('[data-felt-cards] [role=img]')].filter(vis).map(box);
        const pot = [...ring.querySelectorAll('[aria-label^="Pot"]')].filter(vis).map(box);
        const bets = [...ring.querySelectorAll('[data-bet]')].filter(vis).map(e => ({ i: e.dataset.bet, b: box(e) }));
        for (const s of seats) {
          if (!inside(s.b, table)) out.push(`seat ${s.i} outside the table`);
          if (s.b.b > felt.b + s.b.h + 1) out.push(`seat ${s.i} ${Math.round(s.b.b - felt.b)}px below the felt`);
          for (const t of seats) if (t.i > s.i && meet(s.b, t.b)) out.push(`seats ${s.i} and ${t.i} overlap`);
          if ([...board, ...pot].some(c => meet(c, s.b))) out.push(`seat ${s.i} over the board or the pot`);
          // Name, stack and badge: inside the seat and painted on top there (nothing over their middle); the stack and the
          // badge whole, the name whole or cut short by its ellipsis.
          const name = [...s.e.querySelectorAll('[title]')].find(e => !e.hasAttribute('data-position'));
          for (const [what, e] of [['name', name], ['stack', s.e.querySelector('[data-chips]')], ['badge', s.e.querySelector('[data-position]')]]) {
            if (!e || !vis(e)) { out.push(`seat ${s.i} has no ${what}`); continue; }
            const b = box(e), hit = document.elementFromPoint((b.l + b.r) / 2, (b.t + b.b) / 2);
            if (!inside(b, s.b)) out.push(`seat ${s.i}'s ${what} runs out of the seat`);
            if (!hit || !(e === hit || e.contains(hit))) out.push(`seat ${s.i}'s ${what} is covered`);
            if (e.scrollWidth > e.clientWidth + 1 && (what !== 'name' || getComputedStyle(e).textOverflow !== 'ellipsis' || b.w < 30)) out.push(`seat ${s.i}'s ${what} is cut`);
          }
        }
        for (const t of bets) if ([...board, ...pot, ...seats.map(s => s.b)].some(c => meet(c, t.b))) out.push(`bet ${t.i} on the board, the pot or a seat`);
        const reasoning = [...document.querySelectorAll('.stage-zoom .h-\\[100px\\]')].find(vis);
        return { out, seats: seats.length, board: board.length, pot: pot.length, bets: bets.length, height: table.h, reasoning: reasoning ? reasoning.getBoundingClientRect().top + scrollY : null, screen: innerHeight };
      });
      if (!r) { bad.push(`${size}: no phone table`); continue; }
      if (r.seats !== 9 || r.board !== 5 || r.pot !== 1 || r.bets < 3) bad.push(`${size}: ${r.seats} seats, ${r.board} board cards, ${r.pot} pots, ${r.bets} bets drawn`);
      if (r.height > 400) bad.push(`${size}: the table is ${Math.round(r.height)}px tall`);
      if (r.reasoning === null || r.reasoning >= r.screen) bad.push(`${size}: the reasoning bar starts at ${Math.round(r.reasoning)}px, past the first screen (${r.screen}px)`);
      if (r.out.length) bad.push(`${size}: ${r.out.slice(0, 6).join(', ')}${r.out.length > 6 ? ` and ${r.out.length - 6} more` : ''}`);
      seen.push(`${size}: table ${Math.round(r.height)}px, reasoning bar at ${Math.round(r.reasoning)}px, 9 seats and ${r.bets} bets clear`);
    } finally { await p.close(); }
  }
  return { pass: !bad.length, detail: bad.length ? bad.join(' | ') : seen.join(' | ') };
}));

// The table's amounts in chips or in big blinds (owner 2026-11-08: "a toggle view if someone cares about looking at the
// game by big blinds versus just the absolute size of the stack"). One switch in the header's status row, kept across a
// reload. Every amount on the table screen follows it in one format: seat stacks and actions, bets, the pot, Profits &
// Losses (bare, its unit in the panel's header) and the reasoning panel's action; the model's own words stay as written.
// Text only: the locked sizes never move (seats 200x128, 250x160 at 1870x1200; the table 1000px), and big blinds wrap,
// clip or cut short nothing that chips leave whole, phones included. Bets and a raise are scripted (scriptStream).
group(() => check('table-positions', 'Each seat\'s badge is the position the engine sent for it (the name the model is told), in one of the nine engine names\' own colours with a full name, and it moves with the button on the next deal', async () => {
  const p = await scriptedTable(1440, 900), bad = [], seen = [];
  const NAMES = ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'MP+1', 'HJ', 'CO'];
  const read = () => p.evaluate(() => ({ want: window.__stream.last.players.map(q => q.position ?? ''),
    got: [...document.querySelectorAll('td [data-seat]')].map(e => { const b = e.querySelector('[data-position]'); return { seat: +e.dataset.seat, text: b?.textContent.trim() ?? '', title: b?.title ?? '', grey: !!b?.className.includes('bg-gray-600') }; }) }));
  const test = async when => {
    const { want, got } = await read();
    seen.push(`${when}: ${want.join(' ')}`);
    if (got.length !== want.length) bad.push(`${when}: ${got.length} seats drawn for ${want.length} players`);
    for (const g of got) {
      if (g.text !== want[g.seat]) bad.push(`${when}: seat ${g.seat} shows '${g.text}', the engine sent '${want[g.seat]}'`);
      if (g.text && !NAMES.includes(g.text)) bad.push(`${when}: seat ${g.seat}: '${g.text}' is not an engine name`);
      if (g.text && (g.grey || !g.title || g.title === g.text)) bad.push(`${when}: seat ${g.seat}: '${g.text}' has ${g.grey ? 'the grey fallback' : 'no full name'}`);
    }
  };
  try {
    // Dealt from the engine's last state (its hand_start ends any draw for the button, which hides the badges).
    await p.evaluate(() => window.__stream.deal()); await sleep(1500);
    await test('deal');
    await p.evaluate(() => window.__stream.deal()); await sleep(1500);
    await test('next deal');
  } finally { await p.close(); }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));

group(() => check('table-shot-clock', 'The shot clock shows the turn\'s budgetMs - elapsedMs from the stream (a viewer who joins mid-turn sees the time really left) and counts down; with no budgetMs there is no clock', async () => {
  const p = await scriptedTable(1440, 900), bad = [], seen = [];
  const read = () => p.evaluate(() => { const c = document.querySelector('[data-clock]'); return c && !c.closest('.invisible') ? parseInt(c.textContent, 10) : null; });
  const think = (budgetMs, elapsedMs) => p.evaluate((budgetMs, elapsedMs) => { const s = window.__stream; s.scripted = true;
    s.feed({ type: 'llm_thinking', payload: { turn: 1, playerIdx: 2, playerName: s.last.players[2].name, budgetMs, elapsedMs } }); }, budgetMs, elapsedMs);
  const near = (got, want) => got !== null && Math.abs(got - want) <= 1;
  try {
    for (const [budget, elapsed] of [[45000, 0], [45000, 20480], [30000, 0]]) {
      await think(budget, elapsed); await sleep(300);
      const want = Math.ceil((budget - elapsed) / 1000), now = await read();
      await sleep(2200);
      const later = await read();
      seen.push(`${budget}/${elapsed}: ${now}s, then ${later}s`);
      if (!near(now, want)) bad.push(`budgetMs ${budget}, elapsedMs ${elapsed}: shows ${now ?? 'no clock'}, want ${want}s`);
      if (!near(later, want - 2)) bad.push(`budgetMs ${budget}, elapsedMs ${elapsed}: 2.2 s later shows ${later ?? 'no clock'}, want ${want - 2}s`);
    }
    await think(undefined, undefined); await sleep(1300);
    const none = await read();
    seen.push(`no budget: ${none ?? 'no clock'}`);
    if (none !== null) bad.push(`no budgetMs: a ${none}s clock is shown`);
  } finally { await p.close(); }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
}));

group(() => check('table-no-turn-glow', 'The seat on the clock glows; once the hand is complete no seat does, through the next-hand pause', async () => {
  const p = await scriptedTable(1440, 900), seen = [];
  const glowing = () => p.evaluate(() => [...document.querySelectorAll('td [data-seat].border-animation')].map(e => +e.dataset.seat));
  try {
    await p.evaluate(() => window.__stream.bets()); await sleep(1000);
    const during = await glowing();
    await p.evaluate(() => window.__stream.end(8000)); await sleep(500);
    const after = await glowing();
    await sleep(3000);
    const later = await glowing();
    seen.push(`seat 3 acting: [${during}]`, `hand complete: [${after}]`, `3.5 s into the pause: [${later}]`);
    return { pass: during.length === 1 && during[0] === 3 && !after.length && !later.length, detail: seen.join('; ') };
  } finally { await p.close(); }
}));

group(() => check('table-notice-says-why', 'Closed for the day or at the daily call cap, the felt says which, and when the table reopens in the viewer\'s time and how long that is, inside the window at 1440x900 and 390x844; no next-hand countdown; the card goes when the table runs again', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const p = await scriptedTable(w, h);
    // The card on screen (the page keeps a felt per layout; the other one is not drawn).
    const card = () => p.evaluate(() => {
      const e = [...document.querySelectorAll('[data-felt-cards] [role=status]')].find(x => x.getBoundingClientRect().width > 0), b = e?.getBoundingClientRect();
      return { text: e?.innerText.replace(/\s+/g, ' ').trim() ?? null, inside: !!b && b.left >= 0 && b.right <= innerWidth, countdown: /Next hand in/.test(document.body.innerText) };
    });
    try {
      await p.evaluate(() => window.__stream.end(1500)); await sleep(2500);
      for (const [kind, message, headline] of [['closed', 'The table is closed.', 'Table closed.'], ['cap', 'Daily LLM call limit reached.', 'Daily LLM call limit reached.']]) {
        // Reopens 13h 30m (and a little) from now, as the engine's RFC3339 reopensAt.
        const want = await p.evaluate((kind, message) => {
          const at = new Date(Date.now() + (13 * 60 + 30) * 60000 + 20000);
          window.__stream.feed({ type: 'table_notice', payload: { kind, message, reopensAt: at.toISOString() } });
          return `Reopens at ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at)} your time (in 13h 30m).`;
        }, kind, message);
        await sleep(800);
        const r = await card(), tag = `${w}x${h} ${kind}`;
        seen.push(`${tag}: '${r.text}'`);
        if (!r.text?.startsWith(headline) || !r.text.includes(want)) bad.push(`${tag}: '${r.text}', want '${headline}' and '${want}'`);
        if (r.text && !r.inside) bad.push(`${tag}: the card runs past the window`);
        if (r.countdown) bad.push(`${tag}: a next-hand countdown is shown`);
      }
      await p.evaluate(() => window.__stream.feed({ type: 'table_notice', payload: { kind: '', message: '' } })); await sleep(800);
      const after = await card();
      if (after.text !== null) bad.push(`${w}x${h} after the table runs again: '${after.text}' still shown`);
    } finally { await p.close(); }
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
}));

// A hand saved while Trends replays stretches the chart to the new hand count (an axis tween, overtakes not counted while
// it runs). It cleared the splashes as a Skip does: every one in flight vanished in one frame, and the queued were dropped.
group(() => check('history-splash-survives-hand', 'A hand saved while Trends replays leaves the overtake splashes in flight: none vanishes with its dots still out', async () => {
  const p = await scriptedTable(1440, 900);
  try {
    const e = await engineStats(p);
    if (!e) return { pass: false, detail: 'no engine stream seen' };
    await goto(p, 'race'); await sleep(2000);
    await clickText(p, 'Skip'); await sleep(1000);
    await p.evaluate(() => {
      window.__replaySpeed = 4; const log = window.__splash = { cut: 0, gone: 0, tween: false };
      new MutationObserver(ms => { for (const m of ms) for (const n of m.removedNodes) if (n.dataset?.burst != null && log.armed) { log.gone++; if (n.childElementCount) log.cut++; } }).observe(document.body, { childList: true, subtree: true });
      const plot = () => [...document.querySelectorAll('[data-plot]')].find(x => x.getBoundingClientRect().width > 0);
      const f = () => { if (log.armed && plot()?.dataset.live == null) log.tween = true; requestAnimationFrame(f); }; requestAnimationFrame(f);
    });
    if (!await clickText(p, 'Replay')) return { pass: false, detail: 'no Replay button' };
    await p.evaluate(() => { window.__replaySpeed = 1; });
    // A splash on screen, then the next hand's stats (its count one up), as the engine sends them.
    const flying = await p.waitForFunction(() => document.querySelector('[data-burst]'), { timeout: 20000 }).then(() => true, () => false);
    if (!flying) return { pass: false, detail: 'no splash in 20 s of replay' };
    const { models, ...envelope } = e.stats;
    await p.evaluate(m => { window.__splash.armed = true; window.__stream.scripted = true; window.__stream.feed(m); },
      { type: 'stats', payload: { ...envelope, scope: { ...envelope.scope, hands: envelope.scope.hands + 1 }, model_names: models.map(m => m.name), changed: [] } });
    await sleep(1500);
    const r = await p.evaluate(() => window.__splash);
    return { pass: r.tween && !r.cut, detail: `${r.tween ? 'the axis retweened' : 'no axis tween seen (nothing tested)'}; ${r.gone} splashes ended, ${r.cut} of them with their dots still out` };
  } finally { await p.close(); }
}));

group(() => check('table-reason-empty', 'An action that came with no reason still shows in the reasoning panel (its label and the action), and is announced', async () => {
  const p = await scriptedTable(1440, 900);
  try {
    await p.evaluate(() => { const s = window.__stream, q = s.last.players[2]; s.scripted = true;
      s.feed({ type: 'llm_thinking', payload: { turn: 1, playerIdx: 2, playerName: q.name, budgetMs: 45000, elapsedMs: 0 } });
      s.feed({ type: 'llm_action', payload: { turn: 1, playerIdx: 2, playerName: q.name, action: 'CALL', amount: 10, reason: '' } }); });
    await sleep(800);
    const r = await p.evaluate(() => { const live = [...document.querySelectorAll('p.sr-only[aria-live]')].find(e => e.closest('.h-\\[100px\\]'));
      const panel = live?.parentElement; return { text: panel ? panel.innerText.replace(/\s+/g, ' ').trim() : null, said: live?.textContent ?? '' }; });
    const ok = !!r.text && /Reasoning/i.test(r.text) && /CALL/.test(r.text) && /call/.test(r.said);
    return { pass: ok, detail: `panel: '${r.text}'; announced: '${r.said}'` };
  } finally { await p.close(); }
}));

group(() => check('history-timeline-fetches', 'Thirty hands of stats events fetch the replay timeline at most twice (every 25 hands, not after every hand), and every synced card\'s last hand is still the stream\'s hand count', async () => {
  const p = await scriptedTable(1440, 900), urls = [];
  try {
    const e = await engineStats(p);
    if (!e) return { pass: false, detail: 'no engine stream seen' };
    await sleep(1500);
    p.on('request', r => { if (/\/api\/stats\/timeline/.test(r.url())) urls.push(r.url()); });
    const base = e.stats.scope.hands, { models, ...envelope } = e.stats;
    for (let h = base + 1; h <= base + 30; h++) {
      await p.evaluate(m => { window.__stream.scripted = true; window.__stream.feed(m); },
        { type: 'stats', payload: { ...envelope, scope: { ...envelope.scope, hands: h }, model_names: models.map(m => m.name), changed: [] } });
      await sleep(150);
    }
    await sleep(2500);
    const ends = await p.evaluate(() => [...new Set([...document.querySelectorAll('[data-sync-hand]')].map(e => +e.dataset.syncHand))]);
    const ok = urls.length <= 2 && ends.length > 0 && ends.every(h => h === base + 30);
    return { pass: ok, detail: `hands ${base + 1}-${base + 30}: ${urls.length} timeline fetches; synced cards end at ${ends.join(', ') || 'none'}` };
  } finally { await p.close(); }
}));

group(() => check('table-bb-toggle', 'A Chips/BB switch in the status row turns every amount on the table screen (stacks, actions, bets, pot, P&L, the reasoning action) into big blinds and back, the model\'s words aside; kept across a reload; no size changes, nothing newly cut, wrapped or clipped', async () => {
  const bad = [], seen = [];
  const fmt = (chips, bb, unit) => { const v = chips / bb; return v.toLocaleString('en-US', { maximumFractionDigits: v < 100 ? 1 : 0 }) + (unit ? ' BB' : ''); };
  // The switch's two buttons (null without it), and every visible amount with its chips (data-chips) and its place.
  const read = () => {
    const group = document.querySelector('[role=group][aria-label="Amounts in"]');
    const btn = t => group && [...group.querySelectorAll('button')].find(b => b.textContent.trim() === t);
    const sec = document.querySelector('section[data-screen]'), vis = e => e.getBoundingClientRect().width > 0;
    const box = e => { const r = e.getBoundingClientRect(); return `${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10}`; };
    // Line boxes: a rect that starts below the line before it starts a new one (mixed sizes on one line stay one line).
    const lines = e => { const r = document.createRange(); r.selectNodeContents(e); let n = 0, low = -Infinity; for (const c of [...r.getClientRects()].filter(c => c.width > 0).sort((a, b) => a.top - b.top)) { if (c.top >= low - 1) { n++; low = c.bottom; } else low = Math.max(low, c.bottom); } return n; };
    const clipped = e => { const r = e.getBoundingClientRect(); for (let a = e.parentElement; a && a !== sec; a = a.parentElement) { if (getComputedStyle(a).overflowX === 'visible') continue; const b = a.getBoundingClientRect(); if (r.left < b.left - 1 || r.right > b.right + 1) return true; } return false; };
    return {
      ok: !!(btn('Chips') && btn('BB')) && !!group.parentElement.querySelector('button[aria-label="Sounds"]'),
      pressed: group && btn('BB')?.getAttribute('aria-pressed') === 'true',
      amounts: [...sec.querySelectorAll('[data-chips]')].filter(vis).map(e => ({
        chips: +e.dataset.chips, text: (e.getAttribute('aria-label')?.replace(/^Pot /, '') ?? e.textContent).trim().replace(/^[+−-]/, ''),
        // A seat's first amount is its stack; any after it is the seat's own bet line (BET 35, RAISE 35). The felt's bets
        // show on phones too, beside the ring's seats (owner 2026-11-14).
        where: e.closest('[data-seat]') ? (e === e.closest('[data-seat]').querySelector('[data-chips]') ? 'seat' : 'seat bet') : e.closest('[data-bet]') ? 'bet' : e.closest('ol') ? 'pnl' : e.hasAttribute('aria-label') ? 'pot' : e.closest('[data-pot]') ? 'collected' : 'reasoning',
        lines: lines(e), clipped: clipped(e),
      })),
      unit: !!sec.querySelector('[data-unit]'),
      words: [...sec.querySelectorAll('p')].map(e => e.textContent).find(t => t.includes('Raising to')) ?? '',
      seats: [...new Set([...sec.querySelectorAll('td.w-\\[200px\\]')].map(td => `${td.offsetWidth}x${td.offsetHeight}`))],
      cell: box(sec.querySelector('td.w-\\[200px\\]')),
      table: sec.querySelector('table')?.offsetWidth,
      boxes: [...sec.querySelectorAll('[data-seat], table, ol, h2')].filter(vis).map(box).concat([...sec.children].map(box)),
      // Text cut short with an ellipsis (kept on the page to tell which only BB cuts).
      cut: (window.__cut = [...sec.querySelectorAll('*')].filter(e => vis(e) && getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1)).length,
    };
  };
  for (const [w, h] of [[1440, 790], [1870, 1200], [390, 844]]) {
    const size = `${w}x${h}`, p = await scriptedTable(w, h), phone = w < 768;
    try {
      await p.evaluate(() => window.__stream.bets());
      await sleep(2000); // the reasoning panel types the model's words
      const bb = await p.evaluate(() => window.__stream.last.stakes?.bigBlind || 10);
      // Both modes from one state (the engine's messages are held back): chips, then big blinds, a frame after each click.
      const m = await p.evaluate(async read => {
        read = eval(`(${read})`);
        const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
        const click = t => [...document.querySelectorAll('[role=group][aria-label="Amounts in"] button')].find(b => b.textContent.trim() === t)?.click();
        if (!read().ok) return null;
        click('Chips'); await frame(); const chips = read(), cut = new Set(window.__cut);
        click('BB'); await frame(); const big = read();
        return { chips, big, newlyCut: window.__cut.filter(e => !cut.has(e)).map(e => e.textContent.trim().slice(0, 24)) };
      }, read.toString());
      if (!m) { bad.push(`${size}: no Chips/BB switch beside the sound switch`); continue; }
      const { chips, big, newlyCut } = m;
      for (const [mode, r] of [['chips', chips], ['BB', big]]) {
        for (const a of r.amounts) {
          const want = mode === 'chips' ? a.chips.toLocaleString('en-US') : fmt(a.chips, bb, a.where !== 'pnl');
          if (a.text !== want) bad.push(`${size} ${mode}: ${a.where} ${a.chips} shows "${a.text}", not "${want}"`);
        }
        if (phone) continue; // the phone layout has no grid
        // seat-size's tolerance: the grid's rows round to 128 or 129 on some windows, in either mode.
        if (r.seats.some(c => { const [cw, ch] = c.split('x').map(Number); return Math.abs(cw - 200) > 1 || Math.abs(ch - 128) > 2; })) bad.push(`${size} ${mode}: seat cells ${r.seats.join(', ')}`);
        if (r.table !== 1000) bad.push(`${size} ${mode}: table ${r.table}px`);
      }
      // The same amounts in the same order in both modes: what only big blinds wrap or clip.
      big.amounts.forEach((a, i) => {
        const c = chips.amounts[i];
        if (a.lines > (c?.lines ?? 1)) bad.push(`${size} BB: ${a.where} "${a.text}" wraps`);
        if (a.clipped && !c?.clipped) bad.push(`${size} BB: ${a.where} "${a.text}" is clipped`);
      });
      const where = new Set(big.amounts.map(a => a.where));
      for (const k of ['seat', ...(phone ? ['seat bet'] : []), 'bet', 'pot', 'pnl', 'reasoning']) if (!where.has(k)) bad.push(`${size}: no ${k} amount to check`);
      if (!big.unit || chips.unit) bad.push(`${size}: Profits & Losses header unit ${chips.unit ? 'shown in chips' : 'missing in BB'}`);
      if (!/Raising to 35\b/.test(big.words)) bad.push(`${size}: the model's words changed in BB ("${big.words.slice(0, 40)}")`);
      const moved = big.boxes.filter((b, i) => b !== chips.boxes[i]).length;
      if (moved || big.boxes.length !== chips.boxes.length) bad.push(`${size}: ${moved} boxes changed size in BB`);
      if (w === 1870 && big.cell !== '250x160') bad.push(`${size}: seat cell drawn ${big.cell}, not 250x160`);
      if (newlyCut.length) bad.push(`${size}: cut short only in BB: ${newlyCut.join(', ')}`);
      // Kept: a reload opens in big blinds.
      await p.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
      await p.waitForFunction(() => document.querySelector('td.w-\\[200px\\]'), { timeout: 120000 });
      await sleep(1500);
      const kept = await p.evaluate(read);
      const stacks = kept.amounts.filter(a => a.where === 'seat');
      if (!kept.pressed || !stacks.length || stacks.some(a => !a.text.endsWith(' BB'))) bad.push(`${size}: BB not kept across a reload (${stacks[0]?.text})`);
      seen.push(`${size}: ${big.amounts.length} amounts (${[...where].join(', ')}), e.g. ${big.amounts.slice(0, 3).map(a => `${a.chips}→${a.text}`).join(', ')}${phone ? '' : `; seat cells ${big.seats}, drawn ${big.cell} in both`}`);
      await p.evaluate(() => [...document.querySelectorAll('[role=group][aria-label="Amounts in"] button')].find(b => b.textContent.trim() === 'Chips')?.click());
    } finally { await p.close(); }
  }
  return { pass: !bad.length, detail: bad.length ? bad.slice(0, 6).join(' | ') : seen.join(' | ') };
}));
// The sticky bar's pot is a table amount too, so it follows the same switch: in big blinds it reads as the felt's pot does,
// back in chips it reads in chips, and only its text changes (same height and place; its width moves by the text's alone).
// Read as a screen reader hears it (NumberFlow's accessible name), once its roll has settled. Bets out are scripted (pot 50).
group(() => check('sticky-pot-bb', 'The sticky bar\'s pot follows the Chips/BB switch: in BB it reads in big blinds, the same as the felt\'s pot; back in Chips it reads in chips; its box changes size by no more than its text', async () => {
  const p = await scriptedTable(1440, 900);
  try {
    await p.evaluate(() => window.__stream.bets());
    await goto(p, 'stats');
    await p.waitForFunction(() => { const bar = [...document.querySelectorAll('div.fixed')].find(d => d.textContent.includes('Back to table')); return bar && Math.abs(bar.getBoundingClientRect().top) < 0.5; }, { timeout: 10000, polling: 100 }).catch(() => {});
    // The switch as table-bb-toggle drives it, then the bar's pot: what it says, its box, its text's box, the bar, the felt's pot.
    const read = async t => {
      const clicked = await p.evaluate(t => { const b = [...document.querySelectorAll('[role=group][aria-label="Amounts in"] button')].find(b => b.textContent.trim() === t); b?.click(); return !!b; }, t);
      await sleep(1200); // NumberFlow rolls for 900 ms
      const flow = (await p.evaluateHandle(() => [...document.querySelectorAll('div.fixed')].find(d => d.textContent.includes('Back to table'))?.querySelector('number-flow-react'))).asElement();
      if (!clicked || !flow) return null;
      const said = (await p.accessibility.snapshot({ root: flow }))?.name ?? '';
      return { said, ...(await flow.evaluate(f => {
        const box = e => { const r = e.getBoundingClientRect(); return { l: r.left, w: r.width, h: r.height }; };
        const felt = document.querySelector('[data-felt] [aria-label^="Pot "]');
        return { box: box(f.parentElement.parentElement), text: box(f), bar: box(f.closest('div.fixed')), felt: felt?.getAttribute('aria-label').replace(/^Pot /, ''), pot: +felt?.dataset.chips };
      })) };
    };
    const chips = await read('Chips'), big = await read('BB'), back = await read('Chips');
    if (!chips || !big || !back) return { pass: false, detail: 'no Chips/BB switch, or no pot in the sticky bar once the table scrolled away' };
    const bad = [], want = chips.pot.toLocaleString('en-US'), px = b => `${b.w.toFixed(1)}x${b.h.toFixed(1)} at ${b.l.toFixed(1)}`;
    if (chips.said !== want) bad.push(`Chips: the bar's pot reads "${chips.said}", not "${want}"`);
    if (!big.said.endsWith(' BB') || big.said !== big.felt) bad.push(`BB: the bar's pot reads "${big.said}", the felt's "${big.felt}"`);
    if (back.said !== want) bad.push(`back in Chips: the bar's pot reads "${back.said}", not "${want}"`);
    const more = (big.box.w - chips.box.w) - (big.text.w - chips.text.w);
    if (Math.abs(more) > 1 || Math.abs(big.box.h - chips.box.h) > 0.5 || Math.abs(big.box.l - chips.box.l) > 0.5 || Math.abs(big.bar.h - chips.bar.h) > 0.5)
      bad.push(`the pot's box went ${px(chips.box)} to ${px(big.box)} (bar ${chips.bar.h.toFixed(1)} to ${big.bar.h.toFixed(1)}px tall) for text ${chips.text.w.toFixed(1)} to ${big.text.w.toFixed(1)}px wide`);
    return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `pot ${chips.pot}: "${chips.said}" in chips, "${big.said}" in BB (the felt's "${big.felt}"), "${back.said}" back in chips; box ${px(chips.box)} to ${px(big.box)}, by its text alone` };
  } finally { await p.close(); }
}));

// The deal and the shuffle (owner 2026-11-08: "what happened to the shuffling process and the sound effects? ... let's try
// the dealing animation, the dealing sounds, the shuffle animation, and the shuffle sounds"). Scripted (scriptStream): a
// hand ends with the next due in 4 s, and the next is dealt on time. A second page with reduced motion watches the same.
// Times are the page's (performance.now()), recorded by a MutationObserver: card and chip flights, the deck's phases.
group(async () => {
  if (!want('table-deal-motion') && !want('table-shuffle')) return;
  const run = async reduced => {
    const p = await scriptedTable(1440, 900, reduced);
    try {
      await p.evaluate(() => {
        const t = window.__t = { flights: [], deck: [], spread: 0, squared: null, early: null, done: null, landed: {} };
        // Each visible hole card: its name and whether it is drawn (its own and its wrapper's opacity).
        window.__cards = () => [...document.querySelectorAll('[data-seat] [data-hole] > *')].filter(e => e.getBoundingClientRect().width > 0)
          .map(e => ({ label: e.querySelector('[role=img]')?.getAttribute('aria-label') ?? e.getAttribute('aria-label'), on: +getComputedStyle(e).opacity * +getComputedStyle(e.firstElementChild ?? e).opacity > 0.95 }));
        // The riffle spreads the cards sideways; squared, they are back on one pile.
        const spread = d => Math.max(0, ...[...d.children].map(c => Math.abs(new DOMMatrix(getComputedStyle(c).transform).m41)));
        const sample = d => { if (!d.isConnected || d.dataset.deck !== 'riffle') return; t.spread = Math.max(t.spread, spread(d)); requestAnimationFrame(() => sample(d)); };
        new MutationObserver(muts => {
          const now = performance.now();
          for (const m of muts) {
            if (m.type === 'attributes') {
              const d = m.target;
              if (d.getBoundingClientRect().width > 0) { t.deck.push({ phase: d.dataset.deck, t: now }); setTimeout(() => { t.squared = spread(d); }, 100); }
              continue;
            }
            for (const n of m.addedNodes) {
              if (!(n instanceof Element)) continue;
              if (n.dataset.flight) t.flights.push({ kind: n.dataset.flight, t: now });
              // The cards shown 0.1 s into the deal (the first lands at 0.28 s) and 3.3 s into it (the last of 18 lands at
              // 2.66 s); in between, each frame, when each card first shows (its landing, for the deal's pace).
              if (n.dataset.flight === 'card' && !t.early) {
                t.early = []; setTimeout(() => { t.early = window.__cards(); }, 100); setTimeout(() => { t.done = window.__cards(); }, 3300);
                const watch = () => { const at = performance.now(); for (const c of window.__cards()) if (c.on && !(c.label in t.landed)) t.landed[c.label] = at; if (!t.done) requestAnimationFrame(watch); };
                requestAnimationFrame(watch);
              }
              const d = n.matches('[data-deck]') ? n : n.querySelector('[data-deck]');
              if (d && d.getBoundingClientRect().width > 0) { t.deck.push({ phase: d.dataset.deck, t: now }); sample(d); }
            }
          }
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-deck'] });
      });
      const ended = await p.evaluate(() => window.__stream.end(4000));
      await sleep(4000);
      const dealt = await p.evaluate(() => window.__stream.deal());
      await sleep(600);
      const soon = await p.evaluate(() => window.__cards()); // reduced motion: all there
      await sleep(3200); // the deal's samples are in, and the deck is put away
      const t = await p.evaluate(() => ({ ...window.__t, seats: window.__stream.last.players.length, deckNow: [...document.querySelectorAll('[data-deck]')].some(d => d.getBoundingClientRect().width > 0) }));
      return { ...t, ended, dealt, soon };
    } finally { await p.close(); }
  };
  const [full, reduced] = await Promise.all([run(false), alone(() => run(true))]);
  const cards = r => r.flights.filter(f => f.kind === 'card' && f.t >= r.dealt);
  // The dealt hand's cards by name (scriptStream deals seat i the deck's cards 2i and 2i + 1), and how many of them show.
  const NAMES = { T: '10', J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' }, SUITS = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };
  const deck = [...'23456789TJQKA'].flatMap(r => [...'hdcs'].map(x => `${NAMES[r] ?? r} of ${SUITS[x]}`));
  const fresh = (r, list) => (list ?? []).filter(c => deck.indexOf(c.label) >= 0 && deck.indexOf(c.label) < 2 * r.seats);
  const showing = (r, list) => fresh(r, list).filter(c => c.on).length;
  // The pace (owner 2026-11-09: "the dealing speed is too fast, which causes the sound effects to sound like smacks"): a
  // dealer pitching cards, one landing every 0.1-0.2 s (median), the first about 0.3 s after the new hand (its flight),
  // a nine-seat deal done in 2.5-3 s.
  await check('table-deal-motion', 'A new hand is dealt on the felt: a card flies to every seat, twice, starting at once, at a dealer\'s pace (one landing every 0.1-0.2 s, the first after a flight of about 0.3 s, the whole deal about 0.15 s a card), and each seat\'s cards show as they land; with reduced motion nothing flies and the cards are there at once', async () => {
    const bad = [];
    const c = cards(full), first = c.length ? c[0].t - full.dealt : null;
    const lands = fresh(full, Object.keys(full.landed).map(label => ({ label }))).map(x => full.landed[x.label] - full.dealt).sort((a, b) => a - b);
    const gaps = lands.slice(1).map((v, i) => v - lands[i]).sort((a, b) => a - b), gap = gaps[gaps.length >> 1];
    const last = lands[lands.length - 1], n = 2 * full.seats;
    if (lands.length !== n) bad.push(`${lands.length} of ${n} landings seen`);
    else {
      if (lands[0] < 200 || lands[0] > 600) bad.push(`the first card landed ${lands[0].toFixed(0)} ms after the new hand`);
      if (!(gap >= 100 && gap <= 200)) bad.push(`a card landed every ${gap?.toFixed(0)} ms (median)`);
      if (last < (n - 1) * 0.1 * 1000 || last > (n - 1) * 0.2 * 1000 + 700) bad.push(`the last of ${n} cards landed ${last.toFixed(0)} ms after the new hand`);
    }
    if (c.length !== 2 * full.seats) bad.push(`${c.length} card flights for ${full.seats} seats`);
    if (first === null || first > 600) bad.push(`the first flight ${first === null ? 'never came' : `came ${first.toFixed(0)} ms after the new hand`}`);
    if (!full.early || showing(full, full.early) > full.seats) bad.push(`${full.early ? showing(full, full.early) : '?'} of the new cards already showing 0.1 s into the deal (they do not wait for their flights)`);
    if (showing(full, full.done) !== 2 * full.seats) bad.push(`${showing(full, full.done)} of ${2 * full.seats} new cards showing 3.3 s into the deal`);
    if (reduced.flights.length) bad.push(`reduced motion: ${reduced.flights.length} flights`);
    if (showing(reduced, reduced.soon) !== 2 * reduced.seats) bad.push(`reduced motion: ${showing(reduced, reduced.soon)} of ${2 * reduced.seats} new cards showing 0.6 s after the deal`);
    return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `${c.length} cards dealt to ${full.seats} seats from ${first.toFixed(0)} ms after the new hand, ${showing(full, full.early)} showing at 0.1 s, landing from ${lands[0].toFixed(0)} ms every ${gap.toFixed(0)} ms (median) to ${last.toFixed(0)} ms, all ${showing(full, full.done)} at 3.3 s; reduced motion: no flights, all ${showing(reduced, reduced.soon)} cards at 0.6 s` };
  });
  await check('table-shuffle', 'Between hands the deck is riffled on the felt (the cards spread and come back together) and is squared before the next hand is due and before the first card is dealt from it; with reduced motion there is no deck', async () => {
    const bad = [];
    const riffle = full.deck.find(d => d.phase === 'riffle'), ready = full.deck.find(d => d.phase === 'ready'), first = cards(full)[0];
    const at = v => (v === undefined ? 'never' : `${((v - full.ended) / 1000).toFixed(2)} s`);
    if (!riffle) bad.push('no riffle');
    else if (riffle.t <= full.ended || riffle.t >= full.dealt) bad.push(`riffle at ${at(riffle.t)}, outside the pause (deal at ${at(full.dealt)})`);
    if (!ready) bad.push('never squared');
    else if (ready.t > full.dealt || (first && ready.t > first.t)) bad.push(`squared at ${at(ready.t)}, after the deal at ${at(full.dealt)}`);
    if (riffle && ready && ready.t - riffle.t < 500) bad.push(`riffle took ${(ready.t - riffle.t).toFixed(0)} ms`);
    if (full.spread < 20 || full.squared === null || full.squared > 1) bad.push(`cards spread ${full.spread.toFixed(0)}px, ${full.squared === null ? 'never squared' : `squared to ${full.squared.toFixed(1)}px`}`);
    if (full.deckNow) bad.push('the deck is still on the felt 3.8 s after the deal');
    if (reduced.deck.length) bad.push('reduced motion: a deck');
    return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `hand over at 0 s: riffle ${at(riffle.t)}, cards spread ${full.spread.toFixed(0)}px, squared ${at(ready.t)}; deal due and dealt at ${at(full.dealt)}, first card ${at(first?.t)}; reduced motion: no deck` };
  });
});

// Owner, 2026-11-11: bigger hole cards, two or three sizes on the real page for him to pick (?cards=1|2|3, nothing
// different without it); the deck the same size as the hole cards; seats 200x128 and the table 1000px at every size.
// For the default and each size, at 1440x900 and 390x844 (scripted): the cells, the deck squared between hands against a
// hole card, a dealt card's last painted box against the card it lands on, and, painted, no hole card pixel on a seat's
// name, stack, badge or action text, nor (1440, a hovered seat) on its stats band: each box is shot with the cards and
// with them hidden, and the two must be the same pixels.
group(() => check('table-card-sizes', 'Hole card sizes (?cards=1|2|3; none: as today): the deck and the dealt cards are the hole cards\' size, seats stay 200x128 and the table 1000px, and no hole card covers a seat\'s name, stack, badge, action text or hovered stats band', async () => {
  const bad = [], seen = []; let phoneToday = [];
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const n of [0, 1, 2, 3]) {
      const p = await newPage(); await p.setViewport({ width: w, height: h });
      try {
        await scriptStream(p);
        await p.goto(`${BASE}/${n ? `?cards=${n}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await p.waitForFunction(() => window.__stream?.last?.players?.length && document.querySelector('td.w-\\[200px\\]'), { timeout: 120000 });
        await sleep(1500);
        const tag = `${n || 'default'} ${w}x${h}`;
        const box = s => { const e = [...document.querySelectorAll(s)].find(x => x.getBoundingClientRect().width > 0); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; };
        const cells = await p.evaluate(() => { const c = document.querySelector('td.w-\\[200px\\]'); return [c.offsetWidth, c.offsetHeight, document.querySelector('table').offsetWidth]; });
        // The 200x128 cells and the 1000px table are the desktop layout's (phones show a grid of their own).
        if (w === 1440 && (Math.abs(cells[0] - 200) > 1 || Math.abs(cells[1] - 128) > 2)) bad.push(`${tag}: seat cell ${cells[0]}x${cells[1]}`);
        if (w === 1440 && Math.abs(cells[2] - 1000) > 1) bad.push(`${tag}: table ${cells[2]}px`);
        // Each frame, every flying card's box: the last one painted before it is removed is the box it lands at.
        await p.evaluate(() => { const last = window.__fl = new Map(); const tick = () => { for (const e of document.querySelectorAll('[data-flight=card]')) { const b = e.getBoundingClientRect(); last.set(e, { w: b.width, h: b.height, o: +getComputedStyle(e).opacity }); } requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
        await p.evaluate(() => window.__stream.end(4000)); await sleep(3300);
        const deck = await p.evaluate(box, '[data-deck]'), hole = await p.evaluate(box, '[data-seat] [data-hole] > *');
        // The default is today's: hole cards 28x40 under a deck of the board's 44x64 (both times the stage's zoom). Phones
        // keep today's size whatever the switch says (their seats are about 116px wide).
        const want = n && w >= 768 ? hole : hole && { w: (hole.w * 44) / 28, h: (hole.h * 64) / 40 };
        if (!deck || !hole || Math.abs(deck.w - want.w) > 1 || Math.abs(deck.h - want.h) > 1) bad.push(`${tag}: deck ${deck ? `${deck.w.toFixed(1)}x${deck.h.toFixed(1)}` : 'none'}, hole card ${hole ? `${hole.w.toFixed(1)}x${hole.h.toFixed(1)}` : 'none'}`);
        await sleep(700); await p.evaluate(() => window.__stream.deal()); await sleep(3500);
        const flown = await p.evaluate(() => [...window.__fl.values()]), hole2 = await p.evaluate(box, '[data-seat] [data-hole] > *');
        const off = flown.filter(f => Math.abs(f.w - hole2.w) > 1.5 || Math.abs(f.h - hole2.h) > 1.5);
        if (!flown.length || off.length) bad.push(`${tag}: ${flown.length} flights, ${off.length} landing off the hole card's ${hole2.w.toFixed(1)}x${hole2.h.toFixed(1)} (e.g. ${off[0] ? `${off[0].w.toFixed(1)}x${off[0].h.toFixed(1)}` : '-'})`);
        // The longest action texts: a raise with a 4-digit amount on seat 3, the blinds on theirs; the band on seat 3, hovered.
        await p.evaluate(() => { const s = window.__stream; s.last = { ...s.last, players: s.last.players.map((q, i) => i === 3 ? { ...q, lastAction: 'RAISE', lastAmount: 1234, currentBet: 1234 } : q) }; s.feed({ type: 'game_state', payload: s.last }); });
        await sleep(600);
        if (w >= 768) { const b = await p.evaluate(() => { const e = [...document.querySelectorAll('[data-seat="3"]')].find(x => x.getBoundingClientRect().width > 0).getBoundingClientRect(); return [e.left + 20, e.top + 20]; }); await p.mouse.move(b[0], b[1]); await sleep(400); }
        // Text boxes per seat: the name, the stack, the badge, the action text (each text's own painted extent), the band's lines.
        const boxes = await p.evaluate(() => [...document.querySelectorAll('[data-seat]')].filter(s => s.getBoundingClientRect().width > 0).flatMap(seat => {
          const texts = [...seat.querySelectorAll('[title], [data-chips], [data-action], .absolute.top-\\[46px\\] > div')].filter(e => !e.closest('[data-hole]'));
          return texts.map(e => {
            // The text's own extent, cut to its box (a truncated text runs on, unpainted, under the cards).
            const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect();
            let l = b.left, t = b.top, rr = b.right, bb = b.bottom;
            for (let a = e; a && a !== seat; a = a.parentElement) if (a === e || getComputedStyle(a).overflow !== 'visible') { const c = a.getBoundingClientRect(); l = Math.max(l, c.left); t = Math.max(t, c.top); rr = Math.min(rr, c.right); bb = Math.min(bb, c.bottom); }
            return { seat: seat.dataset.seat, what: e.textContent.trim().slice(0, 16), l: Math.floor(l), t: Math.floor(t), w: Math.ceil(rr - l), h: Math.ceil(bb - t) };
          }).filter(b => b.w > 1 && b.h > 1);
        }));
        const shoot = () => Promise.all(boxes.map(b => p.screenshot({ clip: { x: b.l, y: b.t, width: b.w, height: b.h }, encoding: 'base64' })));
        const shown = await shoot();
        await p.evaluate(() => document.querySelectorAll('[data-hole]').forEach(e => { e.style.visibility = 'hidden'; }));
        const hidden = await shoot();
        await p.evaluate(() => document.querySelectorAll('[data-hole]').forEach(e => { e.style.visibility = ''; }));
        const covered = boxes.filter((_, i) => shown[i] !== hidden[i]).map(b => `seat ${b.seat} "${b.what}"`);
        // Phones keep today's card size, and today's cards already sit over a long action there (seat 3's RAISE 1,234 in a
        // 116px seat): a size may cover nothing the default does not.
        if (w < 768 && !n) phoneToday = covered;
        else if (w < 768) { const extra = covered.filter(c => !phoneToday.includes(c)); if (extra.length) bad.push(`${tag}: hole cards paint over ${extra.slice(0, 4).join(', ')} (today's size does not)`); }
        else if (covered.length) bad.push(`${tag}: hole cards paint over ${covered.slice(0, 4).join(', ')}${covered.length > 4 ? ` and ${covered.length - 4} more` : ''}`);
        seen.push(`${tag}: card ${hole2.w.toFixed(0)}x${hole2.h.toFixed(0)}, deck ${deck?.w.toFixed(0)}x${deck?.h.toFixed(0)}, ${flown.length} flights, ${boxes.length} text boxes clear`);
      } finally { await p.close(); }
    }
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
}));

// Filming: every frame Chrome presented, via the CDP screencast, each acked.
const filmFrames = async (p, run, cast = { format: 'png' }) => {
  const cdp = await p.createCDPSession(), frames = [];
  // The screencast paints only what the window shows (headless Chrome's window is 756x556 here), so the window is made
  // bigger than the viewport first: every frame then holds the whole viewport at its own pixels.
  const { windowId } = await cdp.send('Browser.getWindowForTarget'), [vw, vh] = await p.evaluate(() => [innerWidth, innerHeight]);
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: vw + 200, height: vh + 200 } });
  cdp.on('Page.screencastFrame', f => { frames.push({ data: f.data, ts: f.metadata.timestamp * 1000 }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { ...cast, everyNthFrame: 1 });
  try { await run(); } finally { await cdp.send('Page.stopScreencast').catch(() => {}); await cdp.detach().catch(() => {}); }
  return frames;
};
// Every painted frame (requestAnimationFrame) from now until window.__rec is taken: each shown seat's hole cards as they
// lie and turn. Per card: its angle on the felt and its box ([data-lay]); its turn (the flipper's cos: -1 face down, 1 up);
// the flap's lift in degrees ([data-flap]); while the peek draws a corner index, its box and whether it is what the page
// hits at its centre (painted on top, not a hidden backface). Per seat: any card layer outside the seat or over its name,
// stack, badge or action text.
const HOLE_REC = () => {
  const rec = window.__rec = [];
  const rect = e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
  const m = e => new DOMMatrix(getComputedStyle(e).transform);
  const tick = () => {
    if (window.__rec !== rec) return;
    const seats = {};
    for (const s of document.querySelectorAll('[data-seat]')) {
      if (!(s.getBoundingClientRect().width > 0) || !s.querySelector('[data-hole] [data-lay]')) continue;
      const box = s.getBoundingClientRect(), off = [];
      const texts = [...s.querySelectorAll('[title], [data-chips], [data-position], [data-action]')].filter(e => !e.closest('[data-hole]')).map(e => [rect(e), e.textContent.trim().slice(0, 12)]);
      const cards = [...s.querySelectorAll('[data-hole] > *')].map(c => {
        const lay = c.querySelector('[data-lay]'), l = m(lay), flip = m(c.querySelector('[data-flip]')), flap = m(c.querySelector('[data-flap]')), index = c.querySelector('[data-index]');
        for (const e of c.querySelectorAll('[data-flip], [data-flap], [data-corner]')) {
          const [a, b, r, d] = rect(e);
          if (a < box.left - 0.5 || b < box.top - 0.5 || r > box.right + 0.5 || d > box.bottom + 0.5) off.push('a card outside the seat');
          for (const [t, say] of texts) if (Math.min(r, t[2]) - Math.max(a, t[0]) > 0.5 && Math.min(d, t[3]) - Math.max(b, t[1]) > 0.5) off.push(`a card over "${say}"`);
        }
        const at = index && rect(index);
        return { deg: Math.atan2(l.b, l.a) * 180 / Math.PI, box: rect(lay), turn: flip.m11, lift: Math.atan2(-flap.m13, flap.m11) * 180 / Math.PI,
          index: at, seen: at && document.elementFromPoint((at[0] + at[2]) / 2, (at[1] + at[3]) / 2)?.closest('[data-index]') === index };
      });
      seats[s.dataset.seat] = { cards, off };
    }
    rec.push({ t: performance.now(), seats });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const holeFace = c => (c.turn < -0.99 ? 'down' : c.turn > 0.99 ? 'up' : 'mid');

// Owner, 2026-11-11: "Hole cards are dealt face down ... then stay face up for the rest of the hand. A seat that never acts
// flips at the end of the hand." Owner, 2026-11-14, on how players peek: "they put both cards on top of each other, then
// peel BOTH from the side so they can see the suit and the value", and "the orientation in which cards land in front of
// players should be random". Scripted (at 1440x900, also ?cards=3, the biggest card, and 390x844, the phone ring; and
// with reduced motion), every painted frame: a deal with peeked [] (every card face down, each seat's two at two
// different angles, no two seats alike, inside the seat and off its text); a seat's llm_thinking (its cards square into
// one upright stack, the second lower and a hair right; the flaps of both lift together, at the hold both corner indexes
// are painted and hit, the first's above the second's, for 0.5 s or more; it ends face up, upright, side by side, never
// outside the seat or over its text; every other seat stays down); its game_state with peeked (no change); a second seat's
// turn; the hand complete (the rest turn up); the next deal (every seat at new angles). Reduced motion: the faces switch
// with no frame between and nothing lifts. Live engine: a reload mid-hand, once a seat has had its turn and one has not:
// the first frame with the cards drawn (faded in) shows the snapshot's peeked seats up and upright and the rest down,
// and after it nothing moves but the one seat whose turn may come.
group(() => check('table-hole-peel', 'Hole cards land face down at random angles (two per seat, per seat, per hand); on a seat\'s first turn its two cards square into one stack, lift at the left as one piece so both ranks and suits show, hold, and lie face up, upright and side by side, inside the seat and off its text throughout (1440x900, ?cards=3, 390x844); the rest turn up when the hand completes; a reload mid-hand shows the same faces with no motion; reduced motion switches faces with no motion', async () => {
  const bad = [], seen = [], degs = a => a.map(d => `${d.toFixed(1)}°`).join(' and ');
  const run = async (w, h, reduced, query = '') => {
    const tag = `${w}x${h}${query}${reduced ? ' reduced motion' : ''}: `, settle = reduced ? 1100 : 2600; // the peek takes 2.1 s
    const p = await scriptedTable(w, h, reduced, query);
    try {
      const feed = msgs => p.evaluate(msgs => { const s = window.__stream; s.scripted = true; for (const m of msgs) { if (m.type === 'game_state') s.last = m.payload; s.feed(m); } }, msgs);
      const film = async (msgs, ms) => { await p.evaluate(HOLE_REC); await sleep(100); await feed(msgs); await sleep(ms); return p.evaluate(() => { const r = window.__rec; window.__rec = null; return r; }); };
      const offIn = (rec, seats) => [...new Set(rec.flatMap(f => seats.flatMap(i => (f.seats[i]?.off ?? []).map(o => `seat ${i}: ${o}`))))];
      await p.evaluate(() => window.__stream.end(4000)); await sleep(4200);
      // The deal, as scriptStream's deal() but with peeked [] (its own copies the last state's).
      const deal = () => p.evaluate(() => { const l = window.__stream.last, n = l.players.length, btn = (l.players.findIndex(q => q.isButton) + 1) % n;
        const deck = [...'23456789TJQKA'].flatMap(r => [...'hdcs'].map(x => r + x));
        return { ...l, handNumber: l.handNumber + 1, street: 'preflop', pot: 15, currentBet: 10, communityCards: [], winners: undefined, nextHandInMs: undefined, currentPlayerIdx: (btn + 3) % n, peeked: [],
          players: l.players.map((q, i) => ({ ...q, isButton: i === btn, position: l.players[(i + n - 1) % n].position, holeCards: [deck[2 * i], deck[2 * i + 1]], status: 'active', lastAction: '', lastAmount: 0, currentBet: 0 })) }; });
      const st = await deal();
      const dealing = await film([{ type: 'hand_start', payload: { handNumber: st.handNumber } }, { type: 'game_state', payload: st }], 3600);
      const all = Object.keys(dealing.at(-1).seats), angles = r => Object.fromEntries(Object.entries(r.at(-1).seats).map(([i, s]) => [i, s.cards.map(c => c.deg)]));
      const dealt = angles(dealing);
      for (const [i, s] of Object.entries(dealing.at(-1).seats)) {
        if (s.cards.map(holeFace).join('') !== 'downdown') bad.push(`${tag}after the deal, seat ${i} not face down`);
        if (Math.abs(dealt[i][0] - dealt[i][1]) < 0.1) bad.push(`${tag}after the deal, seat ${i}'s cards both lie at ${degs(dealt[i])}`);
        const twin = Object.keys(dealt).find(j => j !== i && dealt[j].every((d, k) => Math.abs(d - dealt[i][k]) < 0.1));
        if (twin) bad.push(`${tag}seats ${i} and ${twin} landed alike, at ${degs(dealt[i])}`);
      }
      for (const o of offIn(dealing, all)) bad.push(`${tag}the deal: ${o}`);
      seen.push(`${tag}seat ${all[0]} dealt at ${degs(dealt[all[0]])}`);
      const a = st.currentPlayerIdx, b = (a + 1) % st.players.length, up = new Set();
      const steps = [
        ['thinking A', [{ type: 'llm_thinking', payload: { turn: 1, playerIdx: a, playerName: st.players[a].name } }], [a]],
        ['game_state A', [{ type: 'game_state', payload: { ...st, currentPlayerIdx: b, peeked: [a] } }], []],
        ['thinking B', [{ type: 'llm_thinking', payload: { turn: 2, playerIdx: b, playerName: st.players[b].name } }], [b]],
        // No winner: its chips would fly across the seats being watched.
        ['complete', [{ type: 'game_state', payload: { ...st, street: 'complete', currentPlayerIdx: -1, peeked: [a, b], nextHandInMs: 60000, winners: [] } }], all.map(Number).filter(i => i !== a && i !== b)],
      ];
      for (const [name, msgs, turning] of steps) {
        const rec = await film(msgs, settle), peeking = name.startsWith('thinking');
        turning.forEach(i => up.add(i));
        for (const o of offIn(rec, turning.map(String))) bad.push(`${tag}${name}: ${o}`);
        for (const i of all) {
          const frames = rec.map(f => f.seats[i]).filter(Boolean), faces = frames.map(s => s.cards.map(holeFace).join(''));
          const want = up.has(+i) ? 'upup' : 'downdown', last = frames.at(-1);
          if (faces.at(-1) !== want) { bad.push(`${tag}${name}: seat ${i} ends ${faces.at(-1)}, want ${want}`); continue; }
          if (!turning.includes(+i)) { if (new Set(faces).size > 1) bad.push(`${tag}${name}: seat ${i}'s cards turned`); continue; }
          const between = faces.filter(f => f !== 'downdown' && f !== 'upup').length, lifted = frames.filter(s => s.cards.some(c => Math.abs(c.lift) > 1));
          // Afterwards: upright, side by side (the second starts where the first ends, or after it), level.
          const [c0, c1] = last.cards;
          if (Math.abs(c0.deg) > 0.5 || Math.abs(c1.deg) > 0.5 || c0.box[2] > c1.box[0] + 0.5 || Math.abs(c0.box[1] - c1.box[1]) > 0.5) bad.push(`${tag}${name}: seat ${i}'s cards end at ${degs([c0.deg, c1.deg])}, ${c0.box[0].toFixed(1)}-${c0.box[2].toFixed(1)} and ${c1.box[0].toFixed(1)}-${c1.box[2].toFixed(1)} (want 0°, side by side)`);
          if (reduced || !peeking) {
            if (reduced && between) bad.push(`${tag}${name}: seat ${i} has ${between} frames between the faces`);
            if (lifted.length) bad.push(`${tag}${name}: seat ${i}'s cards lifted (${lifted.length} frames)`);
            if (!reduced && between < 3) bad.push(`${tag}${name}: seat ${i}'s cards turn over ${between} frames`);
            continue;
          }
          // The peek: in every lifted frame the two flaps at one angle, the cards upright, the second lower by about a
          // fifth of the card's height and a hair right; at the hold (both past 120°) both indexes painted and hit, the
          // first above the second.
          const ch = c0.box[3] - c0.box[1], wrong = new Set();
          for (const s of lifted) {
            const [d0, d1] = s.cards;
            if (Math.abs(d0.lift - d1.lift) > 0.5) wrong.add('the flaps at two angles');
            if (Math.abs(d0.deg) > 0.5 || Math.abs(d1.deg) > 0.5) wrong.add('the stack not upright');
            const dy = d1.box[1] - d0.box[1], dx = d1.box[0] - d0.box[0];
            if (Math.abs(dy - 0.22 * ch) > 1 || dx < 0.5 || dx > 0.15 * ch) wrong.add(`the second ${dx.toFixed(1)}px right and ${dy.toFixed(1)}px lower than the first`);
          }
          const hold = lifted.filter(s => s.cards.every(c => Math.abs(c.lift) > 120));
          for (const s of hold) {
            const [d0, d1] = s.cards;
            if (!d0.seen || !d1.seen) wrong.add(`at the hold the ${!d0.seen ? 'first' : 'second'} card's rank and suit not painted on top`);
            else if (d0.index[3] > d1.index[1] + 0.5) wrong.add('at the hold the first card\'s index not above the second\'s');
          }
          const held = hold.length ? frames.indexOf(hold.at(-1)) : -1, ms = hold.length ? rec[rec.findIndex(f => f.seats[i] === hold.at(-1))].t - rec[rec.findIndex(f => f.seats[i] === hold[0])].t : 0;
          if (ms < 500) wrong.add(`held ${Math.round(ms)} ms`);
          if (held >= 0 && faces.slice(0, held + 1).some(f => f !== 'downdown')) wrong.add('a face turned up before the hold ended');
          if (wrong.size) bad.push(`${tag}${name}: seat ${i}: ${[...wrong].slice(0, 3).join(', ')}`);
          else if (name === 'thinking A') seen.push(`${tag}seat ${i} peeked: held ${Math.round(ms)} ms at ${hold[0].cards[0].lift.toFixed(0)}°, both indexes painted`);
        }
      }
      // The next hand: every seat at new angles.
      const next = await deal();
      const again = angles(await film([{ type: 'hand_start', payload: { handNumber: next.handNumber } }, { type: 'game_state', payload: next }], 3600));
      const same = Object.keys(again).filter(i => dealt[i] && again[i].every((d, k) => Math.abs(d - dealt[i][k]) < 0.1));
      if (same.length) bad.push(`${tag}the next hand, seats ${same.join(',')} landed as in the last`);
    } finally { await p.close(); }
  };
  for (const [w, h, reduced, query] of [[1440, 900, false], [1440, 900, false, '?cards=3'], [390, 844, false], [1440, 900, true], [390, 844, true]]) await run(w, h, reduced, query);
  // Live: reload until the snapshot has a seat that has had its turn and one that has not.
  const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
  try {
    // The recorder from the first frame; the cards are drawn once their fade-in is done: a hole card (a folded seat's are
    // at 40%) at full opacity.
    await p.evaluateOnNewDocument(HOLE_REC);
    await p.evaluateOnNewDocument(() => { const op = e => (e ? +getComputedStyle(e).opacity * op(e.parentElement) : 1); const look = () => { if (document.querySelector('[data-seat] [data-hole] [data-back]') && Math.max(...[...document.querySelectorAll('[data-seat] [data-hole] > *')].filter(e => e.getBoundingClientRect().width > 0).map(op)) > 0.99) window.__cardsAt = performance.now(); else requestAnimationFrame(look); }; requestAnimationFrame(look); });
    await p.evaluateOnNewDocument(() => { const Real = window.EventSource; window.EventSource = class extends Real { set onmessage(fn) { super.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type === 'snapshot' && !window.__snap) { const t = Object.values(m.payload.tables)[0]; window.__snap = t && { peeked: t.state.peeked, street: t.state.street, players: t.state.players.length, at: performance.now() }; } if (m.type === 'game_state') window.__now = { peeked: m.payload.peeked, street: m.payload.street, players: m.payload.players.length }; } catch {} fn(e); }; } get onmessage() { return super.onmessage; } }; });
    let ok = null, lastSnap = null;
    for (let tries = 0; tries < 12 && !ok; tries++) {
      let none = false;
      await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await p.waitForFunction(() => window.__snap && window.__cardsAt, { timeout: 60000 }).catch(() => { none = true; });
      await sleep(1500);
      if (none) { bad.push('live: no hole card drawn within 60 s of the reload'); break; }
      const snap = await p.evaluate(() => window.__snap);
      // Not mid-hand with a seat peeked and one not: at the live pace that moment is the first orbit of a hand, so wait (up
      // to 4 minutes) until the live table is in it again, then reload.
      if (!snap?.peeked || snap.street === 'complete' || !snap.peeked.length || snap.peeked.length >= snap.players) { lastSnap = snap; await p.waitForFunction(() => { const s = window.__now; return s?.peeked?.length && s.peeked.length < s.players - 1 && s.street !== 'complete'; }, { timeout: 240000, polling: 250 }).catch(() => {}); continue; }
      const { rec, cardsAt } = await p.evaluate(() => ({ rec: window.__rec, cardsAt: window.__cardsAt }));
      ok = { snap, rec: rec.filter(f => f.t >= cardsAt) };
    }
    if (!ok && !bad.some(x => x.startsWith('live:'))) bad.push(`live: no reload landed mid-hand with a seat peeked and one not (12 tries; the last snapshot: ${JSON.stringify(lastSnap)})`);
    else if (ok) {
      const { snap, rec } = ok, wrong = [], moved = [];
      for (const [i, s] of Object.entries(rec[0]?.seats ?? {})) {
        const peeked = snap.peeked.includes(+i), faces = s.cards.map(holeFace).join('');
        if (faces !== (peeked ? 'upup' : 'downdown') || (peeked && s.cards.some(c => Math.abs(c.deg) > 0.5))) wrong.push(`seat ${i} ${faces} at ${degs(s.cards.map(c => c.deg))}`);
        if (rec.some(f => f.seats[i] && f.seats[i].cards.some((c, k) => holeFace(c) !== holeFace(s.cards[k]) || Math.abs(c.deg - s.cards[k].deg) > 0.1))) moved.push(i);
      }
      if (!rec.length) bad.push('live: no frame with cards');
      else if (wrong.length) bad.push(`live: the first frame with cards shows ${wrong.join(', ')}, snapshot peeked [${snap.peeked}]`);
      // The seat whose turn comes while filming may peek; no other.
      if (moved.length > 1) bad.push(`live: seats ${moved.join(',')} moved after the reload`);
      seen.push(`live: snapshot peeked [${snap.peeked}] of ${snap.players} seats, the first frame with cards matches it${moved.length ? `, seat ${moved[0]} then had its turn` : ', nothing moved after it'}`);
    }
  } finally { await p.close(); }
  return { pass: !bad.length, detail: bad.length ? bad.slice(0, 8).join('; ') + (bad.length > 8 ? ` and ${bad.length - 8} more` : '') : seen.join('; ') };
}));

// Owner, 2026-11-11: "On refresh everything fades in where it sits: no sliding (hole cards slide up today), nothing
// popping in (the timer, Profits & Losses). On a mid-hand refresh the dealt cards just fade in." At 1440x900 and 390x844,
// after a first visit (what lib/boxes remembers): a reload with the stream and every /api/ answer held 2.5 s, its
// snapshot played as a turn in progress and then as the pause between hands (nothing live after it), sampled every frame
// (requestAnimationFrame) for 3 s from the release. Each watched element (hole and board cards, the felt, the seats' text,
// the status row, the Profits & Losses rows, the reasoning bar, API usage): never from under 0.1 opacity (with its
// ancestors', hidden or absent: 0) to over 0.9 between two frames, never moved or resized by more than 1px between two
// frames it shows in (over 0.1), and no card or chip flies. With reduced motion (1440x900, mid-hand) nothing fades: no
// watched element is ever between its first and last opacity.
const FADE_WATCH = () => {
  const vis = e => e.getBoundingClientRect().width > 0, out = [];
  const add = (k, list) => list.filter(vis).forEach((e, i) => out.push([`${k}${i}`, e]));
  add('hole', [...document.querySelectorAll('[data-seat] [data-hole] > *')]);
  add('board', [...document.querySelectorAll('[data-felt-cards] > *')]);
  add('felt', [...document.querySelectorAll('[data-felt] > *')]);
  add('seat', [...document.querySelectorAll('[data-seat] [title], [data-seat] [data-chips], [data-seat] [data-action], [data-seat] [data-position]')]);
  add('status', [...(document.querySelector('section[data-screen]')?.children[2]?.querySelectorAll('span, button') ?? [])]);
  add('pnl', [...document.querySelectorAll('#table ol li')]);
  add('reason', [...document.querySelectorAll('.stage-zoom .h-\\[100px\\] > div > div')]);
  const u = document.querySelector('#table a[href*="sponsors"]')?.closest('.rounded');
  if (u) add('usage', [...u.children]);
  add('sticky', [...document.querySelectorAll('div.fixed.top-0')]);
  return out;
};
group(() => check('table-refresh-fades', 'On a refresh, mid-hand or between hands, everything on the table screen fades in where it sits: no card or text slides or moves, nothing pops in from nothing, nothing flies', async () => {
  const bad = [], seen = [];
  for (const [w, h, reduced] of [[1440, 900], [390, 844], [1440, 900, true]]) {
    const p = await newPage(); await p.setViewport({ width: w, height: h });
    if (reduced) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    try {
      await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await p.waitForFunction(() => document.querySelector('[data-seat] [data-hole]') && document.querySelector('#table ol li'), { timeout: 120000 });
      await sleep(3000); // the visit: lib/boxes remembers the filled boxes
      await p.evaluateOnNewDocument(watch => {
        const phase = sessionStorage.getItem('__phase');
        let open; const held = new Promise(r => (open = r));
        const fetch0 = window.fetch;
        window.fetch = async (...a) => { if (String(a[0]?.url ?? a[0]).includes('/api/')) await held; return fetch0(...a); };
        const Real = window.EventSource;
        window.EventSource = class extends Real {
          set onmessage(fn) {
            super.onmessage = e => {
              const m = JSON.parse(e.data);
              if (m.type === 'stats') return held.then(() => fn(e));
              if (m.type !== 'snapshot' || window.__snapped) return; // nothing live after the snapshot
              window.__snapped = true;
              const t = Object.values(m.payload.tables)[0], st = t.state, deck = [...'23456789TJQKA'].flatMap(r => [...'hdcs'].map(x => r + x));
              Object.assign(t, { notice: null, buttonCards: [], buttonWinner: null, turnApplied: false, turn: null });
              st.players.forEach((q, i) => Object.assign(q, { status: 'active', holeCards: [deck[2 * i], deck[2 * i + 1]] }));
              if (phase === 'between') Object.assign(st, { street: 'complete', nextHandInMs: 8000, currentPlayerIdx: -1, winners: [], peeked: [] });
              else {
                Object.assign(st, { street: 'flop', communityCards: ['Kh', '7d', '2c'], currentPlayerIdx: 2, peeked: [0, 1], winners: undefined, nextHandInMs: undefined });
                t.turn = { type: 'llm_thinking', payload: { turn: 3, playerIdx: 2, playerName: st.players[2].name, budgetMs: 45000, elapsedMs: 3000 } };
              }
              held.then(() => fn(new MessageEvent('message', { data: JSON.stringify(m) })));
            };
          }
          get onmessage() { return super.onmessage; }
        };
        // From the page's first frame to 3 s after the release, every frame: each watched element's opacity and box (in the
        // page, so a restored scroll is no move; the fixed sticky bar in the window), and the flights (times from the
        // release). Read once the frame's animation callbacks have all run: what it paints.
        const W = new Function(`return (${watch})()`), s = [];
        let t0 = Infinity, done;
        window.__release = () => new Promise(d => { done = d; t0 = performance.now(); open(); });
        const f = ts => setTimeout(() => {
          const memo = new Map(), up = a => { if (!a) return 1; if (!memo.has(a)) memo.set(a, +getComputedStyle(a).opacity * up(a.parentElement)); return memo.get(a); };
          const els = {};
          for (const [k, e] of W()) { const b = e.getBoundingClientRect(), y = e.closest('.fixed') ? 0 : scrollY; els[k] = [getComputedStyle(e).visibility === 'hidden' ? 0 : up(e), b.left, b.top + y, b.width, b.height]; }
          s.push({ t: ts, els, flights: document.querySelectorAll('[data-flight]').length });
          if (ts - t0 < 3000) requestAnimationFrame(f); else done(s.map(x => ({ ...x, t: x.t - t0 })));
        });
        requestAnimationFrame(f);
      }, FADE_WATCH.toString());
      // Last, a reload below the table: the sticky bar shows at once, and fades in where it sits.
      for (const phase of reduced ? ['mid-hand'] : w > 768 ? ['mid-hand', 'between', 'below the table'] : ['mid-hand', 'between']) {
        await p.evaluate(ph => sessionStorage.setItem('__phase', ph), phase);
        if (phase === 'below the table') await goto(p, 'stats');
        await p.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await sleep(2500);
        if (phase === 'below the table' && !(await p.evaluate(() => scrollY > innerHeight / 2))) bad.push('below the table: the reload went back to the top');
        const s = await p.evaluate(() => window.__release());
        const tag = `${w}x${h} ${phase}${reduced ? ' reduced motion' : ''}`, keys = new Set(s.flatMap(x => Object.keys(x.els))), pops = [], moves = [], fades = [];
        for (const k of keys) {
          const ops = s.map(x => x.els[k]?.[0] ?? 0), lo = Math.min(ops[0], ops.at(-1)) + 0.05, hi = Math.max(ops[0], ops.at(-1)) - 0.05;
          if (reduced && ops.some(o => o > lo && o < hi)) { fades.push(k); continue; }
          if (reduced) continue;
          for (let i = 1; i < s.length; i++) {
            const a = s[i - 1].els[k] ?? [0], b = s[i].els[k] ?? [0];
            if (a[0] < 0.1 && b[0] > 0.9) { pops.push(`${k} at ${s[i].t.toFixed(0)} ms, ${(s[i].t - s[i - 1].t).toFixed(0)} ms after the frame before`); break; }
            if (a[0] > 0.1 && b[0] > 0.1 && Math.max(...[1, 2, 3, 4].map(j => Math.abs(a[j] - b[j]))) > 1) { moves.push(`${k} ${a.slice(1).map(v => v.toFixed(0)).join(',')} → ${b.slice(1).map(v => v.toFixed(0)).join(',')} at ${s[i].t.toFixed(0)} ms`); break; }
          }
        }
        const flown = Math.max(0, ...s.map(x => x.flights)), last = s.at(-1).els;
        const shown = Object.values(last).filter(v => v[0] > 0.9).length;
        if (pops.length) bad.push(`${tag}: ${pops.length} popped in (${pops.slice(0, 5).join('; ')})`);
        if (fades.length) bad.push(`${tag}: ${fades.length} faded (${fades.slice(0, 5).join(', ')})`);
        if (moves.length) bad.push(`${tag}: ${moves.length} moved (${moves.slice(0, 5).join('; ')})`);
        if (flown) bad.push(`${tag}: ${flown} flights`);
        if (phase === 'below the table') { if (!last.sticky0 || last.sticky0[0] < 0.9) bad.push(`${tag}: no sticky bar`); }
        else if (!Object.keys(last).some(k => k.startsWith('hole')) || shown < 20) bad.push(`${tag}: only ${shown} watched elements showing at the end`);
        seen.push(`${tag}: ${shown} elements ${reduced ? 'shown at once' : 'faded in'} over ${s.length} frames`);
      }
    } finally { await p.close(); }
  }
  return { pass: !bad.length, detail: bad.length ? bad.join(' | ') : seen.join('; ') };
}));

// Owner, 2026-11-11: "The yellow connection bar must not flash on a normal refresh (today it shows, hides, shows again);
// it shows only once, when the server is really unreachable." Nor does a normal load say Offline. Every frame
// (requestAnimationFrame, from the page's first script) records whether the bar (its rgb(203, 145, 47) across the
// window's bottom) or a visible Offline is drawn: at 1440x900, five plain reloads, one with the stream's request held
// 3.5 s and one with the CPU 4x slower, each until 5 s after its snapshot: never. Then a load whose stream is refused:
// the bar first drawn 3.5 to 6 s after the load, and in every frame after that for 20 s.
group(() => check('table-bar-once', 'The connection bar and Offline never show on a normal load (a slow stream or a slow machine included); with the server unreachable the bar shows once, about 4 s after the load, and stays', async () => {
  const bad = [], seen = [];
  const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
  try {
    await p.evaluateOnNewDocument(() => {
      const Real = window.EventSource;
      window.EventSource = class extends Real { set onmessage(fn) { super.onmessage = e => { if (!window.__snapAt && /"type":"snapshot"/.test(e.data)) window.__snapAt = performance.now(); fn(e); }; } get onmessage() { return super.onmessage; } };
      const s = window.__bar = [];
      const f = () => {
        const bar = [...document.querySelectorAll('div.fixed')].some(e => { const b = e.getBoundingClientRect(); return getComputedStyle(e).backgroundColor === 'rgb(203, 145, 47)' && b.bottom >= innerHeight - 1 && b.width >= document.body.clientWidth - 1 && b.height >= 20; }); // the page's width: a classic scrollbar's reserved gutter is not the bar's
        const off = [...document.querySelectorAll('section[data-screen] span')].some(e => /^Offline/.test(e.textContent) && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0);
        s.push({ t: performance.now(), bar, off });
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    let mode = 'plain';
    await p.setRequestInterception(true);
    p.on('request', r => {
      const go = () => r.continue().catch(() => {});
      if (!/\/stream$/.test(r.url())) go();
      else if (mode === 'held') setTimeout(go, 3500);
      else if (mode === 'refused') r.abort().catch(() => {});
      else go();
    });
    const cdp = await p.createCDPSession();
    const load = async (m, i) => {
      mode = m;
      if (m === 'slow') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
      if (m === 'refused') { await sleep(26000); }
      else {
        const ok = await p.waitForFunction(() => window.__snapAt, { timeout: 60000 }).then(() => true, () => false);
        if (!ok) { bad.push(`${m} ${i}: no snapshot in 60 s`); return; }
        await p.waitForFunction(() => performance.now() > window.__snapAt + 5000, { timeout: 60000, polling: 250 });
      }
      if (m === 'slow') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const s = await p.evaluate(() => window.__bar);
      if (m === 'refused') {
        const first = s.findIndex(x => x.bar), t = first < 0 ? null : s[first].t, gone = s.slice(first).filter(x => !x.bar && x.t < t + 20000).length;
        if (t === null || t < 3500 || t > 6000) bad.push(`refused: the bar first drawn ${t === null ? 'never' : `at ${(t / 1000).toFixed(2)} s`}`);
        else if (gone) bad.push(`refused: the bar missing from ${gone} frames after it first showed at ${(t / 1000).toFixed(2)} s`);
        else seen.push(`refused: bar from ${(t / 1000).toFixed(2)} s, in all ${s.filter(x => x.t >= t).length} frames after`);
        return;
      }
      const bars = s.filter(x => x.bar), offs = s.filter(x => x.off);
      if (bars.length || offs.length) bad.push(`${m} ${i}: the bar in ${bars.length} of ${s.length} frames${bars.length ? ` (from ${(bars[0].t / 1000).toFixed(2)} s)` : ''}, Offline in ${offs.length}${offs.length ? ` (from ${(offs[0].t / 1000).toFixed(2)} s)` : ''}`);
      else seen.push(`${m}${m === 'plain' ? ` ${i}` : ''}: ${s.length} frames clean`);
    };
    for (let i = 1; i <= 5; i++) await load('plain', i);
    await load('held', 1); await load('slow', 1); await load('refused', 1);
  } finally { await p.close(); }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(', ') };
}));

// Owner, 2026-11-11: "The shuffle sound must line up with the shuffle animation." Scripted at 1440x900, sound stored on
// and unlocked by a real click on an empty spot; the hand ends with the next due in 4 s and the deck is riffled. Every
// Web Audio start is recorded (its time heard, in page time: when scheduled plus the output's latency), and each frame
// (requestAnimationFrame) where each riffled card lands back on the pile and where the pile is squared; filmed (the CDP
// screencast), each of those is the first frame painted at or after it. Each card's flicks (three, in landing order)
// must start from 30 ms before to 60 ms after its painted landing, the tap likewise at the squared pile; nothing before
// the click.
group(() => check('table-shuffle-sound', 'The shuffle sound is in time with the riffle: each card\'s flicks are heard as it lands on the pile, the tap as the deck is squared; no sound before a click', async () => {
  const bad = [];
  const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
  try {
    await p.evaluateOnNewDocument(() => {
      const snd = window.__snd = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (when = 0, offset, duration) {
        const c = this.context;
        snd.push({ heard: performance.now() + (Math.max(when, c.currentTime) - c.currentTime + (c.outputLatency || 0)) * 1000, duration });
        return start.apply(this, arguments);
      };
      try { localStorage.setItem('nollmit:sound', 'on'); } catch {}
    });
    await scriptStream(p);
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction(() => window.__stream?.last?.players?.length && document.querySelector('td.w-\\[200px\\]'), { timeout: 120000 });
    await sleep(2000);
    const early = await p.evaluate(() => window.__snd.length);
    await p.mouse.click(4, 4); await sleep(300); // the first trusted click unlocks audio
    // Each frame while a deck shows: when each card first lands back on the pile (x back to 0 after its spread) and when
    // every card is squared (no x, no rotation). Read once the frame's animation callbacks have all run (what it paints),
    // timed at the frame's start.
    await p.evaluate(() => {
      const r = window.__riffle = { land: [], squared: null };
      const f = ts => setTimeout(() => {
        const d = [...document.querySelectorAll('[data-deck]')].find(e => e.getBoundingClientRect().width > 0);
        if (d) {
          const now = performance.timeOrigin + ts, m = [...d.children].map(c => new DOMMatrix(getComputedStyle(c).transform));
          m.forEach((x, k) => { const at = Math.abs(x.m41); if (at > 10) r.land[k] = r.land[k] ?? 0; else if (at < 0.5 && r.land[k] === 0) r.land[k] = now; });
          if (r.land.length === m.length && r.land.every(Boolean) && r.squared === null && m.every(x => Math.abs(x.m41) < 0.5 && Math.abs(Math.atan2(x.m12, x.m11)) < 0.005)) r.squared = now;
        }
        if (r.squared === null) requestAnimationFrame(f);
      });
      requestAnimationFrame(f);
    });
    const n0 = await p.evaluate(() => window.__snd.length);
    // Small JPEG frames: only their times are read, and the screencast skips fewer frames when each is cheap to send.
    const frames = await filmFrames(p, async () => { await p.evaluate(() => window.__stream.end(4000)); await sleep(3500); }, { format: 'jpeg', quality: 10, maxWidth: 320, maxHeight: 200 });
    const { land, squared, snd, origin } = await p.evaluate(n0 => ({ ...window.__riffle, snd: window.__snd.slice(n0), origin: performance.timeOrigin }), n0);
    const painted = t => frames.find(f => f.ts >= t)?.ts;
    // sound.ts: a flick is 0.01 s of noise, the tap 0.05 s (a board card's deal sound, 0.065 s, plays as the hand ends).
    const flicks = snd.filter(s => s.duration === 0.01).map(s => origin + s.heard).sort((a, b) => a - b), tap = snd.find(s => s.duration === 0.05);
    const off = (heard, t) => { const fr = painted(t); return fr === undefined ? null : heard - fr; };
    const out = (d, what) => { if (d === null) bad.push(`${what}: no frame painted after it`); else if (d < -30 || d > 60) bad.push(`${what} heard ${d.toFixed(0)} ms ${d < 0 ? 'before' : 'after'} its frame`); };
    if (early) bad.push(`${early} sounds before the click`);
    if (land.length !== 12 || land.some(x => !x)) bad.push(`${land.filter(Boolean).length} cards seen landing`);
    else if (flicks.length !== 3 * land.length) bad.push(`${flicks.length} flicks for ${land.length} cards`);
    const offs = flicks.length === 3 * land.length ? land.slice().sort((a, b) => a - b).map((t, k) => off(flicks[3 * k], t)) : [];
    if (land.length === 12 && !land.some(x => !x) && offs.length) offs.forEach((d, k) => out(d, `card ${k + 1}'s flicks`));
    if (!squared || !tap) bad.push(`${squared ? 'squared' : 'never squared'}, ${tap ? 'a tap' : 'no tap'}`);
    else out(off(origin + tap.heard, squared), 'the tap');
    return { pass: !bad.length, detail: bad.length ? bad.slice(0, 8).join('; ') : `${land.length} cards, ${flicks.length} flicks, each card's heard ${Math.min(...offs).toFixed(0)} to ${Math.max(...offs).toFixed(0)} ms from its painted landing; the tap ${off(origin + tap.heard, squared).toFixed(0)} ms from the squared pile; ${frames.length} frames; nothing before the click` };
  } finally { await p.close(); }
}));

// Owner, 2026-11-09: "Any time I refresh the site, the loading skeleton is so much different compared to the shapes that
// actually load in. When stuff is loading, there should just be blank squares that are the same size as all the squares
// that are currently on the site." While the table's state and the stats load, every box (the table, its seats and felt,
// Profits & Losses, API usage, the reasoning bar, the sticky bar, the Trends, Profiles and Matchups tiles and cards,
// About, whose text is no data and stays) stands in blank at exactly the place and size it has once its data is in; the
// data fills it in place. A refresh:
// one visit first (what lib/boxes remembers), then a reload with the table's stream and every /api/ answer held back while
// the placeholders are measured at each screen, then let through and the same boxes measured again.
const SKELETON = {
  stage: '.stage-zoom', grid: '.stage-zoom table', seat: '[data-seat]', felt: '[data-felt]', reasoning: '.stage-zoom .h-\\[100px\\]',
  tile: '#race-panel, #stats-panel, #pairwise-panel', card: '#stats-card .card-chrome, #pairwise-card .card-chrome',
  about: '[data-about], [data-about] section', sticky: 'div.fixed.top-0',
};
group(() => check('skeleton-matches', 'While the page loads, every box (table, seats, felt, Profits & Losses, API usage, reasoning bar, sticky bar, the Trends, Profiles and Matchups tiles and cards, About) stands in blank at the place and size its data fills, at 1440x900, 1728x1117 and 390x844: nothing moves or resizes by more than 1px when the data arrives', async () => {
  const bad = [], seen = [];
  const SCREENS = ['', 'stats', 'about', 'race', 'stats-table', 'pairwise'];
  // Every box on screen at every screen, in window coordinates (what the viewer sees there), with its visible text. A box
  // under a card (hidden: opacity 0) or slid off the window is not on screen.
  const measure = async p => {
    const out = {};
    for (const id of SCREENS) {
      await p.evaluate(id => window.scrollTo({ top: id ? document.getElementById(id).getBoundingClientRect().top + scrollY : 0, behavior: 'instant' }), id);
      await sleep(1500);
      Object.assign(out, await p.evaluate((SKELETON, at) => {
        const els = Object.entries(SKELETON).flatMap(([k, s]) => [...document.querySelectorAll(s)].map((e, i) => [`${k}${i}`, e]));
        // The table screen's sidebar boxes, by what they hold; its header rows by their top and height only (text grows sideways).
        const side = (k, e) => e && els.push([k, e.closest('.rounded')]);
        side('pnl', [...document.querySelectorAll('#table h2')].find(e => /Profits/.test(e.textContent)));
        side('usage', document.querySelector('#table a[href*="sponsors"]'));
        const rows = [...document.querySelector('section[data-screen]').children].map((e, i) => [`row${i}`, e]);
        const shown = e => { const r = e.getBoundingClientRect(); if (r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) return false; for (let a = e; a; a = a.parentElement) if (+getComputedStyle(a).opacity === 0) return false; return getComputedStyle(e).visibility !== 'hidden'; };
        const box = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(v => Math.round(v * 10) / 10); };
        return Object.fromEntries([
          ...els.filter(([, e]) => e.getBoundingClientRect().width > 0 && shown(e)).map(([k, e]) => [`${at || 'table'} ${k}`, { box: box(e), text: e.innerText.trim() }]),
          ...rows.map(([k, e]) => [`${at || 'table'} ${k}`, { box: [null, box(e)[1], null, box(e)[3]] }]),
        ]);
      }, SKELETON, id));
    }
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await sleep(500);
    return out;
  };
  for (const [w, h, d] of [[1440, 900, 1], [1728, 1117, 1], [390, 844, 2]]) {
    const size = `${w}x${h}`;
    const p = await newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: d });
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 }); await waitStats(p); await sleep(3000);
    await measure(p); // the visit: every screen seen once with its data
    await p.evaluateOnNewDocument(() => {
      let open; const held = new Promise(r => (open = r)); window.__release = () => open();
      const fetch0 = window.fetch;
      window.fetch = async (...a) => { if (String(a[0]?.url ?? a[0]).includes('/api/')) await held; return fetch0(...a); };
      const Real = window.EventSource;
      window.EventSource = class extends Real { set onmessage(fn) { super.onmessage = e => held.then(() => fn(e)); } get onmessage() { return super.onmessage; } };
    });
    await p.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await sleep(2500);
    const ske = await measure(p);
    await p.evaluate(() => window.__release());
    await waitStats(p); await p.waitForFunction(() => document.querySelector('[data-seat] [data-hole]'), { timeout: 60000 }).catch(() => {});
    await sleep(3000);
    const got = await measure(p);
    await p.close();
    const moved = [], shown = [];
    for (const k of new Set([...Object.keys(ske), ...Object.keys(got)])) {
      const a = ske[k]?.box, b = got[k]?.box;
      if (!a || !b) { moved.push(`${k} ${a ? 'gone' : 'missing while loading'}`); continue; }
      const dv = Math.max(...a.map((v, i) => (v === null ? 0 : Math.abs(v - b[i]))));
      if (dv > 1) moved.push(`${k} ${a.map(v => v ?? '·').join(',')} → ${b.map(v => v ?? '·').join(',')}`);
      if (ske[k].text && !k.includes(' about')) shown.push(`${k} "${ske[k].text.slice(0, 20)}"`);
    }
    seen.push(`${size}: ${Object.keys(got).length} boxes in place`);
    if (moved.length) bad.push(`${size}: ${moved.length} moved or resized (${moved.slice(0, 12).join('; ')})`);
    if (shown.length) bad.push(`${size}: ${shown.length} placeholders not blank (${shown.slice(0, 4).join('; ')})`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join(' | ') : seen.join(', ') };
}));

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
// Plain line labels (owner 2026-11-08: "the bubble wrap around each model in the trends graph. it doesn't feel like it
// fits"): each line ends in its rank, logo, name in the line's colour and value, with no border, fill or pill shape, and
// no two labels overlap.
main(() => check('trends-labels-plain', 'Trends line labels are plain (no border, background, shadow or pill radius), each still shows its rank, logo, name in its line\'s colour and value, and no two overlap', async () => {
  await clickText(pg, 'Skip'); await sleep(300);
  const r = await pg.evaluate(() => {
    const plot = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0);
    return [...plot.querySelectorAll('[data-pill]')].filter(e => +e.style.opacity > 0.5).map(e => {
      const cs = getComputedStyle(e), name = e.querySelector('[data-pill-name]'), rank = e.querySelector('[data-pill-rank]');
      const logo = rank?.nextElementSibling, tip = name && plot.querySelector(`[data-tip="${CSS.escape(name.textContent)}"]`), b = name?.getBoundingClientRect();
      return {
        name: name?.textContent, rank: rank?.textContent, value: e.querySelector('[data-pill-value]')?.textContent, logo: !!logo && logo.getBoundingClientRect().width > 4,
        border: Math.max(...['Top', 'Right', 'Bottom', 'Left'].map(s => parseFloat(cs[`border${s}Width`]) || 0)), radius: parseFloat(cs.borderTopLeftRadius) || 0,
        bg: cs.backgroundColor, shadow: cs.boxShadow, color: name && getComputedStyle(name).color, line: tip && getComputedStyle(tip).fill, top: b?.top, bottom: b?.bottom,
      };
    });
  });
  const bad = r.flatMap(l => [
    l.border > 0 && `${l.name} has a ${l.border}px border`, l.radius > 0 && `${l.name} is rounded (${l.radius}px)`,
    !/^(rgba\(0, 0, 0, 0\)|transparent)$/.test(l.bg) && `${l.name} is filled (${l.bg})`, l.shadow !== 'none' && `${l.name} has a shadow`,
    !/^\d+$/.test(l.rank ?? '') && `${l.name} has no rank`, !l.logo && `${l.name} has no logo`, !l.name && 'a label has no name',
    !/^[+−]?\d[\d,]*(\.\d+)?$/.test(l.value ?? '') && `${l.name} has no value`, l.color !== l.line && `${l.name} is ${l.color}, its line ${l.line}`,
  ].filter(Boolean));
  const ys = r.filter(l => l.top != null).sort((a, b) => a.top - b.top);
  const overlaps = ys.slice(1).filter((l, i) => l.top < ys[i].bottom - 0.5).map(l => l.name);
  if (overlaps.length) bad.push(`overlapping: ${overlaps.join(', ')}`);
  return { pass: r.length > 1 && !bad.length, detail: bad.length ? bad.slice(0, 5).join('; ') : `${r.length} plain labels: ${r.map(l => `${l.rank} ${l.name} ${l.value}`).join(', ')}` };
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
// Trends zoom (owner 2026-11-08: "is there a way we can include a zoom feature like if people zoom into the trends they can
// zoom into the graph?"). The opened card's hands axis [x0, x1], read off its first and last x tick, its plot area in
// page px, its Reset zoom button and race clock, and the page's scroll; `y` is a point 45% down the plot.
const zoomState = p => p.evaluate(() => {
  const plot = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0), r = plot.getBoundingClientRect();
  const k = r.width / plot.querySelector('svg').viewBox.baseVal.width, clip = plot.querySelector('clipPath rect'), [cl, cw] = [+clip.getAttribute('x'), +clip.getAttribute('width')];
  const ts = [...plot.querySelectorAll('[data-x-tick]')].map(e => [+e.textContent.replace(/,/g, ''), +e.getAttribute('x')]).sort((a, b) => a[0] - b[0]);
  const per = ts.length > 1 ? (ts.at(-1)[1] - ts[0][1]) / (ts.at(-1)[0] - ts[0][0]) : NaN, x0 = ts.length > 1 ? ts[0][0] - (ts[0][1] - cl) / per : NaN; // design px per hand
  const reset = [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Reset zoom' && b.getBoundingClientRect().width > 0);
  const scrolled = [...document.querySelectorAll('*')].reduce((s, e) => s + e.scrollTop, 0); // the page's scroll and every scroller's
  return { x0, x1: x0 + cw / per, left: r.left + cl * k, w: cw * k, y: r.top + r.height * 0.45, reset, clock: !!plot.querySelector('[data-race-clock]'), scrolled, scale: visualViewport.scale };
});
// A pinch in Chrome or Firefox (a wheel with ctrlKey; ⌘ on a Mac works the same) at a fraction `f` across the plot.
const ctrlWheel = async (p, s, f, dy, n) => {
  await p.mouse.move(s.left + f * s.w, s.y); await p.keyboard.down('Control');
  for (let i = 0; i < n; i++) { await p.mouse.wheel({ deltaY: dy }); await sleep(30); }
  await p.keyboard.up('Control'); await sleep(900);
};
group(() => check('trends-zoom', 'In the opened Trends card a pinch or ctrl+wheel over the plot narrows the hands axis around the pointer (no page zoom), a drag pans it, and double-click, Reset zoom or a Hands preset restore every hand; a zoom over the replay ends it; a plain wheel over the chart still moves the page', async () => {
  const p = await pageAt(1440, 900, 'race'), bad = [], seen = [];
  try {
    await clickCenter(p, '#race-panel'); await sleep(1500);
    await clickText(p, 'Skip'); await sleep(1200);
    // Every wheel event as the page saw it once handled: a ctrl+wheel the chart took is cancelled (no browser zoom).
    await p.evaluate(() => { window.__wheels = []; addEventListener('wheel', e => window.__wheels.push({ ctrl: e.ctrlKey, cancelled: e.defaultPrevented })); });
    const full = await zoomState(p), all = full.x1 - full.x0, near = (s, a, b) => Math.abs(s.x0 - a) <= all * 0.01 && Math.abs(s.x1 - b) <= all * 0.01;
    if (!Number.isFinite(all) || all <= 0) return { pass: false, detail: 'no hands axis on the plot (fewer than two x ticks)' };
    const atPointer = s => s.x0 + 0.7 * (s.x1 - s.x0);
    await ctrlWheel(p, full, 0.7, -40, 5);
    const z = await zoomState(p), w = z.x1 - z.x0, wheels = await p.evaluate(() => window.__wheels);
    if (!(w < all * 0.6)) bad.push(`ctrl+wheel left ${w.toFixed(0)} of ${all.toFixed(0)} hands`);
    if (Math.abs(atPointer(z) - atPointer(full)) > all * 0.01) bad.push(`the hand under the pointer moved from ${atPointer(full).toFixed(0)} to ${atPointer(z).toFixed(0)}`);
    if (!wheels.length || wheels.some(e => e.ctrl && !e.cancelled)) bad.push(`${wheels.filter(e => !e.cancelled).length} of ${wheels.length} ctrl+wheel events left to the browser (page zoom)`);
    if (z.scrolled !== full.scrolled) bad.push('the page scrolled');
    if (!z.reset) bad.push('no Reset zoom while zoomed');
    seen.push(`ctrl+wheel: ${full.x0.toFixed(0)}–${full.x1.toFixed(0)} → ${z.x0.toFixed(0)}–${z.x1.toFixed(0)}`);
    // A drag 20% of the plot to the left shows later hands, at the same width.
    await p.mouse.move(z.left + 0.5 * z.w, z.y); await p.mouse.down();
    await p.mouse.move(z.left + 0.3 * z.w, z.y, { steps: 8 }); await p.mouse.up(); await sleep(300);
    const d = await zoomState(p), shift = d.x0 - z.x0;
    if (Math.abs(shift - 0.2 * w) > 0.03 * w || Math.abs(d.x1 - d.x0 - w) > 0.5) bad.push(`a drag moved the window ${shift.toFixed(1)} hands (want ${(0.2 * w).toFixed(1)}), width ${w.toFixed(1)} → ${(d.x1 - d.x0).toFixed(1)}`);
    seen.push(`drag: → ${d.x0.toFixed(0)}–${d.x1.toFixed(0)}`);
    // Double-click, Reset zoom and a Hands preset (the one already on) each bring back every hand.
    await p.mouse.click(d.left + 0.5 * d.w, d.y, { count: 2 }); await sleep(900);
    const dbl = await zoomState(p);
    if (!near(dbl, full.x0, full.x1) || dbl.reset) bad.push(`double-click left ${dbl.x0.toFixed(0)}–${dbl.x1.toFixed(0)}${dbl.reset ? ' and Reset zoom' : ''}`);
    await ctrlWheel(p, dbl, 0.4, -40, 4);
    if (!(await zoomState(p)).reset) bad.push('no Reset zoom after the second zoom');
    await clickText(p, 'Reset zoom'); await sleep(900);
    const rs = await zoomState(p);
    if (!near(rs, full.x0, full.x1) || rs.reset) bad.push(`Reset zoom left ${rs.x0.toFixed(0)}–${rs.x1.toFixed(0)}${rs.reset ? ' and its button' : ''}`);
    await ctrlWheel(p, rs, 0.4, -40, 4);
    await p.evaluate(() => [...document.querySelectorAll('[role=group][aria-label="Hands shown"] button')].find(b => b.getAttribute('aria-pressed') === 'true')?.click()); await sleep(900);
    const pr = await zoomState(p);
    if (!near(pr, full.x0, full.x1)) bad.push(`the Hands preset left ${pr.x0.toFixed(0)}–${pr.x1.toFixed(0)}`);
    // A zoom over the replay ends it (as Skip would) and zooms the resting chart.
    if (!(await clickText(p, 'Replay'))) bad.push('no Replay');
    await sleep(1500);
    const playing = (await zoomState(p)).clock;
    await ctrlWheel(p, pr, 0.5, -40, 5);
    const rz = await zoomState(p);
    if (!playing || rz.clock || !(rz.x1 - rz.x0 < all * 0.9)) bad.push(`a zoom over the replay: ${!playing ? 'it was not playing' : rz.clock ? 'it kept playing' : `${(rz.x1 - rz.x0).toFixed(0)} hands shown`}`);
    await p.mouse.click(rz.left + 0.5 * rz.w, rz.y, { count: 2 }); await sleep(900);
    // A plain wheel over the plot pages as everywhere (Trends to Profiles) and leaves the axis alone.
    const before = await zoomState(p);
    await p.mouse.move(before.left + 0.5 * before.w, before.y); await p.mouse.wheel({ deltaY: 100 }); await sleep(1800);
    const axis = await zoomState(p);
    if (Math.abs(axis.scrolled - before.scrolled) < 50) bad.push('a plain wheel over the plot did not move the page');
    if (!near(axis, full.x0, full.x1)) bad.push(`a plain wheel changed the axis to ${axis.x0.toFixed(0)}–${axis.x1.toFixed(0)}`);
    seen.push(`plain wheel: page moved ${(axis.scrolled - before.scrolled).toFixed(0)}px`);
  } finally { await p.close(); }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
}));
// The same on a touch screen: two fingers pinch the plot's hands axis (never the page); one finger keeps scrolling the page.
group(() => check('trends-zoom-touch', 'On a phone (390x844, touch) a two-finger pinch on the opened Trends plot zooms its hands axis, not the page; a one-finger swipe on it scrolls the page', async () => {
  const p = await newPage(), bad = [];
  try {
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 }); await waitStats(p); await sleep(3000);
    await goto(p, 'race'); await sleep(1500);
    const c = await rect(p, '#race-panel');
    await p.touchscreen.tap(c.l + c.w / 2, c.t + c.h / 2); await sleep(2000);
    await clickText(p, 'Skip'); await sleep(1200);
    const cdp = await p.target().createCDPSession(), touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const s0 = await zoomState(p), all = s0.x1 - s0.x0;
    if (!Number.isFinite(all) || all <= 0) return { pass: false, detail: 'no hands axis on the plot (fewer than two x ticks)' };
    // Two fingers 40px apart at the plot's centre spread to 200px.
    const cx = s0.left + s0.w / 2, fingers = d => [{ x: cx - d / 2, y: s0.y, id: 0 }, { x: cx + d / 2, y: s0.y, id: 1 }];
    await touch('touchStart', fingers(40));
    for (let i = 1; i <= 16; i++) { await touch('touchMove', fingers(40 + i * 10)); await sleep(16); }
    await touch('touchEnd', []); await sleep(900);
    const s1 = await zoomState(p), w = s1.x1 - s1.x0;
    if (!(w < all * 0.6)) bad.push(`a pinch left ${w.toFixed(0)} of ${all.toFixed(0)} hands`);
    if (s1.scale !== 1) bad.push(`the page zoomed to ${s1.scale.toFixed(2)}x`);
    // One finger swiping up 300px from the plot's centre scrolls the page.
    await touch('touchStart', [{ x: cx, y: s1.y, id: 0 }]);
    for (let i = 1; i <= 15; i++) { await touch('touchMove', [{ x: cx, y: s1.y - i * 20, id: 0 }]); await sleep(16); }
    await touch('touchEnd', []); await sleep(1500);
    const s2 = await zoomState(p);
    if (Math.abs(s2.scrolled - s1.scrolled) < 30) bad.push('a one-finger swipe on the plot did not scroll the page');
    return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `pinch: ${all.toFixed(0)} → ${w.toFixed(0)} hands, page at 1x; swipe scrolled ${(s2.scrolled - s1.scrolled).toFixed(0)}px` };
  } finally { await p.close(); }
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
  const MUTED = 'rgba(55, 53, 47, 0.72)';
  one('ticks', [...r.y, ...r.x], { family: 'body', px: 13, color: MUTED, tab: true });
  one('axis titles', r.titles, { family: 'body', px: 13, color: MUTED });
  one('pill names', r.names.map(({ color, ...s }) => s), { family: 'body', px: 13, weight: '500' }); // each in its line's colour (trends-labels-plain)
  for (const v of r.values) if (v.family !== 'body' || v.px !== 13 || !v.tab) { bad.push(`pill value ${JSON.stringify(v)}`); break; }
  const s = o => o ? `${o.family} ${o.px}px ${o.weight} ${o.color ?? ''}${o.tab ? ' tabular' : ''}` : 'none';
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `ticks ${s(r.y[0])}; titles ${s(r.titles[0])}; pill names ${s(r.names[0])}; values ${s(r.values[0])}` };
}));
// Ticks and pills are history-type's; the hover readout keeps the Profiles cells' 14px.
main(() => check('history-number-style', 'The Trends hover readout uses the body sans, tabular, at the Profiles cells\' 14px', async () => {
  const c = await pg.evaluate(() => { const p = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0).getBoundingClientRect(); return [p.left + p.width * 0.45, p.top + p.height * 0.5]; });
  await pg.mouse.move(c[0], c[1]); await sleep(300);
  const r = await pg.evaluate(() => {
    const plot = [...document.querySelectorAll('[data-plot]')].find(e => e.getBoundingClientRect().width > 0);
    const svg = plot.querySelector('svg'), k = plot.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const ref = document.querySelector('#stats-panel td, #stats-card td') || document.body;
    const es = [...plot.querySelectorAll('[data-readout-value]')];
    if (!es.length) return ['readout: none'];
    const bad = new Set();
    for (const e of es) {
      const cs = getComputedStyle(e), px = parseFloat(cs.fontSize) * k;
      if (cs.fontFamily !== getComputedStyle(ref).fontFamily) bad.add(`font ${cs.fontFamily.slice(0, 20)}`);
      if (!cs.fontVariantNumeric.includes('tabular-nums')) bad.add('not tabular');
      if (Math.abs(px - 14) > 0.75) bad.add(`${px.toFixed(1)}px`);
    }
    return bad.size ? [`readout: ${[...bad].join(', ')}`] : [];
  });
  await pg.mouse.move(5, 5);
  return { pass: !r.length, detail: r.length ? r.join('; ') : 'readout: body sans, tabular, 14px on screen' };
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
group(() => check('profiles-replay-one-time', 'While the replay plays, a Profiles row shows no figure from today: 3-bet, C-bet, Fold to c-bet, WTSD, W$SD, Fold when check free, Misses and All-in adj. are dashes (the timeline does not carry them); at rest they are back', async () => {
  const p = await pageAt(1440, 900, 'race');
  try {
    if (!(await p.evaluate(() => [...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Skip' && e.getBoundingClientRect().width > 0)))) await clickText(p, 'Replay');
    await sleep(1500); await goto(p, 'stats-table'); await sleep(1500);
    const LACK = ['3-bet', 'C-bet', 'Fold to c-bet', 'WTSD', 'W$SD', 'Fold when check free', 'Misses', 'All-in adj.'];
    const read = () => p.evaluate(lack => {
      const ths = [...document.querySelectorAll('#stats-card thead tr:last-child th')];
      const cols = lack.map(l => ths.findIndex(th => (th.querySelector('button') ?? th).textContent.trim() === l));
      const playing = !!document.querySelector('[data-race-clock]'); // Trends' clock shows only while the replay plays
      return { cols, playing, rows: [...document.querySelectorAll('#stats-card tbody tr')].filter(tr => tr.querySelector('th a')).map(tr => cols.map(i => (i < 0 ? null : tr.children[i]?.textContent.trim()))) };
    }, LACK);
    const during = await read();
    const bad = [];
    if (during.cols.some(i => i < 0)) bad.push(`columns missing: ${LACK.filter((_, k) => during.cols[k] < 0).join(', ')}`);
    if (!during.playing) bad.push('the replay was not playing');
    const today = during.rows.flatMap(r => r.filter(c => c !== null && c !== '—'));
    if (today.length) bad.push(`while replaying, ${today.length} figures from today (e.g. ${today.slice(0, 3).join(', ')})`);
    await goto(p, 'race'); await sleep(800); await clickText(p, 'Skip'); await sleep(800); await goto(p, 'stats-table'); await sleep(1500);
    const after = await read();
    if (!after.rows.some(r => r.some(c => c !== null && c !== '—'))) bad.push('at rest, still only dashes');
    return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `${during.rows.length} rows: dashes while replaying, figures at rest` };
  } finally { await p.close(); }
}));
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
  // The replay must be playing: the Trends checks before this one end it (Skip), so the tile's Replay restarts it.
  await goto(pg, 'stats'); await sleep(1200); await pg.evaluate(() => document.querySelector('#race-panel [data-tile-replay]')?.click()); await sleep(300);
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

// Owner, 2026-11-09: "It looks like we for-loop over each cell rather than update each cell at once" (the Trends replay).
// Each changed cell's flash started 20 ms after the one before (a ripple), a frame after its figure changed. Every cell a
// replay step changes shows its new figure and starts its flash in one frame, none delayed.
main(() => check('matchups-cells-together', 'During the Trends replay, every Matchups cell a step changes shows its new figure and starts its flash in the same frame, none delayed (no ripple)', async () => {
  await goto(pg, 'stats'); await sleep(800);
  const r = await pg.evaluate(() => new Promise(res => {
    const fig = new Map(), seen = new WeakSet(); const t0 = performance.now();
    let steps = 0, cells = 0, late = 0, delayed = 0, flashes = 0;
    const loop = () => {
      let changed = 0;
      for (const c of document.querySelectorAll('#pairwise-panel td[data-cell]')) {
        const t = c.querySelector('[aria-hidden]')?.textContent ?? '';
        const was = fig.get(c.dataset.cell); fig.set(c.dataset.cell, t);
        // A pair's first figure (it had none: they had not met) is no change of value: it does not flash.
        const fresh = c.getAnimations().filter(a => !seen.has(a)); fresh.forEach(a => seen.add(a));
        flashes += fresh.length; delayed += fresh.filter(a => a.effect.getTiming().delay > 0).length;
        if (!was || !t || was === t) continue;
        changed++; if (!fresh.length) late++; // its figure changed this frame, its flash did not start with it
      }
      if (changed) { steps++; cells += changed; }
      if (performance.now() - t0 < 4000) requestAnimationFrame(loop); else res({ steps, cells, late, delayed, flashes });
    };
    requestAnimationFrame(loop);
  }));
  return { pass: r.steps > 0 && !r.late && !r.delayed, detail: r.steps ? `${r.steps} steps, ${r.cells} cell changes, ${r.flashes} flashes: ${r.late} flashes a frame late, ${r.delayed} delayed` : 'no figure changed in 4s (is the replay running?)' };
}));

// Owner, 2026-11-07: "Trends ... pretty smooth. For profiles, it's not as smooth" (the tile's text
// shrank to ~45% on the first frame of the glide and grew back, as the card's table replaced it scaled
// down), and the card took over from the gliding tile with a jump in size. While a tile glides to its
// card, Profiles' figures stay at their size, and the card takes over exactly where the tile ends.
// Owner, 2026-11-09: "When I click into and out of Matchups it snaps, whereas the other two graphs expand and minimize
// naturally." Opening, Matchups' figures showed the card's size scaled down into the tile (smaller than the tile's) and
// its names and Total column jumped to the card's layout; closing, its matrix kept a glide begun while the stage was
// hidden under the card and drew far off its tile. Both ways each tile's figures never shrink below the tile's size and
// its table stays inside the tile; the card takes over when the tile has landed (not on a timer a busy machine outruns).
main(() => check('glide-smooth', 'Opening and closing Profiles and Matchups: no jump at the hand-over, their figures never drawn smaller than on the tile, the table inside its tile in every frame', async () => {
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
        const t = el.querySelector('table')?.getBoundingClientRect();
        out.push({ on, b: [b.left, b.top, b.right, b.bottom], s, t: t && [t.left, t.top, t.right, t.bottom], t0: performance.now() - t0 });
        // Until 300 ms after the card took over (it waits for the tile to land: longer on a busy machine), 3 s at most.
        const over = out.findIndex(x => !x.on);
        if (performance.now() - t0 < 3000 && (over < 0 || performance.now() - t0 < out[over].t0 + 300)) requestAnimationFrame(loop); else res(out);
      };
      requestAnimationFrame(loop);
    }), [tile, card]);
    // The tile's figure size at rest, before it opens.
    const at = await pg.evaluate(s => { const e = [...document.querySelectorAll(`${s} tbody td`)].map(td => [...td.querySelectorAll('*'), td].flatMap(x => [...x.childNodes]).find(n => n.nodeType === 3 && /\d/.test(n.textContent))).find(Boolean); if (!e) return 0; const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().height; }, tile);
    // Frames of the tile on screen whose table leaves the tile, or whose figures are drawn under 90% of the tile's size.
    const off = fr => fr.filter(x => x.on && x.t && (x.t[0] < x.b[0] - 2 || x.t[1] < x.b[1] - 2 || x.t[2] > x.b[2] + 2 || x.t[3] > x.b[3] + 2)).length;
    const small = fr => fr.filter(x => x.on && x.s && at && x.s < at * 0.9).length;
    await pg.mouse.click(pt[0], pt[1]);
    const f = await run;
    if (off(f)) bad.push(`${id}: the table off its tile in ${off(f)} frames opening`);
    if (small(f)) bad.push(`${id}: figures drawn under the tile's size in ${small(f)} frames opening`);
    const i = f.findIndex(x => !x.on);
    if (i < 1) {
      bad.push(`${id}: ${i < 0 ? 'never reached its card in 3 s' : 'the card took over before the tile had been drawn gliding'}`);
      await sleep(1500); await clickPrefix(pg, 'Back to overview'); await sleep(1500); // leave the page on the overview for the checks after
      continue;
    }
    const jump = Math.max(...f[i].b.map((v, k) => Math.abs(v - f[i - 1].b[k])));
    const rest = f.at(-1).s || 1; // the text's height once the card has landed
    const lo = Math.min(...f.map(x => x.s / rest)), hi = Math.max(...f.map(x => x.s / rest));
    seen.push(`${id} hand-over ${jump.toFixed(1)}px${id === 'stats-table' ? `, text ×${lo.toFixed(2)}–${hi.toFixed(2)}` : ''}`);
    if (jump > 2) bad.push(`${id}: the card takes over ${jump.toFixed(0)}px off the tile`);
    if (id === 'stats-table' && (lo < 0.85 || hi > 1.15)) bad.push(`Profiles text drawn at ×${lo.toFixed(2)}–${hi.toFixed(2)} of its size mid-glide`);
    // Closing: the tile on screen once the page is back on the overview (opacity: not under the card).
    const back = pg.evaluate(([tile]) => new Promise(res => {
      const out = [], t0 = performance.now();
      const op = e => { let v = 1; for (; e; e = e.parentElement) v *= +getComputedStyle(e).opacity; return v; };
      const loop = () => {
        const el = document.querySelector(tile), b = el.getBoundingClientRect(), t = el.querySelector('table')?.getBoundingClientRect();
        const td = [...el.querySelectorAll('tbody td')].find(e => /^\d|^[+−]/.test(e.textContent.trim()));
        const text = td && [...td.querySelectorAll('*'), td].flatMap(e => [...e.childNodes]).find(n => n.nodeType === 3 && /\d/.test(n.textContent));
        let s = 0; if (text) { const r = document.createRange(); r.selectNodeContents(text); s = r.getBoundingClientRect().height; }
        out.push({ on: op(el) > 0.5, b: [b.left, b.top, b.right, b.bottom], s, t: t && [t.left, t.top, t.right, t.bottom] });
        if (performance.now() - t0 < 1000) requestAnimationFrame(loop); else res(out);
      };
      requestAnimationFrame(loop);
    }), [tile]);
    await clickPrefix(pg, 'Back to overview');
    const g = await back;
    if (off(g)) bad.push(`${id}: the table off its tile in ${off(g)} frames closing`);
    if (small(g)) bad.push(`${id}: figures drawn under the tile's size in ${small(g)} frames closing`);
    await sleep(1200);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
}));

// Owner, 2026-11-10, the third time on this seam: "when I open and close matchups, it does not feel like a smooth
// experience. There's some flashing ... With trends, it's very smooth ... for matchups and profiles, there's just
// something off." Profiles and Matchups hand over between two elements (the tile and its card), and every difference
// between them showed as a one-frame pop; closing painted a blank frame. glide-smooth measured the DOM and passed
// through all of it, so these three judge the painted frames (CDP screencast) by content and order, never by timing,
// at four sizes, closing with Back to overview and with Escape. Trends, which never swaps elements, is filmed and
// judged the same way as the control. One run of films serves all three checks (the first of them pays for it).
// Each frame carries the DOM state it was painted from (test-only): a ResizeObserver, which runs after rAF and layout
// and before paint, samples the page and paints the sample's number into a 6px marker in the bottom-left corner.
const filmable = p => p.evaluate(() => {
  const F = window.__film = { k: 0, on: false, s: [] };
  const mark = document.createElement('div'), probe = document.createElement('div');
  mark.style.cssText = 'position:fixed;left:0;bottom:0;width:6px;height:6px;z-index:2147483647;pointer-events:none';
  probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none';
  document.body.append(mark, probe);
  const R = e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
  const shown = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const part = e => e.matches('[role=group][aria-label=Lineup]') && e.closest('#pairwise-panel, #pairwise-card') ? 'Lineup control' : e.matches('[data-scope]') ? 'Leader'
    : e.matches('p') ? 'definition line' : e.matches('tr.add-in') ? 'group header row' : e.matches('.add-in') && e.closest('table') ? 'extra columns'
    : e.matches('.add-in') && e.querySelector('button') ? 'button row' : e.matches('.add-in') ? 'Total column'
    : e.matches('[translate=no]') && e.closest('tbody, a[title]') ? 'row names' : e.textContent.trim() === 'Open ↓' ? 'Open ↓' : null;
  const sample = () => {
    const { tile, card, screen } = F.cfg;
    const t = document.querySelector(tile), c = card && document.querySelector(`${card} .card-chrome`);
    const onCard = !!c && document.getElementById(screen).getBoundingClientRect().top < 2;
    const el = onCard ? c : t;
    // A part drawn fully transparent (an add-in before its fade starts) paints nothing: its box would only measure what
    // shows through it (the tile's own columns under the card's layout), read as the part appearing in one frame.
    const seen = e => { for (let x = e; x && x !== el; x = x.parentElement) if (+getComputedStyle(x).opacity < 0.01) return false; return true; };
    // A part inside the card's scroller is drawn only where the scroller shows it (scrolled away, its box lies over the header).
    const sc = el.querySelector('.panel-scroll'), S = sc && R(sc);
    const box = e => { const b = R(e); return S && sc.contains(e) ? [Math.max(b[0], S[0]), Math.max(b[1], S[1]), Math.min(b[2], S[2]), Math.min(b[3], S[3])] : b; };
    const parts = [...el.querySelectorAll('[role=group], [data-scope], p, .add-in, [translate=no], span[aria-hidden]')].filter(e => shown(e) && seen(e)).map(e => [part(e), box(e)]).filter(([k]) => k);
    const names = [...el.querySelectorAll('a[title] [translate=no]')];
    const rows = [...el.querySelectorAll('tbody tr')].map((tr, i) => {
      const cells = [...tr.querySelectorAll(card === '#pairwise-card' ? 'td[data-hands]' : 'td')].filter(d => shown(d) && /\d/.test(d.textContent)).map(R);
      const name = card === '#pairwise-card' ? names[i] : tr.querySelector('th [translate=no]');
      // Its opacity (a row fading as a whole, or faded by picked rows): faint text on a tint still reads as ink, on white not.
      let o = 1; for (let x = tr; x && x !== el; x = x.parentElement) o *= +getComputedStyle(x).opacity;
      if (!cells.length || !name || !shown(name)) return null;
      const cy = [Math.min(...cells.map(b => b[1])), Math.max(...cells.map(b => b[3]))], cx = [Math.min(...cells.map(b => b[0])), Math.max(...cells.map(b => b[2]))];
      // Painted where its numbers are: a row the room clips (a phone's tile at the window's foot as its glide starts) is not
      // drawn, and the ink there is whatever shows instead (the About band's pill), not its numbers.
      const hit = el.contains(document.elementFromPoint((cx[0] + cx[1]) / 2, (cy[0] + cy[1]) / 2));
      return { n: name.textContent.trim(), o, hit, nx: R(name), cy, cx, tr: R(tr) };
    }).filter(Boolean);
    const tip = [...el.querySelectorAll('[role=tooltip]')].find(e => shown(e) && getComputedStyle(e).visibility === 'visible');
    return { y: scrollY, card: onCard, box: R(el), parts, rows, tip: tip && R(tip), sc: sc && R(sc), st: sc ? sc.scrollTop + sc.scrollLeft : 0, head: Math.max(0, ...[...el.querySelectorAll('thead th')].map(e => e.getBoundingClientRect().bottom)), title: R(el.querySelector('h2')) };
  };
  new ResizeObserver(() => {
    if (!F.on) return;
    F.s[++F.k] = sample();
    mark.style.background = `rgb(${F.k & 255},${(F.k >> 8) & 255},90)`;
  }).observe(probe);
  let flip = 0;
  const loop = () => { probe.style.width = `${(flip ^= 1) + 1}px`; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
// A screencast PNG (8-bit RGB or RGBA, not interlaced) to RGBA pixels: no image dependency in the checks.
const png = b64 => {
  const b = Buffer.from(b64, 'base64'), idat = [];
  let o = 8, w = 0, h = 0, c = 4;
  while (o < b.length) {
    const n = b.readUInt32BE(o), t = b.toString('latin1', o + 4, o + 8);
    if (t === 'IHDR') { w = b.readUInt32BE(o + 8); h = b.readUInt32BE(o + 12); c = b[o + 17] === 6 ? 4 : 3; }
    if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n));
    o += 12 + n;
  }
  const raw = inflateSync(Buffer.concat(idat)), s = w * c, px = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(s);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (s + 1)], cur = raw.subarray(y * (s + 1) + 1, (y + 1) * (s + 1));
    for (let i = 0; i < s; i++) {
      const a = i >= c ? cur[i - c] : 0, u = prev[i], ul = i >= c ? prev[i - c] : 0;
      const pa = Math.abs(u - ul), pb = Math.abs(a - ul), pc = Math.abs(a + u - 2 * ul);
      cur[i] += f === 1 ? a : f === 2 ? u : f === 3 ? (a + u) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? u : ul) : 0;
    }
    for (let x = 0, j = y * w * 4; x < w; x++, j += 4) { px[j] = cur[x * c]; px[j + 1] = cur[x * c + 1]; px[j + 2] = cur[x * c + 2]; }
    prev = cur;
  }
  return { w, h, px };
};
const clip = (f, [l, t, r, b]) => [Math.max(0, Math.ceil(l)), Math.max(0, Math.ceil(t)), Math.min(f.w, Math.floor(r)), Math.min(f.h, Math.floor(b))];
const meet = ([l, t, r, b], [L, T, R, B]) => [Math.max(l, L), Math.max(t, T), Math.min(r, R), Math.min(b, B)];
// The share of a box's pixels (every other one) that pass `test`.
const share = (f, box, test) => {
  const [l, t, r, b] = clip(f, box); let n = 0, all = 0;
  for (let y = t; y < b; y += 2) for (let x = l; x < r; x += 2) { const i = (y * f.w + x) * 4; all++; if (test(f.px[i], f.px[i + 1], f.px[i + 2])) n++; }
  return all ? n / all : 0;
};
const PAGE = (r, g, b) => Math.abs(r - 250) + Math.abs(g - 250) + Math.abs(b - 249) <= 6; // the page colour (pages-one-background)
const INK = (r, g, b) => r + g + b < 300; // text at full strength (TEXT is 155); the darkest cell tint sums 464
// How much a set of boxes is drawn: the darkness summed over their pixels, in pixels of black.
const dark = (f, boxes) => boxes.reduce((d, box) => {
  const [l, t, r, b] = clip(f, box);
  for (let y = t; y < b; y++) for (let x = l; x < r; x++) { const i = (y * f.w + x) * 4; d += 765 - f.px[i] - f.px[i + 1] - f.px[i + 2]; }
  return d;
}, 0) / 765;
// The longest run of scrollbar grey along the 10px strips at a box's right and bottom edges.
const thumb = (f, [l, t, r, b]) => {
  [l, t, r, b] = clip(f, [l, t, r, b]);
  const grey = (x, y) => { const i = (y * f.w + x) * 4, p = [f.px[i], f.px[i + 1], f.px[i + 2]]; return Math.max(...p) - Math.min(...p) <= 6 && p[0] >= 140 && p[0] <= 215; };
  let most = 0;
  for (let x = r - 10; x < r; x++) for (let y = t, run = 0; y < b; y++) most = Math.max(most, run = grey(x, y) ? run + 1 : 0);
  for (let y = b - 10; y < b; y++) for (let x = l, run = 0; x < r; x++) most = Math.max(most, run = grey(x, y) ? run + 1 : 0);
  return most;
};
// Where two frames differ inside a box, as regions of 16px blocks. Both frames are blurred 3x3, and a pixel counts as
// changed only when no pixel within 1px of it in the other frame matches it (SAME, summed RGB), both ways; a block
// counts with BLOCK_PX changed pixels. Measured on this page's frames (1440x900): two frames of the still page differ
// in 0 pixels; Trends' tile and its own screen at the jump in 0; Profiles' tile and card at its matching hand-over in
// 253 pixels scattered over the table (text drawn at another sub-pixel phase), no block; unblurred, those were 9,432
// pixels in 40 blocks. The Lineup control popping in is 1,938 changed pixels, the hover readout 20,296.
const SAME = 60, BLOCK_PX = 12;
const regions = (A, B, box) => {
  const [l, t, r, b] = clip(A, box), w = r - l, h = b - t;
  // Both frames blurred over 3x3 first: text drawn at another sub-pixel phase blurs to the same picture.
  const blur = F => { const o = new Float32Array(w * h * 3); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) for (let c = 0; c < 3; c++) { let v = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v += F.px[((t + y + dy) * F.w + l + x + dx) * 4 + c]; o[(y * w + x) * 3 + c] = v / 9; } return o; };
  const P = blur(A), Q = blur(B), blocks = new Map();
  const d = (X, Y, i, j) => Math.abs(X[i] - Y[j]) + Math.abs(X[i + 1] - Y[j + 1]) + Math.abs(X[i + 2] - Y[j + 2]);
  const near = (X, Y, i, x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (d(X, Y, i, ((y + dy) * w + x + dx) * 3) <= SAME) return true; return false; };
  for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
    const i = (y * w + x) * 3;
    if (d(P, Q, i, i) <= SAME || (near(P, Q, i, x, y) && near(Q, P, i, x, y))) continue;
    const k = `${(l + x) >> 4},${(t + y) >> 4}`; blocks.set(k, (blocks.get(k) ?? 0) + 1);
  }
  const hot = new Set([...blocks].filter(([, n]) => n >= BLOCK_PX).map(([k]) => k)), out = [];
  for (const k0 of hot) {
    const todo = [k0], box = [Infinity, Infinity, -Infinity, -Infinity]; let px = 0; hot.delete(k0);
    while (todo.length) {
      const [x, y] = todo.pop().split(',').map(Number); px += blocks.get(`${x},${y}`);
      box[0] = Math.min(box[0], x * 16); box[1] = Math.min(box[1], y * 16); box[2] = Math.max(box[2], x * 16 + 16); box[3] = Math.max(box[3], y * 16 + 16);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = `${x + dx},${y + dy}`; if (hot.delete(n)) todo.push(n); }
    }
    out.push({ box, px });
  }
  return { out, px: [...blocks.values()].reduce((a, n) => a + n, 0) };
};
// What sits in a region: the smallest named things of either frame that overlap it.
const what = (box, ...ss) => {
  const items = ss.flatMap(s => [...s.parts, ...s.rows.map(r => [`row ${r.n}`, r.tr]), ['title', s.title]]);
  const hit = items.filter(([, r]) => { const m = meet(r, box); return m[2] > m[0] && m[3] > m[1]; }).sort((a, b) => (a[1][2] - a[1][0]) * (a[1][3] - a[1][1]) - (b[1][2] - b[1][0]) * (b[1][3] - b[1][1]));
  return [...new Set(hit.map(([k]) => k))].slice(0, 2).join(' / ') || 'nothing named';
};
const BLANK = 0.05; // under 5% of the card's box painted: neither card nor tile (a blank frame measures 0.1-0.4%, the lowest real one 30%+)
const SECTIONS = { Trends: ['#race-panel', null, 'race'], Profiles: ['#stats-panel', '#stats-card', 'stats-table'], Matchups: ['#pairwise-panel', '#pairwise-card', 'pairwise'] };
// The frames painted around one open or close, each with the sample it was painted from; `post`: after the press.
const film = async (p, cfg, act, to) => {
  const cdp = p.__cdp ??= await p.createCDPSession(), data = [];
  const W = await p.evaluate(c => { Object.assign(window.__film, { cfg: c, s: [], on: true }); return [innerWidth, innerHeight]; }, cfg);
  const on = f => { data.push(f.data); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); };
  cdp.on('Page.screencastFrame', on);
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: W[0], maxHeight: W[1] });
  await sleep(400);
  const mark = await p.evaluate(() => window.__film.k);
  await act();
  await p.waitForFunction(id => Math.abs(document.getElementById(id).getBoundingClientRect().top) < 2, { timeout: 15000, polling: 100 }, to).catch(() => {});
  await sleep(1300);
  await cdp.send('Page.stopScreencast'); cdp.off('Page.screencastFrame', on);
  const s = await p.evaluate(() => { window.__film.on = false; return window.__film.s; });
  const frames = data.map(png).map(f => { const i = ((f.h - 3) * f.w + 2) * 4; return { ...f, k: f.px[i + 2] === 90 ? f.px[i] + 256 * f.px[i + 1] : 0 }; }).filter(f => f.k >= mark && s[f.k]).sort((a, b) => a.k - b.k);
  // The last frame from before the press, then every frame after it, in the order they were painted (the screencast can
  // deliver them out of order).
  return Object.assign(frames.filter((f, i) => f.k > mark || frames[i + 1]?.k > mark).map(f => ({ ...f, s: s[f.k], post: f.k > mark })), { S: s });
};
// Judges one film for all three checks; returns their findings (the frames are dropped after).
const judge = (fr, name, how, state) => {
  const out = { name, blank: [], same: [], clean: [], cal: {} }, post = fr.filter(f => f.post);
  if (post.length < 3) { out.same.push(`${name}: only ${post.length} frames painted`); return out; }
  const ref = how === 'open' ? post.at(-1).s.box : fr[0].s.box; // the card's box (Trends: its opened tile)
  fr.forEach(f => { f.ink = share(f, ref, (r, g, b) => !PAGE(r, g, b)); });
  post.forEach((f, i) => f.ink < BLANK && out.blank.push(`${name}: frame ${i + 1} of ${post.length} is blank (${(100 * f.ink).toFixed(1)}% painted in the card's box)`));
  out.cal.ink = Math.min(...post.map(f => f.ink));
  // The swap (the page's jump, sample kSwap): the last frame painted before it, and the first after it with anything
  // painted. The screencast drops frames on a busy machine: a frame either side counts only if nothing moved between
  // it and the swap (every sample in between has its box and scroll) or every frame in between was captured (blank
  // ones); otherwise the hand-over was not seen and the film is taken again.
  const S = fr.S, yEnd = post.at(-1).s.y, kSwap = S.findLastIndex(x => x && Math.abs(x.y - yEnd) > 2) + 1;
  const i = post.findLastIndex(f => f.k < kSwap), j = post.findIndex(f => f.k >= kSwap && f.ink >= BLANK), caught = new Set(fr.map(f => f.k));
  const still = (a, b) => S.slice(a, b + 1).every(x => x && Math.abs(x.y - S[a].y) <= 2 && x.box.every((v, n) => Math.abs(v - S[a].box[n]) <= 0.5));
  const seen = (a, b) => still(a, b) || Array.from({ length: b - a + 1 }, (_, n) => a + n).every(k => caught.has(k));
  if (i < 0 || j < 0 || !seen(post[i].k, kSwap - 1) || !seen(kSwap, post[j].k)) out.missed = true;
  else if (name.startsWith('Trends') && post[j].w < 768) out.cal.swap = 0; // Trends' phone legend steps 4px at its jump (its own, out of this work)
  else {
    const a = post[i], b = post[j], box = (how === 'open' ? b : a).s.box;
    const moved = Math.max(...a.s.box.map((v, n) => Math.abs(v - b.s.box[n])));
    if (moved > 2) out.same.push(`${name}: the box moves ${moved.toFixed(0)}px at the swap`);
    const { out: rs, px } = regions(a, b, box);
    out.cal.swap = px;
    if (rs.length) out.same.push(`${name}: at the swap (frame ${i + 1} → ${j + 1}) the picture changes at ${rs.slice(0, 4).map(r => `${what(r.box, a.s, b.s)} (${r.box[2] - r.box[0]}x${r.box[3] - r.box[1]} at ${r.box[0]},${r.box[1]})`).join('; ')}${rs.length > 4 ? ` and ${rs.length - 4} more` : ''}`);
    const still = regions(post.at(-2), post.at(-1), box);
    out.cal.still = still.px;
  }
  // While it glides: what the card adds (and the tile's "Open ↓", the Leader, the row names) fades; nothing appears,
  // vanishes or drops out between two frames painted one after the other. Blank frames are A's; they are skipped here.
  const seq = fr.filter(f => f.ink >= BLANK), gap = (a, b) => b.k - a.k - fr.filter(f => f.ink < BLANK && f.k > a.k && f.k < b.k).length;
  const at = n => fr.indexOf(seq[n]) + (fr[0].post ? 1 : 0); // a frame's number after the press
  const keys = new Set(seq.flatMap(f => f.s.parts.map(([k]) => k)));
  for (const k of keys) {
    if (name.startsWith('Trends') && k === 'Open ↓') continue; // Trends' tile hides it at once too, by design so far
    const d = seq.map(f => dark(f, f.s.parts.filter(([q]) => q === k).map(([, r]) => meet(r, f.s.box))));
    const top = Math.max(...d); if (top < 40) continue;
    const r = d.map(v => v / top);
    for (let n = 1; n < seq.length; n++) {
      if (gap(seq[n - 1], seq[n]) > 1) continue; // a frame between them was not captured
      if (seq[n].s.st !== seq[n - 1].s.st) continue; // scrolled into or out of the card's view (a closing card returns to its top), not drawn or dropped
      if (r[n - 1] <= 0.1 && r[n] >= 0.9) out.clean.push(`${name}: ${k} appears in one frame (${at(n - 1)} → ${at(n)})`);
      if (r[n - 1] >= 0.9 && r[n] <= 0.1) out.clean.push(`${name}: ${k} ${r[n + 1] >= 0.8 ? 'drops out for one frame' : 'vanishes in one frame'} (${at(n - 1)} → ${at(n)})`);
    }
  }
  const torn = new Map(), tips = [], bars = [], jumps = [];
  seq.forEach((f, n) => {
    // A scrolled card closes from where it is: its content never jumps to its top in one frame (it did as the glide back started).
    // (A smooth scroll back that a slow frame stretches is moving already: the jump starts from a still scroll.)
    if (n > 1 && gap(seq[n - 1], f) <= 1 && Math.abs(f.s.st - seq[n - 1].s.st) >= 30 && seq[n - 1].s.st === seq[n - 2].s.st) jumps.push(`${seq[n - 1].s.st} → ${f.s.st}px (${at(n - 1)} → ${at(n)})`);
    const [l, t, r, b] = f.s.box;
    for (const row of f.s.rows) {
      if (!row.hit || row.o < 0.99 || row.cy[0] < Math.max(t, 44, f.s.head - 1) || Math.max(row.cy[1], row.nx[3]) > Math.min(b, f.h) || row.nx[0] < l || row.nx[2] > r) continue; // clipped, or under the sticky bar or the card's pinned header (scrolled)
      if (share(f, [row.cx[0], row.cy[0], row.cx[1], row.cy[1]], INK) * (row.cx[1] - row.cx[0]) * (row.cy[1] - row.cy[0]) / 4 < 8) continue; // no numbers drawn
      if (share(f, [row.nx[0], row.cy[0], row.nx[2], row.cy[1]], INK) === 0 && !torn.has(row.n)) torn.set(row.n, at(n));
    }
    if (f.post && f.s.tip && share(f, f.s.tip, (r, g, b) => r + g + b >= 759) > 0.5) tips.push(at(n));
    // Trends' tile shows its scrollbars while gliding too (its own, out of this work): judged on Profiles and Matchups.
    if (state === 'default' && !name.startsWith('Trends') && !f.s.card && f.s.sc && thumb(f, meet(f.s.sc, f.s.box)) >= 30) bars.push(at(n));
  });
  for (const [row, n] of torn) out.clean.push(`${name}: row "${row}" has its numbers but no name (frame ${n})`);
  if (tips.length) out.clean.push(`${name}: a hover tooltip shows with the pointer still (frames ${tips[0]}–${tips.at(-1)})`);
  if (bars.length) out.clean.push(`${name}: a scrollbar shows on the gliding tile (frames ${bars[0]}–${bars.at(-1)})`);
  if (jumps.length) out.clean.push(`${name}: the content's scroll jumps in one frame (${jumps.join(', ')})`);
  return out;
};
let filmed;
const films = () => (filmed ??= alone(async () => {
  const out = [];
  for (const [w, h] of [[1440, 900], [1512, 982], [1728, 1117], [390, 844]]) {
    const p = await pageAt(w, h, 'race');
    // Puppeteer launches Chrome with --hide-scrollbars; the films show them, as a mouse user's browser does.
    await (p.__cdp ??= await p.createCDPSession()).send('Emulation.setScrollbarsHidden', { hidden: false });
    await clickText(p, 'Skip'); await sleep(1000); // the replay over, only the glides change pixels
    await goto(p, 'stats'); await sleep(1500);
    await filmable(p);
    for (const [sec, [tile, card, screen]] of Object.entries(SECTIONS)) {
      const take = async (how, state, act) => {
        for (let n = 1; ; n++) {
          await sleep(800);
          const fr = await film(p, { tile, card, screen }, act, how === 'open' ? screen : 'stats');
          const r = judge(fr, `${sec} ${how} ${w}x${h}${state === 'default' ? '' : ` (${state})`}`, how, state);
          if (!r.missed || n === 4) { if (r.missed) r.same.push(`${r.name}: the swap was not captured in 4 films`); out.push(r); return; }
          await (how === 'open' ? back() : open()); await sleep(2500); // undo it and film it again
        }
      };
      const open = async () => { const pt = await p.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return [b.left + b.width / 2, b.top + 20]; }, tile); await p.mouse.click(pt[0], pt[1]); };
      const back = () => clickPrefix(p, 'Back to overview'), esc = () => p.keyboard.press('Escape');
      await take('open', 'default', open); await take('close by Back', 'default', back);
      await take('open', 'default', open); await take('close by Escape', 'default', esc);
      if (sec === 'Trends') continue;
      // The viewer changes the card, then closes and opens it again.
      await open(); await sleep(3000);
      const changed = await p.evaluate(c => {
        const q = s => [...document.querySelectorAll(`${c} ${s}`)];
        const press = (s, t) => { const b = q(s).find(e => e.textContent.trim().startsWith(t) && !e.disabled); b?.click(); return !!b; };
        if (c === '#pairwise-card') return press('button', 'All models') ? 'lineup All models' : '';
        const did = [press('thead th button', 'VPIP') && 'sorted by VPIP', press('button', 'All models') && 'All models'];
        q('tbody tr td').filter((_, i, a) => i === 0 || i === Math.floor(a.length / 2)).forEach(td => td.click());
        return did.filter(Boolean).concat('2 rows picked').join(', ');
      }, card);
      await sleep(800);
      const scrolled = await p.evaluate(c => { const s = document.querySelector(`${c} .panel-scroll`); s.scrollTop = 60; return s.scrollTop; }, card);
      await sleep(500);
      const state = `${changed}${scrolled ? `, scrolled ${scrolled}px` : ''}`;
      await take('close by Back', state, back); await take('open', state, open);
      await back(); await sleep(2500);
    }
    // A real pointer move over a cell still shows its readout.
    await (async () => {
      await p.mouse.click(...await p.evaluate(() => { const b = document.querySelector('#pairwise-panel').getBoundingClientRect(); return [b.left + b.width / 2, b.top + 20]; }));
      await sleep(3000);
      const c = await p.evaluate(() => [...document.querySelectorAll('#pairwise-card td[data-hands]')].map(e => { const b = e.getBoundingClientRect(); return [e, b.left + b.width / 2, b.top + b.height / 2]; }).find(([e, x, y]) => e.contains(document.elementFromPoint(x, y)))?.slice(1));
      if (c) { await p.mouse.move(c[0] - 3, c[1] - 3); await p.mouse.move(c[0], c[1], { steps: 3 }); await sleep(600); }
      if (!c || !await p.evaluate(() => !!document.querySelector('#pairwise-card [role=tooltip]'))) out.push({ blank: [], same: [], clean: [`Matchups ${w}x${h}: a real pointer move over a cell shows no readout`], cal: {} });
    })();
    await p.close();
  }
  return out;
}));
const report = (key, ok) => async () => {
  const fs = await films(), bad = fs.flatMap(f => f[key]), n = fs.filter(f => f.cal.ink !== undefined).length;
  const by = ['Trends', 'Profiles', 'Matchups'].map(x => `${x} ${bad.filter(b => b.startsWith(x)).length}`).join(', ');
  return { pass: !bad.length, detail: bad.length ? `${bad.length} (${by}): ${bad.slice(0, 12).join('; ')}${bad.length > 12 ? '; …' : ''}` : ok(fs, n) };
};
main(() => check('handover-no-blank', 'Opening and closing Trends, Profiles and Matchups (Back to overview and Escape, 1440x900, 1512x982, 1728x1117, 390x844) never paints a frame with neither the card nor the tile in the card\'s box', report('blank',
  (fs, n) => `${n} opens and closes filmed, at least ${(100 * Math.min(...fs.map(f => f.cal.ink ?? 1))).toFixed(0)}% of the card's box painted in every frame`)));
main(() => check('handover-same-picture', 'At each hand-over between tile and card (opening and closing, as opened and after the viewer changed the lineup, the sort, All models, picked rows or the scroll), the last frame before the swap and the first after it show the same picture in the card\'s box, the box itself within 2px', report('same',
  (fs, n) => `${n} hand-overs, changed pixels at the swap ≤ ${Math.max(...fs.map(f => f.cal.swap ?? 0))}, at rest ≤ ${Math.max(...fs.map(f => f.cal.still ?? 0))}`)));
main(() => check('glide-clean', 'While a tile glides to its card and back: no scrollbar on it, no hover readout the pointer did not ask for (a real move still shows one), no row with numbers but no name, no scroll jumping in one frame, and nothing the card adds (Lineup, Total, extra columns, the definition and button rows, Open ↓, the Leader, the names) appears, vanishes or drops out in one frame', report('clean',
  (fs, n) => `${n} glides, every frame clean`)));
// Closing a card marked the room as leaving (what the card adds fades out) and nothing cleared it: a card reached
// afterwards without its tile (wheel, keys, Next) showed no extra columns, group header, button row, definition or Total.
main(() => check('card-adds-after-close', 'After Profiles or Matchups is opened and closed with Back to overview, its card reached by paging shows everything it adds (extra columns, group header, button row, definition line, Total) at full opacity', async () => {
  const low = [];
  for (const [tile, card, screen] of [['#stats-panel', '#stats-card', 'stats-table'], ['#pairwise-panel', '#pairwise-card', 'pairwise']]) {
    await goto(pg, 'stats'); await sleep(1500);
    await pg.mouse.click(...await pg.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return [b.left + b.width / 2, b.top + 20]; }, tile));
    await sleep(3000); await clickPrefix(pg, 'Back to overview'); await sleep(2500);
    await goto(pg, screen); await sleep(1500);
    const r = await pg.evaluate(c => {
      const ps = [...document.querySelectorAll(`${c} :is(.add-in, .added)`)].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
      return { n: ps.length, lo: Math.min(1, ...ps.map(e => +getComputedStyle(e).opacity)) };
    }, card);
    if (!r.n || r.lo < 0.99) low.push(`${screen}: ${r.n} parts, lowest opacity ${r.lo.toFixed(2)}`);
  }
  await goto(pg, 'stats'); await sleep(500);
  return { pass: !low.length, detail: low.length ? low.join('; ') : 'every part the cards add at opacity 1' };
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

// Owner's rules from 2026-11-07: Profiles leads with Hands (no bb/100 on the tile, no rank spread); no scope line,
// session picker or Bars view on the cards; Matchups gets the wider tile; tiles never scroll. 2026-11-08: the card
// shows every stat at once, the "Last 50 hands" sparkline gone (see profiles-all-stats, profiles-no-sparkline).
const PROFILE_STATS = ['Hands', 'bb/100', 'All-in adj.', 'VPIP', 'PFR', '3-bet', 'AF', 'C-bet', 'Fold to c-bet', 'WTSD', 'W$SD', 'Fold when check free', 'Misses'];
// A header's label: its sort button's text (the th also holds its tooltip's), or the th's own (the tile, Model).
const headLabels = (p, sel) => p.evaluate(sel => [...document.querySelectorAll(`${sel} thead tr:last-child th`)].map(th => (th.querySelector('button') ?? th).textContent.trim()), sel);
main(() => check('profiles-columns', 'Profiles columns are Model, Hands, VPIP, PFR, AF (tile), then Model and every stat in order (card)', async () => {
  await goto(pg, 'stats'); await sleep(1500); const tile = (await headLabels(pg, '#stats-panel')).join(',');
  await goto(pg, 'stats-table'); await sleep(1500); const card = (await headLabels(pg, '#stats-card')).join(',');
  return { pass: tile === 'Model,Hands,VPIP,PFR,AF' && card === ['Model', ...PROFILE_STATS].join(','), detail: `tile ${tile} | card ${card}` };
}));
// Owner, 2026-11-08: "the last 50 hands in profiles just sucks. they look like straight lines. plus we don't need a
// line graph considering trends covers that."
main(() => check('profiles-no-sparkline', 'The opened Profiles card has no Last 50 hands column and no sparkline', async () => {
  await goto(pg, 'stats-table'); await sleep(1500);
  const r = await pg.evaluate(() => ({ head: [...document.querySelectorAll('#stats-card thead th')].some(th => th.textContent.trim().startsWith('Last 50')), lines: document.querySelectorAll('#stats-card tbody svg polyline').length }));
  return { pass: !r.head && !r.lines, detail: `${r.head ? 'a Last 50 hands column' : 'no trend column'}, ${r.lines} sparklines` };
}));
// Owner, 2026-11-08: "when I click into profiles we should include c bet, fold to cbet and all the other stats
// outright." Every stat at once (no "All stats" link), all in view without a sideways scroll at his two laptop
// windows; names whole, the Model column hugging them (no band before Hands), no figure clipped.
main(() => check('profiles-all-stats', 'The opened Profiles card shows all 13 stats at once at 1440x900 and 1728x1117: no All stats link, no sideways scroll, names whole and hugged, figures unclipped', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1728, 1117]]) {
    const p2 = await sharedAt(w, h, 'stats-table');
    const r = await p2.evaluate(() => {
      const card = document.getElementById('stats-card'), sc = card.querySelector('.panel-scroll'), box = sc.getBoundingClientRect();
      const ths = [...card.querySelectorAll('thead tr:last-child th')].slice(1);
      const shown = ths.filter(th => { const b = th.getBoundingClientRect(); return b.width >= 20 && b.left >= box.left - 1 && b.right <= box.right + 1; }).map(th => (th.querySelector('button') ?? th).textContent.trim());
      const names = [...card.querySelectorAll('tbody th [translate=no]')].filter(n => n.getBoundingClientRect().width > 0);
      // The Model column's room after its widest name (and its warning mark): the cell's padding, nothing more.
      const slack = Math.min(...[...card.querySelectorAll('tbody th[scope=row]')].filter(t => t.getBoundingClientRect().height > 4).map(t => t.getBoundingClientRect().right - t.firstElementChild.getBoundingClientRect().right));
      return {
        shown, sideways: sc.scrollWidth - sc.clientWidth, slack,
        cut: names.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent),
        clipped: [...card.querySelectorAll('tbody td')].filter(td => td.scrollWidth > td.clientWidth + 1).map(td => td.textContent.trim()),
        link: [...card.querySelectorAll('button')].some(b => /^(All stats|Fewer stats)/.test(b.textContent.trim())),
      };
    });
    const missing = PROFILE_STATS.filter(l => !r.shown.includes(l));
    seen.push(`${w}x${h}: ${r.shown.length} stats in view, ${Math.round(r.slack)}px after the widest name`);
    if (missing.length) bad.push(`${w}x${h}: not in view: ${missing.join(', ')}`);
    if (r.sideways > 1) bad.push(`${w}x${h}: scrolls ${r.sideways}px sideways`);
    if (r.link) bad.push(`${w}x${h}: an All stats link`);
    if (r.cut.length) bad.push(`${w}x${h}: names cut: ${r.cut.join(', ')}`);
    if (r.clipped.length) bad.push(`${w}x${h}: figures clipped: ${r.clipped.slice(0, 4).join(', ')}`);
    if (r.slack > 24) bad.push(`${w}x${h}: ${Math.round(r.slack)}px empty after the widest name`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
// Owner, 2026-11-08: "we shouldn't care about errors, latency and cost per hand considering it's all coming from
// openrouter." No Errors, Latency or Cost column in the card (with All stats opened, where an older build kept them),
// and no error rate, retry rate, latency or cost in the model drawer.
main(() => check('profiles-no-llm-cost', 'No Errors, Latency or Cost columns in the Profiles card, and no error, retry, latency or cost figures in the model drawer', async () => {
  await goto(pg, 'stats-table'); await sleep(1500);
  const more = await clickPrefix(pg, 'All stats'); if (more) await sleep(800);
  const heads = await headLabels(pg, '#stats-card');
  if (more) { await clickPrefix(pg, 'Fewer stats'); await sleep(500); }
  const opened = await pg.evaluate(() => { const a = document.querySelector('#stats-card tbody th a[href^="#model="]'); a?.click(); return !!a; });
  await sleep(1200);
  const drawer = await pg.evaluate(() => { const d = document.querySelector('dialog[open]'); return d && [...d.querySelectorAll('h3, dt')].map(e => e.textContent.trim()); });
  if (drawer) { await pg.keyboard.press('Escape'); await sleep(800); }
  const bad = [...heads.filter(t => /^(Errors|Latency|Cost)/.test(t)).map(t => `card column ${t}`), ...(drawer ?? []).filter(t => /error|retry|latency|cost/i.test(t)).map(t => `drawer ${t}`)];
  if (!opened || !drawer) bad.push('the drawer did not open');
  return { pass: !bad.length, detail: bad.join(', ') || `card: ${heads.length - 1} stat columns; drawer: ${drawer.join(', ')}` };
}));
// Owner, 2026-11-08, on errors that are the model's own (an illegal or unreadable reply, played as a fold): "oh okay
// that'd be great to track". The card's Misses column shows the engine's miss_rate for each row (one decimal; a dash
// from an engine without it), its header says what it counts, and it sorts lowest first (lower is better).
main(() => check('profiles-misses', 'The Profiles card\'s Misses column shows the engine\'s miss_rate per model, defines it, and sorts lowest first', async () => {
  // At rest: a replayed row shows a dash for Misses (the timeline does not carry it), so a replay still playing is skipped.
  await goto(pg, 'race'); await sleep(800); await clickText(pg, 'Skip'); await sleep(800);
  await goto(pg, 'stats-table'); await sleep(1500);
  // The all-time stats, from the engine the page's build points at.
  const e = await engineStats(pg);
  if (!e) return { pass: false, detail: 'the page never opened the engine stream' };
  const r = await pg.evaluate(async (url, models) => {
    const ths = [...document.querySelectorAll('#stats-card thead tr:last-child th')];
    const i = ths.findIndex(th => th.querySelector('button')?.textContent.trim() === 'Misses');
    if (i < 0) return { err: 'no Misses column' };
    const rows = [...document.querySelectorAll('#stats-card tbody tr')].filter(tr => tr.querySelector('th a'))
      .map(tr => { const name = tr.querySelector('th [translate=no]').textContent; return { name, cell: tr.children[i].textContent.trim(), rate: models.find(m => m.name === name)?.miss_rate }; });
    return { url, rows, tip: ths[i].querySelector('[role=tooltip]')?.textContent ?? '' };
  }, e.url, e.stats.models);
  if (r.err) return { pass: false, detail: r.err };
  const sortBy = label => pg.evaluate(label => {
    const th = [...document.querySelectorAll('#stats-card thead tr:last-child th')].find(t => t.querySelector('button')?.textContent.trim() === label);
    th?.querySelector('button').click();
  }, label);
  const ariaSort = label => pg.evaluate(label => [...document.querySelectorAll('#stats-card thead tr:last-child th')].find(t => t.querySelector('button')?.textContent.trim() === label)?.getAttribute('aria-sort'), label);
  await sortBy('Misses'); await sleep(600); const order = await ariaSort('Misses');
  await sortBy('bb/100'); await sleep(600); // back to the default order
  const off = r.rows.filter(({ cell, rate }) => (rate == null ? cell !== '—' : !/^\d+\.\d%$/.test(cell) || Math.abs(parseFloat(cell) - rate * 100) > 0.1));
  const bad = [];
  if (!r.rows.length) bad.push('no rows');
  if (off.length) bad.push(`cells off the engine: ${off.slice(0, 3).map(o => `${o.name} ${o.cell} vs ${o.rate}`).join(', ')}`);
  if (!/illegal or unreadable/.test(r.tip)) bad.push(`header says "${r.tip.slice(0, 60)}"`);
  if (order !== 'ascending') bad.push(`first sort ${order}, not ascending`);
  const shown = r.rows.filter(o => o.rate != null).map(o => `${o.name} ${o.cell}`);
  return { pass: !bad.length, detail: bad.join('; ') || `${r.rows.length} rows match ${r.url}${shown.length ? ` (${shown.slice(0, 3).join(', ')}…)` : ' (no miss_rate from this engine: dashes)'}; sorts lowest first` };
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
group(() => check('matchups-cells-roomy', 'Matchups tile cells show every figure in full (the replay\'s four-digit ones too), at least 32.5px (1440x900) / 37.5px (1728x1117) tall, one figure size, never edge to edge or blank', async () => {
  const bad = [], seen = [];
  for (const [w, h, min] of [[1440, 900, 32.5], [1728, 1117, 37.5]]) {
    const p = await pageAt(w, h);
    // The replay's first seconds: pairs with few hands together reach four digits (owner, 2026-11-09: "+1k", "+2.4k").
    // Skip, then the tile's Replay restarts it from the first hand.
    await goto(p, 'race'); await sleep(800); await clickText(p, 'Skip'); await sleep(300); await clickPrefix(p, 'Back to overview'); await sleep(2500);
    await p.evaluate(() => document.querySelector('#race-panel [data-tile-replay]')?.click());
    const play = await p.evaluate(() => new Promise(res => {
      const short = new Set(), long = new Set(), t0 = performance.now();
      const loop = () => {
        for (const e of document.querySelectorAll('#pairwise-panel td[data-cell] [aria-hidden]')) {
          const t = e.textContent;
          if (/k$/.test(t)) short.add(t); else if (/\d{4}/.test(t)) long.add(t);
        }
        if (performance.now() - t0 < 5000) requestAnimationFrame(loop); else res({ short: [...short], long: [...long] });
      };
      requestAnimationFrame(loop);
    }));
    if (play.short.length) bad.push(`${w}x${h}: replay figures shortened (${play.short.slice(0, 3).join(', ')})`);
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
    seen.push(`${w}x${h}: ${play.long.length} four-digit figures in full in the replay, cells ${wide.toFixed(1)}x${side.toFixed(1)}px, figures ${[...sizes].join('/')}, least clearance ${Math.min(...fig.filter(c => c.text).map(c => (c.w - c.tw) / 2)).toFixed(1)}px`);
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
// Owner, 2026-11-08: "we need to do an audit on the fonts and sizes and all". One family (the body's sans),
// tabular figures, and one small scale by role on every stats tile and card (Trends's chart internals are
// checked by history-type and history-number-style): titles 20px bold; model names and data figures 14px; controls 14px
// medium; column headers and secondary text 13px (muted); the Matchups tile's figures one size (11px).
main(() => check('stats-type-scale', 'Every text role on the stats tiles and cards uses the agreed family, size, weight and colour', async () => {
  const TEXT = 'rgb(55, 53, 47)', MUTED = 'rgba(55, 53, 47, 0.72)', BLUE = 'rgb(31, 111, 196)';
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
  // At (x, y), the viewport's middle unless given (the dial's gestures aim at the pointer).
  'phased gesture': async (p, dir, x = p.viewport().width / 2, y = p.viewport().height / 2) => { p.__cdp ??= await p.target().createCDPSession(); await p.__cdp.send('Input.synthesizeScrollGesture', { x, y, yDistance: -300 * dir, gestureSourceType: 'mouse', speed: 1500 }); },
  PageDown: (p, dir) => p.keyboard.press(dir > 0 ? 'PageDown' : 'PageUp'),
  ArrowDown: (p, dir) => p.keyboard.press(dir > 0 ? 'ArrowDown' : 'ArrowUp'),
  Space: (p, dir) => (dir > 0 ? p.keyboard.press('Space') : shiftSpace(p)),
};
// Waits for the page to rest: still for 450 ms and on a screen edge (a loaded machine can stall a scroll's frames), or 5 s at most.
// `key`: the window property whose `last` is when the page last moved (__mv in step, __dm in dialStep).
const atRest = async (p, key) => {
  for (let t = Date.now(); Date.now() - t < 5000; await sleep(60)) {
    const r = await p.evaluate(k => ({ quiet: performance.now() - window[k].last, edge: [...document.querySelectorAll('[data-screen]')].some(e => Math.abs(e.getBoundingClientRect().top) < 2) }), key);
    if (r.quiet >= 450 && r.edge) break;
  }
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
  await atRest(p, '__mv');
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
      return { diff, arrow, compact, h: b.height, clear: b.top - tiles, below: innerHeight - b.bottom, x: b.left + b.width / 2 - document.body.clientWidth / 2 }; // centred in the page, not over a classic scrollbar's reserved gutter
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
// About page to fit in with the rest." Then, 2026-11-09: "we're not just changing the content we're changing the layout cuz
// right now it's just......bad"; of two layout drafts he picked the spec sheet (components/About.tsx), held to the rules here.
// Its text is on the stats type scale: the thesis at the site title's 28px bold, card titles 20px bold, section labels 13px muted
// uppercase, figures 20px bold, body 14px, labels 13px muted, links and buttons blue (the donate button white on its blue fill,
// about-support-prominent), a number may take the stats' gain or loss colour, all in the body's sans (the code aside). Any card
// in it is a stats card (radius, ring and shadow, padding, white); a disabled control (the home page's Play button,
// about-play-soon) keeps its own muted look. No heading carries an emoji, and About fits one window at the overview's width
// and centre (not wall to wall) at 1440x900 and 1728x1117. Owner, 2026-11-13: "all the text that aren't headers and whatnot
// in the about page can be bigger": the body is 16px (line-height 1.5) and the labels 14px muted; the headings and the 13px
// uppercase labels (the eyebrow, a row's name) stay as they were; a button's own 14px label (the waitlist's) may stay.
// React has taken over the page (its props are on About's first button): the server's HTML ignores clicks until then.
const aboutReady = p => p.waitForFunction(() => { const b = document.querySelector('[data-about] button'); return !!b && Object.keys(b).some(k => k.startsWith('__react')); }, { timeout: 60000, polling: 100 }).catch(() => {});
main(() => check('about-fits', 'About is on the stats type scale (thesis 28px bold, titles and figures 20px bold, section labels 13px muted uppercase, body 16px, labels 14px muted, the filled donate button white, body sans), any card in it is a stats card, no heading has an emoji, and it fits one window at the overview\'s width and centre at 1440x900 and 1728x1117', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1728, 1117]]) {
    const p = await sharedAt(w, h, 'about');
    // The rule is for the page as it normally is: while the connection bar shows (a page resumed from a freeze reconnects,
    // about 2 s), every screen gives it 40px (--bar-h) and About may scroll inside itself. Wait for it to clear (30 s at
    // most), polling on a timer: a shared page can be its window's background tab, which draws no frames.
    const clear = await p.waitForFunction(() => getComputedStyle(document.querySelector('[data-page]')).getPropertyValue('--bar-h').trim() === '0px', { timeout: 30000, polling: 200 }).then(() => true, () => false);
    if (!clear) bad.push(`${w}x${h}: the connection bar never cleared (measured with it)`);
    const r = await p.evaluate(() => {
      const TEXT = 'rgb(55, 53, 47)', MUTED = 'rgba(55, 53, 47, 0.72)', BLUE = 'rgb(31, 111, 196)', WHITE = 'rgb(255, 255, 255)', NET = ['rgb(15, 123, 108)', 'rgb(200, 50, 50)'];
      const about = document.querySelector('section[aria-label=About]'), race = document.getElementById('race-panel');
      const view = about.querySelector('[data-about]');
      const why = new Set();
      // Cards: the stats cards' chrome, computed exactly as an overview tile's.
      const ref = getComputedStyle(race), KEYS = ['borderTopLeftRadius', 'boxShadow', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'backgroundColor'];
      const cards = [...view.querySelectorAll('.card-chrome')].filter(c => c.getBoundingClientRect().width > 0);
      for (const c of cards) { const s = getComputedStyle(c); for (const k of KEYS) if (s[k] !== ref[k]) why.add(`card ${k} ${s[k]}, not ${ref[k]}`); }
      // Every visible piece of text by its role.
      const body = getComputedStyle(document.body).fontFamily;
      const texts = [...view.querySelectorAll('*')].filter(e => !e.closest('pre, code, svg, .sr-only, button:disabled') && e.getBoundingClientRect().width > 0 && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
      for (const e of texts) {
        const s = getComputedStyle(e), size = parseFloat(s.fontSize), bold = +s.fontWeight >= 700, name = `"${e.textContent.trim().slice(0, 20)}"`;
        const control = e.closest('a, button'), number = /^[+−-]?[\d,.]+$/.test(e.textContent.trim());
        const filled = !!control && getComputedStyle(control).backgroundColor === BLUE;
        if (s.fontFamily !== body) why.add(`${name} in ${s.fontFamily.split(',')[0]}`);
        const ok = e.closest('h1, h2, h3, h4, h5, h6')
          ? ((size === 28 || size === 20) && bold && s.color === TEXT) || (size === 13 && s.color === MUTED && s.textTransform === 'uppercase')
          : size === 20 ? bold && s.color === TEXT
          : size === 16 ? s.color === TEXT || (control && s.color === BLUE) || (filled && s.color === WHITE) || (number && NET.includes(s.color))
          : size === 14 ? s.color === MUTED || (control && (s.color === BLUE || s.color === TEXT))
          : size === 13 ? s.color === MUTED && s.textTransform === 'uppercase'
          : false;
        if (!ok) why.add(`${e.closest('h1, h2, h3, h4, h5, h6') ? 'heading ' : ''}${name} ${size}px ${s.fontWeight} ${s.color}${s.textTransform === 'none' ? '' : ` ${s.textTransform}`}`);
      }
      const emoji = [...view.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(e => e.textContent.trim()).filter(t => /\p{Extended_Pictographic}/u.test(t));
      // One window: nothing to scroll, About under the sticky bar and above the window's edge, at the overview's edges.
      const scroller = about.querySelector('.panel-scroll') ?? about;
      const b = view.getBoundingClientRect(), o = race.getBoundingClientRect();
      return { why: [...why], emoji, over: scroller.scrollHeight - scroller.clientHeight, T: b.top, B: b.bottom, L: b.left, R: b.right, oL: o.left, oR: o.right, h: innerHeight, n: cards.length };
    });
    seen.push(`${w}x${h}: ${r.n} cards ${r.L.toFixed(0)}..${r.R.toFixed(0)} x ${r.T.toFixed(0)}..${r.B.toFixed(0)}`);
    const why = [...r.why];
    if (r.emoji.length) why.push(`emoji in ${r.emoji.join(', ')}`);
    if (r.over > 1 || r.T < 44 || r.B > r.h) why.push(`does not fit the window (${r.over > 1 ? `scrolls ${r.over}px, ` : ''}${r.T.toFixed(0)}..${r.B.toFixed(0)} of ${r.h})`);
    if (Math.abs(r.L - r.oL) > 2 || Math.abs(r.R - r.oR) > 2) why.push(`${r.L.toFixed(0)}..${r.R.toFixed(0)} wide, not the overview's ${r.oL.toFixed(0)}..${r.oR.toFixed(0)}`);
    if (why.length) bad.push(`${w}x${h}: ${why.slice(0, 8).join('; ')}`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join(' | ') : seen.join(' | ') };
}));
// About on /about at 1440x900, then with each prompt dialog opened in turn: its text (an open dialog's included), its own
// copy (every word but the prompts' code, each dialog's view included), its links, and each dialog's code blocks.
async function readAbout() {
  const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await aboutReady(p);
  const on = await p.waitForFunction(() => document.querySelector('[data-about]'), { timeout: 10000 }).then(() => true, () => false);
  if (!on) { await p.close(); return null; }
  await sleep(500);
  const look = () => p.evaluate(() => {
    const root = document.querySelector('[data-about]'), copy = root.cloneNode(true), dialog = root.querySelector('dialog[open]');
    copy.querySelectorAll('pre').forEach(e => e.remove());
    return { text: root.innerText, copy: copy.textContent, links: [...root.querySelectorAll('a[href]')].map(a => a.href), dialog: dialog && [...dialog.querySelectorAll('pre')].map(e => e.textContent) };
  });
  const looks = [await look()], dialogs = {};
  for (const t of ['Read the system prompt', 'Read the user prompt']) {
    const clicked = await p.evaluate(t => { const b = [...document.querySelectorAll('[data-about] button')].find(b => b.textContent.trim().startsWith(t) && b.getBoundingClientRect().width > 0); b?.click(); return !!b; }, t);
    await sleep(500);
    const l = await look(); looks.push(l); dialogs[t] = clicked ? l.dialog : undefined;
    await p.keyboard.press('Escape'); await sleep(300);
  }
  await p.close();
  return { text: looks.map(l => l.text).join('\n'), copy: looks.map(l => l.copy).join('\n'), links: [...new Set(looks.flatMap(l => l.links))], dialogs };
}
// Owner, 2026-11-09, on what About says: what it is ("some cool pseudo benchmark for LLMs"), how it works ("Each LLM gets the
// same system prompt, and then they can open up to see what the system prompt is"), the caveats, the hours and hands a day, what's
// next and the support. Then, the same day, in plain words: "Every model gets the same system prompt and the same standardized user
// prompt." / "Click either to see exactly what's inside." / "Assume each holds what a typical poker player is looking at."; the
// caveats "No memory between hands." (not even its own last hand), "No tells or leaks." and the one retry, with "Poker is noisy"
// cut; the hours as four lines (9am to 9pm ET, about 150 a day, a 12-hour game deals roughly 350, donations keep the models
// seated); what's next the home page's Play button, then the dataset, its date and why. About says all of it, the system
// prompt and the user prompt (then the reply) opened in their dialog from lib/systemPrompt.ts (each export's first line, read from
// the file as text when the check runs, so no prompt text is pinned here and another worker's rewrite of that file passes as it is;
// About never copies it); and none of what he cut: LLM Council, training an LLM to play like you, Tinker, "9 LLMs at the table",
// calls a hand, the false "no persona" and "can't see its own earlier decisions", "Poker is noisy", "One turn" and "The call",
// and the "Playing against the LLMs" lines.
const ABOUT_FACTS = [
  ['pseudo benchmark', /A pseudo benchmark for LLMs/],
  ['live hold\'em', /play No-Limit Hold'em against each other, live/],
  ['every decision and why', /watch every decision and its reasoning/],
  ['same two prompts', /Every model gets the same system prompt and the same standardized user prompt\./],
  ['click either', /Click either to see exactly what.s inside\./],
  ['a typical player\'s view', /Assume each holds what a typical poker player is looking at\./],
  ['the reply', /replies with an action, an amount and a short reason/],
  ['the reply in the dialog', /The user prompt[\s\S]*The reply/],
  ['no memory', /No memory between hands\.[\s\S]*A model doesn.t remember how anyone played earlier, not even its own last hand\./],
  ['no tells', /No tells or leaks\.[\s\S]*The only information is the action on the table\./],
  ['one retry, then check or fold', /illegal or unreadable reply gets one retry[\s\S]*checks if it can, otherwise folds/],
  ['hours', /The main game runs 9am to 9pm ET, every day\./],
  ['hands a day', /About 150 hands a day\./],
  ['a 12-hour game', /A 12-hour live game deals roughly 350\./],
  ['donations keep them seated', /Every decision is a paid model call, so donations keep the models seated\./],
  ['the Play button', /Play vs\. LLMs — \(coming soon\)!/],
  ['dataset and its date', /An open-source dataset by \w+day, \w{3} \d{1,2}\./],
  ['why the dataset', /LLMs are terrible at poker today, and we think there.s a huge unlock in changing that\.[\s\S]*Solvers were AI.s first turn at the game; models that reason in plain words are a whole new paradigm, and this dataset is a push toward it\./],
  ['what donations pay for', /Donations pay for the OpenRouter model calls and the servers/],
  ['GitHub', /Open source on GitHub/],
  ['handle', /@RizzwareEngineer/],
];
const ABOUT_GONE = [['LLM Council', /LLM Council/i], ['training an LLM', /Train an LLM/i], ['Tinker', /Tinker/i], ['9 LLMs at the table', /\b(9|nine) LLMs/i],
  ['calls a hand', /calls? (a|per) hand/i], ['no persona', /no persona/i], ['own earlier decisions', /own earlier decisions/i],
  ['Poker is noisy', /Poker is noisy/i], ['One turn', /One turn/i], ['The call', /\bThe call\b/], ['Playing against the LLMs', /Playing against the LLMs|weak game/i]];
const ABOUT_LINKS = ['https://github.com/sponsors/RizzwareEngineer', 'https://github.com/RizzwareEngineer/No-LLMit', 'https://github.com/RizzwareEngineer'];
// The first line of each prompt lib/systemPrompt.ts exports (`export const NAME = \`first line`), from the file's text.
const PROMPT_LINES = Object.fromEntries([...readFileSync(new URL('../src/lib/systemPrompt.ts', import.meta.url), 'utf8').matchAll(/^export const (\w+) = `([^\n`]*)/gm)].map(m => [m[1], m[2].trim()]));
// Each dialog's code blocks, in order, and the export each one starts with.
const PROMPT_DIALOGS = [['the system prompt', 'Read the system prompt', ['SYSTEM_PROMPT']], ['the user prompt', 'Read the user prompt', ['EXAMPLE_USER_PROMPT', 'EXAMPLE_REPLY']]];
group(() => check('about-content-complete', 'About says what it must, in the owner\'s plain words (pseudo benchmark, the same system and user prompts, the reply, the caveats, the hours in four lines, the Play button, the dataset, its date and why, what donations pay for, GitHub and handle) with the system prompt and the user prompt then the reply opened from lib/systemPrompt.ts (each export\'s first line, read at run time), and nothing the owner cut ("Poker is noisy" and "One turn" among it)', async () => {
  const unread = PROMPT_DIALOGS.flatMap(([, , names]) => names).filter(n => !PROMPT_LINES[n]);
  if (unread.length) return { pass: false, detail: `lib/systemPrompt.ts: no \`export const ${unread.join(' / ')} = \`...\` found to read the first line of` };
  const got = await readAbout();
  if (!got) return { pass: false, detail: 'About not shown by /about' };
  const missing = ABOUT_FACTS.filter(([, re]) => !re.test(got.text)).map(([name]) => name);
  const gone = ABOUT_GONE.filter(([, re]) => re.test(got.copy)).map(([name]) => name);
  const noLink = ABOUT_LINKS.filter(l => !got.links.includes(l));
  const code = [];
  for (const [name, button, names] of PROMPT_DIALOGS) {
    const pres = got.dialogs[button];
    if (!pres) code.push(`${name} never opened`);
    else if (pres.length !== names.length || names.some((n, i) => !pres[i].trim().startsWith(PROMPT_LINES[n]))) code.push(`${name} shows ${pres.length} code block(s) starting "${pres.map(t => t.trim().split('\n')[0].slice(0, 30)).join('", "')}", not ${names.join(' then ')} from lib/systemPrompt.ts`);
  }
  const why = [missing.length && `missing ${missing.join(', ')}`, gone.length && `still says ${gone.join(', ')}`, noLink.length && `no link to ${noLink.join(', ')}`, ...code].filter(Boolean);
  return { pass: !why.length, detail: why.length ? why.join('; ') : `${ABOUT_FACTS.length}/${ABOUT_FACTS.length} facts, ${ABOUT_LINKS.length}/${ABOUT_LINKS.length} links, prompts from lib/systemPrompt.ts` };
}));
// Owner, 2026-11-09: "don't link any sort of system design. That's not what should be inside of the About page." About's text
// (its prompt dialogs opened) never says "system design", and no link goes to a design doc.
group(() => check('about-no-system-design', 'About never mentions or links the system design: no "system design" in its text, prompt dialogs opened, and no link to a design doc', async () => {
  const bad = [];
  const got = await readAbout();
  if (!got) return { pass: false, detail: 'About not shown by /about' };
  const said = got.text.match(/[^\n]*system[ -]design[^\n]*/i)?.[0], linked = got.links.filter(l => /system[-_]design|\/docs\/design\b/i.test(l));
  if (said) bad.push(`says "${said.trim().slice(0, 60)}"`);
  if (linked.length) bad.push(`links ${linked.join(', ')}`);
  return { pass: !bad.length, detail: bad.length ? bad.join(' | ') : `${got.links.length} links, none to a design doc` };
}));
// Owner, 2026-11-09: "I do want a support section, and that should honestly be highlighted a bit better because that's the main
// thing. I'm trying to get people to donate." The donate button (the GitHub Sponsors link) is in the window without scrolling at
// 1440x900, on the home page's About screen (under the sticky bar) and on /about; and it is About's most prominent control:
// the only filled one, and the biggest.
group(() => check('about-support-prominent', 'The donate button is visible without scrolling at 1440x900 (home page About screen and /about) and is About\'s most prominent control: its only filled one, and the biggest', async () => {
  const bad = [], seen = [];
  for (const home of [true, false]) {
    const where = home ? 'home' : '/about';
    const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
    await p.goto(`${BASE}${home ? '/' : '/about'}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await aboutReady(p);
    if (home) { await sleep(1500); await goto(p, 'about'); }
    await sleep(1500);
    const r = await p.evaluate(() => {
      const view = document.querySelector('[data-about]');
      const box = e => e.getBoundingClientRect(), area = e => box(e).width * box(e).height, name = e => e.textContent.trim().slice(0, 24) || e.getAttribute('aria-label');
      const controls = [...(view?.querySelectorAll('a, button') ?? [])].filter(e => area(e) > 0);
      const donate = controls.find(e => /github\.com\/sponsors\//.test(e.href ?? ''));
      // Filled: an opaque background that is not the page's or a card's near-white.
      const filled = e => { const v = (getComputedStyle(e).backgroundColor.match(/[\d.]+/g) || []).map(Number); return v.length >= 3 && (v[3] ?? 1) > 0.5 && Math.min(v[0], v[1], v[2]) < 230; };
      const scroller = document.querySelector('section[aria-label=About] .panel-scroll');
      return donate && {
        t: box(donate).top, b: box(donate).bottom, h: innerHeight, scrolled: Math.round(scroller ? scroller.scrollTop : scrollY), // the About panel's own scroll, or /about's
        filled: filled(donate), others: controls.filter(e => e !== donate && filled(e)).map(name), bigger: controls.filter(e => e !== donate && area(e) >= area(donate)).map(name),
      };
    });
    await p.close();
    if (!r) { bad.push(`${where}: no donate button (GitHub Sponsors link) on screen`); continue; }
    seen.push(`${where}: donate at ${r.t.toFixed(0)}..${r.b.toFixed(0)}`);
    const why = [];
    if (r.scrolled || r.t < 44 || r.b > r.h) why.push(`not in the window without scrolling (${r.t.toFixed(0)}..${r.b.toFixed(0)} of ${r.h}${r.scrolled ? `, scrolled ${r.scrolled}px` : ''})`);
    if (!r.filled) why.push('not filled');
    if (r.others.length) why.push(`other filled controls: ${r.others.join(', ')}`);
    if (r.bigger.length) why.push(`as big or bigger: ${r.bigger.join(', ')}`);
    if (why.length) bad.push(`${where}: ${why.join('; ')}`);
  }
  return { pass: !bad.length, detail: bad.length ? bad.join(' | ') : seen.join(' | ') };
}));
// Owner, 2026-11-09, of the race art on About ("I do like the visual that you included"): "I don't like the fact that we're using
// chips. We should be using BB per 100." Each ridge is an LLM at the table's running bb/100, its logo where it ends; the rows run
// best first by bb/100, the LLMs with 500+ hands (MIN_HANDS) ahead of the rest, as the stats the page loaded say; the caption
// names the leader, the best of those with 500+ hands, with its bb/100, and nothing in the figure says chips.
group(() => check('about-bb100', 'The race on About draws running bb/100: its rows in bb/100 order (500+ hands first) from the stats the page loaded, and its caption names the leader among the LLMs with 500+ hands with its bb/100, never chips', async () => {
  const fmt = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}`;
  const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
  let stats = null;
  p.on('response', r => { const u = new URL(r.url()); if (u.pathname === '/api/stats' && !u.search && r.ok()) r.json().then(j => { stats = j; }, () => {}); });
  await p.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await aboutReady(p);
  await p.waitForFunction(() => document.querySelector('[data-race-row]'), { timeout: 60000, polling: 250 }).catch(() => {});
  await sleep(800);
  const r = await p.evaluate(() => {
    const fig = document.querySelector('[data-about] figure');
    return fig && {
      rows: [...fig.querySelectorAll('[data-race-row]')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(e => e.dataset.raceRow),
      ridges: [...fig.querySelectorAll('svg [data-model]')].map(e => e.dataset.model),
      caption: fig.querySelector('figcaption')?.innerText ?? '', all: fig.textContent + (fig.querySelector('svg')?.getAttribute('aria-label') ?? ''),
    };
  });
  await p.close();
  if (!r) return { pass: false, detail: 'no race figure' };
  if (!stats) return { pass: false, detail: 'never saw the page load /api/stats' };
  // The app's rule: the lineup when at least two of it have stats (seatedModels), with hands, 500+ first, then by bb/100.
  const at = stats.seated ? stats.models.filter(m => stats.seated.includes(m.name)) : [];
  const field = (at.length >= 2 ? at : stats.models).filter(m => m.hands > 0).sort((a, b) => (b.hands >= 500) - (a.hands >= 500) || b.bb100 - a.bb100);
  const want = field.map(m => m.name), leader = field[0]?.hands >= 500 ? field[0] : null;
  const why = [];
  if (r.rows.join('|') !== want.join('|')) why.push(`rows ${r.rows.join(', ') || 'none'}, not by bb/100: ${want.join(', ')}`);
  if (r.ridges.join('|') !== want.join('|')) why.push(`${r.ridges.length} ridges, not one per row in order`);
  if (!/bb\/100/.test(r.caption)) why.push(`caption without bb/100: "${r.caption.replace(/\s+/g, ' ').slice(0, 80)}"`);
  if (/chips/i.test(r.all)) why.push('says chips');
  if (leader && !(r.caption.includes(leader.name) && r.caption.includes(`${fmt(leader.bb100)} bb/100`))) why.push(`caption does not name ${leader.name} at ${fmt(leader.bb100)} bb/100`);
  return { pass: !why.length, detail: why.length ? why.join('; ') : `${r.rows.length} rows in bb/100 order; ${leader ? `${leader.name} ${fmt(leader.bb100)} bb/100` : 'no leader yet'}` };
}));
group(() => check('about-home-no-fetch', 'On the home page About\'s race is drawn from the stats the stream delivered: scrolling to About sends no GET /api/stats, and the race has its rows', async () => {
  const p = watchStream(await newPage()); await p.setViewport({ width: 1440, height: 900 });
  const asked = [];
  p.on('request', r => { const u = new URL(r.url()); if (u.pathname === '/api/stats') asked.push(r.url()); });
  try {
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitStats(p); await sleep(2000);
    await goto(p, 'about');
    const drawn = await p.waitForFunction(() => document.querySelector('section[aria-label=About] [data-race-row]'), { timeout: 30000, polling: 250 }).then(() => true, () => false);
    await sleep(1500);
    const rows = await p.evaluate(() => document.querySelectorAll('section[aria-label=About] [data-race-row]').length);
    return { pass: drawn && !asked.length, detail: `${rows} race rows; ${asked.length} GET /api/stats${asked.length ? ` (${asked[0]})` : ''}` };
  } finally { await p.close(); }
}));
// Owner, 2026-11-09: what's next shows the dataset with a waitlist under it: a labelled email input (type email, required) and a
// "Join the waitlist" button that is not filled (the Sponsor button stays the only filled one), then how many have joined ("N on
// the waitlist", or "Be the first on the waitlist." at 0). The engine's /api/waitlist is intercepted here (GET → {count}, POST
// {email} → 201 {count}), so the form is tested whatever the engine has: an invalid email says so and sends nothing; a valid one is
// posted and says "You're on the list.", the count refreshed.
group(() => check('about-waitlist', 'About\'s dataset waitlist: a labelled email input and an unfilled "Join the waitlist" button; the count reads "Be the first on the waitlist." at 0 and "12 on the waitlist" at 12; an invalid email shows "That doesn\'t look like an email." with no request, a valid one is posted and shows "You\'re on the list."', async () => {
  const bad = [], seen = [];
  const open = async count => {
    const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
    const posts = [];
    await p.setRequestInterception(true);
    p.on('request', req => {
      if (!/\/api\/waitlist$/.test(new URL(req.url()).pathname)) return req.continue();
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers });
      if (req.method() === 'POST') { posts.push(req.postData()); return req.respond({ status: 201, headers, contentType: 'application/json', body: JSON.stringify({ count: count + 1 }) }); }
      req.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ count }) });
    });
    await p.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await aboutReady(p);
    return { p, posts };
  };
  const form = 'form[aria-label="Dataset waitlist"]';
  const said = p => p.evaluate(f => document.querySelector(f)?.innerText.replace(/\s+/g, ' ').trim() ?? '', form);
  const wait = (p, text) => p.waitForFunction((f, t) => document.querySelector(f)?.innerText.includes(t), { timeout: 10000, polling: 100 }, form, text).then(() => true, () => false);
  // At 0: the form's parts, and the empty count.
  let { p } = await open(0);
  const parts = await p.evaluate(f => {
    const el = document.querySelector(f), input = el?.querySelector('input[type=email]'), button = el?.querySelector('button[type=submit]');
    return el && {
      input: !!input, required: !!input?.required, label: (input?.labels?.[0]?.textContent.trim() || input?.getAttribute('aria-label') || '').length > 0,
      button: button?.textContent.trim(), bg: button && getComputedStyle(button).backgroundColor,
    };
  }, form);
  if (!parts) bad.push('no waitlist form');
  else {
    if (!parts.input || !parts.required) bad.push('no required email input');
    if (!parts.label) bad.push('the email input has no label');
    if (parts.button !== 'Join the waitlist') bad.push(`button says "${parts.button}"`);
    if (parts.bg === 'rgb(31, 111, 196)') bad.push('the button is filled blue');
  }
  if (!(await wait(p, 'Be the first on the waitlist.'))) bad.push(`at 0 it says "${await said(p)}"`);
  await p.close();
  // At 12: the count, then an invalid email and a valid one.
  const at12 = await open(12); p = at12.p;
  if (!(await wait(p, '12 on the waitlist'))) bad.push(`at 12 it says "${await said(p)}"`);
  await p.type(`${form} input[type=email]`, 'not-an-email');
  await p.click(`${form} button[type=submit]`);
  if (!(await wait(p, 'That doesn’t look like an email.')) && !(await wait(p, "That doesn't look like an email."))) bad.push(`an invalid email says "${await said(p)}"`);
  if (at12.posts.length) bad.push('an invalid email was posted');
  await p.click(`${form} input[type=email]`, { clickCount: 3 });
  await p.type(`${form} input[type=email]`, 'fan@example.com');
  await p.click(`${form} button[type=submit]`);
  const joined = (await wait(p, 'You’re on the list.')) || (await wait(p, "You're on the list."));
  const after = await said(p);
  if (!joined) bad.push(`a valid email says "${after}"`);
  if (at12.posts.length !== 1 || JSON.parse(at12.posts[0] ?? '{}').email !== 'fan@example.com') bad.push(`posted ${JSON.stringify(at12.posts)}, not {"email":"fan@example.com"} once`);
  if (!after.includes('13 on the waitlist')) bad.push(`the count did not refresh: "${after}"`);
  seen.push(`0 → "Be the first", 12 → "12 on the waitlist", invalid → no request, valid → posted, "${after}"`);
  await p.close();
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
}));
// Owner, 2026-11-09: what's next starts with "the same disabled Play button as the home page", nothing written under it.
// About's button is the home page's, markup and all (one shared PlaySoonButton).
group(() => check('about-play-soon', 'About\'s disabled Play button is the home page\'s: same text, classes and markup, disabled', async () => {
  const bad = [];
  const read = async (path, scope) => {
    const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
    await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await aboutReady(p);
    const r = await p.evaluate(scope => {
      const b = [...document.querySelectorAll(`${scope} button`)].find(b => b.textContent.includes('Play vs. LLMs'));
      return b && { html: b.outerHTML, text: b.textContent.trim(), cls: b.className, disabled: b.disabled };
    }, scope || 'body');
    await p.close();
    return r;
  };
  const home = await read('/', '');
  if (!home) return { pass: false, detail: 'no Play button on the home page' };
  if (!home.disabled) bad.push('the home page\'s Play button is not disabled');
  const r = await read('/about', '[data-about]');
  if (!r) return { pass: false, detail: [...bad, 'About: no Play button'].join('; ') };
  if (r.text !== home.text) bad.push(`About: says "${r.text}", not "${home.text}"`);
  if (r.cls !== home.cls) bad.push(`About: classes "${r.cls}", not "${home.cls}"`);
  if (r.html !== home.html) bad.push('About: markup differs from the home page\'s');
  if (!r.disabled) bad.push('About: not disabled');
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `About: "${r.text}" as on the home page` };
}));
// Owner, 2026-11-09, of the race art: he dislikes the grey "mountain" under the lines. Each ridge's fill is the page's own colour
// (var(--page), no model tint), so only the coloured lines show and the shape melts into the background.
group(() => check('about-race-fill', 'Every ridge area in About\'s race is filled with var(--page), untinted', async () => {
  const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await aboutReady(p);
  await p.waitForFunction(() => document.querySelector('[data-about] figure svg [data-model]'), { timeout: 60000, polling: 250 }).catch(() => {});
  const fills = await p.evaluate(() => [...document.querySelectorAll('[data-about] figure svg [data-model]')].map(g => [g.dataset.model, g.querySelector('path')?.style.fill ?? '']));
  await p.close();
  if (!fills.length) return { pass: false, detail: 'no ridges' };
  const off = fills.filter(([, f]) => f !== 'var(--page)');
  return { pass: !off.length, detail: off.length ? off.map(([m, f]) => `${m} filled ${f || 'none'}`).join(', ') : `${fills.length} ridges on var(--page)` };
}));
// Owner, 2026-11-09: "when I hover over the end graph in the About page I expect to see the names of the models." Hovering a
// ridge (its wide invisible hit area) or its logo shows a tooltip naming that LLM with its bb/100 and hands; focusing a logo
// does too; leaving clears it; nothing on the page moves or resizes meanwhile (the tooltip floats).
group(() => check('about-race-hover', 'Hovering each ridge\'s hit area and each logo in About\'s race, or focusing a logo, shows a tooltip naming that LLM with its bb/100 and hands; leaving clears it; nothing else moves or resizes', async () => {
  const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await aboutReady(p);
  await p.waitForFunction(() => document.querySelector('[data-about] figure [data-race-hit]'), { timeout: 60000, polling: 250 }).catch(() => {});
  await sleep(2200); // the reveal and the logos' fade
  // Every element's box now, to compare while hovered (the tooltip and the front line are new, so not among them).
  const boxes = () => p.evaluate(() => { window.__els ??= [...document.querySelectorAll('body *')]; return window.__els.map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); }); });
  const tip = () => p.evaluate(() => document.querySelector('[data-about] [data-race-tip]')?.innerText.replace(/\s+/g, ' ').trim() ?? '');
  const base = await boxes();
  const moved = async () => { const now = await boxes(); return now.filter((b, i) => b !== base[i]).length; };
  // A point on each hit area that the hit area itself gets (ridges cross): along its path, in screen pixels.
  const targets = await p.evaluate(() => [...document.querySelectorAll('[data-about] figure [data-race-hit]')].map(e => {
    const m = e.getScreenCTM(), L = e.getTotalLength();
    for (let k = 0.5; k < 1; k += 0.02) for (const dy of [0, 4, -4]) {
      const q = e.getPointAtLength(L * k), x = m.a * q.x + m.e, y = m.d * q.y + m.f + dy;
      if (document.elementFromPoint(x, y) === e) return [e.dataset.raceHit, x, y];
    }
    return [e.dataset.raceHit, null, null];
  }));
  const logos = await p.evaluate(() => [...document.querySelectorAll('[data-about] figure [data-race-row]')].map(e => { const r = e.getBoundingClientRect(); return [e.dataset.raceRow, r.left + r.width / 2, r.top + r.height / 2]; }));
  const bad = [];
  if (!targets.length) bad.push('no hit areas');
  for (const [kind, list] of [['line', targets], ['logo', logos]]) for (const [name, x, y] of list) {
    if (x === null) { bad.push(`${name}'s line has no point it gets hovered at`); continue; }
    await p.mouse.move(x, y); await sleep(200);
    const t = await tip(), n = await moved();
    if (!t.includes(name) || !/bb\/100 over [\d,]+ hands/.test(t)) bad.push(`${kind} ${name}: tooltip "${t}"`);
    if (n) bad.push(`${kind} ${name}: ${n} elements moved or resized`);
    await p.mouse.move(5, 5); await sleep(150);
    if (await tip()) bad.push(`${kind} ${name}: the tooltip stays after leaving`);
  }
  for (const [name] of logos) {
    await p.evaluate(n => document.querySelector(`[data-about] [data-race-row="${CSS.escape(n)}"]`).focus(), name); await sleep(100);
    if (!(await tip()).includes(name)) bad.push(`focused logo ${name}: tooltip "${await tip()}"`);
  }
  await p.close();
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : `${targets.length} lines and ${logos.length} logos each name their LLM; nothing moved` };
}));
// Opens a card from the overview the way a visitor does (a click on its tile), and waits for the glide.
const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return Math.round(b[b.length >> 1]); };
const openTile = async (p, tile) => { await goto(p, 'stats'); await sleep(900); await clickCenter(p, tile); await sleep(1300); await p.mouse.move(p.viewport().width / 2, p.viewport().height / 2); };
// Owner, 2026-11-12: "make the how it works, caveats, hours and what's next a scroll carousel. Or like the Apple Watch dial
// ... how it works is first and the rows below it can still be seen but it's blurry ... then you scroll down like a wheel";
// "if I put my cursor closer to the dial then scrolling up or down or just clicking should bring it up and down. Then if
// cursor elsewhere then scroll normally". The four topics on a dial: one row sharp in front, the others blurred behind.
// Each dial row as painted: its index, whether it is the focused one, its words' opacity and blur (the row's and its body's
// together), its label's (the row's alone), scale, and its box against the dial's.
const dialRows = p => p.evaluate(() => {
  const dial = document.querySelector('[data-dial]');
  if (!dial) return null;
  const b = dial.getBoundingClientRect();
  const blurOf = s => +(s.filter.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0);
  return [...dial.querySelectorAll('[data-dial-row]')].map((e, i) => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect(), m = new DOMMatrix(s.transform === 'none' ? undefined : s.transform);
    const body = e.querySelector('[data-dial-body]'), own = body ? getComputedStyle(body) : { filter: 'none', opacity: 1 };
    return {
      i, title: e.dataset.dialRow, current: e.getAttribute('aria-current') === 'true', opacity: Math.round(+s.opacity * +own.opacity * 1000) / 1000,
      blur: blurOf(s) + blurOf(own), labelOpacity: +s.opacity, labelBlur: blurOf(s), scale: Math.round(Math.hypot(m.a, m.b) * 1000) / 1000,
      inside: r.top >= b.top - 1 && r.bottom <= b.bottom + 1 && r.left >= b.left - 1 && r.right <= b.right + 1,
    };
  });
});
const dialAt = async p => (await dialRows(p))?.findIndex(r => r.current) ?? -1;
// The dial's own box and a point on its focused row (the pointer "on the dial").
const dialPoint = p => p.evaluate(() => { const e = document.querySelector('[data-dial] [aria-current="true"]') ?? document.querySelector('[data-dial]'); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, Math.max(r.top, 0) + Math.min(r.height, innerHeight - r.top) / 2]; });
// The blue pixels painted in boxes of the window (a focus ring), counted on one screenshot of the window drawn on a canvas.
const bluePixels = async (p, boxes) => {
  const png = await p.screenshot({ encoding: 'base64' });
  return p.evaluate(async (src, boxes) => {
    const img = new Image(); img.src = `data:image/png;base64,${src}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const k0 = img.width / innerWidth;
    return boxes.map(b => {
      const d = g.getImageData(Math.round(b.x * k0), Math.round(b.y * k0), Math.max(1, Math.round(b.width * k0)), Math.max(1, Math.round(b.height * k0))).data; let n = 0;
      for (let k = 0; k < d.length; k += 4) if (d[k + 2] > 180 && d[k] < 120 && d[k + 2] - d[k] > 80) n++;
      return n;
    });
  }, png, boxes);
};
// The page's /about, or the home page paged to About.
const dialPage = async (w, h, path, opts = {}) => {
  if (path === '/') return pageAt(w, h, 'about');
  const p = await newPage();
  if (opts.touch) await p.emulate({ viewport: { width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, userAgent: (await browser.userAgent()) });
  else await p.setViewport({ width: w, height: h });
  if (opts.reduce) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await aboutReady(p); await sleep(1500);
  return p;
};
group(() => check('about-dial', 'About\'s four topics are a dial at 1440x900, 1728x1117 and 390x844 (home page About screen and /about): it opens on How it works; exactly one row is sharp (no blur, opacity 1, unscaled) and fully inside the dial\'s box; the others are scaled down, their words faded (opacity 0.5 or less) and softly blurred (more than 0, at most 1.5px, still readable), their label unblurred at opacity 0.45 or more; a focus ring is painted round it when it has keyboard focus', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1728, 1117], [390, 844]]) for (const path of ['/', '/about']) {
    const at = `${w}x${h} ${path}`;
    const p = await dialPage(w, h, path);
    await p.evaluate(() => document.querySelector('[data-dial]')?.scrollIntoView({ block: 'nearest', behavior: 'instant' })); await sleep(600);
    const rows = await dialRows(p);
    if (!rows) { bad.push(`${at}: no dial`); await p.close(); continue; }
    const sharp = rows.filter(r => r.blur === 0 && r.opacity === 1 && r.scale === 1);
    if (sharp.length !== 1 || !sharp[0].current) bad.push(`${at}: sharp rows ${sharp.map(r => r.title).join(', ') || 'none'}`);
    if (rows[0].current !== true) bad.push(`${at}: opens on ${rows.find(r => r.current)?.title ?? 'nothing'}`);
    if (sharp[0] && !sharp[0].inside) bad.push(`${at}: the focused row is cut by the dial's box`);
    // Owner, 2026-11-13: "the text is a bit too blurry. at least make the left column words a bit less blurry": the words
    // behind softly blurred (1.5px at most), the labels never, faded only.
    const soft = rows.filter(r => !r.current && !(r.blur > 0 && r.blur <= 1.5 && r.opacity <= 0.5 && r.scale < 1 && r.labelBlur === 0 && r.labelOpacity >= 0.45));
    if (soft.length) bad.push(`${at}: not softly behind: ${soft.map(r => `${r.title} blur ${r.blur} opacity ${r.opacity} label blur ${r.labelBlur} opacity ${r.labelOpacity} scale ${r.scale}`).join(', ')}`);
    // Keyboard focus (no pointer has touched this page, so a scripted focus shows as keyboard focus), then the ring's blue round its box.
    await p.focus('[data-dial]');
    const focused = await p.evaluate(() => document.activeElement?.matches('[data-dial]:focus-visible'));
    if (!focused) bad.push(`${at}: the dial takes no keyboard focus`);
    else {
      await sleep(700);
      const b = await p.evaluate(() => { const r = document.querySelector('[data-dial]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      // The ring's four sides: strips 4px either side of each edge (a ring may sit just inside or just outside), in the window.
      const strip = (x, y, cw, ch) => ({ x: Math.max(0, x), y: Math.max(0, y), width: Math.max(1, Math.min(cw, w - Math.max(0, x))), height: Math.max(1, Math.min(ch, h - Math.max(0, y))) });
      const sides = [strip(b.x + 8, b.y - 4, b.w - 16, 8), strip(b.x + 8, b.y + b.h - 4, b.w - 16, 8), strip(b.x - 4, b.y + 8, 8, b.h - 16), strip(b.x + b.w - 4, b.y + 8, 8, b.h - 16)];
      const inWindow = s => s.y + s.height <= h && s.x + s.width <= w && s.y < h - 1;
      const counts = await bluePixels(p, sides.filter(inWindow));
      const n = sides.map(s => (inWindow(s) ? counts.shift() : -1));
      if (n.filter(v => v >= 0).some(v => v < 10)) bad.push(`${at}: focus ring blue pixels by side (top, bottom, left, right) ${n.join('/')}`);
      seen.push(`${at}: ring ${n.join('/')}`);
    }
    seen.push(`${at}: ${rows.map(r => `${r.title}${r.current ? '*' : ''} ${r.blur}px ${r.opacity}`).join(', ')}`);
    await p.close();
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
// One gesture at the pointer, then the page at rest (still for 450 ms on a screen edge, 5 s at most): its screen and scrollY.
const DIAL_GESTURES = Object.fromEntries(['wheel notch', 'trackpad swipe', 'phased gesture'].map(k => [k, GESTURES[k]]));
const dialStep = async (p, kind, dir, x, y) => {
  await p.evaluate(() => { const m = (window.__dm = { y: scrollY, last: performance.now(), done: false }); const f = () => { if (scrollY !== m.y) { m.y = scrollY; m.last = performance.now(); } if (!m.done) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await DIAL_GESTURES[kind](p, dir, Math.round(x), Math.round(y));
  await sleep(600);
  await atRest(p, '__dm');
  return p.evaluate(() => { __dm.done = true; const hit = [...document.querySelectorAll('[data-screen]')].find(e => Math.abs(e.getBoundingClientRect().top) < 2); return { id: hit ? (hit.id || 'table') : null, y: Math.round(scrollY) }; });
};
late(() => check('about-dial-wheel', 'With the pointer on About\'s dial (1440x900), one wheel gesture (notch, trackpad swipe, phased) turns it exactly one row and the page stays (scrollY unchanged): down to What’s next, where down stays on About; up back to How it works, where up pages to the overview. With the pointer in the side margin the page pages and the dial does not turn', async () => {
  const bad = [], seen = [];
  const p = await pageAt(1440, 900, 'about');
  for (const kind of Object.keys(DIAL_GESTURES)) {
    await goto(p, 'about'); await sleep(900);
    const [x, y] = await dialPoint(p);
    await p.mouse.move(x, y);
    const got = [];
    let at = await dialAt(p);
    if (at !== 0) { bad.push(`${kind}: starts on row ${at}`); continue; }
    for (const [dir, want] of [[1, 1], [1, 2], [1, 3], [1, 'about'], [-1, 2], [-1, 1], [-1, 0], [-1, 'stats']]) {
      const y0 = Math.round(await p.evaluate(() => scrollY));
      const res = await dialStep(p, kind, dir, x, y);
      at = await dialAt(p);
      got.push(`${dir > 0 ? '↓' : '↑'}${typeof want === 'number' ? at : res.id}`);
      if (typeof want === 'number') {
        if (at !== want || res.y !== y0) { bad.push(`${kind}: ${dir > 0 ? '↓' : '↑'} turned to row ${at} (want ${want}), scrollY ${y0} → ${res.y}`); break; }
      } else if (res.id !== want || at !== (dir > 0 ? 3 : 0)) { bad.push(`${kind}: ${dir > 0 ? '↓' : '↑'} past the end → ${res.id ?? `mid-way (y ${res.y})`}, dial on row ${at}`); break; }
      await sleep(900);
    }
    seen.push(`${kind}: ${got.join(' ')}`);
  }
  // Pointer in the side margin of About: the page has the wheel (up pages to the overview), the dial stays.
  for (const kind of Object.keys(DIAL_GESTURES)) {
    await goto(p, 'about'); await sleep(900);
    await p.mouse.move(20, 450);
    const r = await dialStep(p, kind, -1, 20, 450), at = await dialAt(p);
    seen.push(`margin ${kind} ↑: ${r.id}, row ${at}`);
    if (r.id !== 'stats' || at !== 0) bad.push(`margin ${kind} ↑ → ${r.id ?? `mid-way (y ${r.y})`}, dial on row ${at}`);
    await sleep(900);
  }
  await p.close();
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
group(() => check('about-dial-click-keys', 'On About\'s dial (/about, 1440x900): a click on a blurred row brings it forward and does nothing else (no dialog, no navigation); a click on "Read the system prompt" in the focused row opens it; ArrowDown and ArrowUp on the focused dial turn it; Tab into a blurred row\'s control brings that row forward', async () => {
  const bad = [], seen = [];
  const p = await dialPage(1440, 900, '/about');
  const url = p.url();
  const opened = () => p.evaluate(() => !!document.querySelector('dialog[open]'));
  const read = () => p.evaluate(() => { const b = [...document.querySelectorAll('[data-dial] button')].find(e => /^Read the system prompt/.test(e.textContent.trim())); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, row: [...document.querySelectorAll('[data-dial-row]')].indexOf(b.closest('[data-dial-row]')) }; });
  // ArrowDown then ArrowUp with focus on the dial.
  await p.focus('[data-dial]');
  await p.keyboard.press('ArrowDown'); await sleep(600);
  const down = await dialAt(p);
  await p.keyboard.press('ArrowUp'); await sleep(600);
  const up = await dialAt(p);
  seen.push(`↓ row ${down}, ↑ row ${up}`);
  if (down !== 1 || up !== 0) bad.push(`ArrowDown → row ${down}, ArrowUp → row ${up}`);
  // A click on the next row (blurred): it comes forward, nothing else.
  const pt = await p.evaluate(() => { const e = document.querySelectorAll('[data-dial-row]')[1], d = document.querySelector('[data-dial]').getBoundingClientRect(), r = e.getBoundingClientRect(); return [r.left + 160, Math.min(r.top + 30, d.bottom - 10)]; });
  await p.mouse.click(pt[0], pt[1]); await sleep(600);
  const clicked = await dialAt(p);
  seen.push(`click on row 1 → row ${clicked}`);
  if (clicked !== 1) bad.push(`a click on the blurred row 1 → row ${clicked}`);
  // The prompt button now sits in a blurred row: a click on it only brings its row back, opening nothing.
  const btn = await read();
  if (!btn) bad.push('no "Read the system prompt" button in the dial');
  else {
    await p.mouse.click(btn.x, btn.y); await sleep(600);
    const a = await dialAt(p), o = await opened();
    seen.push(`click on the blurred prompt button → row ${a}, dialog ${o}`);
    if (a !== btn.row || o) bad.push(`a click on the blurred row's prompt button → row ${a}, dialog ${o ? 'opened' : 'closed'}`);
    if (o) { await p.keyboard.press('Escape'); await sleep(300); }
    const b2 = await read();
    await p.mouse.click(b2.x, b2.y); await sleep(600);
    const o2 = await opened();
    seen.push(`click on it in the focused row → dialog ${o2}`);
    if (!o2) bad.push('a click on "Read the system prompt" in the focused row opens nothing');
    await p.keyboard.press('Escape'); await sleep(400);
  }
  if (p.url() !== url) bad.push(`the page navigated to ${p.url()}`);
  // Tab from the dial into the rows: the first stop in a row behind brings that row forward.
  await p.focus('[data-dial]');
  let moved = null;
  for (let k = 0; k < 20 && !moved; k++) {
    await p.keyboard.press('Tab'); await sleep(50);
    const r = await p.evaluate(() => { const e = document.activeElement?.closest('[data-dial-row]'); return e ? [...document.querySelectorAll('[data-dial-row]')].indexOf(e) : -1; });
    if (r < 0) break;
    if (r !== 0) moved = r;
  }
  await sleep(600);
  const tabbed = await dialAt(p);
  seen.push(`Tab into row ${moved} → row ${tabbed}`);
  if (moved === null || tabbed !== moved) bad.push(`Tab into row ${moved} left the dial on row ${tabbed}`);
  await p.close();
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
}));
// Owner, 2026-11-13: "when i click read system prompt read user prompt nothing should be moving in the background." With a
// prompt open (home page About screen and /about, 1440x900): wheel on the backdrop, on the dialog's header and past both
// ends of its text, and the page's keys, move nothing behind it (the page's scroll, About's own, the dial, every box in the
// window outside the dialog), every CSS animation behind it is paused, and on close all is where it was.
group(() => check('about-prompt-holds', 'With a prompt dialog open on About (home page About screen and /about, 1440x900), wheel on the backdrop, the dialog\'s header and past both ends of its text, and PageDown, ArrowDown, End and PageUp, move nothing behind it (page scroll, About\'s scroll, the dial, every box in the window outside the dialog) and its CSS animations are paused; closing it leaves all where it was', async () => {
  const bad = [], seen = [];
  for (const path of ['/', '/about']) {
    const p = await dialPage(1440, 900, path);
    await p.waitForFunction(() => document.querySelector('[data-about] figure [data-race-hit]'), { timeout: 60000, polling: 250 }).catch(() => {});
    await sleep(2200); // the race's reveal and the logos' fade
    // The page's scroll, About's own, the dial's row, and every visible box outside an open dialog.
    const state = () => p.evaluate(() => {
      const panel = document.querySelector('section[aria-label=About] .panel-scroll');
      const boxes = [...document.querySelectorAll('body *')].filter(e => !e.closest('dialog[open]')).map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.bottom > 0 && r.top < innerHeight).map(r => [r.x, r.y, r.width, r.height].map(Math.round).join(','));
      return { y: Math.round(scrollY), panel: Math.round(panel?.scrollTop ?? 0), at: [...document.querySelectorAll('[data-dial-row]')].findIndex(e => e.getAttribute('aria-current') === 'true'), boxes };
    });
    const before = await state();
    const btn = await p.evaluate(() => { const b = [...document.querySelectorAll('[data-dial] button')].find(e => /^Read the system prompt/.test(e.textContent.trim())); const r = b?.getBoundingClientRect(); return r && [r.left + r.width / 2, r.top + r.height / 2]; });
    if (!btn) { bad.push(`${path}: no "Read the system prompt" button`); await p.close(); continue; }
    await p.mouse.click(btn[0], btn[1]); await sleep(600);
    const open = await p.evaluate(() => !!document.querySelector('dialog[open]') && document.documentElement.hasAttribute('data-hold'));
    if (!open) { bad.push(`${path}: the dialog did not open with <html data-hold>`); await p.close(); continue; }
    const held = await state();
    // Where to wheel: the backdrop (the side margin), the dialog's header, and its text (to its bottom and past, then back).
    const spots = await p.evaluate(() => { const d = document.querySelector('dialog[open]').getBoundingClientRect(), t = document.querySelector('dialog[open] .overflow-y-auto').getBoundingClientRect(); return { head: [d.left + 40, d.top + 20], text: [t.left + t.width / 2, t.top + t.height / 2] }; });
    for (const [x, y, dir, n] of [[20, 450, 1, 3], [20, 450, -1, 3], [...spots.head, 1, 3], [...spots.text, 1, 12], [...spots.text, -1, 12], [...spots.head, -1, 3]]) {
      await p.mouse.move(x, y);
      for (let k = 0; k < n; k++) { await p.mouse.wheel({ deltaY: 400 * dir }); await sleep(40); }
      await sleep(300);
    }
    for (const key of ['PageDown', 'ArrowDown', 'End', 'PageUp']) { await p.keyboard.press(key); await sleep(200); }
    await sleep(500);
    const after = await state();
    const moved = after.boxes.filter(b => !held.boxes.includes(b)).length + held.boxes.filter(b => !after.boxes.includes(b)).length;
    const running = await p.evaluate(() => document.getAnimations().filter(a => a instanceof CSSAnimation && a.playState === 'running' && !a.effect?.target?.closest?.('dialog')).map(a => `${a.animationName} on ${a.effect.target.className || a.effect.target.tagName}`.slice(0, 60)));
    if (after.y !== held.y || after.panel !== held.panel || after.at !== held.at || moved) bad.push(`${path}: open, the page moved (scrollY ${held.y} → ${after.y}, About ${held.panel} → ${after.panel}, dial row ${held.at} → ${after.at}, ${moved} boxes changed)`);
    if (running.length) bad.push(`${path}: CSS animations still running behind the dialog: ${running.slice(0, 4).join(', ')}`);
    await p.keyboard.press('Escape'); await sleep(500);
    const closed = await state(), hold = await p.evaluate(() => document.documentElement.hasAttribute('data-hold') || !!document.querySelector('dialog[open]'));
    if (hold || closed.y !== before.y || closed.panel !== before.panel || closed.at !== before.at) bad.push(`${path}: closed, ${hold ? 'still held or open; ' : ''}scrollY ${before.y} → ${closed.y}, About ${before.panel} → ${closed.panel}, dial row ${before.at} → ${closed.at}`);
    seen.push(`${path}: scrollY ${held.y}, dial row ${held.at}, ${held.boxes.length} boxes held, ${running.length} animations running`);
    await p.close();
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
// Owner, 2026-11-14, on "Read the user prompt": "ideally we don't have to scroll down to see the reply, right? Or the callout
// message in the reply." The reply's code block (its callout) shows whole in the dialog as it opens, with no scroll.
group(() => check('about-prompt-reply-shows', 'On /about at 1440x900, 1512x982 and 1728x1117, "Read the user prompt" opens a dialog that shows the user prompt and the reply\'s code block whole without a scroll: with its text scrolled to the top, both blocks\' bottoms are inside the dialog\'s visible area and the window', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1512, 982], [1728, 1117]]) {
    const p = await dialPage(w, h, '/about'), at = `${w}x${h}`;
    const clicked = await p.evaluate(() => { const b = [...document.querySelectorAll('[data-about] button')].find(b => b.textContent.trim().startsWith('Read the user prompt') && b.getBoundingClientRect().width > 0); b?.click(); return !!b; });
    await sleep(600);
    const r = clicked && await p.evaluate(() => {
      const d = document.querySelector('dialog[open]'), body = d?.querySelector('.overflow-y-auto');
      if (!body) return null;
      body.scrollTop = 0;
      const pres = [...body.querySelectorAll('pre')], v = body.getBoundingClientRect();
      return { n: pres.length, bottoms: pres.map(e => Math.round(e.getBoundingClientRect().bottom)), view: Math.round(Math.min(v.bottom, d.getBoundingClientRect().bottom, innerHeight)), scrolls: body.scrollHeight > body.clientHeight + 1 };
    });
    if (!r) { bad.push(`${at}: the user prompt dialog did not open`); await p.close(); continue; }
    seen.push(`${at}: prompt and reply end at ${r.bottoms.join(' and ')}, view ends at ${r.view}${r.scrolls ? ', scrolls' : ''}`);
    if (r.n !== 2) bad.push(`${at}: ${r.n} code blocks in the dialog, not the prompt and the reply`);
    else if (r.bottoms.some(b => b > r.view + 1)) bad.push(`${at}: prompt ends at ${r.bottoms[0]}, reply at ${r.bottoms[1]}, past the dialog's visible area (${r.view})`);
    await p.close();
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
group(() => check('about-dial-touch-motion', 'At 390x844 with touch, one vertical swipe on About\'s dial turns it exactly one row (swipe up: the next) and the page stays; past How it works the page scrolls instead. Under reduced motion a turn shows the new row in focus at once, with no transition', async () => {
  const bad = [], seen = [];
  const p = await dialPage(390, 844, '/about', { touch: true });
  const cdp = await p.target().createCDPSession();
  await p.evaluate(() => document.querySelector('[data-dial]').scrollIntoView({ block: 'center', behavior: 'instant' })); await sleep(500);
  // A finger's swipe on the dial (up: dir 1): touch start, 160px of moves 16 ms apart, release.
  const swipe = async dir => {
    const [x, y] = await dialPoint(p), at = dy => [{ x: Math.round(x), y: Math.round(y + dy) }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
    for (let k = 1; k <= 10; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(-16 * k * dir) }); await sleep(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(800);
  };
  const got = [];
  // Past How it works (a swipe down there): not the dial's, the page scrolls up.
  {
    const y0 = await p.evaluate(() => scrollY);
    await swipe(-1);
    const at = await dialAt(p), y1 = await p.evaluate(() => scrollY);
    got.push(`down at the top: row ${at}, scrolled ${Math.round(y1 - y0)}`);
    if (at !== 0 || y0 - y1 < 8) bad.push(`a swipe down on How it works: row ${at}, the page scrolled ${Math.round(y1 - y0)}px`);
    await p.evaluate(() => document.querySelector('[data-dial]').scrollIntoView({ block: 'center', behavior: 'instant' })); await sleep(500);
  }
  for (const want of [1, 2, 3]) {
    const y0 = await p.evaluate(() => scrollY);
    await swipe(1);
    const at = await dialAt(p), y1 = await p.evaluate(() => scrollY);
    got.push(`row ${at}${y1 !== y0 ? ` (scrolled ${Math.round(y1 - y0)})` : ''}`);
    if (at !== want || Math.abs(y1 - y0) > 1) { bad.push(`swipe ${want}: row ${at} (want ${want}), scrollY ${Math.round(y0)} → ${Math.round(y1)}`); break; }
  }
  seen.push(`swipes: ${got.join(', ')}`);
  await p.close();
  // Reduced motion: the frame after ArrowDown already shows Caveats sharp and How it works behind, nothing animating.
  const q = await dialPage(1440, 900, '/about', { reduce: true });
  await q.focus('[data-dial]');
  const frame = await q.evaluate(() => new Promise(res => {
    document.querySelector('[data-dial]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const rows = [...document.querySelectorAll('[data-dial-row]')];
      // A row's words: the row's opacity times its body's, and the body's blur (the row itself is never blurred).
      const words = e => { const b = e.querySelector('[data-dial-body]') ?? e; return { o: +getComputedStyle(e).opacity * (b === e ? 1 : +getComputedStyle(b).opacity), f: getComputedStyle(b).filter }; };
      res({ at: rows.findIndex(e => e.getAttribute('aria-current') === 'true'), o: words(rows[1]).o, f: words(rows[1]).f, back: words(rows[0]).o, anims: document.querySelector('[data-dial]').getAnimations({ subtree: true }).length });
    }));
  }));
  seen.push(`reduced motion, next frame: row ${frame.at}, opacity ${frame.o}, filter ${frame.f}, behind ${frame.back}, ${frame.anims} animations`);
  if (frame.at !== 1 || frame.o !== 1 || frame.f !== 'none' || frame.back > 0.5 || frame.anims) bad.push(`reduced motion: the frame after ArrowDown shows row ${frame.at} at opacity ${frame.o} (${frame.f}), the row behind at ${frame.back}, ${frame.anims} animations running`);
  await q.close();
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join('; ') };
}));
// Every line of the API usage card fits on one line (owner's rule: UI text fits one line); the mock provider's test-mode
// line wrapped "called" onto a second line at 1440x900.
group(() => check('usage-card-one-line', 'At 1440x900, 1728x1117 and 390x844 every text line in the API usage card sits on one line', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1728, 1117], [390, 844]]) {
    const p = await newPage(); await p.setViewport({ width: w, height: h });
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction(() => [...document.querySelectorAll('#table a[href*="github.com/sponsors"]')].some(e => e.getBoundingClientRect().width > 0 && e.closest('.rounded')?.textContent.includes('/')), { timeout: 60000, polling: 250 }).catch(() => {});
    await sleep(1500);
    const r = await p.evaluate(() => {
      const a = [...document.querySelectorAll('#table a[href*="github.com/sponsors"]')].find(e => e.getBoundingClientRect().width > 0);
      if (!a) return null;
      const lines = [...a.closest('.rounded').querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
      // Lines are counted from the element's own text, not its child elements: an icon beside the words (the
      // Sponsor pill's 11px heart) has a box of its own whose top is not the text's, and is not a second line.
      return lines.map(e => {
        const rects = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).flatMap(n => { const rg = document.createRange(); rg.selectNodeContents(n); return [...rg.getClientRects()]; });
        return { text: e.textContent.trim(), n: new Set(rects.filter(q => q.width > 0).map(q => Math.round(q.top))).size };
      });
    });
    const at = `${w}x${h}`;
    if (!r) { bad.push(`${at}: no usage card`); await p.close(); continue; }
    const wrapped = r.filter(l => l.n > 1);
    seen.push(`${at}: ${r.length} lines`);
    for (const l of wrapped) bad.push(`${at}: "${l.text}" on ${l.n} lines`);
    await p.close();
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
// The watching count's first answer already counts the page asking: the usage poll starts once the page's own stream
// is open, as the hub counts a stream only when its request arrives (a fetch at mount read "0 watching" for 30 s).
group(() => check('watching-counts-me', 'A fresh table page\'s status label, when it first reads "· N watching", has N of at least 1, since the page itself is watching', async () => {
  const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const first = await p.waitForFunction(() => {
    const m = [...document.querySelectorAll('span')].map(e => e.textContent.match(/· ([\d,]+) watching/)).find(Boolean);
    return m ? m[1] : false;
  }, { timeout: 20000, polling: 50 }).then(h => h.jsonValue()).catch(() => null);
  await p.close();
  const n = first === null ? null : +first.replace(/,/g, '');
  return { pass: n !== null && n >= 1, detail: n === null ? 'no "· N watching" within 20 s' : `first read "· ${first} watching"` };
}));
// Owner, 2026-11-12: "the donation part is not like... apparent". The ask sits on the table screen, in the API usage card
// beside the calls it pays for: a filled "Sponsor on GitHub" link, its sentence on one line, and Profits & Losses above
// still shows every seat.
group(() => check('donate-apparent', 'On the table screen at 1440x900, 1728x1117 and 390x844, the API usage card has, at its bottom below everything else in it and inside it, a filled "Sponsor on GitHub" link to GitHub Sponsors (new tab), the card\'s only filled control, inside the window; Profits & Losses shows every seat\'s row unclipped and unscrolled', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [1728, 1117], [390, 844]]) {
    const p = await newPage(); await p.setViewport({ width: w, height: h });
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction(() => document.querySelectorAll('#table ol li').length >= 2 && document.querySelector('#table a[href*="sponsors"]'), { timeout: 60000, polling: 250 }).catch(() => {});
    await sleep(2500);
    const r = await p.evaluate(() => {
      const a = [...document.querySelectorAll('#table a[href*="github.com/sponsors"]')].find(e => e.getBoundingClientRect().width > 0);
      if (!a) return null;
      const card = a.closest('.rounded'), cb = card.getBoundingClientRect(), ab = a.getBoundingClientRect();
      // Owner, 2026-11-14: the paid-call sentence is gone; the link sits at the card's bottom, below every other line in
      // it, still inside the card (on a line of its own, whole).
      const others = [...card.querySelectorAll('span, p, div')].filter(e => !a.contains(e) && !e.contains(a) && e.children.length === 0 && e.textContent.trim());
      const lowest = Math.max(...others.map(e => e.getBoundingClientRect().bottom));
      const below = ab.top >= lowest - 1 && ab.bottom <= cb.bottom - 1 && ab.right <= cb.right - 1 && a.scrollWidth <= a.clientWidth + 1;
      const sentence = /paid model call/.test(card.textContent);
      const filled = [...card.querySelectorAll('a, button')].filter(e => { const c = getComputedStyle(e).backgroundColor; return c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'; });
      const pnl = [...document.querySelectorAll('#table h2')].find(e => /Profits/.test(e.textContent))?.closest('.rounded');
      const list = pnl?.querySelector('ol'), scroller = list?.parentElement, pb = scroller?.getBoundingClientRect();
      const rows = list ? [...list.children] : [];
      const cut = rows.filter(li => { const q = li.getBoundingClientRect(); return q.top < pb.top - 1 || q.bottom > pb.bottom + 1; }).length;
      return {
        text: a.textContent.trim(), bg: getComputedStyle(a).backgroundColor, target: a.target, sentence, below, filled: filled.length,
        inWindow: ab.top >= 0 && ab.bottom <= innerHeight + 1 && ab.left >= 0 && ab.right <= innerWidth, rows: rows.length, cut,
        scrolls: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : true, cardH: Math.round(cb.height),
      };
    });
    const at = `${w}x${h}`;
    if (!r) { bad.push(`${at}: no GitHub Sponsors link on the table screen`); await p.close(); continue; }
    seen.push(`${at}: "${r.text}" ${r.bg}, card ${r.cardH}px, P&L ${r.rows} rows, ${r.cut} cut${r.scrolls ? ', scrolls' : ''}`);
    if (r.text !== 'Sponsor on GitHub' || r.bg !== 'rgb(31, 111, 196)' || r.target !== '_blank') bad.push(`${at}: the link is "${r.text}" on ${r.bg}, target ${r.target || 'self'}`);
    if (r.sentence) bad.push(`${at}: the card still says it is a paid model call`);
    if (!r.below) bad.push(`${at}: the Sponsor link is not at the card's bottom, below its other lines, inside it`);
    if (r.filled !== 1) bad.push(`${at}: ${r.filled} filled controls in the card`);
    if (w > 390 && !r.inWindow) bad.push(`${at}: the Sponsor link is outside the window`);
    if (r.rows < 2 || r.cut || r.scrolls) bad.push(`${at}: Profits & Losses ${r.rows} rows, ${r.cut} cut${r.scrolls ? ', scrolls' : ''}`);
    await p.close();
  }
  return { pass: !bad.length, detail: bad.length ? bad.join('; ') : seen.join(' | ') };
}));
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
// The engine's /api/stats, at the address of the page's own stream (the build's NEXT_PUBLIC_API_URL); null if it never opened one.
const engineStats = async p => {
  const url = p.__stream?.replace(/\/stream$/, '/api/stats');
  return url ? { url, stats: await (await fetch(url)).json() } : null;
};
// bb/100 as the cards print it (lib/stats signedBrief): +12.3 below a thousand, +1.2k above.
const bbText = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n) < 1000 ? Math.abs(n).toFixed(1) : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(n)).toLowerCase()}`;
const bb100 = (v, bb) => (v.net_chips / bb / v.hands) * 100;
// The models the Seated now lineup shows (lib/stats seatedModels): the seated with stats when two or more have them, else all.
const seatedOf = stats => { const at = stats.models.filter(m => stats.seated?.includes(m.name)); return at.length >= 2 ? at : stats.models; };
// A button in the Matchups card's header (the Trends card has an "All models" of its own in the page's order).
const clickLineup = (p, t) => p.evaluate(t => { const b = [...document.querySelectorAll('#pairwise-card button')].find(e => e.textContent.trim() === t && e.getBoundingClientRect().width > 0); if (b) b.click(); return !!b; }, t);
const cardCells = p => p.evaluate(() => [...document.querySelectorAll('#pairwise-card [data-cell]')].map(el => ({ key: el.dataset.cell, hands: el.dataset.hands ?? null, text: el.querySelector('[aria-hidden]')?.textContent ?? '' }))); // the visible figure (the sr-only copy aside)
group(() => check('matchups-bb100', 'Every Matchups card cell is the pair\'s bb/100 (net_chips / big_blind / hands together x 100 from the engine, with those hands on it), and each Total is the row\'s bb/100 against the models shown', async () => {
  const p = await pageAt(1440, 900, 'race');
  await clickText(p, 'Skip'); await sleep(800); await goto(p, 'pairwise'); await sleep(1500);
  const e = await engineStats(p);
  if (!e) { await p.close(); return { pass: false, detail: 'the page never opened the engine stream' }; }
  const bb = e.stats.scope.big_blind, by = Object.fromEntries(e.stats.models.map(m => [m.name, m]));
  const cells = await cardCells(p);
  await p.close();
  const bad = []; let n = 0;
  const names = new Set(cells.map(c => c.key.split('|')[0]));
  for (const c of cells) {
    const [row, col] = c.key.split('|');
    if (row === col) continue;
    let v = by[row]?.vs?.[col];
    if (!col) { // the Total: the row's bb/100 against the models shown
      v = { net_chips: 0, hands: 0 };
      for (const o of names) if (o !== row) { const w = by[row]?.vs?.[o]; v.net_chips += w?.net_chips ?? 0; v.hands += w?.hands ?? 0; }
    }
    if (!v?.hands) { if (c.text) bad.push(`${c.key}: "${c.text}" for a pair without hands together`); continue; }
    if (col) n++;
    // The figure in full where it fits (owner, 2026-11-09: not "+1k", "+2.4k"; HeadToHead's fitFigure), else a whole, else short.
    const x = bb100(v, bb), want = bbText(x), sign = x > 0 ? '+' : x < 0 ? '−' : '', full = `${sign}${Math.abs(x).toFixed(1)}`, whole = `${sign}${Math.round(Math.abs(x))}`;
    if (![full, whole, want].includes(c.text)) bad.push(`${c.key}: shows "${c.text}", engine ${v.net_chips} chips over ${v.hands} hands = ${full}`);
    if (+c.hands !== v.hands) bad.push(`${c.key}: data-hands ${c.hands}, engine ${v.hands}`);
  }
  if (n < 20) bad.push(`only ${n} pairs with hands together`);
  return { pass: !bad.length, detail: bad.length ? bad.slice(0, 5).join('; ') : `${n} cells match the engine's bb/100 (big blind ${bb})` };
}));
group(() => check('matchups-total-faint', 'A Matchups Total is drawn faint exactly when its row has fewer than 500 hands of its own (not the hands summed over its opponents)', async () => {
  const p = await pageAt(1440, 900, 'race');
  await clickText(p, 'Skip'); await sleep(800); await goto(p, 'pairwise'); await sleep(1500);
  const e = await engineStats(p);
  if (!e) { await p.close(); return { pass: false, detail: 'the page never opened the engine stream' }; }
  const by = Object.fromEntries(e.stats.models.map(m => [m.name, m]));
  const totals = await p.evaluate(() => [...document.querySelectorAll('#pairwise-card [data-cell$="|"]')]
    .filter(el => el.querySelector('[aria-hidden]')).map(el => ({ row: el.dataset.cell.slice(0, -1), faint: +getComputedStyle(el).opacity < 1 })));
  await p.close();
  const bad = totals.filter(t => by[t.row] && t.faint !== by[t.row].hands < 500).map(t => `${t.row}: ${by[t.row].hands} hands, drawn ${t.faint ? 'faint' : 'full'}`);
  if (!totals.length) bad.push('no Total with a figure');
  return { pass: !bad.length, detail: bad.length ? bad.slice(0, 5).join('; ') : `${totals.length} Totals, ${totals.filter(t => t.faint).length} faint, each by its row's own hands` };
}));
group(() => check('matchups-all-models', 'The Matchups card\'s "All models" shows every model with hands at the seated cell size; the grid scrolls inside the card with the row names, column logos and totals pinned', async () => {
  const p = await pageAt(1440, 900, 'race');
  await clickText(p, 'Skip'); await sleep(800); await goto(p, 'pairwise'); await sleep(1500);
  const e = await engineStats(p);
  if (!e) { await p.close(); return { pass: false, detail: 'the page never opened the engine stream' }; }
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
// No pair in the local data has never met, so the page is served stats with one seated pair's head-to-head removed:
// the stream's stats messages are rewritten before the page reads them, and so is any /api/stats answer it fetches.
group(() => check('matchups-never-met', 'A pair with no hands together is an empty Matchups cell whose readout says they never sat together', async () => {
  const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(seatedSrc => {
    const seatedOf = new Function(`return ${seatedSrc}`)();
    let pair = null;
    // The first full body picks the pair; every stats body or changed row after it (a session's too) loses it.
    const strip = stats => {
      if (stats.models) pair ??= window.__pair = seatedOf(stats).slice(0, 2).map(m => m.name);
      if (!pair) return stats;
      const [a, b] = pair;
      for (const m of stats.models ?? stats.changed ?? []) if (m.name === a || m.name === b) delete m.vs?.[m.name === a ? b : a];
      return stats;
    };
    const Real = window.EventSource;
    window.EventSource = class extends Real {
      set onmessage(fn) {
        super.onmessage = e => {
          const m = JSON.parse(e.data);
          if (m.type !== 'stats') return fn(e);
          fn(new MessageEvent('message', { data: JSON.stringify({ ...m, payload: strip(m.payload) }) }));
        };
      }
      get onmessage() { return super.onmessage; }
    };
    const fetch0 = window.fetch;
    window.fetch = async (...a) => {
      const res = await fetch0(...a);
      if (!/\/api\/stats(\?|$)/.test(String(a[0]?.url ?? a[0])) || !res.ok) return res;
      return new Response(JSON.stringify(strip(await res.json())), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  }, seatedOf.toString());
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 }); await waitStats(p); await sleep(3000);
  await goto(p, 'race'); await sleep(800); await clickText(p, 'Skip'); await sleep(800); await goto(p, 'pairwise'); await sleep(1500);
  const pair = await p.evaluate(() => window.__pair ?? null);
  if (!pair) { await p.close(); return { pass: false, detail: 'the page never got stats from the engine stream' }; }
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
// Owner, 2026-11-13: "why does a scrollbar sometimes appear on the matrix? and look the text barely fits in the popup
// when i hover". The readout is drawn in the card's chrome, outside the matrix's scroller, hugging its text.
group(() => check('matchups-tip-inside', 'Hovering a Matchups card cell (the four corners and the middle, at 1440x900 and 390x844) shows its readout whole inside the card, its text uncut, off the cell, and never changes the matrix scroller\'s scroll size', async () => {
  const bad = [], seen = [];
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const p = await pageAt(w, h, 'race');
    await clickText(p, 'Skip'); await sleep(800); await goto(p, 'pairwise'); await sleep(1500);
    const n = await p.evaluate(() => document.querySelectorAll('#pairwise-card tbody tr').length);
    if (n < 3) { bad.push(`${w}x${h}: ${n} rows`); await p.close(); continue; }
    const m = n >> 1;
    // The corners off the diagonal (a model's own cell has no readout), and one in the middle.
    for (const [r, c] of [[0, 1], [0, n - 1], [n - 1, 0], [n - 1, n - 2], [m, m + 1]]) {
      const at = await p.evaluate((r, c) => {
        const td = document.querySelectorAll('#pairwise-card tbody tr')[r].querySelectorAll('td')[c];
        td.scrollIntoView({ block: 'nearest', inline: 'center' }); // a phone's grid scrolls: bring the cell out from under the pinned names
        const sc = document.querySelector('#pairwise-card .panel-scroll');
        // scrollIntoView centres it in the whole scroller, half under the pinned names: centre it in the part beside them.
        const pin = sc.querySelector('.sticky.left-0').getBoundingClientRect(), s = sc.getBoundingClientRect(), b0 = td.getBoundingClientRect();
        sc.scrollLeft += (b0.left + b0.right) / 2 - (pin.right + s.right) / 2;
        const b = td.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
        return { x, y, key: td.dataset.cell, hit: td.contains(document.elementFromPoint(x, y)), size: [sc.scrollWidth, sc.scrollHeight] };
      }, r, c);
      if (!at.hit) { bad.push(`${w}x${h} ${at.key}: the cell is covered at its centre`); continue; }
      await p.mouse.move(at.x - 3, at.y - 3); await p.mouse.move(at.x, at.y, { steps: 3 }); await sleep(400);
      const t = await p.evaluate(key => {
        const tip = document.querySelector('#pairwise-card [role=tooltip]');
        if (!tip) return null;
        const a = tip.getBoundingClientRect(), k = document.querySelector('#pairwise-card .card-chrome').getBoundingClientRect();
        const cell = document.querySelector(`#pairwise-card td[data-cell="${CSS.escape(key)}"]`).getBoundingClientRect();
        const sc = document.querySelector('#pairwise-card .panel-scroll');
        return {
          box: [a.left, a.top, a.right, a.bottom].map(Math.round), card: [k.left, k.top, k.right, k.bottom].map(Math.round),
          inside: a.left >= k.left - 0.5 && a.right <= k.right + 0.5 && a.top >= k.top - 0.5 && a.bottom <= k.bottom + 0.5,
          cut: tip.scrollWidth - tip.clientWidth, over: a.left < cell.right && a.right > cell.left && a.top < cell.bottom && a.bottom > cell.top,
          size: [sc.scrollWidth, sc.scrollHeight],
        };
      }, at.key);
      const where = `${w}x${h} ${at.key}`;
      if (!t) { bad.push(`${where}: no readout`); continue; }
      if (!t.inside) bad.push(`${where}: readout ${t.box} outside the card ${t.card}`);
      if (t.cut) bad.push(`${where}: readout text ${t.cut}px wider than its box`);
      if (t.over) bad.push(`${where}: readout covers the cell`);
      if (t.size.join() !== at.size.join()) bad.push(`${where}: matrix scroll size ${at.size.join('x')} -> ${t.size.join('x')} on hover`);
      seen.push(`${where} ${t.box[2] - t.box[0]}px`);
    }
    await p.close();
  }
  return { pass: !bad.length, detail: bad.length ? bad.slice(0, 6).join('; ') : `readouts inside the card, uncut, scroll size unchanged: ${seen.join(', ')}` };
}));
group(() => check('leader-bb100', 'The Leader line is the best bb/100 among the models shown with at least 500 hands (Seated now, then All models on the Matchups card), in bb/100', async () => {
  const p = await pageAt(1440, 900, 'race');
  await clickText(p, 'Skip'); await sleep(800); await goto(p, 'pairwise'); await sleep(1500);
  const e = await engineStats(p);
  if (!e) { await p.close(); return { pass: false, detail: 'the page never opened the engine stream' }; }
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

// The server ends every stream after 10 to 14 minutes and the page reopens it (docs/stream.md); the viewer must not
// see it. On the live table, in each phase of a turn (thinking; reasoning while it types; revealed), the page's stream
// is ended as the server ends it (closed, then its error handler), so the page reopens it against the engine. From then
// until 3 s after the new stream's snapshot is applied, every frame: no connection bar, no Offline; the reasoning text
// never gets shorter and the shot clock never goes up, except after a live message; seats, cards, pot and
// stacks change only after a live message, never after the snapshot. A try whose snapshot is newer than the last live
// message (the table moved while the stream was down) shows something real, so it is retried.
group(() => check('reconnect-unseen', 'The routine stream reconnect is unseen: no connection bar or Offline, the reasoning neither shortens nor retypes, the shot clock never jumps up, and the table changes only on live events, in the thinking, reasoning and revealed phases', async () => {
  const p = await newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(() => {
    const Real = window.EventSource, s = window.__es = { cur: null, log: [] };
    window.EventSource = class extends Real {
      constructor(...a) { super(...a); s.cur = this; }
      set onmessage(fn) {
        super.onmessage = e => {
          try { const m = JSON.parse(e.data); s.log.push({ at: performance.now(), type: m.type, seq: m.seq, live: m.type !== 'snapshot' && m.type !== 'stats' }); } catch {}
          fn(e);
        };
      }
      get onmessage() { return super.onmessage; }
    };
    // As the server ends it: the stream closes and EventSource reports an error.
    window.__endStream = () => { const es = s.cur; es.close(); es.onerror?.(new Event('error')); };
    window.__read = () => {
      const panel = document.querySelector('.stage-zoom .h-\\[100px\\]');
      const clock = panel?.querySelector('[data-clock]');
      const shown = clock && !clock.closest('.invisible');
      const look = e => e.textContent + [...e.querySelectorAll('[aria-label]')].map(c => c.getAttribute('aria-label')).join(',');
      return {
        reason: (panel?.querySelector('p.italic')?.textContent ?? '').replace('▌', ''), // the typing cursor goes when it ends
        clock: shown ? parseInt(clock.textContent, 10) : null,
        bar: !!document.querySelector('div[role=status].fixed'),
        offline: [...document.querySelectorAll('span')].some(e => /^Offline/.test(e.textContent) && e.getBoundingClientRect().width > 0),
        table: [...document.querySelectorAll('[data-seat], [data-felt]')].map(look).join('|').replace(/Next hand in \d+s/, ''),
      };
    };
  });
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const ready = () => p.evaluate(() => ({ snapshot: window.__es.log.some(m => m.type === 'snapshot'), cards: !!document.querySelector('[data-seat] [data-hole]'), messages: window.__es.log.length }));
  if (!(await p.waitForFunction(() => window.__es.log.some(m => m.type === 'snapshot') && document.querySelector('[data-seat] [data-hole]'), { timeout: 120000 }).catch(() => null))) {
    const r = await ready(); await p.close();
    return { pass: false, detail: `the live table never showed in 120 s: ${JSON.stringify(r)}` };
  }
  // Waits for the next live message of the phase's type (a thinking turn at least 4 s into its hand, so the deal has landed).
  const phases = {
    thinking: { type: 'llm_thinking', after: 300 },
    reasoning: { type: 'llm_action', after: 300 },
    revealed: { type: 'game_state', after: 100, prev: 'llm_action' },
  };
  const bad = [], seen = [];
  for (const [name, ph] of Object.entries(phases)) {
    let done = false;
    for (let attempt = 1; attempt <= 6 && !done; attempt++) {
      const from = await p.evaluate(() => window.__es.log.length);
      const ok = await p.waitForFunction((from, ph) => {
        const log = window.__es.log.filter(m => m.live);
        const i = log.findLastIndex(m => m.type === ph.type);
        if (i < 0 || window.__es.log.indexOf(log[i]) < from) return false;
        if (ph.prev && log[i - 1]?.type !== ph.prev) return false;
        const start = log.findLast(m => m.type === 'hand_start');
        return ph.type !== 'llm_thinking' || !start || log[i].at - start.at > 4000;
      }, { timeout: 90000, polling: 'raf' }, from, ph).then(() => true, () => false);
      if (!ok) { bad.push(`${name}: no ${ph.type} on the live table in 90 s`); break; }
      await sleep(ph.after);
      const r = await p.evaluate(() => new Promise(resolve => {
        const s = window.__es, cut = s.log.length, last = s.log.at(-1)?.seq;
        const t0 = performance.now(), frames = [], faults = [];
        let prev = window.__read(), snapAt = null;
        window.__endStream();
        const frame = () => {
          const now = performance.now(), cur = window.__read(), since = s.log.slice(cut);
          const snap = since.find(m => m.type === 'snapshot');
          if (snap && snapAt === null) snapAt = snap.at;
          const lastMsg = since.filter(m => m.type !== 'stats').at(-1);
          const liveLast = lastMsg?.live; // since the stream was ended, the table's latest word was a live message, not the snapshot
          const t = (now - t0).toFixed(0);
          if (cur.bar) faults.push(`connection bar at ${t} ms`);
          if (cur.offline) faults.push(`Offline at ${t} ms`);
          if (cur.reason.length < prev.reason.length && !liveLast) faults.push(`reasoning ${prev.reason.length} -> ${cur.reason.length} chars ("${cur.reason.slice(-16)}") at ${t} ms, after the ${lastMsg?.type ?? 'reopen'}`);
          if (cur.clock !== null && prev.clock !== null && cur.clock > prev.clock && !liveLast) faults.push(`shot clock ${prev.clock}s -> ${cur.clock}s at ${t} ms, after the ${lastMsg?.type ?? 'reopen'}`);
          if (cur.table !== prev.table && !liveLast && since.length) faults.push(`table changed after the ${lastMsg?.type ?? 'nothing'} at ${t} ms`);
          prev = cur; frames.push(now);
          if (snapAt !== null && now > snapAt + 3000) return resolve({ frames: frames.length, gapMs: Math.round(snapAt - t0), moved: snap.seq !== last, faults: [...new Set(faults)] });
          if (now - t0 > 15000) return resolve({ frames: frames.length, gapMs: null, moved: false, faults: [...new Set(faults), 'no snapshot within 15 s'] });
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }));
      if (r.moved && !r.faults.some(f => /bar|Offline|no snapshot/.test(f))) { seen.push(`${name} try ${attempt}: the table moved while the stream was down, retried`); continue; }
      done = true;
      seen.push(`${name}: reopened in ${r.gapMs} ms, ${r.frames} frames watched`);
      if (r.faults.length) bad.push(`${name}: ${r.faults.slice(0, 4).join(', ')}`);
    }
    if (!done && !bad.some(b => b.startsWith(name))) bad.push(`${name}: the table moved during every reconnect`);
  }
  await p.close();
  return { pass: !bad.length, detail: bad.length ? `${bad.join('; ')} (${seen.join('; ')})` : seen.join('; ') };
}));

// --lanes 1 runs one page at a time (the main page's steps, then each group, then each late): a timing check on the main
// page (a 4x replay's splashes, a refresh's fade) misreads frames while a group films in a window beside it.
const beside = LANES > 1 ? drain(groups, LANES - 1) : null;
for (const step of steps) await step().catch(e => console.error(e));
await Promise.all([pg, ...shared().values()].map(p => p.close()));
await browser.__sharedCtx?.close();
if (beside) await Promise.all([beside, drain(lates, LANES - 1)]);
else { await drain(groups, 1); await drain(lates, 1); }
await browser.close();
// A block that threw outside its check() lost its checks: they fail under their own ids, so verify.sh reruns them alone.
for (const id of IDS) if (want(id) && !results.some(r => r.id === id)) results.push({ id, rule: 'ran', pass: false, detail: 'never ran: its block threw (error above)', ms: 0 });
results.sort((a, b) => IDS.indexOf(a.id) - IDS.indexOf(b.id));
const w = Math.max(...results.map(r => r.id.length));
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(w)}  ${(r.ms / 1000).toFixed(1).padStart(5)}s  ${r.detail}   (${r.rule})`);
console.log(`\nslowest: ${results.slice().sort((a, b) => b.ms - a.ms).slice(0, 5).map(r => `${r.id} ${(r.ms / 1000).toFixed(0)}s`).join(', ')}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
