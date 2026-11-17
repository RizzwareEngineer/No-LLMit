// The loop's gate (LOOP-DESIGN.md step 3): one script, one JSON verdict, run fresh and never by the builder.
//
//   node scripts/gate.mjs --base <sha> --cand <sha> [--api http://localhost:8080] [--only id,id | --all] [--lanes 2] [--out verdict.json]
//   node scripts/gate.mjs --corpus [--base <sha>] [--out corpus.json]   every known-bad entry must fail, and base against base must pass
//   node scripts/gate.mjs --freeze-red [--base <sha>]                    runs the whole UI suite on the base and writes gate-corpus/red-list.json
//
// In a fresh worktree of each SHA (under --work, default the OS temp dir) it:
//  pins    restores every pinned path (the checks, the harness, the corpus and red list, the unit tests, the lint and type
//          settings, the runner scripts, the mock model and any fixture) from the base and proves each file's blob hash
//          equals the base's; this script must itself be the base's copy (--dev-gate waives that, and marks the verdict);
//  path    fails a candidate whose diff touches a pinned path at all (the restore still runs, so the other gates judge
//          the candidate's code under the base's checks);
//  ua      fails a candidate that adds a read of the user agent, navigator.webdriver, the checks' harness globals or
//          device hints (counted per pattern over web/src and engine, test files aside: a move keeps the count), and, at
//          run time, one that loads other scripts or other elements under a Lighthouse or a headless user agent than
//          under a phone's (beyond what two loads under the phone's own agent differ by);
//  g1      tsc --noEmit, eslint src --quiet and the unit tests (src/lib/*.test.mjs), on the candidate;
//  g2      the UI checks (checks.mjs, the base's) on both builds against one engine, in one environment that this script
//          sets (no WITHIN_MS or other knob from the caller): a check green on the base and red on the candidate fails;
//          a check red on the base is judged by its measured detail against the frozen red list (or, if it is not on
//          it, against this run's base): it fails only if the detail gets worse (judgeDetail). Every red result is run
//          once more on both arms, under the same lanes, and fails only if the candidate fails more often than the base;
//  lcp     the phone's LCP at 4x CPU: the element that is the base's LCP must become visible (in view, effective
//          opacity >= 0.99) no later on the candidate (margin max(300 ms, 20%)), and a candidate whose LCP is another
//          element fails unless that real content shows sooner (the opacity trick: hide the LCP element, the score rises);
//  g5      axe (axe-core, pinned) on the home page and /about at 390x844 and 1440x900: no rule with more nodes; Lighthouse
//          (pinned) accessibility and SEO on the home page and /about: no lower score.
// The verdict: { pass, status: pass|fail|incomplete, reasons[], gates: {...}, base, cand, pinHash, gateHash, ... }.
// A candidate that changes engine/ is "incomplete": its engine needs the fixture (design step 2) to run beside the base's.
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes(k);
const SELF = fileURLToPath(import.meta.url);
const REPO = resolve(arg('--repo', join(dirname(SELF), '../..')));
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const API = arg('--api', 'http://localhost:8080');
const LANES = +arg('--lanes', 2);
const PORT = +arg('--port', 3401); // the base's server; the candidate's is the next port
const WORK = resolve(arg('--work', join(tmpdir(), `gate-${process.pid}`)));
const CORPUS_DIR = join(dirname(SELF), 'gate-corpus');
const LIGHTHOUSE = 'lighthouse@12.8.2', AXE = 'axe-core@4.10.2';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.error(`[gate ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const git = (cmd, cwd = REPO) => sh(`git ${cmd}`, { cwd }).trim();
// The one environment every child runs in: nothing from the caller but the path, home and Chrome.
const ENV = { PATH: process.env.PATH, HOME: process.env.HOME, CHROME_PATH: CHROME, NEXT_TELEMETRY_DISABLED: '1', ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY ?? '', NO_PROXY: process.env.NO_PROXY ?? 'localhost,127.0.0.1', NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS ?? '' } : {}) };

// ---------- the pinned paths ----------
// Everything that judges, or sets up what is judged. A candidate may not touch these; they come from the base.
export const PINNED = [
  'web/scripts/**', // checks.mjs, audit.mjs, this gate, the corpus and the red list, the trace and film tools
  'web/src/**/*.test.mjs', 'web/src/**/*.test.ts', // the unit tests
  'web/package.json', 'web/package-lock.json', // the runner's packages (puppeteer-core, eslint, typescript)
  'web/eslint.config.mjs', 'web/tsconfig.json', // G1's settings
  'scripts/**', // verify.sh, dev.sh, smoke.sh, stop-server.sh
  'llm/**', // the mock model the fixture runs on
  'fixtures/**', 'web/fixtures/**', '**/testdata/**', // the fixture (design step 2), wherever it lands
  '.github/**', // CI runners
  '.cloud-out/RUN-RULES.md', '.cloud-out/LOOP-DESIGN.md',
];
const globRe = g => new RegExp('^' + g.split('**').map(p => p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$');
const PIN_RE = PINNED.map(globRe);
const pinned = f => PIN_RE.some(r => r.test(f));

// ---------- the user-agent rule's patterns ----------
export const UA_PATTERNS = {
  userAgent: /navigator\s*\.\s*userAgent|userAgentData|\bUser-Agent\b|\.UserAgent\(\)|Sec-CH-UA/i,
  webdriver: /\bwebdriver\b/i,
  auditNames: /Lighthouse|HeadlessChrome|PageSpeed|Speed Insights|puppeteer|playwright|Chrome-Lighthouse/i,
  harnessGlobals: /__replaySpeed|__stream\b|__noIdle|__shown|__gate|__peel/,
  deviceHints: /deviceMemory|hardwareConcurrency|effectiveType|saveData|prefers-reduced-data/,
};
const uaCounts = root => {
  const files = sh(`git ls-files -co --exclude-standard -- web/src web/next.config.ts web/public engine`, { cwd: root }).split('\n')
    .filter(f => f && /\.(m?[jt]sx?|go|html)$/.test(f) && !/\.test\.|_test\.go$/.test(f));
  const counts = Object.fromEntries(Object.keys(UA_PATTERNS).map(k => [k, 0])), where = {};
  for (const f of files) {
    if (!existsSync(join(root, f))) continue;
    const lines = readFileSync(join(root, f), 'utf8').split('\n');
    lines.forEach((l, i) => { for (const [k, re] of Object.entries(UA_PATTERNS)) if (re.test(l)) { counts[k]++; (where[k] ??= []).push(`${f}:${i + 1}`); } });
  }
  return { counts, where };
};

// ---------- worktrees and builds ----------
function worktree(name, sha) {
  const dir = join(WORK, name);
  if (existsSync(dir)) { try { git(`worktree remove --force ${dir}`); } catch { rmSync(dir, { recursive: true, force: true }); } }
  git(`worktree add --detach ${dir} ${sha}`);
  return dir;
}
const dropWorktree = dir => { try { git(`worktree remove --force ${dir}`); } catch { /* gone */ } };
// node_modules: a hard-linked copy of the repo's install when its lock file is the base's (pinned, so the candidate's
// is the base's too), else a fresh npm ci.
function modules(dir, baseSha) {
  const want = git(`rev-parse ${baseSha}:web/package-lock.json`), have = git('hash-object web/package-lock.json');
  const src = join(REPO, 'web/node_modules'), dst = join(dir, 'web/node_modules');
  if (existsSync(dst)) return;
  if (want === have && existsSync(src)) sh(`cp -al ${src} ${dst}`);
  else sh('npm ci --no-audit --no-fund', { cwd: join(dir, 'web'), env: ENV, timeout: 600000 });
}
function build(dir) {
  const t0 = Date.now();
  sh('npx next build', { cwd: join(dir, 'web'), env: { ...ENV, NEXT_PUBLIC_API_URL: API }, timeout: 600000 });
  return Date.now() - t0;
}
const servers = [];
async function serve(dir, port) {
  // A server left on the port (next start's child is "next-server", which no command-line match finds) would be judged
  // in this build's place: free the port, and refuse to go on while anything still answers there.
  try { sh(`fuser -k ${port}/tcp`); } catch { /* none */ }
  await sleep(500);
  if (await fetch(`http://localhost:${port}/`).then(() => true, () => false)) throw new Error(`port ${port} is still taken`);
  const p = spawn('npx', ['next', 'start', '-p', String(port)], { cwd: join(dir, 'web'), env: ENV, stdio: 'ignore', detached: true });
  servers.push(p);
  for (let i = 0; i < 120; i++) { try { const r = await fetch(`http://localhost:${port}/`); if (r.ok) return `http://localhost:${port}`; } catch { /* starting */ } await sleep(500); }
  throw new Error(`next start on :${port} never answered`);
}
const stopServers = () => { for (const p of servers.splice(0)) { try { process.kill(-p.pid); } catch { /* gone */ } } };

