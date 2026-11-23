'use client'

// Phone draft A's tiles: the landing fill under the table (LandingFill) and the stats overview, the window under it
// (StatsSections' PhoneStats; owner, 2026-11-23: "the next page should be all 3 stats in one view"). Each tile is a
// small, still picture of its part, sized to the box it is given; a tap anywhere on it opens the part (openPart).
import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import FitName from '@/components/FitName';
import { pairTint, FAINT } from '@/components/HeadToHead';
import { openPart } from '@/components/Section';
import { MIN_PAIR_HANDS, MUTED, TEXT, bb100Of, signed, type ModelStats } from '@/lib/stats';
import { RATE_FROM, robustRange, series } from '@/lib/series';

// The caption's frame (ReasoningPanel), so the landing's caption and its fill are one family.
export const RING = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };

// A part's tile: its title (and a muted note) over its picture, a caret saying it opens. One button over the whole
// tile: what it shows stays readable text, and no part of it takes a tap of its own.
export function Tile({ part, id, title, note, label, className = '', children }: { part: string; id?: string; title: string; note?: string; label: string; className?: string; children?: ReactNode }) {
  return (
    <div className={`relative flex flex-col min-h-0 min-w-0 bg-white rounded p-3 ${className}`} style={RING}>
      <div className="h-5 flex items-center gap-1.5 min-w-0 whitespace-nowrap">
        <span className="text-[14px] leading-5 font-bold" style={{ color: TEXT }}>{title}</span>
        {note && <span className="min-w-0 truncate text-[13px] leading-5" style={{ color: MUTED }}>{note}</span>}
        <CaretRight size={14} weight="bold" className="ml-auto shrink-0" style={{ color: MUTED }} aria-hidden />
      </div>
      <div className="relative flex-1 min-h-0 mt-2">{children}</div>
      <button id={id} type="button" onClick={() => openPart(part)} aria-label={label} className="absolute inset-0 rounded [-webkit-tap-highlight-color:transparent] active:bg-black/[0.03]" />
    </div>
  );
}

