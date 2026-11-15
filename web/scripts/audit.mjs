// UI audit: Lighthouse scores, axe-core violations and labelled contact sheets of every state, viewport and browser zoom.
// Run (site on :3300 built against a live engine; DEV_CONTROLS-free): npm i --no-save axe-core && node scripts/audit.mjs --base http://localhost:3300 --out ../.cloud-out/audit [--only lighthouse,axe,shots] [--lanes 3]
// Needs Chrome (CHROME_PATH) and, for Lighthouse, npx (lighthouse@12 is fetched on demand). Output: <out>/lighthouse/*.json, axe.json, sheets/NN-*.png + INDEX.md, failures.json.
// A browser zoom z of a W x H window is a viewport of round(W/z) x round(H/z) CSS px at deviceScaleFactor z. The table's game stream is scripted (as checks.mjs does) so every state is reproducible.
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
const LAYOUT = readFileSync(new URL('../src/lib/layout.ts', import.meta.url), 'utf8');
const DESK_MIN_W = +LAYOUT.match(/DESK_MIN_W = (\d+)/)[1], SHORT_H = +LAYOUT.match(/SHORT_H = (\d+)/)[1];

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:3300'), OUT = arg('--out', '../.cloud-out/audit');
const ONLY = new Set(arg('--only', 'lighthouse,axe,shots').split(','));
const LANES = +arg('--lanes', 3), SHOTS = arg('--shots', '/tmp/auditshots');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
const fail = (what, e) => { failures.push({ what, error: String(e?.message ?? e).split('\n')[0] }); console.error('FAIL', what, String(e?.message ?? e).split('\n')[0]); };
for (const d of ['lighthouse', 'sheets']) mkdirSync(`${OUT}/${d}`, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

// ---------- (1) Lighthouse ----------
function lighthouse() {
  for (const [page, path] of [['home', '/'], ['about', '/about']]) for (const preset of ['mobile', 'desktop']) {
    const raw = `${SHOTS}/lh-${page}-${preset}.json`;
    try {
      execSync(`npx -y lighthouse@12 ${BASE}${path} ${preset === 'desktop' ? '--preset=desktop' : ''} --chrome-flags="--headless=new --no-sandbox" --output=json --output-path=${raw} --quiet`,
        { env: { ...process.env, CHROME_PATH: CHROME }, stdio: 'pipe', timeout: 300000 });
      const r = JSON.parse(readFileSync(raw, 'utf8'));
      const scores = Object.fromEntries(Object.entries(r.categories).map(([k, c]) => [k, c.score === null ? null : Math.round(c.score * 100)]));
      const audits = Object.values(r.audits).filter(a => typeof a.score === 'number' && a.score < 1).map(a => ({
        id: a.id, title: a.title, score: a.score, displayValue: a.displayValue, description: (a.description || '').split(' [')[0],
        items: (a.details?.items ?? []).slice(0, 3),
      }));
      writeFileSync(`${OUT}/lighthouse/${page}-${preset}.json`, JSON.stringify({ url: `${BASE}${path}`, preset, scores, audits }, null, 1));
      console.log('lighthouse', page, preset, JSON.stringify(scores));
    } catch (e) { fail(`lighthouse ${page} ${preset}`, e); }
  }
}

// ---------- states ----------
const PHONES = ['375x667', '390x844', '430x932', '844x390'], LAPTOPS = ['1440x900', '1512x982', '1728x1117'], ZOOMS = [67, 90, 125, 175, 200, 300, 500];
const AXE_AT = new Set(['390x844@100', '1440x900@100']);
const frames = []; // { file, family, group, vp, zoom, state, desc }
const axeRows = [];
let axeSrc = null;
if (ONLY.has('axe')) {
  try { axeSrc = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8'); } catch (e) { fail('axe-core not installed (npm i --no-save axe-core)', e); }
}

// Scripted stream (as checks.mjs scriptStream): the table's state is whatever this plays once the engine's first state is in.
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
  const play = (...msgs) => { s.scripted = true; for (const m of msgs) { if (m.type === 'game_state') s.last = m.payload; s.feed(m); } };
  const open = { type: 'table_notice', payload: { kind: '', message: '' } };
  const deck = [...'23456789TJQKA'].flatMap(r => [...'hdcs'].map(x => r + x)).filter(c => !['Kh', '7d', '2c', '9s', 'Ks'].includes(c));
  const hole = (q, i) => (q.holeCards?.length === 2 && q.holeCards[0] ? q.holeCards : [deck[2 * i], deck[2 * i + 1]]);
  // Mid-hand: flop out, bets in front of seats, seat 3 on the clock and thinking.
  s.mid = () => {
    const l = s.last, bet = [0, 5, 10, 35, 0, 10, 0, 0, 0];
    play(open, { type: 'game_state', payload: { ...l, street: 'flop', pot: 120, currentBet: 35, winners: undefined, nextHandInMs: undefined, currentPlayerIdx: 3, communityCards: ['Kh', '7d', '2c'],
      players: l.players.map((q, i) => ({ ...q, holeCards: hole(q, i), status: i === 5 || i === 7 ? 'folded' : 'active', currentBet: bet[i] ?? 0, lastAction: i === 3 ? 'RAISE' : i === 5 ? 'FOLD' : '', lastAmount: i === 3 ? 35 : 0 })) } },
    { type: 'llm_thinking', payload: { playerIdx: 3, playerName: l.players[3].name, budgetMs: 45000, elapsedMs: 9000 } });
  };
  // Showdown: the board complete, every seat's cards face up, a winner paid.
  s.show = (ms, bump) => {
    const l = s.last;
    play(open, { type: 'game_state', payload: { ...l, handNumber: l.handNumber + (bump ? 1 : 0), street: 'complete', nextHandInMs: ms, currentPlayerIdx: -1, communityCards: ['Kh', '7d', '2c', '9s', 'Ks'], pot: l.pot || 120,
      players: l.players.map((q, i) => ({ ...q, holeCards: hole(q, i), status: 'active', currentBet: 0, stack: i === 0 ? q.stack + (l.pot || 120) : q.stack })),
      winners: [{ playerIdx: 0, amount: l.pot || 120, handType: 'Pair', handDesc: 'Pair of Kings', eligiblePlayers: l.players.map((_, i) => i), potNumber: 1 }] } });
  };
  // The next hand dealt: button moves, two cards each, blinds posted.
  s.deal = () => {
    const l = s.last, n = l.players.length, btn = (l.players.findIndex(q => q.isButton) + 1) % n;
    const blind = i => (i === (btn + 1) % n ? 5 : i === (btn + 2) % n ? 10 : 0);
    play({ type: 'hand_start', payload: { handNumber: l.handNumber + 1 } }, { type: 'game_state', payload: { ...l, handNumber: l.handNumber + 1, street: 'preflop', pot: 15, currentBet: 10, communityCards: [], winners: undefined, nextHandInMs: undefined, currentPlayerIdx: (btn + 3) % n,
      players: l.players.map((q, i) => ({ ...q, isButton: i === btn, holeCards: [deck[2 * i], deck[2 * i + 1]], status: 'active', lastAction: '', lastAmount: 0, currentBet: blind(i), stack: q.stack - blind(i) })) } });
  };
});

