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
//  path    fails a candidate whose diff modifies or deletes a pinned file (renames count as both); a file the candidate
//          adds under a pinned path (a lever's own script or unit test) is allowed, and judges nothing: the checks, the
//          audit and this gate always run from the base's worktree. The restore still runs, so the other gates judge the
//          candidate's code under the base's checks, and the pins are hashed again after the build and after G2, in both
//          worktrees, since candidate code runs at build and serve time;
//  ua      fails a candidate that adds a read of the user agent, navigator.webdriver, the checks' harness globals or
//          device hints (counted per pattern over web/src and engine, test files aside: a move keeps the count), and, at
//          run time, one that loads other scripts or other elements under a Lighthouse or a headless user agent than
//          under a phone's (beyond what two loads under the phone's own agent differ by);
//  g1      tsc --noEmit, eslint src --quiet and the unit tests (src/lib/*.test.mjs), on the candidate;
//  g2      the UI checks (checks.mjs, run from the base's worktree) on both builds, each against its own arm's engine, in
//          one environment that this script sets (no WITHIN_MS or other knob from the caller): a check green on the base
//          and red on the candidate fails, and so does a check with a base result and none on the candidate;
//          a check red on the base is judged by its measured detail against the frozen red list (or, if it is not on
//          it, against this run's base): it fails only if the detail gets worse (judgeDetail). Every red result is run
//          once more on both arms, under the same lanes, and fails only if the candidate fails more often than the base;
//  lcp     the phone's LCP at 4x CPU: the element that is the base's LCP must become visible (in view, effective
//          opacity >= 0.99) no later on the candidate (margin max(300 ms, 20%)), and a candidate whose LCP is another
//          element fails unless that real content shows sooner (the opacity trick: hide the LCP element, the score rises);
//  g5      axe (axe-core, pinned) on the home page and /about at 390x844 and 1440x900: no rule with more nodes; Lighthouse
//          (pinned) accessibility and SEO on the home page and /about: no lower score.
// The verdict: { pass, status: pass|fail|incomplete, reasons[], gates: {...}, base, cand, pinHash, gateHash, ... }.
// Engines: unless --api is given, the gate starts the mock model and one engine per arm, each built from its own worktree's
// engine/ and run on its own copy of the fixture snapshot (web/scripts/fixture, --size hands, seeded), so a candidate that
// changes engine/ is judged like any other. With --api both arms share that engine and an engine change is "incomplete".
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
const SHARED_API = arg('--api', null); // one engine for both arms (old mode); else one fixture engine per arm
const ENGINE_PORT = +arg('--engine-port', 8401), LLM_PORT = +arg('--llm-port', 5401), FX_SIZE = +arg('--size', 1250);
const WORK_GIVEN = !!arg('--work');
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
  worktrees.add(dir);
  return dir;
}
const worktrees = new Set(); // this run's, dropped on a signal too
const dropWorktree = dir => { worktrees.delete(dir); try { git(`worktree remove --force ${dir}`); } catch { /* gone */ } };
// node_modules: a hard-linked copy of the repo's install when its lock file is the base's (pinned, so the candidate's
// is the base's too), else a fresh npm ci.
function modules(dir, baseSha) {
  const want = git(`rev-parse ${baseSha}:web/package-lock.json`), have = git('hash-object web/package-lock.json');
  const src = join(REPO, 'web/node_modules'), dst = join(dir, 'web/node_modules');
  if (existsSync(dst)) return;
  if (want === have && existsSync(src)) sh(`cp -al ${src} ${dst}`);
  else sh('npm ci --no-audit --no-fund', { cwd: join(dir, 'web'), env: ENV, timeout: 600000 });
}
function build(dir, api) {
  const t0 = Date.now();
  sh('npx next build', { cwd: join(dir, 'web'), env: { ...ENV, NEXT_PUBLIC_API_URL: api }, timeout: 600000 });
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
const waitUp = async (url, what) => { for (let i = 0; i < 240; i++) { try { if ((await fetch(url)).ok) return; } catch { /* starting */ } await sleep(500); } throw new Error(`${what} never answered at ${url}`); };
const freePort = async port => { try { sh(`fuser -k ${port}/tcp`); } catch { /* none */ } await sleep(300); };

// ---------- engines: the mock model, and one fixture engine per arm (G-e) ----------
const GO_ENV = Object.fromEntries(['GOPATH', 'GOCACHE', 'GOMODCACHE', 'GOFLAGS', 'GOPROXY', 'GOTOOLCHAIN'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
// uv resolves the mock model's requirements through the machine's proxy: its CA settings, and nothing else, pass through.
const TLS_ENV = Object.fromEntries(['SSL_CERT_FILE', 'UV_NATIVE_TLS', 'REQUESTS_CA_BUNDLE', 'UV_CACHE_DIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
// The mock model from the base's llm/ (pinned), seeded as the fixture's serve.sh seeds it.
async function startModel(bdir) {
  await freePort(LLM_PORT);
  servers.push(spawn('uv', ['run', '--quiet', '--no-project', '--with-requirements', 'requirements.txt', 'python', '-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(LLM_PORT), '--log-level', 'warning'],
    { cwd: join(bdir, 'llm'), env: { ...ENV, ...TLS_ENV, LLM_PROVIDER: 'mock', MOCK_SEED: '7' }, stdio: 'ignore', detached: true }));
  await waitUp(`http://127.0.0.1:${LLM_PORT}/health`, 'the mock model');
  return `http://127.0.0.1:${LLM_PORT}`;
}
// An arm's engine: built from that arm's engine/, on its own copy of the base's fixture snapshot (the first FX_SIZE hands).
function buildEngine(dir, name) {
  const bin = join(WORK, `engine-${name}`), hands = join(WORK, `fx-${name}`, 'hands');
  sh(`go build -o ${bin} .`, { cwd: join(dir, 'engine'), env: { ...ENV, ...GO_ENV }, timeout: 600000 });
  rmSync(dirname(hands), { recursive: true, force: true }); mkdirSync(hands, { recursive: true });
  return { bin, hands };
}
async function startEngine({ bin, hands }, snapshot, port, llm) {
  sh(`gzip -dc "${snapshot}" | head -n ${FX_SIZE} > "${join(hands, 'hands.jsonl')}"`, { shell: '/bin/bash' });
  await freePort(port);
  servers.push(spawn(bin, [], { env: { PATH: ENV.PATH, HOME: ENV.HOME, PORT: String(port), HAND_LOG_DIR: hands, LLM_SERVICE_URL: llm, FIXTURE_SEED: '7', TABLE_PACE: '0.3', DAILY_CALL_CAP: '1000000' }, stdio: 'ignore', detached: true }));
  await waitUp(`http://127.0.0.1:${port}/health`, 'an arm\'s engine');
  return `http://localhost:${port}`;
}

// ---------- pins: the path rule and the restore by hash ----------
// The path rule on a diff's name-status lines: a pinned file modified or deleted fails; one added is allowed.
export function pathRule(nameStatus) {
  const rows = nameStatus.split('\n').filter(Boolean).map(l => { const [st, f] = l.split('\t'); return { st: st[0], f }; });
  return {
    changed: rows.map(r => r.f),
    touched: rows.filter(r => pinned(r.f) && r.st !== 'A').map(r => `${r.f} (${r.st === 'D' ? 'deleted' : 'modified'})`),
    added: rows.filter(r => pinned(r.f) && r.st === 'A').map(r => r.f),
  };
}
const pinFiles = base => new Map(git(`ls-tree -r ${base}`).split('\n').filter(Boolean).map(l => { const [meta, f] = l.split('\t'); return [f, meta.split(' ')[2]]; }).filter(([f]) => pinned(f)));
// Every pinned file of the base has the base's blob hash in dir, and no pinned file is there that neither the base nor
// the candidate's own diff (an added file) has.
function hashPins(dir, baseFiles, added) {
  const bad = [];
  for (const [f, blob] of baseFiles) { const p = join(dir, f); if (!existsSync(p)) bad.push(`${f}: missing`); else if (git(`hash-object "${p}"`, dir) !== blob) bad.push(`${f}: hash differs`); }
  const extra = git('ls-files -co --exclude-standard', dir).split('\n').filter(f => f && pinned(f) && !baseFiles.has(f) && !added.includes(f) && existsSync(join(dir, f)));
  bad.push(...extra.map(f => `${f}: not in the base`));
  return bad;
}
function pins(base, cand, dir) {
  const pr = pathRule(git(`diff --no-renames --name-status ${base} ${cand}`));
  const { changed, added } = pr;
  const touched = changed.filter(f => pinned(f) && !added.includes(f));
  const baseFiles = pinFiles(base);
  for (const f of touched) {
    if (baseFiles.has(f)) git(`checkout ${base} -- "${f}"`, dir);
    else rmSync(join(dir, f), { force: true });
  }
  const bad = hashPins(dir, baseFiles, added);
  const pinHash = createHash('sha256').update([...baseFiles].sort().map(([f, b]) => `${f} ${b}`).join('\n')).digest('hex').slice(0, 16);
  return {
    path: { pass: !pr.touched.length, touched: pr.touched, added },
    pins: { pass: !bad.length, restored: touched.length, files: baseFiles.size, pinHash, bad },
    baseFiles, added,
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
// A red check's detail, judged against the base's. The detail lists offenders, "; " apart. An offender's key is its text
// with the numbers taken out, its figures are the numbers, and its kind is the key with names taken out too (capitalised
// words, quoted text, hex colours), so the same failure on other seats or models is the same kind. Worse: an offender of
// a kind no base detail has (a different kind of failure), more offenders than the base had, or a figure that moved the
// bad way by more than 15% and 2 units against the same offender (same key) or, failing that, the same kind.
// Each figure carries its own direction, read from its unit (review 7, R7-1: one direction for a whole detail judged a
// frame count, a fill percentage and a timestamp as badness): px and ms off, "N s late/early/behind/ahead/off", the N of
// "N of M", and the lateness of "X s still shown with Y s left" (X - Y) are lower-is-better; every other figure (the M of
// "N of M", percentages, "at 47.3 s", a window's "50s", a coordinate, a bare count) is not judged, unless the check's
// red-list entry declares `better` ("lower" or "higher"), which then applies to every figure.
const NUM = /-?\d[\d,]*(?:\.\d+)?/g;
const namesOut = s => s.replace(/"[^"]*"|'[^']*'/g, 'N').replace(/#[0-9A-Fa-f]{3,8}\b/g, 'N')
  .replace(/\b[A-Z][\w.+-]*(?:\s+(?:[A-Z][\w.+-]*|\d[\d.]*[A-Z]+\b|\d[\d.]*(?=\s+[A-Z0-9]|\s*[,;)]|$)))*/g, 'N');
export const kindOf = s => namesOut(s).replace(NUM, '#').replace(/N(?:[\s,&/+]*N)*/g, 'N').replace(/\s+/g, ' ').trim();
const num = x => +x.replace(/,/g, '');
// figures come from the text with the names out, so a model's "4" or "3.5" is never read as a measurement
export function figures(s) {
  const t = namesOut(s), out = [];
  for (const m of t.matchAll(NUM)) {
    const after = t.slice(m.index + m[0].length);
    const dir = /^\s*(?:px|ms)\b/.test(after) || /^\s*s\s+(?:too\s+)?(?:late|early|behind|ahead|off)\b/.test(after) || /^\s+of\s+-?\d/.test(after) ? 'lower' : null;
    out.push({ n: num(m[0]), dir });
  }
  // a countdown or clock that stays past its second: how far past is the figure, not the clock's reading
  for (const m of t.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*s still shown with (-?\d[\d,]*(?:\.\d+)?)\s*s left/g)) out.push({ n: num(m[1]) - num(m[2]), dir: 'lower', lag: true });
  return out;
}
const offenders = d => (d || '').split(/;\s+/).map(s => s.trim()).filter(Boolean).map(s => ({ s, key: s.replace(NUM, '#'), kind: kindOf(s), figs: figures(s) }));
// `frozen` may be a list of details (the red list's and every base run's): the candidate is worse only if it is worse than
// all of them, so a red check's own spread on the base is never read as the candidate's doing.
export function judgeDetail(frozen, now, better = null) {
  const seen = [].concat(frozen).filter(x => typeof x === 'string').map(offenders), b = offenders(now), why = [];
  if (!seen.length) return { worse: false, why: ['nothing to judge against'] };
  const all = seen.flat(), kinds = new Set(all.map(x => x.kind)), most = Math.max(...seen.map(a => a.length));
  if (b.length > most) why.push(`${b.length} offenders, the base at most ${most}`);
  for (const o of b) {
    if (!kinds.has(o.kind)) { why.push(`new: ${o.s.slice(0, 160)}`); continue; }
    let same = all.filter(x => x.key === o.key);
    if (!same.length) same = all.filter(x => x.kind === o.kind && x.figs.length === o.figs.length);
    o.figs.forEach(({ n, dir }, i) => {
      const way = better ?? dir;
      if (!way) return;
      const fs = same.map(x => x.figs[i]?.n).filter(f => f !== undefined);
      if (!fs.length) return;
      const f = way === 'higher' ? Math.min(...fs) : Math.max(...fs), tol = Math.abs(f) * 0.15 + 2;
      if (way === 'higher' ? n < f - tol : n > f + tol) why.push(`${o.s.slice(0, 120)}: ${n} against ${f}`);
    });
  }
  return { worse: why.length > 0, why };
}
// The red list, only when it was frozen on this very base: a list frozen on another base says nothing about this one.
export const redFor = (red, base) => (red && red.base === base ? red : null);
const readRed = base => { try { return redFor(JSON.parse(readFileSync(join(CORPUS_DIR, 'red-list.json'), 'utf8')), base); } catch { return null; } };
// Every check either arm has a row for: one with a base result and none on the candidate (its run crashed or timed out
// before it) fails.
export function judgeG2(base, cand, red) {
  const fails = [], notes = [];
  for (const id of new Set([...Object.keys(base.rows), ...Object.keys(cand.rows)])) {
    const b = base.rows[id], c = cand.rows[id] ?? { pass: false, s: 0, detail: 'no result on the candidate (its run ended before it)', missing: true };
    if (c.pass) continue;
    if (c.missing) { fails.push({ id, why: 'no result on the candidate', detail: c.detail, missing: true }); continue; }
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
// A script's path without its build's content hash (Turbopack's chunks are hash-only names, webpack's end in -<hash>; the
// build id is a hash too), so two builds of the same scripts give the same list; each repeat of a name gets its own
// entry (#2, #3), so the list still counts the scripts of each kind.
const hashy = h => h.length >= 8 && /\d/.test(h) && /^[0-9a-z_~-]+$/i.test(h);
export const scriptKey = path => path.replace(/[?#].*$/, '')
  .replace(/^\/_next\/static\/(?!chunks\/|media\/|css\/)[^/]+\//, '/_next/static/<build>/')
  .replace(/\/([^/]+)\.(js|css)$/, (m, name, ext) => {
    const pre = name.match(/^(turbopack|webpack|main-app|main|framework|polyfills|page|layout|not-found|error|loading)-(.+)$/);
    if (pre && hashy(pre[2])) return `/${pre[1]}-<h>.${ext}`;
    if (hashy(name)) return `/<h>.${ext}`;
    const tail = name.match(/^(.+)-([0-9a-f]{8,})$/);
    return tail ? `/${tail[1]}-<h>.${ext}` : m;
  });
export const scriptKeys = paths => { const n = new Map(); return paths.map(scriptKey).sort().map(k => { const i = (n.get(k) ?? 0) + 1; n.set(k, i); return `${k} #${i}`; }); };
// DOM marks that come and go with the hand (a bet in front of a seat, the pot, the chart's emphasised line, a chip or card
// in flight), not with the agent: left out of the DOM list, which keeps every id and the other data- marks (the stats' rows,
// the chart, the screens).
const HAND_DOM = new Set(['[data-bet]', '[data-pot]', '[data-emph]', '[data-flight]']);
async function uaRuntime(url) { // one build's differences under an audit's agent
  const b = await browser(['--disable-blink-features=AutomationControlled']);
  const load = async (ua, phone, webdriver) => {
    const p = await b.newPage();
    try {
      if (!webdriver) await hideWebdriver(p);
      await p.setViewport(phone ? { width: 412, height: 823, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1350, height: 940 });
      if (ua) await p.setUserAgent(ua);
      const scripts = [];
      p.on('request', r => { if (r.resourceType() === 'script') scripts.push(r.url().replace(/^https?:\/\/[^/]+/, '')); });
      await p.goto(url, { waitUntil: 'load', timeout: 120000 });
      await sleep(6000);
      const dom = await p.evaluate(() => [...new Set([...document.querySelectorAll('*')].flatMap(e => [e.id ? `#${e.id}` : null, ...e.getAttributeNames().filter(a => a.startsWith('data-')).map(a => `[${a}]`)]).filter(Boolean))]);
      return new Set([...scriptKeys([...new Set(scripts)]).map(s => `script ${s}`), ...dom.filter(d => !HAND_DOM.has(d)).map(d => `dom ${d}`)]);
    } finally { await p.close(); }
  };
  const diff = (a, b) => [...a].filter(x => !b.has(x)).map(x => `-${x}`).concat([...b].filter(x => !a.has(x)).map(x => `+${x}`));
  const out = {};
  try {
    for (const phone of [true, false]) {
      // Three loads under the phone's (or a laptop's) own agent set the noise: whatever differs among any two of them. A
      // difference under an audit's agent counts only if both of its loads show it.
      const ua = phone ? PHONE_UA : DESK_UA, n = [await load(ua, phone, false), await load(ua, phone, false), await load(ua, phone, false)];
      const noise = new Set([...diff(n[0], n[1]), ...diff(n[0], n[2]), ...diff(n[1], n[2])].map(x => x.slice(1)));
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
const LCP_WATCH = sels => {
  const path = e => { const parts = []; for (; e && e !== document.body && e.nodeType === 1; e = e.parentElement) parts.unshift(e.tagName.toLowerCase() + (e.id ? `#${CSS.escape(e.id)}` : '') + e.getAttributeNames().filter(a => a.startsWith('data-')).map(a => `[${a}]`).join('')); return parts.join(' > '); };
  const w = window.__gateLcp = { entries: [], seen: {} };
  new PerformanceObserver(l => { for (const e of l.getEntries()) w.entries.push({ t: e.startTime, size: e.size, sel: e.element ? path(e.element) : null }); }).observe({ type: 'largest-contentful-paint', buffered: true });
  if (!sels?.length) return;
  const shown = e => {
    const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= innerHeight) return false;
    if (!(e.textContent || '').trim() && !(e.tagName === 'IMG' && e.complete)) return false;
    let o = 1; for (let x = e; x && x.nodeType === 1; x = x.parentElement) { const c = getComputedStyle(x); if (c.display === 'none' || c.visibility === 'hidden') return false; o *= +c.opacity; }
    return o >= 0.99;
  };
  const tick = () => {
    if (performance.now() > 20000) return;
    for (const sel of sels) if (!(sel in w.seen) && document.body && [...document.querySelectorAll(sel)].some(shown)) w.seen[sel] = performance.now();
    if (Object.keys(w.seen).length < sels.length) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
async function lcpLoad(b, url, sels) {
  const p = await b.newPage();
  try {
    await hideWebdriver(p); await p.setUserAgent(PHONE_UA);
    await p.setViewport({ width: 412, height: 823, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    const c = await p.createCDPSession(); await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await p.evaluateOnNewDocument(`(${LCP_WATCH})(${JSON.stringify(sels)})`);
    await p.goto(url, { waitUntil: 'load', timeout: 120000 });
    // With elements to watch: until each has shown (or 20 s). Without (a probe): 8 s, for the LCP entries to settle.
    await p.waitForFunction(n => n ? Object.keys(window.__gateLcp.seen).length >= n || performance.now() > 20000 : performance.now() > 8000, { timeout: 60000, polling: 200 }, sels?.length ?? 0).catch(() => {});
    await sleep(500);
    const r = await p.evaluate(() => { const w = window.__gateLcp, last = w.entries.at(-1); return { lcp: last ? Math.round(last.t) : null, sel: last?.sel ?? null, seen: Object.fromEntries(Object.entries(w.seen).map(([k, v]) => [k, Math.round(v)])) }; });
    return r;
  } finally { await p.close(); }
}
const median = xs => { const s = xs.filter(x => x !== null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const mode = xs => { const m = new Map(); xs.forEach(x => m.set(x, (m.get(x) ?? 0) + 1)); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
// The base's LCP element is not one element: from load to load it is the caption's model name or a seat's text on the
// felt. So every element that was the base's LCP in a probe is watched, in every load. The pairs alternate which arm
// loads first, both arms get the same warm-up, and a base-against-base load in each pair measures this run's own A/A
// noise: the candidate fails if any watched element's median paired delay passes max(300 ms, 20% of its base median,
// the high edge of its A/A band, the 10th to 90th percentile of its A/A deltas), or if its LCP element is one the base
// never had and the base's content does not show sooner (the opacity trick: hide the LCP element, the score rises).
export const quantile = (xs, q) => { const s = xs.filter(x => x !== null && x !== undefined).sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
async function lcpGate(baseUrl, candUrl, n = +arg('--lcp-pairs', 6)) {
  const b = await browser(['--disable-blink-features=AutomationControlled']);
  try {
    const probe = [];
    for (let i = 0; i < 3; i++) for (const [arm, url] of i % 2 ? [['cand', candUrl], ['base', baseUrl]] : [['base', baseUrl], ['cand', candUrl]]) probe.push({ arm, ...(await lcpLoad(b, url, null)) });
    const sels = [...new Set(probe.filter(r => r.arm === 'base' && r.sel).map(r => r.sel))];
    if (!sels.length) return { pass: false, why: ['the base reported no LCP element'] };
    const runs = { base: [], cand: [], base2: [] }, pairs = [];
    for (let i = 0; i < n; i++) {
      const order = i % 2 ? ['cand', 'base', 'base2'] : ['base2', 'base', 'cand'], got = {};
      for (const arm of order) { got[arm] = await lcpLoad(b, arm === 'cand' ? candUrl : baseUrl, sels); runs[arm].push(got[arm]); }
      pairs.push({ order: order.join(','), got: Object.fromEntries(order.map(a => [a, got[a].seen])) });
    }
    // Judged: the watched elements that showed within 10 s in every base load (the caption, a seat's text). One that comes
    // and goes with the hand (the pot) is reported, never judged.
    const stable = sel => [...runs.base, ...runs.base2].every(r => r.seen[sel] != null && r.seen[sel] < 10000);
    const judged = sels.filter(stable);
    if (!judged.length) return { pass: false, why: ['no LCP element of the base showed within 10 s in every base load'], sels, runs, probe };
    const why = [], per = {};
    for (const sel of sels) {
      const d = pairs.map(p => p.got.cand[sel] != null && p.got.base[sel] != null ? p.got.cand[sel] - p.got.base[sel] : null);
      const aa = pairs.map(p => p.got.base2[sel] != null && p.got.base[sel] != null ? p.got.base2[sel] - p.got.base[sel] : null);
      const bm = median(runs.base.map(r => r.seen[sel] ?? null)), cm = median(runs.cand.map(r => r.seen[sel] ?? null)), dm = median(d);
      const band = [quantile(aa, 0.1), quantile(aa, 0.9)].map(x => x === null ? null : Math.round(x)), margin = Math.max(300, 0.2 * (bm ?? 0), band[1] ?? 0);
      per[sel] = { judged: judged.includes(sel), baseSeenMs: bm, candSeenMs: cm, medianDeltaMs: dm, aaBandMs: band, aaMedianMs: median(aa), marginMs: Math.round(margin) };
      if (!judged.includes(sel)) continue;
      const missing = runs.cand.filter(r => r.seen[sel] == null).length, baseMissing = runs.base.filter(r => r.seen[sel] == null).length;
      if (missing > baseMissing + 1 || (cm === null && bm !== null)) why.push(`the base's LCP element ${sel} did not show within 20 s on the candidate in ${missing} of ${n} loads (base ${baseMissing})`);
      else if (dm !== null && dm > margin) why.push(`the base's LCP element ${sel} shows ${dm} ms later on the candidate (median of ${n} pairs; base ${bm} ms, candidate ${cm} ms; margin ${Math.round(margin)} ms, A/A band ${band[0]}..${band[1]} ms)`);
    }
    const baseSels = new Set([...sels, ...runs.base.map(r => r.sel), ...runs.base2.map(r => r.sel)].filter(Boolean)), candSel = mode(runs.cand.map(r => r.sel));
    const sooner = Object.values(per).some(x => x.judged && x.medianDeltaMs !== null && x.medianDeltaMs < -x.marginMs);
    if (candSel && !baseSels.has(candSel) && !sooner) why.push(`the LCP element moved (${candSel}) without the base's LCP content showing sooner`);
    const aaAll = pairs.flatMap(p => judged.map(sel => p.got.base2[sel] != null && p.got.base[sel] != null ? p.got.base2[sel] - p.got.base[sel] : null));
    return { pass: !why.length, why, sels, judged, baseSels: [...baseSels], candSel, perElement: per, aaBandMs: [quantile(aaAll, 0.1), quantile(aaAll, 0.9)].map(x => x === null ? null : Math.round(x)), pairs, baseLcpMs: median(runs.base.map(r => r.lcp)), candLcpMs: median(runs.cand.map(r => r.lcp)), runs, probe };
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
  const v = { base, cand, api: SHARED_API ?? `fixture engines per arm, ${FX_SIZE} hands`, ids: ids ?? 'all', lanes: LANES, startedAt: new Date().toISOString(), gateHash, gateIsBase: gateHash === baseGate, gates };
  if (!v.gateIsBase && !has('--dev-gate')) reasons.push('the gate script is not the base\'s copy');
  if (SHARED_API) try { await fetch(`${SHARED_API}/health`).then(r => { if (!r.ok) throw new Error(r.status); }); } catch (e) { v.pass = false; v.status = 'incomplete'; reasons.push(`no engine at ${SHARED_API} (${e.message})`); v.reasons = reasons; return v; }
  const bdir = worktree(`base-${base.slice(0, 8)}`, base), cdir = base === cand ? null : worktree(`cand-${cand.slice(0, 8)}`, cand);
  const dir = cdir ?? worktree(`cand-${cand.slice(0, 8)}-aa`, cand);
  try {
    // pins and the path rule
    const pr = pins(base, cand, dir);
    gates.path = pr.path; gates.pins = pr.pins;
    if (!pr.path.pass) reasons.push(`path: the diff touches pinned paths (${pr.path.touched.join(', ')})`);
    if (!pr.pins.pass) reasons.push(`pins: ${pr.pins.bad.slice(0, 5).join('; ')}`);
    v.pinHash = pr.pins.pinHash;
    v.engineChanged = pr.engineChanged;
    if (pr.engineChanged && SHARED_API) { v.status = 'incomplete'; reasons.push('engine: the candidate changes engine/ and --api gives both arms one engine: not evaluated (drop --api to run one engine per arm)'); }
    // engines: one per arm (the base's for the base arm, the candidate's for the candidate's), each on its own snapshot copy
    let baseApi = SHARED_API, candApi = SHARED_API;
    if (!SHARED_API) {
      log('engines');
      const be = buildEngine(bdir, 'base'), ce = buildEngine(dir, 'cand'), llm = await startModel(bdir), snap = join(bdir, 'web/scripts/fixture/snapshot.jsonl.gz');
      baseApi = await startEngine(be, snap, ENGINE_PORT, llm); candApi = await startEngine(ce, snap, ENGINE_PORT + 1, llm);
      v.engines = { base: baseApi, cand: candApi };
    }
    // the user-agent rule, by source
    const bu = uaCounts(bdir), cu = uaCounts(dir);
    const grew = Object.keys(UA_PATTERNS).filter(k => cu.counts[k] > bu.counts[k]);
    gates.uaGrep = { pass: !grew.length, base: bu.counts, cand: cu.counts, added: Object.fromEntries(grew.map(k => [k, cu.where[k].filter(x => !bu.where[k]?.includes(x)).slice(0, 10)])) };
    if (grew.length) reasons.push(`ua: the candidate adds ${grew.map(k => `${k} (${bu.counts[k]} -> ${cu.counts[k]})`).join(', ')}`);
    log('g1'); // G1
    modules(bdir, base); modules(dir, base);
    if (!skip.has('g1')) { gates.g1 = g1(dir); if (!gates.g1.pass) reasons.push(`g1: ${gates.g1.steps.filter(s => !s.pass).map(s => s.name).join(', ')} failed`); }
    // builds
    log('builds'); gates.build = { base: build(bdir, baseApi) };
    try { gates.build.cand = build(dir, candApi); } catch (e) { gates.build.cand = 'failed'; reasons.push(`build: ${String(e.stderr ?? e.message).split('\n').slice(-5).join(' | ')}`); throw e; }
    // Candidate code ran in the build (next.config.ts, prerendering) and runs in its server: hash the pins again, in both
    // worktrees (its worktree is beside the base's), before anything is judged, and again after G2.
    const rehash = when => {
      const bad = [...hashPins(bdir, pr.baseFiles, []).map(x => `base worktree ${x}`), ...hashPins(dir, pr.baseFiles, pr.added).map(x => `candidate worktree ${x}`)];
      (gates.pinsAgain ??= { pass: true, bad: [] }).bad.push(...bad.map(x => `${when}: ${x}`));
      if (bad.length) { gates.pinsAgain.pass = false; v.status = 'fail'; reasons.push(`pins ${when}: ${bad.slice(0, 5).join('; ')}`); }
      return !bad.length;
    };
    if (!rehash('after the build')) throw new Error('a pinned file changed during the build');
    const baseUrl = await serve(bdir, PORT), candUrl = await serve(dir, PORT + 1);
    log('ua at run time');
    if (!skip.has('ua')) { gates.uaRuntime = await uaGate(baseUrl, candUrl); if (!gates.uaRuntime.pass) reasons.push('ua: the page loads other scripts or elements under a Lighthouse or headless user agent'); }
    log('lcp');
    if (!skip.has('lcp')) { gates.lcp = await lcpGate(baseUrl, candUrl); if (!gates.lcp.pass) reasons.push(`lcp: ${gates.lcp.why.join('; ')}`); }
    log('g2');
    if (!skip.has('g2')) {
      const key = `g2-${createHash('md5').update(String(ids ?? 'all') + LANES + (SHARED_API ?? `fx${FX_SIZE}`)).digest('hex').slice(0, 8)}`;
      // The checks always run from the base's worktree (they are the base's anyway), on both arms' URLs.
      const bres = await cached(base, key, () => runChecks(bdir, baseUrl, ids));
      const cres = runChecks(bdir, candUrl, ids);
      const red = readRed(base);
      let j = judgeG2(bres, cres, red);
      // Each red result once more on both arms, same lanes: the candidate fails a check only if it fails it more often.
      const again = j.fails.map(f => f.id);
      if (again.length) {
        const b2 = runChecks(bdir, baseUrl, again), c2 = runChecks(bdir, candUrl, again);
        j.fails = j.fails.filter(f => {
          const bf = (bres.rows[f.id]?.pass ? 0 : 1) + (b2.rows[f.id]?.pass ? 0 : 1), cf = 1 + (c2.rows[f.id]?.pass ? 0 : 1);
          f.rerun = { candDetail: c2.rows[f.id]?.detail, baseDetail: b2.rows[f.id]?.detail, baseFails: bf, candFails: cf };
          const r = red?.entries?.find(e => e.id === f.id);
          const baseSaw = [r?.detail, bres.rows[f.id]?.pass ? null : bres.rows[f.id]?.detail, b2.rows[f.id]?.pass ? null : b2.rows[f.id]?.detail];
          // Red on the base in a run: judged by detail (against the base's runs and the frozen detail), and worse on both
          // candidate runs. Green on both base runs: never judged by a frozen detail.
          if (f.missing) return true;
          if (bf > 0) {
            const keep = !c2.rows[f.id]?.pass && judgeDetail(baseSaw, f.detail, r?.better).worse && judgeDetail(baseSaw, c2.rows[f.id]?.detail, r?.better).worse;
            if (!keep) j.notes.push({ ...f, why: `${f.why}; red on the base too (${bf} of 2), and the candidate's detail is not worse than the base's on both runs` });
            return keep;
          }
          if (cf > bf + 1) return true; // red on both candidate runs, green on both base runs
          if (cf > bf) { f.settle = true; return true; } // one candidate flake: settled below
          j.notes.push({ ...f, why: `${f.why}, but the base failed it as often on the rerun` }); return false;
        });
        // A check green on both base runs and red on one of two candidate runs is a flake or an intermittent regression:
        // two more runs on each arm (four each), and it fails if the candidate fails it at least twice more than the base.
        // (The base against itself failed clock-after-load this way, 1 of 2 against 0 of 2.)
        const settle = j.fails.filter(f => f.settle).map(f => f.id);
        if (settle.length) {
          const more = [0, 1].map(() => ({ b: runChecks(bdir, baseUrl, settle), c: runChecks(bdir, candUrl, settle) }));
          j.fails = j.fails.filter(f => {
            if (!f.settle) return true;
            delete f.settle;
            const bf = f.rerun.baseFails + more.filter(m => !m.b.rows[f.id]?.pass).length, cf = f.rerun.candFails + more.filter(m => !m.c.rows[f.id]?.pass).length;
            f.rerun = { ...f.rerun, baseFails: bf, candFails: cf, runs: 4, moreCandDetails: more.map(m => m.c.rows[f.id]?.detail) };
            if (cf >= bf + 2) return true;
            j.notes.push({ ...f, why: `${f.why} once; over four runs each the candidate failed it ${cf} times, the base ${bf}` }); return false;
          });
        }
      }
      rehash('after G2');
      gates.g2 = { pass: !j.fails.length, checks: Object.keys(cres.rows).length, baseChecks: Object.keys(bres.rows).length, redList: red ? 'frozen on this base' : 'none for this base', baseRed: Object.entries(bres.rows).filter(([, r]) => !r.pass).map(([id]) => id), fails: j.fails, notes: j.notes, ms: { base: bres.ms, cand: cres.ms } };
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
    modules(dir, base);
    let api = SHARED_API;
    if (!api) api = await startEngine(buildEngine(dir, 'base'), join(dir, 'web/scripts/fixture/snapshot.jsonl.gz'), ENGINE_PORT, await startModel(dir));
    build(dir, api);
    const url = await serve(dir, PORT);
    const r = runChecks(dir, url, ids());
    const entries = Object.entries(r.rows).filter(([, x]) => !x.pass).map(([id, x]) => ({ id, detail: x.detail }));
    const red = { base, frozenAt: new Date().toISOString(), lanes: LANES, api: SHARED_API ?? `fixture engine, ${FX_SIZE} hands`, checks: Object.keys(r.rows).length, minutes: +(r.ms / 60000).toFixed(1), entries };
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
  // Ctrl-C or a kill: stop the servers and engines, drop this run's worktrees, then exit (Node emits no 'exit' for these).
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log(`${sig}: cleaning up`); stopServers(); if (!has('--keep')) { for (const d of worktrees) dropWorktree(d); if (!WORK_GIVEN) rmSync(WORK, { recursive: true, force: true }); } process.exit(130); });
  let result, ok;
  if (has('--freeze-red')) { result = await freezeRed(arg('--base', 'HEAD')); ok = true; }
  else if (has('--corpus')) { result = await corpus(arg('--base', 'HEAD'), ids()); ok = result.pass; }
  else {
    if (!arg('--base') || !arg('--cand')) { console.error('usage: gate.mjs --base <sha> --cand <sha> | --corpus | --freeze-red'); process.exit(2); }
    result = await gate(arg('--base'), arg('--cand'), { ids: ids(), skip });
    ok = result.pass;
  }
  stopServers();
  if (!has('--keep') && !WORK_GIVEN) rmSync(WORK, { recursive: true, force: true });
  const text = JSON.stringify(result, null, 1);
  if (arg('--out')) writeFileSync(arg('--out'), text); else console.log(text);
  if (result.reasons) log(result.pass ? 'PASS' : `${result.status?.toUpperCase()}: ${result.reasons.join(' | ')}`);
  if (has('--corpus')) { log(`control: ${result.control ? (result.control.pass ? 'pass' : 'FAIL') : 'not run'}`); for (const e of result.entries) log(`${e.id}: ${e.failed ? 'failed' : 'PASSED (bad)'} by ${e.failingGates?.join(', ')}${e.expectMet ? '' : ` (expected ${e.expect})`}`); }
  process.exit(ok ? 0 : 1);
}
