'use client'

// Phone draft A (app/a): under the table and its caption, the rest of the first screen holds one live thing, sized to the
// space left (owner, 2026-11-22: "fill that space with either the P&L, or we just fill it with trends. If they click on
// it, then they should get the expanded graph"). ?fill=graph (default: the Trends lines alone, no controls), pnl (Profits
// & Losses, its rows re-sorting without a slide) or both (the graph, P&L under it). A tap opens the full Trends window.
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import WinningsPanel from '@/components/WinningsPanel';
import { pageTo } from '@/components/Section';
import { MUTED, seatedModels, type ModelStats, type StatsResponse } from '@/lib/stats';
import { series } from '@/lib/series';
import { shortName } from '@/lib/names';
import type { PlayerState } from '@/lib/api';

type Fill = 'graph' | 'pnl' | 'both';
const noSub = () => () => {};
const useFill = () => useSyncExternalStore(noSub, (): Fill => { const f = new URLSearchParams(location.search).get('fill'); return f === 'pnl' || f === 'both' ? f : 'graph'; }, (): Fill => 'graph');
const RING = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };

export default function LandingFill({ stats, players }: { stats: StatsResponse | null; players: PlayerState[] }) {
  const fill = useFill();
  const box = useRef<HTMLButtonElement>(null);
  const [h, setH] = useState(0);
  // The space the first screen has left under the caption, above the tab bar.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const size = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-h')) || 0;
      setH(Math.max(180, Math.round(window.innerHeight - top - bar - 12)));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  const field = useMemo(() => seatedModels(stats?.models ?? [], stats?.seated), [stats]);
  return (
    <button ref={box} type="button" data-landing-fill onClick={() => pageTo('race')} aria-label="Open Trends"
      className="mt-2 w-full text-left flex flex-col gap-2" style={{ height: h || undefined, visibility: h ? undefined : 'hidden' }}>
      {fill !== 'pnl' && (
        <div className="relative flex-1 min-h-0 w-full bg-white rounded overflow-hidden" style={RING}>
          <LandingChart models={field} />
        </div>
      )}
      {fill === 'pnl' && (
        <div className="flex-1 min-h-0 w-full flex flex-col">
          <WinningsPanel players={players} still />
        </div>
      )}
      {fill === 'both' && <SessionGrid players={players} />}
    </button>
  );
}

// The live lines alone: each seated model's net big blinds over the hands it has played, filling the space given, a dot
// and its name and figure at each line's end (pushed apart so none overlap). No controls: a tap opens Trends.
function LandingChart({ models }: { models: ModelStats[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const lines = models.map(m => ({ name: m.name, color: modelColor(m.name), pts: series(m, 'bb') })).filter(l => l.pts.length > 1);
  if (!size || !lines.length) return <div ref={ref} className="absolute inset-0" />;
  const LABEL = 118, L = 10, R = LABEL + 14, T = 26, B = 14, ROW = 15;
  const maxX = Math.max(1, ...lines.map(l => l.pts[l.pts.length - 1][0]));
  const ys = lines.flatMap(l => l.pts.map(p => p[1]));
  const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), span = hi - lo || 1;
  const x = (v: number) => L + (v / maxX) * (size.w - L - R);
  const y = (v: number) => T + (1 - (v - lo) / span) * (size.h - T - B);
  const path = (pts: [number, number][]) => {
    const every = Math.max(1, Math.ceil(pts.length / 240));
    return pts.filter((_, i) => i % every === 0 || i === pts.length - 1).map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  };
  const ends = lines.map(l => { const e = l.pts[l.pts.length - 1]; return { ...l, e, ty: y(e[1]) }; }).sort((a, b) => a.ty - b.ty);
  for (let i = 1; i < ends.length; i++) ends[i].ty = Math.max(ends[i].ty, ends[i - 1].ty + ROW);
  const over = ends.length ? ends[ends.length - 1].ty - (size.h - B) : 0;
  if (over > 0) for (const e of ends) e.ty -= over;
  for (let i = 0; i < ends.length; i++) ends[i].ty = Math.max(ends[i].ty, T + i * ROW);
  const fmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
  return (
    <div ref={ref} className="absolute inset-0">
      <svg width={size.w} height={size.h} role="img" aria-label="Net big blinds over hands played, each seated model">
        <text x={L} y={16} fontSize={11} fill={MUTED}>Net big blinds, all time</text>
        <line x1={L} x2={size.w - R} y1={y(0)} y2={y(0)} stroke="rgba(55, 53, 47, 0.25)" strokeDasharray="3 3" />
        {lines.map(l => <path key={l.name} d={path(l.pts)} fill="none" stroke={l.color} strokeWidth={1.5} strokeLinejoin="round" />)}
        {ends.map(e => (
          <g key={e.name}>
            <line x1={x(e.e[0])} y1={y(e.e[1])} x2={size.w - LABEL - 6} y2={e.ty} stroke={e.color} strokeOpacity={0.35} />
            <circle cx={x(e.e[0])} cy={y(e.e[1])} r={2.5} fill={e.color} />
            <text x={size.w - LABEL} y={e.ty + 4} fontSize={11} fill="rgb(55, 53, 47)">
              <tspan fontWeight={700} fill={e.color}>{fmt(e.e[1])}</tspan> {shortName(e.name)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// "Both": the graph, and under it this session's Profits & Losses as three short rows of three (no slide, no rolls).
function SessionGrid({ players }: { players: PlayerState[] }) {
  const ranked = [...players].sort((a, b) => (b.winnings || 0) - (a.winnings || 0));
  return (
    <div className="w-full bg-white rounded px-2 py-1.5" style={RING}>
      <div className="text-[11px] mb-1" style={{ color: MUTED }}>This session</div>
      <ol className="grid grid-cols-3 gap-x-2 gap-y-1">
        {ranked.map(p => {
          const v = p.winnings || 0, color = v > 0 ? 'rgb(15, 123, 108)' : v < 0 ? 'rgb(200, 50, 50)' : MUTED;
          return (
            <li key={p.id} className="flex items-center gap-1 min-w-0 text-[11px]">
              <LLMLogo model={p.name} size={12} />
              <span className="truncate min-w-0" style={{ color: 'rgb(55, 53, 47)' }}>{shortName(p.name)}</span>
              <span className="ml-auto font-bold tabular-nums shrink-0" style={{ color }}>{v > 0 ? '+' : v < 0 ? '−' : ''}{Math.abs(v).toLocaleString('en-US')}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
