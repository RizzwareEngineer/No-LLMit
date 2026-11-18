// The fixture's endpoint guard: an HTTP proxy every fixture browser goes through (chrome.sh points Chrome at it, loopback
// included). It forwards only what the fixture serves: any path on the site, and the engine's own endpoints. Every other
// request (another engine path, any other host, any https CONNECT) gets a 599 and is written to the violations file;
// run.sh fails the run when that file is not empty.
//   node guard.mjs --port 8899 --site http://localhost:3301[,http://localhost:3302] --engine http://localhost:8090 --violations FILE [--freeze N]
// --freeze N (frozen mode, for frozen.mjs; test runs only, nothing of it is in any site build): at start the guard reads the
// engine's stream until it has N events and then closes it; every page's /stream gets those N events and then stays open and
// quiet (a paused table), and each engine GET (/api/stats, /api/stats/timeline, /api/usage) is fetched once and the same
// body served to every page. Started right after a fresh fixture engine, the N events are the same every run (seeded deck
// and model) up to ids and times; frozen.mjs pins the page clock to /__fixture/frozen-at, the time the prefix was read.
import http from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = +arg('--port', 8899);
const SITES = arg('--site', 'http://localhost:3301').split(',').map(s => new URL(s)); // more than one for an A/A (aa.mjs)
const ENGINE = new URL(arg('--engine', 'http://localhost:8090')); // the build's NEXT_PUBLIC_API_URL, where the engine listens
const VIOL = arg('--violations', 'fixture-violations.jsonl');
const FREEZE = +arg('--freeze', 0) || 0;
// The engine's endpoints (engine/api/server.go Start). /dev/pace is not among them: a fixture engine never sets DEV_CONTROLS.
const ENGINE_PATHS = new Set(['/stream', '/api/stats', '/api/stats/timeline', '/api/usage', '/api/waitlist', '/health']);
writeFileSync(VIOL, '');

const isLoop = h => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(h);
const sameHost = (u, base) => (u.hostname === base.hostname || (isLoop(u.hostname) && isLoop(base.hostname))) && (u.port || '80') === (base.port || '80');
// Chrome's own background calls (updates, sign-in, time sync, safe browsing) to its service hosts, which flags do not stop
// in branded Chrome: logged beside the violations, not in them. Only Chrome's service hosts are here (review 6, R6-12):
// any other Google host a page could use (fonts.googleapis.com, fonts.gstatic.com, storage or firebase on googleapis.com,
// www.gstatic.com) is a violation, and so is any plain request whose Referer or Origin is a fixture site.
const CHROME_OWN = /^(?:accounts\.google\.com|clients\d*\.google\.com|[a-z0-9-]+\.clients\.google\.com|www\.google\.com|update\.googleapis\.com|safebrowsing(?:-[a-z0-9]+)?\.googleapis\.com|[a-z0-9-]+-pa\.googleapis\.com|content-autofill\.googleapis\.com|chromewebstore\.googleapis\.com|(?:[a-z0-9-]+\.)*gvt1\.com)(?::\d+)?$/;
const fromSite = req => { for (const h of [req?.headers?.referer, req?.headers?.origin]) { try { if (h && SITES.some(s => sameHost(new URL(h), s))) return true; } catch {} } return false; };
const chromeOwn = (method, url, req) => {
  if (fromSite(req)) return false;
  let host = '';
  try { host = method === 'CONNECT' ? url : new URL(url).host; } catch {}
  return CHROME_OWN.test(host);
};
const violation = (method, url, why, req) => {
  appendFileSync(chromeOwn(method, url, req) ? VIOL + '.chrome' : VIOL, JSON.stringify({ at: new Date().toISOString(), method, url, why }) + '\n');
};
const deny = (res, why, method, url, req) => {
  violation(method, url, why, req);
  res.writeHead(599, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end(`fixture guard: ${why}`);
};
const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

// Frozen mode's recorded stream prefix and cached reads.
let frozen = null; // { events: string, at: number } once read
const frozenReady = !FREEZE ? null : new Promise((resolve, reject) => {
  const start = () => http.get({ host: ENGINE.hostname, port: ENGINE.port, path: '/stream' }, r => {
    let n = 0, buf = '', out = '';
    r.setEncoding('utf8'); r.on('error', () => {});
    r.on('data', chunk => {
      buf += chunk;
      let i;
      while (n < FREEZE && (i = buf.indexOf('\n\n')) >= 0) {
        const ev = buf.slice(0, i + 2); buf = buf.slice(i + 2);
        if (ev.startsWith(':')) continue; // heartbeats are not events
        out += ev; n++;
      }
      if (n >= FREEZE) { frozen = { events: out, at: Date.now() }; r.destroy(); resolve(); }
    });
  }).on('error', e => reject(e));
  start();
});
const cache = new Map();
const fetchOnce = path => {
  if (!cache.has(path)) cache.set(path, frozenReady.then(() => new Promise((resolve, reject) => {
    http.get({ host: ENGINE.hostname, port: ENGINE.port, path }, r => {
      const parts = []; r.on('data', c => parts.push(c)); r.on('end', () => resolve({ status: r.statusCode, type: r.headers['content-type'], body: Buffer.concat(parts) }));
    }).on('error', reject);
  })));
  cache.get(path).catch(() => cache.delete(path)); // a failed read is tried again by the next page
  return cache.get(path);
};

const server = http.createServer(async (req, res) => {
  req.on('error', () => {}); res.on('error', () => {}); // a page that closes mid-request is not the guard's failure
  let u;
  try { u = new URL(req.url); } catch { return deny(res, 'not a proxy request', req.method, req.url, req); }
  let to;
  const site = SITES.find(s => sameHost(u, s));
  if (site) to = site;
  else if (sameHost(u, ENGINE)) {
    if (FREEZE && u.pathname === '/__fixture/frozen-at') { await frozenReady; res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ at: frozen.at })); }
    if (!ENGINE_PATHS.has(u.pathname)) return deny(res, 'engine path the fixture does not serve', req.method, req.url, req);
    if (FREEZE && u.pathname === '/stream') {
      await frozenReady;
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
      res.write(frozen.events);
      const hb = setInterval(() => res.write(': hb\n\n'), 15000);
      req.on('close', () => clearInterval(hb));
      return;
    }
    if (FREEZE && req.method === 'GET' && u.pathname !== '/health') {
      const r = await fetchOnce(u.pathname + u.search);
      res.writeHead(r.status, { ...cors, 'Content-Type': r.type || 'application/json' });
      return res.end(r.body);
    }
    to = ENGINE;
  } else return deny(res, 'host outside the fixture', req.method, req.url, req);
  const up = http.request({ host: to.hostname, port: to.port || 80, method: req.method, path: u.pathname + u.search,
    headers: { ...req.headers, host: u.host } }, ur => { ur.on("error", () => res.destroy()); res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); });
  up.on('error', e => { if (!res.headersSent) res.writeHead(502); res.end(String(e.message)); });
  res.on('close', () => up.destroy());
  req.pipe(up);
});
// https (or any tunnel): nothing in the fixture is served over TLS.
server.on('clientError', (e, sock) => sock.destroy());
server.on('connect', (req, sock) => { sock.on('error', () => {}); violation('CONNECT', req.url, 'tunnel outside the fixture', req); sock.end('HTTP/1.1 599 Fixture Guard\r\n\r\n'); });
server.listen(PORT, '127.0.0.1', () => console.log(`guard on ${PORT}: site ${SITES.map(s => s.host).join(' ')}, engine ${ENGINE.host}${FREEZE ? `, frozen after ${FREEZE} events` : ''}`));