// ---------- pins: the path rule and the restore by hash ----------
function pins(base, cand, dir) {
  const changed = git(`diff --name-only ${base} ${cand}`).split('\n').filter(Boolean);
  const touched = changed.filter(pinned);
  const baseFiles = new Map(git(`ls-tree -r ${base}`).split('\n').filter(Boolean).map(l => { const [meta, f] = l.split('\t'); return [f, meta.split(' ')[2]]; }).filter(([f]) => pinned(f)));
  for (const f of touched) {
    if (baseFiles.has(f)) git(`checkout ${base} -- "${f}"`, dir);
    else rmSync(join(dir, f), { force: true });
  }
  const bad = [];
  for (const [f, blob] of baseFiles) { const p = join(dir, f); if (!existsSync(p)) bad.push(`${f}: missing`); else if (git(`hash-object "${p}"`, dir) !== blob) bad.push(`${f}: hash differs`); }
  const extra = git('ls-files', dir).split('\n').filter(f => f && pinned(f) && !baseFiles.has(f) && existsSync(join(dir, f)));
  bad.push(...extra.map(f => `${f}: not in the base`));
  const pinHash = createHash('sha256').update([...baseFiles].sort().map(([f, b]) => `${f} ${b}`).join('\n')).digest('hex').slice(0, 16);
  return {
    path: { pass: !touched.length, touched },
    pins: { pass: !bad.length, restored: touched.length, files: baseFiles.size, pinHash, bad },
    engineChanged: changed.some(f => f.startsWith('engine/') && !pinned(f)),
    changed,
  };
}

