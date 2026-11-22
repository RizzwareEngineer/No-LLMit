'use client'

// Phone draft A (app/a): under the table and its caption, the rest of the first screen holds one live thing, sized to the
// space left (owner, 2026-11-22: "fill that space with either the P&L, or we just fill it with trends. If they click on
// it, then they should get the expanded graph"). ?fill=graph (default: the Trends lines alone, no controls), pnl (Profits
// & Losses, its rows re-sorting without a slide) or both (the graph, this session's P&L under it). A tap anywhere on it
// opens the full Trends window.
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import WinningsPanel from '@/components/WinningsPanel';
import { pageTo } from '@/components/Section';
import { MUTED, netColor, seatedModels, signed, type ModelStats, type StatsResponse } from '@/lib/stats';
import { series } from '@/lib/series';
import { formatAmount, useBigBlind } from '@/lib/amounts';
import type { PlayerState } from '@/lib/api';

type Fill = 'graph' | 'pnl' | 'both';
const noSub = () => () => {};
const useFill = () => useSyncExternalStore(noSub, (): Fill => { const f = new URLSearchParams(location.search).get('fill'); return f === 'pnl' || f === 'both' ? f : 'graph'; }, (): Fill => 'graph');
const RING = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };

export default function LandingFill({ stats, players }: { stats: StatsResponse | null; players: PlayerState[] }) {
  const fill = useFill();
  const box = useRef<HTMLDivElement>(null);
  // Where the fill starts on the page. It takes the rest of the first screen above the bars at the bottom: 100svh (steady
  // while iOS's address bar hides and shows) less --bar-h, which it inherits from the page (the tab bar, and the connection
  // bar while that shows). At least that: a short phone's P&L grows past the screen rather than cutting rows off.
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const at = () => setTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
    at();
    const ro = new ResizeObserver(at); // the table or the caption above changing height
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  const field = useMemo(() => seatedModels(stats?.models ?? [], stats?.seated), [stats]);
  const open = () => {
    document.getElementById('race-panel')?.focus({ preventScroll: true });
    pageTo('race');
  };
  return (
    <div ref={box} data-landing-fill className="relative mt-2 w-full flex flex-col gap-2"
      style={top === null ? { visibility: 'hidden' } : { minHeight: `max(180px, calc(100svh - ${top}px - var(--bar-h, 0px) - 12px))` }}>
      {fill !== 'pnl' && (
        <div className="relative flex-1 min-h-[180px] w-full bg-white rounded overflow-hidden" style={RING}>
          <LandingChart models={field} />
        </div>
      )}
      {fill === 'pnl' && <WinningsPanel players={players} landing />}
      {fill === 'both' && <SessionGrid players={players} />}
      {/* One button over the whole fill: what it shows stays readable text, and no part of it takes a tap of its own. */}
      <button type="button" onClick={open} aria-label="Open Trends" className="absolute inset-0 rounded [-webkit-tap-highlight-color:transparent] active:bg-black/[0.03]" />
    </div>
  );
}

// The live lines alone: each seated model's net big blinds over the hands it has played, filling the space given, and at
// each line's end its logo and figure (spread apart so none overlap, all inside). No controls: a tap opens Trends.
const T = 28, B = 10, L = 8, LABEL = 76, ROW = 18;
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
  const title = <div className="absolute left-2 top-1.5 text-[13px] leading-4" style={{ color: MUTED }}>Net big blinds, all time</div>;
  const lines = models.map(m => ({ name: m.name, color: modelColor(m.name), pts: series(m, 'bb') })).filter(l => l.pts.length > 1);
  if (!size || !lines.length) return <div ref={ref} className="absolute inset-0">{title}</div>;
  const R = LABEL + 10;
  const maxX = Math.max(1, ...lines.map(l => l.pts[l.pts.length - 1][0]));
  const ys = lines.flatMap(l => l.pts.map(p => p[1]));
  const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), span = hi - lo || 1;
  const x = (v: number) => L + (v / maxX) * (size.w - L - R);
  const y = (v: number) => T + (1 - (v - lo) / span) * (size.h - T - B);
  const path = (pts: [number, number][]) => {
    const every = Math.max(1, Math.ceil(pts.length / 240));
    return pts.filter((_, i) => i % every === 0 || i === pts.length - 1).map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  };
  // Each label's middle at its line's end, at least a row from the next, all between the top and the bottom: rows shrink
  // when there are more labels than rows (a short chart, a full table), so none is pushed outside.
  const ends = lines.map(l => { const e = l.pts[l.pts.length - 1]; return { ...l, e, ty: y(e[1]) }; }).sort((a, b) => a.ty - b.ty);
  const first = T + 8, last = size.h - B - 8;
  const gap = ends.length > 1 ? Math.min(ROW, (last - first) / (ends.length - 1)) : ROW;
  for (let i = 0; i < ends.length; i++) ends[i].ty = Math.max(ends[i].ty, i ? ends[i - 1].ty + gap : first);
  for (let i = ends.length - 1; i >= 0; i--) ends[i].ty = Math.min(ends[i].ty, i < ends.length - 1 ? ends[i + 1].ty - gap : last);
  return (
    <div ref={ref} className="absolute inset-0">
      {title}
      <svg width={size.w} height={size.h} className="absolute inset-0" role="img" aria-label="Net big blinds over hands played, each seated model">
        <line x1={L} x2={size.w - R} y1={y(0)} y2={y(0)} stroke="rgba(55, 53, 47, 0.25)" strokeDasharray="3 3" />
        {lines.map(l => <path key={l.name} d={path(l.pts)} fill="none" stroke={l.color} strokeWidth={1.5} strokeLinejoin="round" />)}
        {ends.map(e => (
          <g key={e.name}>
            <line x1={x(e.e[0])} y1={y(e.e[1])} x2={size.w - LABEL - 4} y2={e.ty} stroke={e.color} strokeOpacity={0.35} />
            <circle cx={x(e.e[0])} cy={y(e.e[1])} r={2.5} fill={e.color} />
          </g>
        ))}
      </svg>
      {ends.map(e => (
        <div key={e.name} className="absolute flex items-center gap-1 text-[13px] leading-4 font-bold tabular-nums whitespace-nowrap" style={{ left: size.w - LABEL, top: e.ty - 8, color: e.color }}>
          <LLMLogo model={e.name} size={16} />
          {signed(Math.round(e.e[1]), 0)}
        </div>
      ))}
    </div>
  );
}

// "Both": under the graph, this session's Profits & Losses as three short rows of three, each seat's logo and figure (the
// table above names them), re-sorting without a slide.
function SessionGrid({ players }: { players: PlayerState[] }) {
  const bb = useBigBlind();
  const ranked = [...players].sort((a, b) => (b.winnings || 0) - (a.winnings || 0));
  return (
    <div className="w-full bg-white rounded px-3 py-2" style={RING}>
      <div className="flex justify-between mb-1.5 text-[13px] leading-4" style={{ color: MUTED }}>
        <span>This session</span>
        {bb && <span>BB</span>}
      </div>
      <ol className="grid grid-cols-3 gap-x-3 gap-y-1.5">
        {ranked.map(p => {
          const v = p.winnings || 0;
          return (
            <li key={p.id} className="flex items-center gap-1 text-[13px] leading-4 font-bold tabular-nums" style={{ color: netColor(v) }}>
              <LLMLogo model={p.name} size={16} />
              {v > 0 ? '+' : v < 0 ? '−' : ''}{formatAmount(Math.abs(v), bb, false)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