const goto = (p, id) => p.evaluate(id => { const el = document.getElementById(id); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: 'instant' }); return !!el; }, id);
const clickBtn = (p, re) => p.evaluate(src => { const rx = new RegExp(src, 'i'); const b = [...document.querySelectorAll('button, a')].find(e => rx.test(e.textContent.trim()) && e.getBoundingClientRect().width > 0); b?.click(); return !!b; }, re.source);
const clickAt = async (p, sel, dy) => { const c = await p.evaluate((s, dy) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + (dy ?? r.height / 2)]; }, sel, dy); if (!c) throw new Error(`no ${sel}`); await p.mouse.click(c[0], c[1]); };

async function newBrowser() { return puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--mute-audio', '--no-sandbox'] }); }

// One page at a viewport/zoom, walked through its states. `steps` is [{group, state, desc, run}].
async function walk(browser, { family, vp, zoom }) {
  const [W, H] = vp.split('x').map(Number), z = zoom / 100;
  const phone = Math.round(W / z) < DESK_MIN_W || Math.round(H / z) <= SHORT_H, key = `${vp}@${zoom}`; // the phone layout, as lib/layout.ts has it
  const ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  let n = 0;
  const snap = async (group, state, desc) => {
    const file = `${SHOTS}/${family}-${key}-${String(++n).padStart(2, '0')}-${state.replace(/\W+/g, '_')}.jpg`;
    try {
      await p.screenshot({ path: file, type: 'jpeg', quality: 80 });
      frames.push({ file, family, group, vp, zoom, state, desc });
    } catch (e) { fail(`shot ${key} ${state}`, e); }
    if (axeSrc && ONLY.has('axe') && zoom === 100 && AXE_AT.has(key)) {
      try {
        await p.evaluate(axeSrc);
        const r = await p.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
        for (const v of r.violations) axeRows.push({ state, viewport: vp, violation: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map(x => x.target.join(' ')) });
        if (!r.violations.length) axeRows.push({ state, viewport: vp, violation: null });
      } catch (e) { fail(`axe ${key} ${state}`, e); }
    }
  };
  const step = async (group, state, desc, fn, wait = 900) => {
    try { await fn(); await sleep(wait); } catch (e) { fail(`${key} ${state}`, e); await p.keyboard.press('Escape').catch(() => {}); }
    if (ONLY.has('shots') || ONLY.has('axe')) await snap(group, state, desc);
  };
  const reload = async (hash = '') => {
    await p.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction(() => window.__stream?.last?.players?.length && document.querySelector('[data-seat], td.w-\\[200px\\]'), { timeout: 120000 });
    await p.waitForFunction(() => document.querySelector('#pairwise-card td[data-cell]') && document.querySelector('#stats-panel tbody tr') && document.querySelector('#race-panel svg'), { timeout: 90000 }).catch(() => {});
    await sleep(2500);
  };
  try {
    if (family === 'phones') await p.emulate({ viewport: { width: W, height: H, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, userAgent: await browser.userAgent() });
    else await p.setViewport({ width: Math.round(W / z), height: Math.round(H / z), deviceScaleFactor: z });
    await scriptStream(p);
    await reload();
    const fullFamily = family === 'zoom';
    // --- table ---
    if (!fullFamily) {
      // A new hand number restarts the deal animation (~3 s); the deck then riffles at (countdown - 1 - 0.9) s, squares, and is put away 3 s on (TableMotion).
      await step('table', 'table-shuffle', 'Between hands: the deck riffling on the felt', async () => { await p.evaluate(() => window.__stream.show(8000, true)); await p.waitForSelector('[data-deck="riffle"]', { timeout: 15000 }); }, 120);
      await step('table', 'table-deck-ready', 'Between hands: the deck squared, waiting for the deal', async () => { await p.waitForSelector('[data-deck="ready"]', { timeout: 5000 }); }, 150);
      await step('table', 'table-deal', 'The next hand being dealt', async () => { await p.evaluate(() => window.__stream.deal()); }, 700);
    }
    await step('table', 'table-mid-hand', 'Flop dealt, chips out, a seat thinking', () => p.evaluate(() => window.__stream.mid()), 2500);
    await step('table', 'table-showdown', 'Hand over, every seat face up, winner paid', () => p.evaluate(() => window.__stream.show(30000)), 2500);
    if (phone) {
      await step('modals', 'phone-seat-stats', 'Phone seat stats popup', async () => { await p.evaluate(() => window.__stream.mid()); await sleep(800); await clickAt(p, '[data-seat] a'); }, 1200);
      await p.keyboard.press('Escape'); await p.mouse.click(2, 2).catch(() => {}); await sleep(500);
    }
    // --- stats ---
    if (phone) {
      for (const [id, name, what] of [['phone-stats', 'stats-profits-losses', 'Profits & Losses'], ['race', 'stats-trends', 'Trends'], ['stats-table', 'stats-profiles', 'Profiles'], ['pairwise', 'stats-matchups', 'Matchups']])
        await step('stats', name, `Phone Stats window: ${what}`, () => goto(p, id), 1500);
      await step('modals', 'trends-filter-sheet', 'Trends filter sheet (phone)', async () => { await goto(p, 'race'); await sleep(800); if (!await clickBtn(p, /^Filters/)) throw new Error('no Filters button'); }, 1200);
      await p.keyboard.press('Escape'); await sleep(500);
    } else {
      await step('stats', 'stats-overview', 'Stats overview tiles', () => goto(p, 'stats'), 1800);
      for (const [sel, name, what] of [['#race-panel', 'card-trends', 'Trends'], ['#stats-panel', 'card-profiles', 'Profiles'], ['#pairwise-panel', 'card-matchups-all-models', 'Matchups with All models on']]) {
        await step('stats', name, `Opened card: ${what}`, async () => {
          await goto(p, 'stats'); await sleep(1200); await clickAt(p, sel, 40); await sleep(1800);
          if (name.includes('matchups')) { const c = await p.evaluate(() => { const b = [...document.querySelectorAll('#pairwise-panel button, #pairwise-card button')].find(b => b.textContent.trim() === 'All models' && b.getBoundingClientRect().width > 0 && b.contains(document.elementFromPoint(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2, b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2))); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); if (!c) throw new Error('no All models button'); await p.mouse.click(c[0], c[1]); await sleep(1500); }
        }, 1200);
        await p.keyboard.press('Escape'); await sleep(1200);
      }
    }
    // --- about ---
    await step('about', 'about-default', 'About, default layout', () => goto(p, 'about'), 1500);
    if (phone) {
      await step('modals', 'about-dial', 'About dial turned to a later topic (phone)', async () => { await p.evaluate(() => document.querySelector('[data-dial]')?.focus()); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); }, 1200);
    }
    // --- modals ---
    for (const [re, name, what] of [[/system prompt/, 'dialog-system-prompt', 'System prompt dialog'], [/user prompt/, 'dialog-user-prompt', 'User prompt dialog']]) {
      await step('modals', name, what, async () => { await goto(p, 'about'); await sleep(600); if (!await clickBtn(p, new RegExp(`Read the ${re.source}`))) throw new Error('no prompt button'); }, 1200);
      await p.keyboard.press('Escape'); await sleep(500);
    }
    if (!fullFamily || zoom === 100) {
      await step('modals', 'model-drawer', 'Model drawer', async () => {
        const slug = await p.evaluate(() => window.__stream.last.players[1].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
        await p.evaluate(s => { location.hash = `model=${s}`; }, slug);
      }, 1800);
    }
  } catch (e) { fail(`walk ${key}`, e); }
  await ctx.close().catch(() => {});
}

// ---------- /about page ----------
async function aboutPage(browser, vp, family) {
  const [W, H] = vp.split('x').map(Number), ctx = await browser.createBrowserContext(), p = await ctx.newPage();
  try {
    if (family === 'phones') await p.emulate({ viewport: { width: W, height: H, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, userAgent: await browser.userAgent() });
    else await p.setViewport({ width: W, height: H });
    await p.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await sleep(3000);
    const file = `${SHOTS}/${family}-${vp}@100-aboutpage.jpg`;
    await p.screenshot({ path: file, type: 'jpeg', quality: 80 });
    frames.push({ file, family, group: 'about', vp, zoom: 100, state: 'about-page', desc: '/about page' });
    if (axeSrc && AXE_AT.has(`${vp}@100`)) {
      await p.evaluate(axeSrc);
      const r = await p.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
      for (const v of r.violations) axeRows.push({ state: 'about-page', viewport: vp, violation: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map(x => x.target.join(' ')) });
      if (!r.violations.length) axeRows.push({ state: 'about-page', viewport: vp, violation: null });
    }
  } catch (e) { fail(`about page ${vp}`, e); }
  await ctx.close().catch(() => {});
}

// ---------- contact sheets ----------
const SHEET_W = 1600, SHEET_H = 2400, GAP = 8, LABEL = 28;
async function sheets(browser) {
  const order = ['table', 'stats', 'about', 'modals'];
  const sizeOf = f => f.vp.split('x').map(Number);
  const out = [];
  let nn = 0;
  for (const family of ['phones', 'laptops', 'zoom']) for (const group of order) {
    const fs = frames.filter(f => f.family === family && f.group === group);
    if (!fs.length) continue;
    // Frames grouped by state then viewport/zoom, so neighbours compare like with like.
    fs.sort((a, b) => a.state.localeCompare(b.state) || a.vp.localeCompare(b.vp, undefined, { numeric: true }) || a.zoom - b.zoom);
    const portrait = family === 'phones';
    const cols = portrait ? 4 : 3, fw = Math.floor((SHEET_W - GAP * (cols + 1)) / cols);
    const imgH = f => { const [w, hh] = sizeOf(f); return Math.round(fw * (family === 'zoom' ? 900 / 1440 : hh / w)) + LABEL; };
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const name = `${String(++nn).padStart(2, '0')}-${family}-${group}`;
      const html = `<body style="margin:0;background:#888;font:600 15px system-ui"><div style="display:grid;grid-template-columns:repeat(${cols},${fw}px);gap:${GAP}px;padding:${GAP}px;width:${SHEET_W - 2 * GAP}px;align-items:start">${batch.map(f => {
        const [w, hh] = sizeOf(f), ih = imgH(f) - LABEL;
        const img = `data:image/jpeg;base64,${readFileSync(f.file).toString('base64')}`;
        return `<div style="width:${fw}px;background:#fff"><div style="height:${LABEL}px;line-height:${LABEL}px;padding:0 6px;background:#111;color:#fff;white-space:nowrap;overflow:hidden">${f.vp} · ${f.zoom}% · ${f.state}</div><img src="${img}" style="display:block;width:${fw}px;height:${ih}px"></div>`;
      }).join('')}</div></body>`;
      const pg = await browser.newPage(); await pg.setViewport({ width: SHEET_W, height: 400 });
      await pg.setContent(html, { waitUntil: 'load' });
      const hh = await pg.evaluate(() => document.body.scrollHeight);
      await pg.screenshot({ path: `${OUT}/sheets/${name}.png`, clip: { x: 0, y: 0, width: SHEET_W, height: Math.min(hh, SHEET_H) } });
      await pg.close();
      out.push({ name, family, group, frames: batch.map(f => ({ vp: f.vp, zoom: f.zoom, state: f.state, desc: f.desc })), height: hh });
      if (hh > SHEET_H) fail(`sheet ${name} taller than ${SHEET_H}`, `${hh}px`);
      batch = [];
    };
    // Whole rows of `cols` frames; a row is as tall as its tallest frame; a sheet takes rows while it stays within SHEET_H.
    for (let i = 0; i < fs.length; i += cols) {
      const row = fs.slice(i, i + cols), rh = Math.max(...row.map(imgH));
      const rows = []; for (let k = 0; k < batch.length; k += cols) rows.push(Math.max(...batch.slice(k, k + cols).map(imgH)));
      const total = GAP + rows.reduce((t, x) => t + x + GAP, 0) + rh + GAP;
      if (batch.length && total > SHEET_H) await flush();
      batch.push(...row);
    }
    await flush();
  }
  const md = ['# Audit contact sheets', '', 'Each frame is labelled `viewport · zoom · state` in the image. Zoom frames are a 1440x900 window at that browser zoom.', ''];
  for (const s of out) {
    md.push(`## ${s.name}.png (${s.family}, ${s.group})`, '', '| viewport | zoom | state | shows |', '|---|---|---|---|');
    for (const f of s.frames) md.push(`| ${f.vp} | ${f.zoom}% | ${f.state} | ${f.desc} |`);
    md.push('');
  }
  writeFileSync(`${OUT}/sheets/INDEX.md`, md.join('\n'));
}

// ---------- main ----------
if (ONLY.has('lighthouse')) lighthouse();
if (ONLY.has('axe') || ONLY.has('shots')) {
  for (const f of readdirSync(`${OUT}/sheets`)) rmSync(`${OUT}/sheets/${f}`);
  const browser = await newBrowser();
  const jobs = [];
  for (const vp of PHONES) jobs.push({ family: 'phones', vp, zoom: 100 });
  for (const vp of LAPTOPS) jobs.push({ family: 'laptops', vp, zoom: 100 });
  for (const zoom of ZOOMS) jobs.push({ family: 'zoom', vp: '1440x900', zoom });
  await Promise.all(Array.from({ length: LANES }, async () => { while (jobs.length) { const j = jobs.shift(); console.log('walk', j.family, j.vp, j.zoom); await walk(browser, j); } }));
  for (const [vp, family] of [['390x844', 'phones'], ['1440x900', 'laptops']]) await aboutPage(browser, vp, family);
  if (ONLY.has('axe')) writeFileSync(`${OUT}/axe.json`, JSON.stringify(axeRows, null, 1));
  if (ONLY.has('shots')) await sheets(browser);
  await browser.close();
}
writeFileSync(`${OUT}/failures.json`, JSON.stringify(failures, null, 1));
console.log(`done: ${frames.length} frames, ${axeRows.length} axe rows, ${failures.length} failures`);
process.exit(0);