// ---------- G1 ----------
function g1(dir) {
  const run = (name, cmd) => {
    const t0 = Date.now();
    try { sh(cmd, { cwd: join(dir, 'web'), env: ENV, timeout: 600000 }); return { name, pass: true, ms: Date.now() - t0 }; }
    catch (e) { return { name, pass: false, ms: Date.now() - t0, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.split('\n').filter(Boolean).slice(-15).join('\n') }; }
  };
  const steps = [run('tsc', 'npx tsc --noEmit'), run('eslint', 'npx eslint src --quiet'), run('unit', 'node --experimental-strip-types --test src/lib/*.test.mjs')];
  return { pass: steps.every(s => s.pass), steps };
}

// ---------- G2: the UI checks ----------
const LINE = /^(PASS|FAIL)  (\S+)\s+([\d.]+)s  (.*)$/;
function parseChecks(out) {
  const at = out.lastIndexOf('\nall checks, in order:\n');
  const rows = {};
  for (const l of (at >= 0 ? out.slice(at) : out).split('\n')) {
    const m = l.match(LINE); if (!m) continue;
    const k = m[4].lastIndexOf('   (');
    rows[m[2]] = { pass: m[1] === 'PASS', s: +m[3], detail: k >= 0 ? m[4].slice(0, k) : m[4] };
  }
  return rows;
}
function runChecks(dir, url, ids) {
  const t0 = Date.now();
  const cmd = `node scripts/checks.mjs --base ${url} --lanes ${LANES}${ids ? ` --only ${ids.join(',')}` : ''}`;
  let out;
  try { out = sh(cmd, { cwd: join(dir, 'web'), env: ENV, timeout: 3 * 3600000 }); }
  catch (e) { out = `${e.stdout ?? ''}`; if (!out.includes('checks passed')) log('checks.mjs ended early:', `${e.stderr ?? ''}`.split('\n').slice(-3).join(' | ')); }
  const rows = parseChecks(out);
  if (ids) for (const id of ids) rows[id] ??= { pass: false, s: 0, detail: 'no result (the run ended before it)' };
  return { rows, ms: Date.now() - t0 };
}
// A red check's detail, judged against the frozen one. The detail lists offenders, "; " apart. An offender's key is its
// text with the numbers taken out; its figures are the numbers. Worse: an offender whose key the frozen detail lacks, more
// offenders, or a figure of a matched offender that moved the bad way by more than 15% and 2 units. The bad way is up
// unless the red list says `better: "higher"` for that check (most figures are px off, ms late or counts).
const NUM = /-?\d[\d,]*(?:\.\d+)?/g;
const offenders = d => (d || '').split(/;\s+/).map(s => s.trim()).filter(Boolean).map(s => ({ s, key: s.replace(NUM, '#'), nums: (s.match(NUM) || []).map(n => +n.replace(/,/g, '')) }));
// `frozen` may be a list of details (the red list's and every base run's): the candidate is worse only if it is worse than
// all of them, so a red check's own spread on the base is never read as the candidate's doing. Figures count only where
// the red list gives the check a direction (`better`); without one, a red check fails on new or more offenders alone.
export function judgeDetail(frozen, now, better = null) {
  const seen = [].concat(frozen).filter(x => typeof x === 'string').map(offenders), b = offenders(now), why = [];
  if (!seen.length) return { worse: false, why: ['nothing to judge against'] };
  const keys = new Set(seen.flat().map(x => x.key)), most = Math.max(...seen.map(a => a.length));
  if (b.length > most) why.push(`${b.length} offenders, the base at most ${most}`);
  for (const o of b) {
    if (!keys.has(o.key)) { why.push(`new: ${o.s.slice(0, 160)}`); continue; }
    if (!better) continue;
    o.nums.forEach((n, i) => {
      const fs = seen.flat().filter(x => x.key === o.key).map(x => x.nums[i]).filter(f => f !== undefined);
      if (!fs.length) return;
      const f = better === 'higher' ? Math.min(...fs) : Math.max(...fs), tol = Math.abs(f) * 0.15 + 2;
      if (better === 'higher' ? n < f - tol : n > f + tol) why.push(`${o.s.slice(0, 120)}: ${n} against ${f}`);
    });
  }
  return { worse: why.length > 0, why };
}
const readRed = () => { try { return JSON.parse(readFileSync(join(CORPUS_DIR, 'red-list.json'), 'utf8')); } catch { return null; } };
function judgeG2(base, cand, red) {
  const fails = [], notes = [];
  for (const [id, c] of Object.entries(cand.rows)) {
    const b = base.rows[id];
    if (c.pass) continue;
    if (!b) { fails.push({ id, why: 'no base result', detail: c.detail }); continue; }
    if (b.pass) { fails.push({ id, why: 'green on the base, red on the candidate', detail: c.detail }); continue; }
    const r = red?.entries?.find(e => e.id === id);
    const j = judgeDetail([r?.detail, b.detail], c.detail, r?.better);
    (j.worse ? fails : notes).push({ id, why: `red on the base (${r ? 'frozen' : 'not on the red list: judged against this run\'s base'})${j.worse ? ': worse' : ': no worse'}`, detail: c.detail, against: r ? r.detail : b.detail, worse: j.why });
  }
  return { fails, notes };
}

