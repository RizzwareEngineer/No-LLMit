// One scripted viewer journey (loop design steps 1 and 5), at an applied 4x CPU throttle and Lighthouse's applied slow-4G
// network (562.5 ms round trip, 1,474.56 Kbps down, 675 Kbps up), at 390x844 (a phone, touch, 3x) and 1440x900:
//   load → 30 s watching the table → each Stats window (a swipe up at a time on the phone: Profits & Losses, Trends,
//   Profiles, Matchups; on the desktop a wheel notch to the overview, a click on Trends, then a notch to Profiles and one
//   to Matchups) → open a model's drawer (a tap or click on a model's name in Matchups) and close it → back to the
//   table (a phone: then a seat's popup, a tap on its logo) → a stream
//   update (a game_state with a planted 77,777 stack) while a long reason types.
// Each step records its time to real content (journey-page.mjs's region predicates: data present, shown and half in
// the window, checked each frame, and the element-timing paint of the data inside it, never an empty box's), its long
// tasks (over 50 ms), its dropped frames (animation-frame gaps), its main-thread time (CDP TaskDuration) and its bytes;
// the journey totals main-thread time and bytes. The screen is recorded throughout (CDP screencast) and each step's
// filmstrip, a frame every 100 ms, is saved as a PNG for run 1. An extra, unmeasured run per size (run 0) takes the
// inventory of each state: the server HTML's text, the DOM's text, the accessibility tree, the links and controls, and
// the gestures that reach each (inventory work would distort the measured runs: an accessibility tree, once built, is kept).
// Runs N times (each in a fresh browser) and reports every metric's spread, and swipe-to-Stats against 300 ms.
// Run: node scripts/journey.mjs --base http://localhost:3300 [--runs 10] [--out dir] [--sizes phone,desk] [--watch 30]
//      [--no-inventory] [--films all]
// Needs a running site and engine (the engine at a slow pace, e.g. curl -X POST 'localhost:8080/dev/pace?pace=0.3').
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { instrument } from './journey-page.mjs';
import { filmstrip, summarize } from './journey-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:3300');
const RUNS = +arg('--runs', 10), WATCH_S = +arg('--watch', 30);
const OUT = arg('--out', '/tmp/journey');
const SIZES = arg('--sizes', 'phone,desk').split(',');
const FILMS = arg('--films', 'first'); // first | all | none
const INVENTORY = !process.argv.includes('--no-inventory');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SWIPE_TARGET_MS = 300; // the owner's target: a Stats window within 300 ms of a swipe on a slow phone