// The overview: Trends across the top, Profiles and Matchups side by side under it, their rows level (both list the
// seated models by bb/100, best first). It fills the window it is in; the rows share the height.
export function PhoneOverview({ models, bigBlind, blank, message }: { models: ModelStats[]; bigBlind: number; blank: boolean; message: ReactNode }) {
  const body = (b: ReactNode) => (message ? null : blank ? null : b);
  return (
    <div data-overview className="flex-1 min-h-0 grid grid-cols-2 gap-2" style={{ gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1.15fr)' }}>
      <Tile part="race" id="tile-race" title="Trends" note="bb/100" label="Open Trends" className="col-span-2">{message || body(<LandingChart models={models} />)}</Tile>
      <Tile part="stats-table" id="tile-stats-table" title="Profiles" label="Open Profiles">{body(<MiniProfiles models={models} />)}</Tile>
      <Tile part="pairwise" id="tile-pairwise" title="Matchups" label="Open Matchups">{body(<MiniMatchups models={models} bigBlind={bigBlind} />)}</Tile>
    </div>
  );
}

// The rows' shared grid: a 16px header line, then one row per model taking an equal share of the height, 1px apart.
const rowsOf = (n: number) => `16px repeat(${n}, minmax(0, 1fr))`;
const byRate = (models: ModelStats[]) => [...models].sort((a, b) => b.bb100 - a.bb100);

// Profiles in brief: each model's VPIP/PFR (how often it plays a hand / raises before the flop), as a HUD reads them.
function MiniProfiles({ models }: { models: ModelStats[] }) {
  const rows = byRate(models);
  return (
    <div className="absolute inset-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-px text-[12px] tabular-nums" style={{ gridTemplateRows: rowsOf(rows.length), color: TEXT }}>
      <span className="text-[11px] leading-4" style={{ color: MUTED }}>Model</span>
      <span className="text-[11px] leading-4 text-right" style={{ color: MUTED }}>VPIP/PFR</span>
      {rows.map(m => (
        <Fragment key={m.name}>
          <span data-row={m.name} className="flex items-center gap-1.5 min-w-0">
            <LLMLogo model={m.name} size={14} />
            <span className="flex-1 min-w-0"><FitName name={m.name} className="font-medium" /></span>
          </span>
          <span className="self-center text-right">{Math.round(m.vpip * 100)}/{Math.round(m.pfr * 100)}</span>
        </Fragment>
      ))}
    </div>
  );
}

// Matchups in brief: the grid's colours alone (green: the row's model won against the column's, red: lost; faint: under
// MIN_PAIR_HANDS together), logos heading the rows and the columns as on the phone's Matchups card.
function MiniMatchups({ models, bigBlind }: { models: ModelStats[]; bigBlind: number }) {
  const rows = byRate(models), n = rows.length;
  const cell = (r: ModelStats, col: string) => {
    const v = r.vs?.[col], hands = v?.hands ?? 0;
    return { hands, bb: v ? bb100Of(v.net_chips, bigBlind, hands) : null };
  };
  const tint = pairTint(rows.flatMap(r => rows.map(c => cell(r, c.name))));
  return (
    <div aria-hidden className="absolute inset-0 grid gap-px" style={{ gridTemplateColumns: `16px repeat(${n}, minmax(0, 1fr))`, gridTemplateRows: rowsOf(n) }}>
      <span />
      {rows.map(c => <span key={c.name} className="flex items-center justify-center"><LLMLogo model={c.name} size={12} /></span>)}
      {rows.map(r => (
        <Fragment key={r.name}>
          <span data-row={r.name} className="flex items-center"><LLMLogo model={r.name} size={14} /></span>
          {rows.map(c => {
            const self = r.name === c.name, { bb, hands } = cell(r, c.name);
            return <span key={c.name} className="rounded-sm" style={{ background: self ? 'rgba(55, 53, 47, 0.16)' : bb === null ? 'rgba(55, 53, 47, 0.04)' : tint(bb), opacity: !self && bb !== null && hands < MIN_PAIR_HANDS ? FAINT : undefined }} />;
          })}
        </Fragment>
      ))}
    </div>
  );
}

// Trends' lines (its default: each seated model's bb/100), from the RATE_FROM-th hand on, as the Trends window draws them
// (a rate over a few hands swings off any scale), filling the box. Each line's end has its logo and figure, spread
// apart so none overlap: their size follows the room, one row per line down the box's height.
const T = 6, B = 6, L = 2;
export function LandingChart({ models }: { models: ModelStats[] }) {
  const ref = useRef<HTMLDivElement>(null), clip = useId();
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
  const lines = models.map(m => ({ name: m.name, color: modelColor(m.name), pts: series(m, 'bb100') })).filter(l => l.pts.length > 1);
  if (!size || !lines.length) return <div ref={ref} className="absolute inset-0" />;
  const maxX = Math.max(1, ...lines.map(l => l.pts[l.pts.length - 1][0]));
  const x0 = maxX > RATE_FROM * 2 ? RATE_FROM : 0; // a session's first hands: all of them
  const shown = lines.map(l => ({ ...l, pts: l.pts.filter(p => p[0] >= x0) })).filter(l => l.pts.length > 1);
  // Trends' own fit (robustRange): 5th to 95th percentile of the rates and the lines' ends; a swing outside it is cut at
  // the plot's edge (clipPath).
  const [lo, hi] = robustRange(shown.flatMap(l => l.pts.map(p => p[1])), shown.map(l => l.pts[l.pts.length - 1][1]));
  const span = hi - lo || 1;
  // The labels: one row per line down the box (16px and 13px in a tall box, 10px and 9px at the least).
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
  // Each label's middle at its line's end, at least a row from the next, all inside the box.
  const ends = shown.map((l, i) => { const e = l.pts[l.pts.length - 1]; return { ...l, e, fig: figs[i], ty: y(e[1]) }; }).sort((a, b) => a.ty - b.ty);
  const first = row / 2 + 2, last = size.h - row / 2 - 2;
  for (let i = 0; i < n; i++) ends[i].ty = Math.max(ends[i].ty, i ? ends[i - 1].ty + row : first);
  for (let i = n - 1; i >= 0; i--) ends[i].ty = Math.min(ends[i].ty, i < n - 1 ? ends[i + 1].ty - row : last);
  const dot = (e: (typeof ends)[number]) => Math.min(Math.max(y(e.e[1]), T - 4), size.h - B + 4);
  return (
    <div ref={ref} className="absolute inset-0">
      <svg width={size.w} height={size.h} className="absolute inset-0" role="img" aria-label="bb/100 over hands played, each seated model">
        <clipPath id={clip}><rect x={0} y={T - 4} width={size.w} height={size.h - T - B + 8} /></clipPath>
        {lo < 0 && hi > 0 && <line x1={L} x2={size.w - R} y1={y(0)} y2={y(0)} stroke="rgba(55, 53, 47, 0.25)" strokeDasharray="3 3" />}
        <g clipPath={`url(#${CSS.escape(clip)})`}>
          {shown.map(l => <path key={l.name} d={path(l.pts)} fill="none" stroke={l.color} strokeWidth={1.5} strokeLinejoin="round" />)}
        </g>
        {ends.map(e => <circle key={e.name} cx={x(e.e[0])} cy={dot(e)} r={2.5} fill={e.color} />)}
        {ends.map(e => <line key={e.name} x1={x(e.e[0])} y1={dot(e)} x2={size.w - label - 4} y2={e.ty} stroke={e.color} strokeOpacity={0.35} />)}
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
