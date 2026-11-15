// What zoom-tolerable (checks.mjs) and the zoom sweep (zoomsweep.mjs) read off a page, in CSS px; both run in the page.

// The window as it is: sideways page scroll, the fixed chrome's share of the height (fixed or stuck-sticky boxes at
// least half the window wide, outside dialogs and popups, not a full-window backdrop; overlapping ones counted once), and
// the smallest visible text (`skip`: a selector whose text is not counted).
export const measure = (skip = '') => {
  const vw = innerWidth, vh = innerHeight, de = document.documentElement;
  const vis = e => { const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const spans = [];
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    if (e.closest('dialog, [role=dialog]')) continue;
    const r = e.getBoundingClientRect();
    if (r.height < 4 || r.width < vw * 0.5 || r.bottom <= 0 || r.top >= vh || r.height > vh * 0.9 || !vis(e)) continue;
    if (s.position === 'sticky' && r.top > 2 && r.bottom < vh - 2) continue; // a sticky box not held at an edge
    if (s.position === 'sticky' && e.parentElement && e.parentElement.getBoundingClientRect().height < vh * 0.5) continue; // a table's sticky header row
    spans.push([Math.max(0, r.top), Math.min(vh, r.bottom), e.tagName.toLowerCase() + (e.getAttribute('aria-label') ? `[${e.getAttribute('aria-label')}]` : '')]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let chrome = 0, end = -1;
  for (const [t, b] of spans) { if (b <= end) continue; chrome += b - Math.max(t, end); end = b; }
  let minFont = 99, minAt = '';
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    if (!n.textContent.trim()) continue;
    const p = n.parentElement;
    if (!p || p.closest('[aria-hidden=true], .sr-only, script, style, noscript') || (skip && p.closest(skip))) continue;
    const r = p.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw || !vis(p)) continue;
    const f = parseFloat(getComputedStyle(p).fontSize);
    if (f < minFont) { minFont = f; minAt = `${p.tagName.toLowerCase()} "${n.textContent.trim().slice(0, 20)}"`; }
  }
  return { vw, vh, hscroll: Math.max(0, de.scrollWidth - de.clientWidth), chrome: Math.round(chrome), chromePct: Math.round(chrome / vh * 1000) / 10, chromeEls: spans.map(s => s[2]).join(' '), minFont: Math.round(minFont * 10) / 10, minAt };
};

// The open popup (`sel`): wholly inside the window (±1px), and, where its content is taller than it, it scrolls (a popup
// whose body is its own scroller, the prompt dialog's, is never taller than its content box).
export const modalBox = sel => {
  const d = [...document.querySelectorAll(sel)].find(e => e.getBoundingClientRect().height > 0);
  if (!d) return null;
  const r = d.getBoundingClientRect();
  const inside = r.top >= -1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1;
  const o = getComputedStyle(d).overflowY;
  const overflows = d.scrollHeight > d.clientHeight + 1;
  return { inside, t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), overflows, scrolls: o === 'auto' || o === 'scroll' };
};
