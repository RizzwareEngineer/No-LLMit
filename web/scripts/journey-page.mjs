// The in-page half of scripts/journey.mjs: installed before any of the page's own scripts (evaluateOnNewDocument), it
// records every frame, every long task, element-timing paints on data, and the stream's messages, and it waits for a
// region's real content (data present, shown and in the window) frame by frame. Everything it keeps is in window.__J.
// It also wraps EventSource the way checks.mjs's scriptStream does, so the journey can feed the page a message.
export function instrument() {
  const J = window.__J = { frames: [], longtasks: [], et: [], msgs: [], waits: {}, felt: [], stream: { last: null, table: null, scripted: false, feed: null } };
  // Frames: every animation frame's time, all journey long (dropped frames are the gaps).
  const frame = t => { J.frames.push(t); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) J.longtasks.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
  // Element timing on data only: an element is tagged as it is inserted (a mutation observer runs before the frame that
  // paints it) when it is inside a data region and holds text with a digit or a name of its own, so its first paint
  // is the data's, never an empty box's.
  const REGIONS = '[data-oval], [data-seat], [data-pot], #phone-stats, #race, #race-panel, #stats-panel, #stats-card, #stats-table, #pairwise, #pairwise-panel, #pairwise-card, dialog';
  const tag = el => {
    if (el.nodeType !== 1 || el.hasAttribute('elementtiming')) return;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && /[0-9A-Za-z]{2}/.test(n.data));
    if (own && el.closest(REGIONS)) el.setAttribute('elementtiming', 'data');
  };
  new MutationObserver(ms => {
    for (const m of ms) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 3) { if (n.parentElement) tag(n.parentElement); continue; }
        if (n.nodeType !== 1) continue;
        tag(n);
        for (const d of n.querySelectorAll('*')) tag(d);
      }
      // Changes on the felt (the table's seats, pot and cards), for the time from a stream message to its pixels.
      const at = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (at?.closest?.('[data-oval], [data-seat], [data-pot]')) { const t = performance.now(); if (t - (J.felt.at(-1) ?? -9) > 1) J.felt.push(t); }
    }
  }).observe(document, { childList: true, subtree: true, characterData: true });
  try {
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) J.et.push({ t: e.renderTime || e.loadTime, el: e.element, text: (e.element?.textContent ?? '').slice(0, 40) });
    }).observe({ type: 'element', buffered: true });
  } catch {}
  // Gestures, as the page sees them.
  // Gestures, as the page sees them: each input's type and time (a swipe's start and lift, a wheel notch, a click).
  J.inputs = [];
  for (const type of ['touchstart', 'touchend', 'wheel', 'click', 'keydown']) addEventListener(type, () => J.inputs.push({ type, t: performance.now() }), { capture: true, passive: true });
  // The stream: arrival times by type, and a feed to play a scripted message (as checks.mjs's scriptStream).
  const Real = window.EventSource, s = J.stream;
  window.EventSource = class extends Real {
    constructor(...a) { super(...a); this.addEventListener('message', e => { try { J.msgs.push({ t: performance.now(), type: JSON.parse(e.data).type, bytes: e.data.length }); } catch {} }); }
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

  // Real content, by region: data present, shown (no faded or hidden ancestor) and at least half in the window.
  const shown = e => { for (let a = e; a && a.nodeType === 1; a = a.parentElement) { const s = getComputedStyle(a); if (+s.opacity < 0.5 || s.visibility === 'hidden' || s.display === 'none') return false; } return true; };
  // Half in the window up and down (of the element or of the window, whichever is less tall), and some of it across
  // (a wide table scrolls sideways in its card).
  const inView = e => { const b = e.getBoundingClientRect(); if (b.width < 1 || b.height < 1) return false; const w = Math.min(b.right, innerWidth) - Math.max(b.left, 0), h = Math.min(b.bottom, innerHeight) - Math.max(b.top, 0); return w > 0 && h >= 0.5 * Math.min(b.height, innerHeight); };
  const vis = e => inView(e) && shown(e);
  // The window a target lives in is the one in view (on a desktop the overview's tiles hold the same data as the
  // Trends, Profiles and Matchups screens; a tile on the overview is not its screen).
  const screenIn = id => { const e = document.getElementById(id); return !!e && inView(e); };
  const NUM = /\d/;
  // The table's box: the phone's oval, or the desktop's table of seats.
  const felt = () => document.querySelector('[data-oval]') ?? document.querySelector('[data-seat]')?.closest('table') ?? null;
  // Data elements are many: the costly shown() walk runs on a few of them (the first, middle and last), not every one.
  const some = (a, k) => { const pick = [...new Set(Array.from({ length: k }, (_, i) => a[Math.round((i * (a.length - 1)) / Math.max(1, k - 1))]))]; return pick.every(vis); };
  const els = sel => [...document.querySelectorAll(sel)];
  const P = J.preds = {
    // The table (a phone's oval, a desktop's grid of seats): six seats or more each with a figure and a name, shown.
    table: () => { const t = felt(); if (!t || !vis(t)) return null; const seats = els('[data-seat]').filter(e => t.contains(e) && /\d/.test(e.innerText) && /[A-Za-z]{2}/.test(e.innerText)); return seats.length >= 6 ? t : null; },
    // Profits & Losses: five model figures or more, shown.
    pnl: () => { const f = els('#phone-stats [data-chips]').filter(e => NUM.test(e.textContent)); return f.length >= 5 && some(f, 3) ? document.getElementById('phone-stats') : null; },
    // Trends: a chart with three lines or more drawn from data, shown.
    trends: () => { const s = els('#race svg, #race-panel svg').find(s => [...s.querySelectorAll('path')].filter(p => (p.getAttribute('d') ?? '').length > 100).length >= 3 && inView(s)); return s && vis(s) && screenIn('race') ? s : null; },
    // Profiles: three model rows or more with figures, shown.
    // A row's figures are its cells after the first (a model's name can hold a digit: GPT-OSS 120B); a row of dashes
    // waiting for its numbers is an empty box.
    profiles: () => { const r = els('#stats-table tbody tr, #stats-panel tbody tr, #stats-card tbody tr').filter(r => [...r.cells].slice(1).some(c => NUM.test(c.textContent))).filter(r => inView(r)); return r.length >= 3 && some(r, 3) && screenIn('stats-table') ? r[0].closest('table') : null; },
    // Matchups: nine cells or more with figures, shown.
    matchups: () => { const c = els('#pairwise td[data-cell], #pairwise-panel td[data-cell], #pairwise-card td[data-cell]').filter(c => NUM.test(c.textContent)).filter(c => inView(c)); return c.length >= 9 && some(c, 3) && screenIn('pairwise') ? c[0].closest('table') : null; },
    // The desktop overview: its three tiles, each with data, on the overview's screen.
    overview: () => {
      if (!screenIn('stats')) return null;
      const svg = els('#race-panel svg').some(s => [...s.querySelectorAll('path')].filter(p => (p.getAttribute('d') ?? '').length > 100).length >= 3 && vis(s));
      const rows = els('#stats-panel tbody tr').filter(r => [...r.cells].slice(1).some(c => NUM.test(c.textContent)) && inView(r)), cells = els('#pairwise-panel td[data-cell]').filter(c => NUM.test(c.textContent) && inView(c));
      return svg && rows.length >= 3 && cells.length >= 9 && some(rows, 2) && some(cells, 2) ? document.getElementById('stats') : null;
    },
    // The model drawer: open, shown, with a figure and more than a heading.
    drawer: () => { const d = document.querySelector('dialog[open]'); return d && vis(d) && NUM.test(d.innerText) && d.innerText.length > 100 ? d : null; },
    // A phone's seat popup (a tap on a seat's logo): open, shown, with a figure.
    popup: () => { const d = document.querySelector('[data-seat-stats]'); return d && vis(d) && NUM.test(d.innerText) ? d : null; },
    closed: () => document.querySelector('dialog[open]') ? null : document.body,
    // The planted stack (journey's stream step) on the felt, shown.
    planted: () => els('[data-seat] *').find(e => e.childElementCount === 0 && e.textContent.includes('77,777') && vis(e)) ?? null,
    typing: () => els('span').find(e => e.textContent.startsWith('Qzstart') && e.textContent.endsWith('▌')) ?? null,
  };
  // Which window the page rests on: the screen most in view (at least half the window), else the table.
  J.landed = () => {
    let best = 'table', most = 0.5 * innerHeight;
    for (const id of ['phone-stats', 'stats', 'race', 'stats-table', 'pairwise', 'about']) {
      const e = document.getElementById(id); if (!e) continue;
      const b = e.getBoundingClientRect(), h = Math.min(b.bottom, innerHeight) - Math.max(b.top, 0);
      if (b.height > 1 && h >= most) { most = h; best = id; }
    }
    return best;
  };
  // Waits for a region's real content from now (or from `from`), checking each frame; resolves with the frame's time.
  J.wait = (name, ms, from) => new Promise(res => {
    const t0 = from ?? performance.now();
    // Element timing for the frame found arrives once it paints, which on a busy main thread can be well after the frame:
    // read 2 s later, paints up to 2 s past the frame.
    // The time is taken in the frame's callback, just before that frame's style, layout and paint (a frame's own
    // timestamp is its start, which can come before a change made late in it).
    const tick = () => { const t = performance.now(); let el = null; try { el = P[name](); } catch {} if (el) { J.waits[name] = { t0, at: t }; setTimeout(() => res({ t0, at: t, et: etFor(el, t0, t + 2000) }), 2000); } else if (performance.now() - t0 > ms) res({ t0, at: null }); else requestAnimationFrame(tick); };
    tick();
  });
  // The last element-timing paint of data inside `el` since t0 (null: its data painted before, or nothing was tagged).
  const etFor = (el, t0, t1) => { if (el === document.body) return null; // a page with no dialog: nothing of its own paints
    const ts = J.et.filter(e => e.t >= t0 && e.t <= t1 && e.el && el.contains(e.el)).map(e => e.t); return ts.length ? Math.max(...ts) : null; };
}