// Lighthouse's applied ("devtools") mobile throttling: slow 4G times its 3.75 round-trip and 0.9 throughput factors.
const NETWORK = { offline: false, latency: 562.5, downloadThroughput: (1474.56 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 };
const CPU = 4;
const SIZE = {
  phone: { viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' },
  desk: { viewport: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
};
// Each Stats window's screen (journey-page.mjs's J.landed names the one the page rests on).
const SCREEN = { pnl: 'phone-stats', overview: 'stats', trends: 'race', profiles: 'stats-table', matchups: 'pairwise' };
const LONG_REASON = 'Qzstart ' + 'The board is dry and the pot is small, so a call keeps the weaker hands in while my pair is ahead. '.repeat(6) + 'zqend';

async function journey(size, { run, inventory, films }) {
  const S = SIZE[size], phone = size === 'phone';
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], ignoreDefaultArgs: ['--enable-automation'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(S.ua);
    await page.setViewport(S.viewport);
    const cdp = await page.createCDPSession();
    await cdp.send('Performance.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    await cdp.send('Network.emulateNetworkConditions', NETWORK);
    // Bytes: a finished request counts its encoded length when it finishes; one that never finishes (the stream) counts
    // each chunk as it comes. Times are this process's clock (the browser's wall clock on the same machine).
    const reqs = new Map(), finished = [], chunks = [];
    cdp.on('Network.responseReceived', e => { reqs.set(e.requestId, e.response.url); });
    cdp.on('Network.dataReceived', e => chunks.push({ id: e.requestId, wall: Date.now(), n: e.encodedDataLength }));
    cdp.on('Network.loadingFinished', e => finished.push({ id: e.requestId, wall: Date.now(), n: e.encodedDataLength }));
    // The screen, every frame the compositor produces (scaled to CSS pixels).
    const frames = [];
    cdp.on('Page.screencastFrame', e => { frames.push({ wall: e.metadata.timestamp * 1000, data: e.data }); cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: S.viewport.width, maxHeight: S.viewport.height, everyNthFrame: 1 });
    await page.evaluateOnNewDocument(instrument);
    // The load's waits start with the document: the table on both sizes, Profits & Losses beside it on the desktop.
    await page.evaluateOnNewDocument(phone => { window.__J.load = Promise.all([window.__J.wait('table', 90000, 0), phone ? null : window.__J.wait('pnl', 90000, 0)]); }, phone);

    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const now = () => page.evaluate(() => performance.now());
    const steps = [], states = [];
    let path = [], origin = 0;
    const lastInput = (types, t0) => page.evaluate((types, t0) => window.__J.inputs.filter(i => i.t >= t0 && types.includes(i.type)).at(-1)?.t ?? null, types, t0);
    const wait = (name, ms, from) => page.evaluate((name, ms, from) => window.__J.wait(name, ms, from), name, ms, from ?? null);
    // One step: its gestures (fn), then its numbers over its window; then, on an inventory run, the state it leaves.
    const step = async (name, gesture, fn) => {
      const t0 = name === 'load' ? 0 : await now(), m0 = name === 'load' ? {} : await metrics();
      let r;
      try { r = (await fn(t0)) ?? {}; } catch (e) { r = { error: e.message.split('\n')[0] }; }
      const t1 = await now(), m1 = await metrics();
      steps.push({ name, t0, t1, wall0: origin + t0, wall1: origin + t1, ...r,
        taskMs: (m1.TaskDuration - (m0.TaskDuration ?? 0)) * 1000, scriptMs: (m1.ScriptDuration - (m0.ScriptDuration ?? 0)) * 1000,
        layoutMs: (m1.LayoutDuration - (m0.LayoutDuration ?? 0)) * 1000, styleMs: (m1.RecalcStyleDuration - (m0.RecalcStyleDuration ?? 0)) * 1000 });
      if (gesture) path = [...path, gesture];
      if (inventory) states.push({ state: name, gestures: path, ...(await takeInventory(page)) });
    };
    // Time to real content of one region: from the gesture's end (a lift, a wheel notch, a click) and from its start.
    const content = (w, t0, end, start) => {
      if (w.at == null) return { found: false };
      const at = Math.max(w.at, w.et ?? 0);
      return { found: true, frameAt: Math.round(w.at), etAt: w.et == null ? null : Math.round(w.et), fromStep: Math.round(at - t0),
        fromEnd: end == null ? null : Math.round(at - end), fromStart: start == null ? null : Math.round(at - start) };
    };
    // Input as a person makes it: each event is sent at its own time and not held until the page has handled the one
    // before (puppeteer's touchscreen waits for each event's acknowledgement, so on a busy 4x main thread a 200 ms swipe
    // took up to 8 s). Returns the gesture's start and end on the page's clock (ms from its navigation).
    const fire = async seq => {
      const t = Date.now(), sent = [];
      await Promise.all(seq.map(([at, method, params]) => new Promise(r => setTimeout(() => { sent.push(cdp.send(method, params).catch(() => {})); r(); }, at))));
      await Promise.all(sent);
      return { start: t - origin, end: t + seq.at(-1)[0] - origin };
    };
    const center = async sel => {
      // The first of them whole in the window and not under anything else (a tap there reaches it).
      const c = await page.evaluate(sel => { const e = [...document.querySelectorAll(sel)].find(e => { const b = e.getBoundingClientRect(); if (!(b.width > 0 && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth)) return false; const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!top && (top === e || e.contains(top)); }); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, sel);
      if (!c) throw new Error(`nothing to tap: ${sel}`);
      return c;
    };
    const tapAt = async sel => {
      const [x, y] = await center(sel);
      if (phone) return fire([[0, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }], [60, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }]]);
      return fire([[0, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }], [10, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }], [80, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }]]);
    };
    const W = S.viewport.width, H = S.viewport.height;
    // A finger's swipe up, as checks.mjs's phone-stats-windows: 12 moves 16 ms apart, from 85% of the window to 12%.
    const swipeUp = () => { const x = W / 2, y0 = H * 0.85, y1 = H * 0.12; return fire([[0, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] }], ...Array.from({ length: 12 }, (_, i) => [16 * (i + 1), 'Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * (i + 1)) / 12 }] }]), [16 * 13, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }]]); };
    const notch = () => fire([[0, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: W / 2, y: H / 2 }], [10, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: W / 2, y: H / 2, deltaX: 0, deltaY: 120 }]]);

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 180000 });
    origin = await page.evaluate(() => performance.timeOrigin);
    await step('load', null, async () => {
      const [table, pnl] = await page.evaluate(() => window.__J.load);
      const lcp = await page.evaluate(() => new Promise(r => { new PerformanceObserver(l => { const e = l.getEntries().at(-1); r(e ? { t: Math.round(e.startTime), el: (e.element?.textContent ?? '').slice(0, 40) } : null); }).observe({ type: 'largest-contentful-paint', buffered: true }); setTimeout(() => r(null), 3000); }));
      await sleep(2000);
      const regions = { table: content(table, 0) };
      if (pnl) regions.pnl = content(pnl, 0);
      return { regions, ttc: Math.max(...Object.values(regions).map(r => r.fromStep ?? Infinity)), lcp };
    });
    await step('watch', null, async t0 => { await sleep(WATCH_S * 1000); return { watchedS: WATCH_S }; });

    // Each Stats window.
    const windows = phone ? [['pnl', 'swipe up'], ['trends', 'swipe up'], ['profiles', 'swipe up'], ['matchups', 'swipe up']]
      : [['overview', 'wheel notch down'], ['trends', 'click the Trends tile title'], ['profiles', 'wheel notch down'], ['matchups', 'wheel notch down']];
    let prev = null;
    for (const [target, gesture] of windows) {
      // A gesture that left the page on another window: the page is put back on the window this one starts from (by
      // script, as checks.mjs's goto), so each window's own gesture is measured; the step says so.
      let repositioned = false;
      if (prev && (await page.evaluate(() => window.__J.landed())) !== SCREEN[prev]) {
        await page.evaluate(id => { const e = document.getElementById(id); window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY, behavior: 'instant' }); }, SCREEN[prev]);
        await sleep(1500);
        repositioned = true;
      }
      prev = target;
      await step(`to-${target}`, gesture, async t0 => {
        await page.evaluate((name, t0) => { window.__J.pending = window.__J.wait(name, 10000, t0); }, target, t0);
        const g = phone ? await swipeUp() : gesture.startsWith('click') ? await tapAt('#race-panel-title') : await notch();
        const w = await page.evaluate(() => window.__J.pending);
        const seen = { end: await lastInput(phone ? ['touchend'] : ['wheel', 'click'], t0), start: await lastInput(phone ? ['touchstart'] : ['wheel', 'click'], t0) };
        await sleep(1500);
        // Where the gesture left the page: a swipe that carries past its window (or stops short) fails the step.
        const landed = await page.evaluate(() => window.__J.landed()), want = SCREEN[target];
        const r = { ...content(w, t0, g.end, g.start), pageSawEnd: seen.end == null ? null : Math.round(seen.end - g.end), landed, wanted: want };
        if (landed !== want) r.wrongWindow = true;
        if (repositioned) r.startedFromRepositioned = true;
        return { target, regions: { [target]: r }, ttc: r.fromEnd ?? null };
      });
    }

    // A model's drawer, from a model's name on Matchups, and the drawer's close button.
    await step('drawer-open', `${phone ? 'tap' : 'click'} a model's name in Matchups`, async t0 => {
      await page.evaluate(t0 => { window.__J.pending = window.__J.wait('drawer', 10000, t0); }, t0);
      const g = await tapAt('#pairwise a[href^="#model="], #pairwise-card a[href^="#model="], #pairwise-panel a[href^="#model="]');
      const w = await page.evaluate(() => window.__J.pending);
      const r = content(w, t0, g.end);
      return { regions: { drawer: r }, ttc: r.fromEnd ?? r.fromStep };
    });
    await step('drawer-close', `${phone ? 'tap' : 'click'} the drawer's Close`, async t0 => {
      await page.evaluate(t0 => { window.__J.pending = window.__J.wait('closed', 10000, t0); }, t0);
      const g = await tapAt('dialog[open] button[aria-label=Close]');
      const w = await page.evaluate(() => window.__J.pending);
      const r = content(w, t0, g.end);
      return { regions: { closed: r }, ttc: r.fromEnd ?? r.fromStep };
    });
    // Back to the table: the tab bar's Table tab on a phone; the desktop has no control for it from Matchups but keys
    // and wheels, so it is scrolled there (not a viewer's gesture: its numbers are reported, not judged).
    await step('back', phone ? 'tap the Table tab' : 'scroll to the top (scripted)', async t0 => {
      const g = phone ? await tapAt('nav[aria-label=Sections] button:first-child') : (await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })), { end: null });
      const w = await wait('table', 10000, t0);
      const r = content(w, t0, g.end);
      return { regions: { table: r }, ttc: r.fromEnd ?? r.fromStep };
    });
    // A phone's seat popup: a tap on a seat's logo.
    if (phone) await step('popup', "tap a seat's logo", async t0 => {
      await page.evaluate(t0 => { window.__J.pending = window.__J.wait('popup', 10000, t0); }, t0);
      const g = await tapAt('[data-oval] a[href^="#model="]');
      const w = await page.evaluate(() => window.__J.pending);
      const r = content(w, t0, g.end);
      await tapAt('[data-seat-stats] button[aria-label=Close]'); await sleep(1000); // closed again, for the next step
      return { regions: { popup: r }, ttc: r.fromEnd ?? r.fromStep };
    });
    // A stream update while a reason types: the seat to act thinks, then a long reason types at pace 1; once it types,
    // a game_state comes (as the engine sends one after each move) with the acting seat's stack planted at 77,777.
    await step('update-while-typing', null, async t0 => {
      const fed = await page.evaluate(reason => {
        const s = window.__J.stream; if (!s.last || !s.feed) return false;
        const l = s.last, i = Math.max(0, l.players.findIndex(q => q.status === 'active')), name = l.players[i].name;
        s.scripted = true;
        s.feed({ type: 'table_notice', payload: { kind: '', message: '' } });
        s.feed({ type: 'game_state', payload: { ...l, pace: 1, street: l.street === 'complete' ? 'flop' : l.street, winners: undefined, nextHandInMs: undefined, currentPlayerIdx: i } });
        s.feed({ type: 'llm_thinking', payload: { playerIdx: i, playerName: name, budgetMs: 45000, elapsedMs: 0 } });
        s.feed({ type: 'llm_action', payload: { playerIdx: i, playerName: name, action: 'CALL', amount: l.currentBet || 10, reason } });
        // The planted stack is the acting seat's (its stack changes as its move is applied; a folded seat is dimmed).
        window.__J.planted = { i, j: i };
        return true;
      }, LONG_REASON);
      if (!fed) return { error: 'no stream state to play from' };
      const typing = await wait('typing', 20000, t0);
      if (typing.at == null) return { error: 'the reason never typed' };
      await sleep(800);
      const tFeed = await page.evaluate(() => {
        const s = window.__J.stream, l = s.last, { i, j } = window.__J.planted;
        const players = l.players.map((p, k) => (k === j ? { ...p, stack: 77777 } : p));
        const t = performance.now();
        window.__J.pending = window.__J.wait('planted', 10000, t);
        s.feed({ type: 'game_state', payload: { ...l, players, pace: 1, street: l.street === 'complete' ? 'flop' : l.street, winners: undefined, nextHandInMs: undefined, currentPlayerIdx: i } });
        return t;
      });
      const w = await page.evaluate(() => window.__J.pending);
      const typingAfter = await page.evaluate(() => !!window.__J.preds.typing());
      await sleep(3000);
      const r = content(w, tFeed, tFeed);
      return { regions: { planted: r }, ttc: r.fromEnd, typingAt: Math.round(typing.at - t0), stillTypingAfterUpdate: typingAfter };
    });
    await cdp.send('Page.stopScreencast').catch(() => {});

    // Per step: long tasks, dropped frames, the stream's messages and their time to the felt, bytes.
    const J = await page.evaluate(() => ({ frames: window.__J.frames, longtasks: window.__J.longtasks, msgs: window.__J.msgs, felt: window.__J.felt, etCount: window.__J.et.length }));
    const bytesIn = (w0, w1) => {
      const done = new Set(finished.map(f => f.id));
      const fin = finished.filter(f => f.wall >= w0 && f.wall < w1), open = chunks.filter(c => !done.has(c.id) && c.wall >= w0 && c.wall < w1);
      const isStream = id => /\/stream(\?|$)/.test(reqs.get(id) ?? '');
      const sum = a => a.reduce((s, x) => s + x.n, 0);
      return { total: sum(fin) + sum(open), stream: sum(fin.filter(f => isStream(f.id))) + sum(open.filter(c => isStream(c.id))) };
    };
    for (const [k, s] of steps.entries()) {
      const end = k + 1 < steps.length ? steps[k + 1].t0 : s.t1; // a step's window runs to the next step's start
      const lt = J.longtasks.filter(t => t.t >= s.t0 && t.t < end);
      s.longTasks = lt.length; s.longTaskMs = Math.round(lt.reduce((a, t) => a + t.d, 0)); s.longestTaskMs = Math.round(Math.max(0, ...lt.map(t => t.d)));
      s.blockingMs = Math.round(lt.reduce((a, t) => a + Math.max(0, t.d - 50), 0));
      const fr = J.frames.filter(t => t >= s.t0 && t < end);
      let dropped = 0, worst = 0;
      for (let i = 1; i < fr.length; i++) { const dt = fr[i] - fr[i - 1]; worst = Math.max(worst, dt); dropped += Math.max(0, Math.round(dt / (1000 / 60)) - 1); }
      s.frames = fr.length; s.droppedFrames = dropped; s.worstFrameMs = Math.round(worst);
      const b = bytesIn(origin + s.t0 - (k === 0 ? 60000 : 0), origin + end);
      s.bytes = b.total; s.streamBytes = b.stream;
      // Stream messages in the step and the time from each to the next change on the felt and the frame after it.
      const ms = J.msgs.filter(m => m.t >= s.t0 && m.t < end);
      const lat = ms.filter(m => m.type === 'game_state').map(m => { const f = J.felt.find(t => t >= m.t); if (f == null || f - m.t > 2000) return null; const fr2 = J.frames.find(t => t >= f); return fr2 == null ? null : fr2 - m.t; }).filter(x => x != null).sort((a, b) => a - b);
      s.messages = ms.length;
      if (lat.length) s.updateToFrameMs = { n: lat.length, median: Math.round(lat[Math.floor(lat.length / 2)]), max: Math.round(lat.at(-1)) };
    }
    const m = await metrics();
    const all = bytesIn(0, Infinity);
    const total = { taskMs: Math.round(m.TaskDuration * 1000), scriptMs: Math.round(m.ScriptDuration * 1000), layoutMs: Math.round(m.LayoutDuration * 1000), styleMs: Math.round(m.RecalcStyleDuration * 1000),
      bytes: all.total, streamBytes: all.stream, nonStreamBytes: all.total - all.stream, longTasks: J.longtasks.length, blockingMs: Math.round(J.longtasks.reduce((a, t) => a + Math.max(0, t.d - 50), 0)),
      droppedFrames: steps.reduce((a, s) => a + s.droppedFrames, 0), elementTimingEntries: J.etCount, journeyS: Math.round(steps.at(-1).t1 / 100) / 10 };
    for (const s of steps) for (const k of ['t0', 't1', 'taskMs', 'scriptMs', 'layoutMs', 'styleMs']) s[k] = Math.round(s[k]);
    const result = { size, run, steps: steps.map(({ wall0, wall1, ...s }) => s), total };
    if (inventory) result.inventory = { serverHtml: await serverHtml(S.ua), states };
    if (films) result.filmFrames = { frames, steps: steps.map(s => ({ name: s.name, wall0: s.wall0, wall1: s.wall1 })) };
    return result;
  } finally { await browser.close().catch(() => {}); }
}

