// Frozen screenshot mode: a settled page whose boxes, text and pixels do not depend on when it was taken. Test runs only:
// everything is done from here and the guard, so no site build contains any of it.
//  - stream paused at a fixed event: serve.sh --freeze N (the guard serves the same first N events, then a quiet table,
//    and the same engine reads to every page);
//  - pinned clock: Date is fixed at the moment the guard read those events, so countdowns and "ago" texts are the same;
//  - animations done: CSS animations and transitions finish at once, the page is left until its boxes and text stop
//    changing for 3 s, and then virtual time is paused before the capture.
// Capture:  node scripts/fixture/run.sh V -- node scripts/fixture/frozen.mjs --base http://localhost:3301 --out DIR [--views phone,desk] [--paths /,/#stats]
//   writes DIR/<view><path>.png and .json (every visible element's box and own text).
// Compare:  node scripts/fixture/frozen.mjs --compare DIR_A DIR_B   (exit 1 when any box or text differs; prints the pixel difference)
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VIEWS = { phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desk: { width: 1440, height: 900, deviceScaleFactor: 1 } };
const slug = p => p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home';

if (process.argv.includes('--compare')) await compare(arg('--compare'), process.argv[process.argv.indexOf('--compare') + 2]);
else await capture();

async function frozenAt(engine, guardPort) {
  // Asked through the guard (it answers /__fixture/frozen-at only in frozen mode).
  return new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: guardPort, path: `${engine}/__fixture/frozen-at` }, r => {
    let s = ''; r.on('data', c => s += c); r.on('end', () => { try { resolve(JSON.parse(s).at); } catch { reject(new Error(`no frozen mode on the guard (${r.statusCode}): start serve.sh with --freeze N`)); } });
  }).on('error', reject));
}

async function capture() {
  const BASE = arg('--base', 'http://localhost:3301'), OUT = arg('--out', 'frozen-out');
  const ENGINE = arg('--engine', 'http://localhost:8090'), GUARD = +(process.env.FIXTURE_GUARD_PORT || 8899);
  const views = arg('--views', 'phone,desk').split(','), paths = arg('--paths', '/').split(',');
  mkdirSync(OUT, { recursive: true });
  const at = await frozenAt(ENGINE, GUARD);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--mute-audio', '--no-sandbox', '--font-render-hinting=none', '--disable-lcd-text'] });
  try {
    for (const v of views) for (const path of paths) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport(VIEWS[v]);
      await page.evaluateOnNewDocument(t => {
        const RealDate = Date;
        class Pinned extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }
        globalThis.Date = Pinned;
        const css = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}html{scroll-behavior:auto!important}';
        const add = () => { const s = document.createElement('style'); s.textContent = css; (document.head || document.documentElement).appendChild(s); };
        document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', add) : add();
      }, at);
      await page.goto(BASE + path, { waitUntil: 'load' });
      // Settled: the same boxes and text for 3 s running (at most 45 s).
      let last = '', same = 0;
      for (let i = 0; i < 90 && same < 6; i++) {
        await sleep(500);
        const now = JSON.stringify(await boxes(page));
        same = now === last ? same + 1 : 0; last = now;
      }
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
      const name = `${v}-${slug(path)}`;
      writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ frozenAt: at, settled: same >= 6, boxes: await boxes(page) }, null, 0));
      await page.screenshot({ path: `${OUT}/${name}.png` });
      console.log(name, same >= 6 ? 'settled' : 'NOT SETTLED in 45 s');
      await ctx.close();
    }
  } finally { await browser.close(); }
}

// Every rendered element: its path, box (in page coordinates) and own text (text nodes directly inside it), in document order.
function boxes(page) {
  return page.evaluate(() => {
    const out = [];
    const walk = (el, path) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).filter(Boolean).join(' ');
      if (r.width || r.height) out.push([path, Math.round((r.x + scrollX) * 10) / 10, Math.round((r.y + scrollY) * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10, cs.visibility === 'hidden' || +cs.opacity === 0 ? 0 : 1, own]);
      [...el.children].forEach((c, i) => walk(c, `${path}>${c.tagName.toLowerCase()}${i}`));
    };
    walk(document.body, 'body');
    out.push(['scroll', scrollX, scrollY]); // where the window is, apart from the layout
    return out;
  });
}

async function compare(a, b) {
  let bad = 0;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  // Every capture either side has (R6-14): a view only one side has is a DIFF, and an A with no captures fails.
  const ja = readdirSync(a).filter(f => f.endsWith('.json')), jb = readdirSync(b).filter(f => f.endsWith('.json'));
  if (!ja.length) { console.log(`DIFF  ${a} has no captures`); bad++; }
  for (const f of [...new Set([...ja, ...jb])].sort()) {
    if (!ja.includes(f) || !jb.includes(f)) { console.log(`DIFF  ${f.replace('.json', '')}: only in ${ja.includes(f) ? 'A' : 'B'}`); bad++; continue; }
    const A = JSON.parse(readFileSync(`${a}/${f}`)).boxes, B = JSON.parse(readFileSync(`${b}/${f}`)).boxes;
    const key = x => JSON.stringify(x);
    const sa = new Set(A.map(key)), sb = new Set(B.map(key));
    const onlyA = A.filter(x => !sb.has(key(x))), onlyB = B.filter(x => !sa.has(key(x)));
    const png = f.replace(/json$/, 'png');
    const px = await page.evaluate(async (x, y) => {
      const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
      const [i1, i2] = await Promise.all([load(x), load(y)]);
      if (i1.width !== i2.width || i1.height !== i2.height) return { size: true };
      const get = i => { const c = new OffscreenCanvas(i.width, i.height), g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
      const d1 = get(i1), d2 = get(i2);
      let n = 0;
      for (let k = 0; k < d1.length; k += 4) if (Math.abs(d1[k] - d2[k]) + Math.abs(d1[k + 1] - d2[k + 1]) + Math.abs(d1[k + 2] - d2[k + 2]) > 24) n++;
      return { n, of: d1.length / 4 };
    }, 'data:image/png;base64,' + readFileSync(`${a}/${png}`).toString('base64'), 'data:image/png;base64,' + readFileSync(`${b}/${png}`).toString('base64'));
    const ok = !onlyA.length && !onlyB.length;
    if (!ok) bad++;
    console.log(`${ok ? 'SAME' : 'DIFF'}  ${f.replace('.json', '')}: ${A.length} boxes, ${onlyA.length} only in A, ${onlyB.length} only in B; pixels differing ${px.size ? 'size differs' : `${px.n} of ${px.of} (${(100 * px.n / px.of).toFixed(3)}%)`}`);
    for (const x of onlyA.slice(0, 5)) console.log('   A:', JSON.stringify(x).slice(0, 200));
    for (const x of onlyB.slice(0, 5)) console.log('   B:', JSON.stringify(x).slice(0, 200));
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
}
