'use client'

// Phone draft A (app/a): under the table and its caption, the rest of the first screen above the tab bar (owner, 2026-11-22:
// "fill that space with either the P&L, or we just fill it with trends. If they click on it, then they should get the
// expanded graph"; "Why is the table so small in relation to the graph?"). Exactly that space, never under the tab bar: on
// a real phone (its browser's bars take about a fifth of the screen) 250 to 350px, so Trends' lines no taller than the
// table, and this session's Profits & Losses under them in the rest. A tap anywhere on it opens the Trends window.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import FitName from '@/components/FitName';
import { pageTo } from '@/components/Section';
import { MUTED, seatedModels, signed, type ModelStats, type StatsResponse } from '@/lib/stats';
import { RATE_FROM, robustRange, series } from '@/lib/series';
import { replayStarted, skipReplay } from '@/lib/timeline';
import { formatAmount, useBigBlind } from '@/lib/amounts';
import type { PlayerState } from '@/lib/api';

const RING = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };
const MIN_H = 80; // a chart under this is a smear under its title: nothing
const MIN_CHART = 110, PNL_H = 128; // with P&L: the lines at least this tall, P&L's title and five rows of two

export default function LandingFill({ stats, players }: { stats: StatsResponse | null; players: PlayerState[] }) {
  const box = useRef<HTMLDivElement>(null);
  // Where the fill starts on the page, the height that leaves it (100svh, steady while iOS's address bar hides and shows,
  // less --bar-h, which it inherits from the page: the tab bar, and the connection bar while that shows), and the table's.
  const [top, setTop] = useState<number | null>(null);
  const [h, setH] = useState(0);
  const [tableH, setTableH] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const at = () => {
      setTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
      setH(el.clientHeight);
      setTableH(Math.round(document.querySelector('[data-a-table]')?.getBoundingClientRect().height ?? 0));
    };
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
  // The lines no taller than the table (a graph never dwarfs it), P&L the rest; on a phone with no room for both, the lines.
  const cap = tableH || h, both = players.length > 0 && h >= MIN_CHART + 8 + PNL_H;
  const chartH = both ? Math.min(cap, h - 8 - PNL_H) : Math.min(cap, h);
  return (
    <div ref={box} data-landing-fill className="relative w-full flex flex-col gap-2"
      style={top === null ? { visibility: 'hidden' } : { height: `max(0px, calc(100svh - ${top}px - var(--bar-h, 0px) - 12px))` }}>
      {chartH >= MIN_H && (
        <>
          <div className="relative w-full shrink-0 bg-white rounded overflow-hidden" style={{ ...RING, height: chartH }}>
            <LandingChart models={field} />
          </div>
          {both && <div className="relative w-full flex-1 bg-white rounded overflow-hidden" style={RING}><Pnl players={players} /></div>}
          {/* One button over the whole fill: no part of it takes a tap of its own. */}
          <button type="button" onClick={open} aria-label="Open Trends" className="absolute inset-0 rounded [-webkit-tap-highlight-color:transparent] active:bg-black/[0.03]" />
        </>
      )}
    </div>
  );
}

// This session's Profits & Losses (WinningsPanel's figures) in two columns, ranked, each with its line's colour; a new
// rank moves a row at once (the panel's sliding rows "jiggle", owner 2026-11-22). Its rows share the height it is given.
function Pnl({ players }: { players: PlayerState[] }) {
  const bb = useBigBlind();
  const ranked = [...players].sort((a, b) => (b.winnings || 0) - (a.winnings || 0));
  return (
    <div className="absolute inset-0 flex flex-col px-3 pt-1.5 pb-1">
      <div className="text-[13px] leading-4" style={{ color: MUTED }}>Profits &amp; Losses · this session{bb ? ' · BB' : ''}</div>
      <ol className="flex-1 grid grid-cols-2 grid-flow-col gap-x-4" style={{ gridTemplateRows: `repeat(${Math.ceil(ranked.length / 2)}, 1fr)` }}>
        {ranked.map(p => {
          const w = p.winnings || 0;
          return (
            <li key={p.id} className="flex items-center gap-1.5 min-w-0">
              <span aria-hidden className="w-[3px] h-3.5 rounded-full shrink-0" style={{ background: modelColor(p.name) }} />
              <LLMLogo model={p.name} size={14} />
              <div className="flex-1 min-w-0"><FitName name={p.name} className="text-[12px] font-medium" style={{ color: 'rgb(55, 53, 47)' }} /></div>
              <span data-chips={Math.abs(w)} className="text-[12px] font-bold tabular-nums shrink-0" style={{ color: w > 0 ? 'rgb(15, 123, 108)' : w < 0 ? 'rgb(200, 50, 50)' : MUTED }}>
                {w > 0 ? '+' : w < 0 ? '−' : ''}{formatAmount(Math.abs(w), bb, false)}
              </span>
            </li>
          );
        })}
      </ol>
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
