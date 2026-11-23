'use client'

// Phone draft A (app/a): under the table and its caption, the rest of the first screen above the tab bar holds Trends' lines
// (owner, 2026-11-22: "fill that space with either the P&L, or we just fill it with trends. If they click on it, then they
// should get the expanded graph"), sized to exactly that space: on a real phone (its browser's bars take about a fifth of
// the screen) it is 90 to 170px tall, never under the tab bar. Where less than MIN_H is left, nothing: Trends is the next
// window. No controls: a tap opens the Trends window.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import { pageTo } from '@/components/Section';
import { MUTED, seatedModels, signed, type ModelStats, type StatsResponse } from '@/lib/stats';
import { RATE_FROM, robustRange, series } from '@/lib/series';
import { replayStarted, skipReplay } from '@/lib/timeline';

const RING = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };
const MIN_H = 80; // under this the plot is a smear under its title

export default function LandingFill({ stats }: { stats: StatsResponse | null }) {
  const box = useRef<HTMLDivElement>(null);
  // Where the fill starts on the page, and the height that leaves it: 100svh (steady while iOS's address bar hides and
  // shows) less --bar-h, which it inherits from the page (the tab bar, and the connection bar while that shows).
  const [top, setTop] = useState<number | null>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const at = () => { setTop(Math.round(el.getBoundingClientRect().top + window.scrollY)); setH(el.clientHeight); };
    at();
    // The table or the caption above changing height moves the fill; its own height follows from that.
    const ro = new ResizeObserver(at);
    ro.observe(document.body);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);
  // The first screen shows the lines at their end, so Trends opens on those (owner: a tap gives "the expanded graph"), not
  // on a replay from the first hand; its Replay button still plays it.
  useEffect(() => { if (!replayStarted()) skipReplay(); }, []);
  const field = useMemo(() => seatedModels(stats?.models ?? [], stats?.seated), [stats]);
  const open = () => {
    document.getElementById('race-panel')?.focus({ preventScroll: true });
    pageTo('race');
  };
  return (
    <div ref={box} data-landing-fill className="relative w-full"
      style={top === null ? { visibility: 'hidden' } : { height: `max(0px, calc(100svh - ${top}px - var(--bar-h, 0px) - 12px))` }}>
      {h >= MIN_H && (
        <>
          <div className="absolute inset-0 bg-white rounded overflow-hidden" style={RING}>
            <LandingChart models={field} />
          </div>
          {/* One button over the whole fill: no part of it takes a tap of its own. */}
          <button type="button" onClick={open} aria-label="Open Trends" className="absolute inset-0 rounded [-webkit-tap-highlight-color:transparent] active:bg-black/[0.03]" />
        </>
      )}
    </div>
  );
}

// Trends' lines (its default: each seated model's bb/100), from the RATE_FROM-th hand on, as the Trends window draws them
// (a rate over a few hands swings off any scale), filling the card. Each line's end has its logo and figure, spread apart
// so none overlap: their size follows the room, one row per line down the card's height.
const T = 26, B = 8, L = 8;
function LandingChart({ models }: { models: ModelStats[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize(s => (s && s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure(); // before the first paint: no frame without its lines
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const title = <div className="absolute left-3 top-1.5 text-[13px] leading-4" style={{ color: MUTED }}>Trends · bb/100</div>;
  const lines = models.map(m => ({ name: m.name, color: modelColor(m.name), pts: series(m, 'bb100') })).filter(l => l.pts.length > 1);
  if (!size || !lines.length) return <div ref={ref} className="absolute inset-0">{title}</div>;
  const maxX = Math.max(1, ...lines.map(l => l.pts[l.pts.length - 1][0]));
  const x0 = maxX > RATE_FROM * 2 ? RATE_FROM : 0; // a session's first hands: all of them
  const shown = lines.map(l => ({ ...l, pts: l.pts.filter(p => p[0] >= x0) })).filter(l => l.pts.length > 1);
  // Trends' own fit (robustRange): 5th to 95th percentile of the rates and the lines' ends; a swing outside it is cut at
  // the plot's edge (clipPath).
  const [lo, hi] = robustRange(shown.flatMap(l => l.pts.map(p => p[1])), shown.map(l => l.pts[l.pts.length - 1][1]));
  const span = hi - lo || 1;
  // The labels: one row per line down the card (its whole height: the title is at the left), the logo and figure sized to
  // the row (16px and 13px in a tall card, 10px and 9px at the least).
  const n = shown.length, row = n > 1 ? Math.min(18, (size.h - 4) / n) : 18;
  const logo = Math.max(10, Math.min(16, Math.floor(row - 2))), font = Math.max(9, Math.min(13, Math.floor(row - 4)));
  const figs = shown.map(l => signed(Math.round(l.pts[l.pts.length - 1][1]), 0));
  const label = logo + 4 + Math.ceil(Math.max(...figs.map(f => f.length)) * font * 0.62);
  const R = label + 10;
  const x = (v: number) => L + ((v - x0) / (maxX - x0 || 1)) * (size.w - L - R);
  const y = (v: number) => T + (1 - (v - lo) / span) * (size.h - T - B);
  const path = (pts: [number, number][]) => {
    const every = Math.max(1, Math.ceil(pts.length / 240));
    return pts.filter((_, i) => i % every === 0 || i === pts.length - 1).map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  };
  // Each label's middle at its line's end, at least a row from the next, all inside the card.
  const ends = shown.map((l, i) => { const e = l.pts[l.pts.length - 1]; return { ...l, e, fig: figs[i], ty: y(e[1]) }; }).sort((a, b) => a.ty - b.ty);
  const first = row / 2 + 2, last = size.h - row / 2 - 2;
  for (let i = 0; i < n; i++) ends[i].ty = Math.max(ends[i].ty, i ? ends[i - 1].ty + row : first);
  for (let i = n - 1; i >= 0; i--) ends[i].ty = Math.min(ends[i].ty, i < n - 1 ? ends[i + 1].ty - row : last);
  return (
    <div ref={ref} className="absolute inset-0">
      {title}
      <svg width={size.w} height={size.h} className="absolute inset-0" role="img" aria-label="bb/100 over hands played, each seated model">
        <clipPath id="landing-plot"><rect x={0} y={T - 4} width={size.w} height={size.h - T - B + 8} /></clipPath>
        {lo < 0 && hi > 0 && <line x1={L} x2={size.w - R} y1={y(0)} y2={y(0)} stroke="rgba(55, 53, 47, 0.25)" strokeDasharray="3 3" />}
        <g clipPath="url(#landing-plot)">
          {shown.map(l => <path key={l.name} d={path(l.pts)} fill="none" stroke={l.color} strokeWidth={1.5} strokeLinejoin="round" />)}
        </g>
        {ends.map(e => <circle key={e.name} cx={x(e.e[0])} cy={Math.min(Math.max(y(e.e[1]), T - 4), size.h - B + 4)} r={2.5} fill={e.color} />)}
        {ends.map(e => <line key={e.name} x1={x(e.e[0])} y1={Math.min(Math.max(y(e.e[1]), T - 4), size.h - B + 4)} x2={size.w - label - 4} y2={e.ty} stroke={e.color} strokeOpacity={0.35} />)}
      </svg>
      {ends.map(e => (
        <div key={e.name} className="absolute flex items-center gap-1 font-bold tabular-nums whitespace-nowrap" style={{ left: size.w - label, top: e.ty - row / 2, height: row, fontSize: font, lineHeight: `${row}px`, color: e.color }}>
          <LLMLogo model={e.name} size={logo} />
          {e.fig}
        </div>
      ))}
    </div>
  );
}