// ---------- browsers ----------
let puppeteer;
const browser = async (extra = []) => {
  puppeteer ??= (await import(createRequire(join(REPO, 'web/package.json')).resolve('puppeteer-core'))).default;
  return puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--mute-audio', ...extra] });
};
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const DESK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const LH_UA = 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse';
const hideWebdriver = p => p.evaluateOnNewDocument(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });

// ---------- the user-agent rule at run time ----------
async function uaRuntime(url) { // one build's differences under an audit's agent
  const b = await browser(['--disable-blink-features=AutomationControlled']);
  const load = async (ua, phone, webdriver) => {
    const p = await b.newPage();
    try {
      if (!webdriver) await hideWebdriver(p);
      await p.setViewport(phone ? { width: 412, height: 823, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1350, height: 940 });
      if (ua) await p.setUserAgent(ua);
      const scripts = new Set();
      p.on('request', r => { if (r.resourceType() === 'script') scripts.add(r.url().replace(/^https?:\/\/[^/]+/, '')); });
      await p.goto(url, { waitUntil: 'load', timeout: 120000 });
      await sleep(6000);
      const dom = await p.evaluate(() => [...new Set([...document.querySelectorAll('*')].flatMap(e => [e.id ? `#${e.id}` : null, ...e.getAttributeNames().filter(a => a.startsWith('data-')).map(a => `[${a}]`)]).filter(Boolean))]);
      return new Set([...[...scripts].map(s => `script ${s}`), ...dom.map(d => `dom ${d}`)]);
    } finally { await p.close(); }
  };
  const diff = (a, b) => [...a].filter(x => !b.has(x)).map(x => `-${x}`).concat([...b].filter(x => !a.has(x)).map(x => `+${x}`));
  const out = {};
  try {
    for (const phone of [true, false]) {
      // Three loads under the phone's (or a laptop's) own agent set the noise: whatever differs among them. A difference
      // under an audit's agent counts only if both of its loads show it.
      const ua = phone ? PHONE_UA : DESK_UA, n = [await load(ua, phone, false), await load(ua, phone, false)];
      const noise = new Set(diff(n[0], n[1]).map(x => x.slice(1)));
      const off = x => !noise.has(x.slice(1));
      const both = async (u, wd) => { const a = diff(n[0], await load(u, phone, wd)).filter(off), b = new Set(diff(n[0], await load(u, phone, wd))); return a.filter(x => b.has(x)).slice(0, 20); };
      out[phone ? 'phone' : 'desktop'] = { lighthouse: await both(phone ? LH_UA : `${DESK_UA} Chrome-Lighthouse`, false), headless: await both(null, true), noise: noise.size };
    }
  } finally { await b.close(); }
  return out;
}
// The framework already serves an audit's agent differently (Next.js treats Chrome-Lighthouse as a bot that gets its
// metadata in the HTML, and loads two chunks fewer at the laptop size). So the candidate fails only on a difference under
// an audit's agent that the base's build does not show too.
async function uaGate(baseUrl, candUrl) {
  const b = await uaRuntime(baseUrl), c = await uaRuntime(candUrl), extra = {};
  for (const size of ['phone', 'desktop']) for (const who of ['lighthouse', 'headless']) {
    const more = c[size][who].filter(x => !b[size][who].includes(x));
    if (more.length) extra[`${size} ${who}`] = more;
  }
  return { pass: !Object.keys(extra).length, extra, base: b, cand: c };
}