// The text a server sends (no script, style or tags), as a reader without JavaScript gets it.
async function serverHtml(ua) {
  const r = await fetch(BASE, { headers: { 'user-agent': ua } }), html = await r.text();
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  return { bytes: html.length, text };
}

// One state's inventory: the DOM's text, the accessibility tree, and each link and control with how it is reached from
// this state (on screen now; a scroll away; hidden; or inert, under aria-hidden or inert).
async function takeInventory(page) {
  const dom = await page.evaluate(() => {
    const SEL = 'a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=tab], [role=switch], [role=slider], [role=checkbox], [role=radio], [role=menuitem], [tabindex]:not([tabindex="-1"])';
    const controls = [...document.querySelectorAll(SEL)].map(e => {
      const b = e.getBoundingClientRect(), cs = getComputedStyle(e);
      const inert = !!e.closest('[inert], [aria-hidden=true]');
      const hidden = b.width === 0 || b.height === 0 || cs.visibility === 'hidden' || +cs.opacity === 0;
      const onScreen = !hidden && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth;
      const name = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || e.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      return { tag: e.tagName.toLowerCase(), role: e.getAttribute('role') ?? undefined, name, href: e.getAttribute('href') ?? undefined,
        reach: inert ? 'inert' : hidden ? 'hidden' : onScreen ? 'on screen' : 'scroll', box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] };
    });
    return { url: location.pathname + location.hash, scrollY: Math.round(scrollY), text: document.body.innerText, controls };
  });
  const ax = await page.accessibility.snapshot({ interestingOnly: true }).catch(() => null);
  const lines = [];
  const walk = (n, d) => { if (!n) return; lines.push(`${'  '.repeat(d)}${n.role}${n.name ? ` "${n.name.slice(0, 80)}"` : ''}${n.value != null ? ` = ${n.value}` : ''}`); for (const c of n.children ?? []) walk(c, d + 1); };
  walk(ax, 0);
  return { ...dom, accessibility: lines };
}

