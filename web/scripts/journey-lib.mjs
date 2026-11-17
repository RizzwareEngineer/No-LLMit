// Helpers for scripts/journey.mjs: each step's filmstrip (a frame every 100 ms, as a PNG contact sheet) and the spread
// of every metric over the runs.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

// Each step's filmstrip: at every 100 ms of the step, the last frame the screen showed by then (the screencast sends a
// frame only when the screen changes), labelled with its time from the step's start; one PNG per step.
export async function filmstrip(chrome, { frames, steps }, dir, viewport) {
  mkdirSync(dir, { recursive: true });
  frames.sort((a, b) => a.wall - b.wall);
  const thumbW = viewport.width >= 1000 ? 240 : 130, cols = viewport.width >= 1000 ? 6 : 10;
  const thumbH = Math.round((viewport.height * thumbW) / viewport.width);
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const out = [];
  try {
    const p = await b.newPage();
    for (const [k, s] of steps.entries()) {
      const slots = [];
      let fi = -1, changes = 0, prev = -1;
      for (let t = s.wall0; t <= s.wall1; t += 100) {
        while (fi + 1 < frames.length && frames[fi + 1].wall <= t) fi++;
        if (fi !== prev) { changes++; prev = fi; }
        slots.push({ ms: Math.round(t - s.wall0), fi });
      }
      const used = [...new Set(slots.map(x => x.fi).filter(i => i >= 0))];
      const imgs = Object.fromEntries(used.map(i => [i, frames[i].data]));
      await p.setViewport({ width: cols * (thumbW + 6) + 6, height: 400, deviceScaleFactor: 1 });
      await p.setContent(`<style>body{margin:0;padding:3px;font:11px system-ui,sans-serif;background:#fff;color:#333}h1{font-size:13px;margin:4px 3px}
        .g{display:grid;grid-template-columns:repeat(${cols},${thumbW}px);gap:6px}.f{display:flex;flex-direction:column}
        img,.b{width:${thumbW}px;height:${thumbH}px;outline:1px solid #ccc;object-fit:contain}.b{background:#eee}.n{outline:2px solid #d33}</style>
        <h1>${s.name}: ${((s.wall1 - s.wall0) / 1000).toFixed(1)} s, a frame every 100 ms (red: the screen changed)</h1><div class="g"></div>`);
      await p.evaluate((slots, imgs) => {
        const g = document.querySelector('.g');
        let last = -2;
        for (const sl of slots) {
          const f = document.createElement('div'); f.className = 'f';
          const im = sl.fi < 0 ? Object.assign(document.createElement('div'), { className: 'b' }) : Object.assign(document.createElement('img'), { src: `data:image/jpeg;base64,${imgs[sl.fi]}` });
          if (sl.fi !== last && last !== -2) im.classList.add('n');
          last = sl.fi;
          f.append(im, Object.assign(document.createElement('span'), { textContent: `+${(sl.ms / 1000).toFixed(1)} s` }));
          g.append(f);
        }
        return Promise.all([...document.images].map(i => i.decode().catch(() => {})));
      }, slots, imgs);
      const file = `${dir}/${String(k).padStart(2, '0')}-${s.name}.png`;
      await p.screenshot({ path: file, fullPage: true });
      out.push({ step: s.name, file, slots: slots.length, changes, blankSlots: slots.filter(x => x.fi < 0).length });
    }
  } finally { await b.close().catch(() => {}); }
  return out;
}

// n, median, mean, standard deviation, a 95% interval of the mean (Student's t), min, max, and the quartiles.
const T95 = [0, 12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.20, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.10, 2.09, 2.09];
export function stat(xs) {
  const a = xs.filter(x => typeof x === 'number' && Number.isFinite(x)).sort((p, q) => p - q), n = a.length;
  if (!n) return { n: 0 };
  const q = f => { const i = (n - 1) * f, lo = Math.floor(i); return a[lo] + (a[Math.min(n - 1, lo + 1)] - a[lo]) * (i - lo); };
  const mean = a.reduce((s, x) => s + x, 0) / n, sd = n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const h = n > 1 ? (T95[Math.min(n - 1, 20)] ?? 1.96) * sd / Math.sqrt(n) : null;
  const r = v => Math.round(v * 10) / 10;
  return { n, median: r(q(0.5)), mean: r(mean), sd: r(sd), ci95: h == null ? null : [r(mean - h), r(mean + h)], min: r(a[0]), max: r(a[n - 1]), p25: r(q(0.25)), p75: r(q(0.75)) };
}

const STEP_METRICS = ['ttc', 'longTasks', 'longTaskMs', 'longestTaskMs', 'blockingMs', 'droppedFrames', 'worstFrameMs', 'taskMs', 'scriptMs', 'bytes', 'streamBytes'];
const TOTAL_METRICS = ['taskMs', 'scriptMs', 'layoutMs', 'styleMs', 'bytes', 'nonStreamBytes', 'streamBytes', 'longTasks', 'blockingMs', 'droppedFrames'];

// The spread of each metric over the runs, per size and step; and each swipe (phone, from the lift) against the target.
export function summarize(runs, targetMs) {
  const out = { bySize: {}, swipe: {} };
  for (const size of [...new Set(runs.map(r => r.size))]) {
    const ok = runs.filter(r => r.size === size && !r.error);
    const S = out.bySize[size] = { runs: ok.length, failed: runs.filter(r => r.size === size && r.error).map(r => `run ${r.run}: ${r.error}`), steps: {}, total: {} };
    for (const name of [...new Set(ok.flatMap(r => r.steps.map(s => s.name)))]) {
      const ss = ok.map(r => r.steps.find(s => s.name === name)).filter(Boolean);
      const m = S.steps[name] = {};
      for (const k of STEP_METRICS) m[k] = stat(ss.map(s => s[k]));
      m.updateToFrameMedianMs = stat(ss.map(s => s.updateToFrameMs?.median));
      const regions = [...new Set(ss.flatMap(s => Object.keys(s.regions ?? {})))];
      if (regions.length) m.regions = Object.fromEntries(regions.map(g => [g, {
        found: `${ss.filter(s => s.regions?.[g]?.found).length}/${ss.length}`,
        fromStep: stat(ss.map(s => s.regions?.[g]?.fromStep)), fromEnd: stat(ss.map(s => s.regions?.[g]?.fromEnd)), fromStart: stat(ss.map(s => s.regions?.[g]?.fromStart)),
        etFound: `${ss.filter(s => s.regions?.[g]?.etAt != null).length}/${ss.length}`,
      }]));
      if (name === 'load') m.lcp = stat(ss.map(s => s.lcp?.t));
      const errs = ss.filter(s => s.error).map(s => s.error);
      if (errs.length) m.errors = errs;
    }
    for (const k of TOTAL_METRICS) S.total[k] = stat(ok.map(r => r.total[k]));
    if (size === 'phone') {
      for (const name of Object.keys(S.steps).filter(n => n.startsWith('to-'))) {
        const v = ok.map(r => r.steps.find(s => s.name === name)?.ttc).filter(x => typeof x === 'number');
        const miss = ok.length - v.length;
        out.swipe[name] = { targetMs, ...stat(v), within: v.filter(x => x <= targetMs).length, of: ok.length, notShownIn10s: miss,
          verdict: miss === 0 && v.length && v.every(x => x <= targetMs) ? 'within target every run' : `over target in ${v.filter(x => x > targetMs).length + miss} of ${ok.length} runs` };
      }
    }
  }
  return out;
}