// ---------- LCP: real content no later, and no moved LCP element without it ----------
const LCP_WATCH = sel => {
  const path = e => { const parts = []; for (; e && e !== document.body && e.nodeType === 1; e = e.parentElement) parts.unshift(e.tagName.toLowerCase() + (e.id ? `#${CSS.escape(e.id)}` : '') + e.getAttributeNames().filter(a => a.startsWith('data-')).map(a => `[${a}]`).join('')); return parts.join(' > '); };
  const w = window.__gateLcp = { entries: [], seen: null };
  new PerformanceObserver(l => { for (const e of l.getEntries()) w.entries.push({ t: e.startTime, size: e.size, sel: e.element ? path(e.element) : null }); }).observe({ type: 'largest-contentful-paint', buffered: true });
  if (!sel) return;
  const shown = e => {
    const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= innerHeight) return false;
    if (!(e.textContent || '').trim() && !(e.tagName === 'IMG' && e.complete)) return false;
    let o = 1; for (let x = e; x && x.nodeType === 1; x = x.parentElement) { const c = getComputedStyle(x); if (c.display === 'none' || c.visibility === 'hidden') return false; o *= +c.opacity; }
    return o >= 0.99;
  };
  const tick = () => {
    if (w.seen !== null || performance.now() > 20000) return;
    if (document.body && [...document.querySelectorAll(sel)].some(shown)) { w.seen = performance.now(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
async function lcpLoad(b, url, sel) {
  const p = await b.newPage();
  try {
    await hideWebdriver(p); await p.setUserAgent(PHONE_UA);
    await p.setViewport({ width: 412, height: 823, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    const c = await p.createCDPSession(); await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await p.evaluateOnNewDocument(`(${LCP_WATCH})(${JSON.stringify(sel)})`);
    await p.goto(url, { waitUntil: 'load', timeout: 120000 });
    await p.waitForFunction(() => window.__gateLcp.seen !== null || performance.now() > 20000, { timeout: 60000, polling: 200 }).catch(() => {});
    await sleep(500);
    const r = await p.evaluate(() => { const w = window.__gateLcp, last = w.entries.at(-1); return { lcp: last ? Math.round(last.t) : null, sel: last?.sel ?? null, seen: w.seen === null ? null : Math.round(w.seen) }; });
    return r;
  } finally { await p.close(); }
}
const median = xs => { const s = xs.filter(x => x !== null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const mode = xs => { const m = new Map(); xs.forEach(x => m.set(x, (m.get(x) ?? 0) + 1)); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
async function lcpGate(baseUrl, candUrl, n = 3) {
  const b = await browser(['--disable-blink-features=AutomationControlled']);
  try {
    const probe = [await lcpLoad(b, baseUrl, null), await lcpLoad(b, baseUrl, null)];
    const sel = mode(probe.map(r => r.sel));
    if (!sel) return { pass: false, why: ['the base reported no LCP element'] };
    const runs = { base: [], cand: [] };
    for (let i = 0; i < n; i++) { runs.base.push(await lcpLoad(b, baseUrl, sel)); runs.cand.push(await lcpLoad(b, candUrl, sel)); }
    const bm = median(runs.base.map(r => r.seen)), cm = median(runs.cand.map(r => r.seen));
    const baseSel = mode(runs.base.map(r => r.sel)), candSel = mode(runs.cand.map(r => r.sel)), margin = Math.max(300, 0.2 * (bm ?? 0)), why = [];
    if (cm === null) why.push(`the base's LCP element (${sel}) never showed on the candidate in 20 s`);
    else if (bm !== null && cm > bm + margin) why.push(`the base's LCP element shows at ${cm} ms on the candidate, ${bm} ms on the base (margin ${Math.round(margin)} ms)`);
    if (candSel !== baseSel && !(cm !== null && bm !== null && cm < bm - margin)) why.push(`the LCP element moved (${candSel}) without the base's LCP content showing sooner`);
    return { pass: !why.length, why, sel, baseSel, candSel, baseSeenMs: bm, candSeenMs: cm, baseLcpMs: median(runs.base.map(r => r.lcp)), candLcpMs: median(runs.cand.map(r => r.lcp)), runs };
  } finally { await b.close(); }
}

// ---------- G5: axe, Lighthouse accessibility and SEO ----------
function tool(spec) {
  const dir = join(WORK, 'tools');
  const name = spec.replace(/@[^@]*$/, '');
  if (!existsSync(join(dir, 'node_modules', name))) { mkdirSync(dir, { recursive: true }); sh(`npm i --no-save --no-audit --no-fund --prefix ${dir} ${spec}`, { env: ENV, timeout: 600000 }); }
  return join(dir, 'node_modules', name);
}
async function axeRun(url) {
  const src = readFileSync(join(tool(AXE), 'axe.min.js'), 'utf8');
  const b = await browser(), rows = {};
  try {
    for (const [path, w, h] of [['/', 390, 844], ['/', 1440, 900], ['/about', 390, 844], ['/about', 1440, 900]]) {
      const p = await b.newPage();
      try {
        await p.setViewport(w < 992 ? { width: w, height: h, isMobile: true, hasTouch: true } : { width: w, height: h });
        await p.goto(url + path, { waitUntil: 'load', timeout: 120000 }); await sleep(5000);
        await p.evaluate(src);
        const r = await p.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
        for (const v of r.violations) rows[`${path} ${w}x${h} ${v.id}`] = v.nodes.length;
      } finally { await p.close(); }
    }
  } finally { await b.close(); }
  return rows;
}
function lighthouse(url) {
  const out = {};
  for (const path of ['/', '/about']) {
    const file = join(WORK, `lh-${createHash('md5').update(url + path).digest('hex').slice(0, 8)}.json`);
    sh(`npx -y ${LIGHTHOUSE} ${url}${path} --only-categories=accessibility,seo --chrome-flags="--headless=new --no-sandbox" --output=json --output-path=${file} --quiet`, { env: ENV, timeout: 300000 });
    const r = JSON.parse(readFileSync(file, 'utf8'));
    for (const [k, c] of Object.entries(r.categories)) out[`${path} ${k}`] = Math.round(c.score * 100);
    out[`${path} failing`] = Object.values(r.audits).filter(a => a.score === 0 && a.scoreDisplayMode === 'binary').map(a => a.id).sort();
  }
  return out;
}
function judgeG5(base, cand) {
  const why = [];
  // The live page's content changes between loads (which reason shows, who folded), and color-contrast's node count with
  // it (1 to 9 on the base's own phone loads). So on the live page a rule fails if it is new on a state, or its nodes
  // pass twice the base's plus 5; the exact axe judgement is G2's a11y-axe, on a scripted stream.
  for (const [k, n] of Object.entries(cand.axe)) if (!(k in base.axe) || n > 2 * base.axe[k] + 5) why.push(`axe ${k}: ${n} nodes, base ${base.axe[k] ?? 0}`);
  for (const [k, s] of Object.entries(cand.lh)) {
    if (Array.isArray(s)) { const add = s.filter(x => !base.lh[k]?.includes(x)); if (add.length) why.push(`lighthouse ${k}: ${add.join(', ')}`); }
    else if (s < (base.lh[k] ?? 0)) why.push(`lighthouse ${k}: ${s}, base ${base.lh[k]}`);
  }
  return { pass: !why.length, why };
}

// ---------- one gate run ----------
const cacheFile = (sha, what) => join(WORK, 'cache', `${sha}-${what}.json`);
const cached = async (sha, what, fn) => {
  const f = cacheFile(sha, what);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const v = await fn(); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); return v;
};
export async function gate(baseRef, candRef, { ids = null, skip = new Set() } = {}) {
  const base = git(`rev-parse ${baseRef}^{commit}`), cand = git(`rev-parse ${candRef}^{commit}`);
  const t0 = Date.now(), reasons = [], gates = {};
  const gateHash = git(`hash-object "${SELF}"`), baseGate = (() => { try { return git(`rev-parse ${base}:web/scripts/gate.mjs`); } catch { return null; } })();
  const v = { base, cand, api: API, ids: ids ?? 'all', lanes: LANES, startedAt: new Date().toISOString(), gateHash, gateIsBase: gateHash === baseGate, gates };
  if (!v.gateIsBase && !has('--dev-gate')) reasons.push('the gate script is not the base\'s copy');
  try { await fetch(`${API}/health`).then(r => { if (!r.ok) throw new Error(r.status); }); } catch (e) { v.pass = false; v.status = 'incomplete'; reasons.push(`no engine at ${API} (${e.message})`); v.reasons = reasons; return v; }
  const bdir = worktree(`base-${base.slice(0, 8)}`, base), cdir = base === cand ? null : worktree(`cand-${cand.slice(0, 8)}`, cand);
  const dir = cdir ?? worktree(`cand-${cand.slice(0, 8)}-aa`, cand);
  try {
    // pins and the path rule
    const pr = pins(base, cand, dir);
    gates.path = pr.path; gates.pins = pr.pins;
    if (!pr.path.pass) reasons.push(`path: the diff touches pinned paths (${pr.path.touched.join(', ')})`);
    if (!pr.pins.pass) reasons.push(`pins: ${pr.pins.bad.slice(0, 5).join('; ')}`);
    v.pinHash = pr.pins.pinHash;
    if (pr.engineChanged) { v.status = 'incomplete'; reasons.push('engine: the candidate changes engine/, which needs the fixture (design step 2) to run its engine beside the base\'s: not evaluated'); }
    // the user-agent rule, by source
    const bu = uaCounts(bdir), cu = uaCounts(dir);
    const grew = Object.keys(UA_PATTERNS).filter(k => cu.counts[k] > bu.counts[k]);
    gates.uaGrep = { pass: !grew.length, base: bu.counts, cand: cu.counts, added: Object.fromEntries(grew.map(k => [k, cu.where[k].filter(x => !bu.where[k]?.includes(x)).slice(0, 10)])) };
    if (grew.length) reasons.push(`ua: the candidate adds ${grew.map(k => `${k} (${bu.counts[k]} -> ${cu.counts[k]})`).join(', ')}`);
    log('g1'); // G1
    modules(bdir, base); modules(dir, base);
    if (!skip.has('g1')) { gates.g1 = g1(dir); if (!gates.g1.pass) reasons.push(`g1: ${gates.g1.steps.filter(s => !s.pass).map(s => s.name).join(', ')} failed`); }
    // builds
    log('builds'); gates.build = { base: build(bdir) };
    try { gates.build.cand = build(dir); } catch (e) { gates.build.cand = 'failed'; reasons.push(`build: ${String(e.stderr ?? e.message).split('\n').slice(-5).join(' | ')}`); throw e; }
    const baseUrl = await serve(bdir, PORT), candUrl = await serve(dir, PORT + 1);
    log('ua at run time');
    if (!skip.has('ua')) { gates.uaRuntime = await uaGate(baseUrl, candUrl); if (!gates.uaRuntime.pass) reasons.push('ua: the page loads other scripts or elements under a Lighthouse or headless user agent'); }
    log('lcp');
    if (!skip.has('lcp')) { gates.lcp = await lcpGate(baseUrl, candUrl); if (!gates.lcp.pass) reasons.push(`lcp: ${gates.lcp.why.join('; ')}`); }
    log('g2');
    if (!skip.has('g2')) {
      const key = `g2-${createHash('md5').update(String(ids ?? 'all') + LANES).digest('hex').slice(0, 8)}`;
      const bres = await cached(base, key, () => runChecks(bdir, baseUrl, ids));
      const cres = runChecks(dir, candUrl, ids);
      let j = judgeG2(bres, cres, readRed());
      // Each red result once more on both arms, same lanes: the candidate fails a check only if it fails it more often.
      const again = j.fails.map(f => f.id);
      if (again.length) {
        const b2 = runChecks(bdir, baseUrl, again), c2 = runChecks(dir, candUrl, again);
        j.fails = j.fails.filter(f => {
          const bf = (bres.rows[f.id]?.pass ? 0 : 1) + (b2.rows[f.id]?.pass ? 0 : 1), cf = 1 + (c2.rows[f.id]?.pass ? 0 : 1);
          f.rerun = { candDetail: c2.rows[f.id]?.detail, baseDetail: b2.rows[f.id]?.detail, baseFails: bf, candFails: cf };
          const r = readRed()?.entries?.find(e => e.id === f.id);
          const baseSaw = [r?.detail, bres.rows[f.id]?.pass ? null : bres.rows[f.id]?.detail, b2.rows[f.id]?.pass ? null : b2.rows[f.id]?.detail];
          // Red on the base in any run (or frozen red): judged by detail, and worse on both candidate runs.
          if (bf > 0 || r) {
            const keep = !c2.rows[f.id]?.pass && judgeDetail(baseSaw, f.detail, r?.better).worse && judgeDetail(baseSaw, c2.rows[f.id]?.detail, r?.better).worse;
            if (!keep) j.notes.push({ ...f, why: `${f.why}; red on the base too (${bf} of 2), and the candidate's detail is not worse than the base's on both runs` });
            return keep;
          }
          if (cf > bf) return true;
          j.notes.push({ ...f, why: `${f.why}, but the base failed it as often on the rerun` }); return false;
        });
      }
      gates.g2 = { pass: !j.fails.length, checks: Object.keys(cres.rows).length, baseRed: Object.entries(bres.rows).filter(([, r]) => !r.pass).map(([id]) => id), fails: j.fails, notes: j.notes, ms: { base: bres.ms, cand: cres.ms } };
      if (!gates.g2.pass) reasons.push(`g2: ${j.fails.map(f => `${f.id} (${f.detail.slice(0, 140)})`).join('; ')}`);
    }
    log('g5');
    if (!skip.has('g5')) {
      const bg5 = await cached(base, 'g5', async () => ({ axe: await axeRun(baseUrl), lh: lighthouse(baseUrl) }));
      const cg5 = { axe: await axeRun(candUrl), lh: lighthouse(candUrl) };
      gates.g5 = { ...judgeG5(bg5, cg5), base: bg5, cand: cg5 };
      if (!gates.g5.pass) reasons.push(`g5: ${gates.g5.why.join('; ')}`);
    }
  } catch (e) {
    reasons.push(`gate error: ${String(e.message).split('\n')[0]}`);
    v.status ??= 'incomplete';
  } finally {
    stopServers();
    if (!has('--keep')) { dropWorktree(dir); dropWorktree(bdir); }
  }
  v.reasons = reasons;
  v.pass = !reasons.length;
  v.status ??= v.pass ? 'pass' : 'fail';
  v.minutes = +((Date.now() - t0) / 60000).toFixed(1);
  return v;
}

// ---------- the corpus: every known-bad entry fails, base against base passes ----------
async function corpus(baseRef, ids) {
  const base = git(`rev-parse ${baseRef}^{commit}`);
  const manifest = JSON.parse(readFileSync(join(CORPUS_DIR, 'manifest.json'), 'utf8'));
  const only = new Set((arg('--entries', '') || '').split(',').filter(Boolean));
  const out = { base, startedAt: new Date().toISOString(), ids, control: null, entries: [] };
  const save = () => { if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify(out, null, 1)); };
  if (!has('--no-control')) {
    log('control: base against base');
    const c = await gate(base, base, { ids });
    out.control = { pass: c.pass, status: c.status, reasons: c.reasons, verdict: c }; save();
  }
  for (const e of manifest.entries) {
    if (only.size && !only.has(e.id)) continue;
    log(`entry ${e.id}`);
    const dir = worktree(`plant-${e.id}`, base);
    let sha;
    try {
      sh(`git apply ${join(CORPUS_DIR, e.patch)}`, { cwd: dir });
      sh(`git add -A && git -c user.name=gate -c user.email=gate@localhost commit -qm "gate corpus: ${e.id}"`, { cwd: dir, env: { ...ENV, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' } });
      sha = git('rev-parse HEAD', dir);
    } catch (err) { out.entries.push({ id: e.id, applied: false, error: String(err.stderr ?? err.message).split('\n')[0] }); dropWorktree(dir); save(); continue; }
    dropWorktree(dir);
    const v = await gate(base, sha, { ids });
    const failed = Object.entries(v.gates).filter(([, g]) => g && g.pass === false).map(([k]) => k);
    out.entries.push({ id: e.id, about: e.about, cand: sha, failed: !v.pass, status: v.status, failingGates: failed, expect: e.expect, expectMet: (e.expect ?? []).every(x => failed.includes(x)), reasons: v.reasons, verdict: v });
    save();
  }
  out.pass = out.control?.pass === true && out.entries.every(e => e.failed && e.expectMet);
  out.finishedAt = new Date().toISOString();
  save();
  return out;
}

// ---------- the red list ----------
async function freezeRed(baseRef) {
  const base = git(`rev-parse ${baseRef}^{commit}`);
  const dir = worktree(`base-${base.slice(0, 8)}`, base);
  try {
    modules(dir, base); build(dir);
    const url = await serve(dir, PORT);
    const r = runChecks(dir, url, ids());
    const entries = Object.entries(r.rows).filter(([, x]) => !x.pass).map(([id, x]) => ({ id, detail: x.detail }));
    const red = { base, frozenAt: new Date().toISOString(), lanes: LANES, api: API, checks: Object.keys(r.rows).length, minutes: +(r.ms / 60000).toFixed(1), entries };
    writeFileSync(arg('--red-out', join(CORPUS_DIR, 'red-list.json')), JSON.stringify(red, null, 1) + '\n');
    return red;
  } finally { stopServers(); dropWorktree(dir); }
}

function ids() {
  if (has('--all')) return null;
  if (arg('--only')) return arg('--only').split(',');
  try { return JSON.parse(readFileSync(join(CORPUS_DIR, 'manifest.json'), 'utf8')).checks; } catch { return null; }
}

if (process.argv[1] === SELF) {
  mkdirSync(WORK, { recursive: true });
  const skip = new Set((arg('--skip', '') || '').split(',').filter(Boolean));
  process.on('exit', stopServers);
  let result, ok;
  if (has('--freeze-red')) { result = await freezeRed(arg('--base', 'HEAD')); ok = true; }
  else if (has('--corpus')) { result = await corpus(arg('--base', 'HEAD'), ids()); ok = result.pass; }
  else {
    if (!arg('--base') || !arg('--cand')) { console.error('usage: gate.mjs --base <sha> --cand <sha> | --corpus | --freeze-red'); process.exit(2); }
    result = await gate(arg('--base'), arg('--cand'), { ids: ids(), skip });
    ok = result.pass;
  }
  const text = JSON.stringify(result, null, 1);
  if (arg('--out')) writeFileSync(arg('--out'), text); else console.log(text);
  if (result.reasons) log(result.pass ? 'PASS' : `${result.status?.toUpperCase()}: ${result.reasons.join(' | ')}`);
  if (has('--corpus')) { log(`control: ${result.control ? (result.control.pass ? 'pass' : 'FAIL') : 'not run'}`); for (const e of result.entries) log(`${e.id}: ${e.failed ? 'failed' : 'PASSED (bad)'} by ${e.failingGates?.join(', ')}${e.expectMet ? '' : ` (expected ${e.expect})`}`); }
  process.exit(ok ? 0 : 1);
}