mkdirSync(OUT, { recursive: true });
const runs = [], inventories = {};
const t00 = Date.now();
for (const size of SIZES) {
  if (INVENTORY) {
    console.error(`${size}: inventory run`);
    const r = await journey(size, { run: 0, inventory: true, films: false });
    inventories[size] = r.inventory;
    writeFileSync(`${OUT}/inventory-${size}.json`, JSON.stringify(r.inventory, null, 1));
  }
}
// The measured runs, sizes interleaved (a drift in the machine or the table lands on both).
for (let run = 1; run <= RUNS; run++) for (const size of SIZES) {
  const films = FILMS === 'all' || (FILMS === 'first' && run === 1);
  let r;
  try { r = await journey(size, { run, inventory: false, films }); }
  catch (e) { r = { size, run, error: e.message.split('\n')[0] }; }
  if (r.filmFrames) {
    const dir = `${OUT}/films/${size}-run${run}`;
    r.films = await filmstrip(CHROME, r.filmFrames, dir, SIZE[size].viewport);
    delete r.filmFrames;
  }
  runs.push(r);
  console.error(`${size} run ${run}: ${r.error ?? r.steps.map(s => `${s.name} ${s.ttc ?? '-'}ms/${s.longTasks}lt/${s.droppedFrames}df`).join(', ')}; total ${r.total ? `${r.total.taskMs}ms main, ${Math.round(r.total.nonStreamBytes / 1024)} KB + stream ${Math.round(r.total.streamBytes / 1024)} KB` : ''} (${Math.round((Date.now() - t00) / 1000)} s)`);
  writeFileSync(`${OUT}/journey.json`, JSON.stringify({ base: BASE, cpu: CPU, network: NETWORK, sizes: SIZES, runs, summary: summarize(runs, SWIPE_TARGET_MS) }, null, 1));
}
const summary = summarize(runs, SWIPE_TARGET_MS);
writeFileSync(`${OUT}/journey.json`, JSON.stringify({ base: BASE, cpu: CPU, network: NETWORK, sizes: SIZES, runs, summary }, null, 1));
console.log(JSON.stringify(summary.swipe, null, 1));
