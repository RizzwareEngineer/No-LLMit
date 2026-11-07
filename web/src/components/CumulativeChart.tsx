'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Segmented } from '@/components/Section';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import { family, openWeights } from '@/lib/families';
import { MUTED, ModelStats, TEXT, chips, ciHalf, netColor, signed } from '@/lib/stats';

const GRID = 'rgba(55, 53, 47, 0.12)';
const AXIS = 'rgba(55, 53, 47, 0.75)';
// Every line is redrawn through this many points, so a new hand changes the numbers in each
// path but not its shape and motion can tween the old line into the new one.
const SAMPLES = 160;

// The value of a cumulative curve at hand n, linearly interpolated (0 before its first point,
// flat after its last).
export function valueAt(pts: [number, number][], n: number) {
  if (!pts.length || n < pts[0][0]) return 0;
  const i = pts.findIndex(p => p[0] >= n);
  if (i <= 0) return pts.at(i)![1]; // past the last point, or exactly on the first
  const [n0, v0] = pts[i - 1], [n1, v1] = pts[i];
  return n1 === n0 ? v1 : v0 + ((n - n0) / (n1 - n0)) * (v1 - v0);
}

// Spreads label centres at least `gap` apart inside [lo, hi], each as close to its target as
// that allows. `ys` must be sorted ascending.
export function spread(ys: number[], gap: number, lo: number, hi: number) {
  const out = ys.map(v => Math.min(Math.max(v, lo), hi));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  for (let i = out.length - 1; i >= 0; i--) out[i] = Math.min(out[i], i === out.length - 1 ? hi : out[i + 1] - gap);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], i ? out[i - 1] + gap : lo);
  return out;
}

// 95% band around the cumulative line after n hands. The per-hand spread implied by the
// bb/100 interval over N hands is h*sqrt(N)/196, so n hands spread by h*sqrt(N*n)/100.
function band(m: ModelStats, n: number) {
  return ((ciHalf(m) ?? 0) * Math.sqrt(m.hands * n)) / 100; // no interval below 2 hands
}

// Evenly spaced round ticks that cover [min, max]; the first and last tick bound the axis,
// so a range that dips below zero always gets a negative label.
export function niceTicks(min: number, max: number, count: number, integer = false) {
  const step0 = (max - min) / count || 1;
  const mag = 10 ** Math.floor(Math.log10(step0));
  let step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= step0) ?? step0;
  if (integer) step = Math.max(1, Math.ceil(step));
  const ticks = [];
  for (let t = Math.floor(min / step) * step; t < max + step; t += step) {
    ticks.push(+t.toFixed(6));
    if (t >= max) break;
  }
  return ticks;
}

// The curve at SAMPLES evenly spaced hands over [from, last hand], linearly interpolated; empty
// when the curve ends before `from`.
export function resample(pts: [number, number][], from = 0): [number, number][] {
  const last = pts.at(-1)?.[0] ?? 0;
  if (from > last) return [];
  if (pts.length < 2) return Array.from({ length: SAMPLES }, (_, i) => [from + (i / (SAMPLES - 1)) * (last - from), pts[0]?.[1] ?? 0]);
  let j = 0;
  return Array.from({ length: SAMPLES }, (_, i) => {
    const n = from + (i / (SAMPLES - 1)) * (last - from);
    while (j < pts.length - 2 && pts[j + 1][0] < n) j++;
    const [n0, v0] = pts[j], [n1, v1] = pts[j + 1];
    return [n, n1 === n0 ? v1 : v0 + ((n - n0) / (n1 - n0)) * (v1 - v0)];
  });
}

// The Race window choices: the last 100 or 1,000 hands, or all of them.
const RANGES = [{ label: 'Last 100', n: 100 }, { label: 'Last 1k', n: 1000 }, { label: 'All', n: 0 }] as const;
// A running bb/100 over a handful of hands is noise, so the rate lines start here.
export const RATE_FROM = 20;

type Metric = 'bb100' | 'chips' | 'bb';
type License = 'all' | 'open' | 'closed';

// A model's line in the plotted metric: running bb/100 from RATE_FROM hands, or cumulative chips
// (or bb), as [hands played, value].
export function series(m: ModelStats, metric: Metric, bigBlind = 1): [number, number][] {
  if (metric === 'bb100') return m.cumulative_bb.filter(([n]) => n >= RATE_FROM).map(([n, v]) => [n, (v / n) * 100]);
  const k = metric === 'chips' ? bigBlind : 1;
  return m.cumulative_bb.map(([n, v]) => [n, v * k]);
}

export default function CumulativeChart({
  models,
  everyone,
  selected,
  onSelect,
  highlight,
  onHighlight,
  race = false,
  mini = false,
  bigBlind,
}: {
  models: ModelStats[];
  everyone?: ModelStats[]; // the Race "All models" lineup; `models` is the seated one
  selected: string;
  onSelect?: (name: string) => void; // the Race screen: a click on an end label shades that line's 95% band
  highlight?: string; // a line to bring forward while the pointer is not on the plot
  onHighlight?: (name: string | undefined) => void;
  race?: boolean; // several lines, each labelled at its end, with filters, a legend, a hover readout and a range control
  mini?: boolean; // the overview tile: the same chart small, logos for labels, no interaction
  bigBlind?: number; // outside the Race: plot chips (bb × big blind) instead of bb
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The plot fills its box. `drawnFor` is the data the size was measured with: a resize (the Race
  // zoom) redraws the lines at once, and only new data tweens them.
  const [{ width, height, drawnFor }, setSize] = useState({ width: 720, height: 300, drawnFor: models });
  const latest = useRef(models);
  useEffect(() => { latest.current = models; });
  // Like Arena's trends chart, the lines draw in from the first hand to the last each time the Race
  // screen opens (the tile draws once, when it first scrolls into view); the labels follow the lines.
  const [draw, setDraw] = useState(0);
  const wasMini = useRef(mini);
  useEffect(() => {
    if (wasMini.current && !mini) setDraw(n => n + 1);
    wasMini.current = mini;
  }, [mini]);
  const DRAW = mini ? 1.2 : 2.4; // seconds
  const reduce = useReducedMotion();
  // The hand under the pointer (or picked with the arrow keys) and the line nearest it.
  const [hover, setHover] = useState<{ n: number; name: string } | null>(null);
  const [range, setRange] = useState(0); // 0: every hand
  // The Race filters, Arena style. They live here, so the overview tile (the same instance) shows them too.
  const [metricPick, setMetric] = useState<'bb100' | 'chips'>('bb100');
  const [lineup, setLineup] = useState<'seated' | 'all'>('seated');
  const [license, setLicense] = useState<License>('all');
  const [fams, setFams] = useState<string[]>([]); // none picked: every family
  const [top, setTop] = useState(0); // 0: every model
  const [hidden, setHidden] = useState<string[]>([]); // lines switched off in the legend
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height, drawnFor: latest.current }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const metric: Metric = race ? metricPick : bigBlind ? 'chips' : 'bb';
  const rate = metric === 'bb100';
  const unit = rate ? 'bb/100' : metric;
  const fmt = (v: number) => (metric === 'chips' ? chips(Math.round(v)) : signed(v));
  const interactive = race && !mini;
  const line$ = new Map([...(everyone ?? []), ...models].map(m => [m.name, series(m, metric, bigBlind)]));
  const pts = (m: ModelStats) => line$.get(m.name)!;
  const finalOf = (m: ModelStats) => pts(m).at(-1)?.[1] ?? 0;
  const pool = race && lineup === 'all' && everyone?.length ? everyone : models;
  const families = [...new Set(pool.map(m => family(m.name)))].sort();
  // The legend: every model the filters let through, best first; `top` keeps the leaders.
  const listed = pool
    .filter(m => !race || ((license === 'all' || openWeights(m.name) === (license === 'open')) && (!fams.length || fams.includes(family(m.name)))))
    .filter(m => pts(m).length)
    .sort((a, b) => finalOf(b) - finalOf(a))
    .slice(0, race && top ? top : undefined);
  const lastHand = Math.max(1, ...listed.flatMap(m => pts(m).map(p => p[0])));
  const win = interactive ? range : 0;
  const whole = !(win && win < lastHand);
  // The x axis starts where the first line does (RATE_FROM hands for bb/100), or at the window.
  const from = Math.max(whole ? 0 : lastHand - win, Math.min(lastHand - 1, ...listed.map(m => pts(m)[0][0])));
  // Every line resampled over the window; lines switched off or ended before it drop out.
  const drawn = new Map(listed.map(m => {
    const p = pts(m);
    return [m.name, hidden.includes(m.name) ? [] : resample(p, Math.max(from, p[0][0]))];
  }));
  const shown = listed.filter(m => drawn.get(m.name)!.length);
  // The value at hand n, or null before the line starts.
  const at = (m: ModelStats, n: number) => (n < pts(m)[0][0] ? null : valueAt(pts(m), n));
  const ys = shown.flatMap(m => drawn.get(m.name)!.map(p => p[1]));
  const sel = shown.find(m => m.name === selected);
  // 95% band: bb/100's interval narrows as 1/sqrt(n); a cumulative total's widens as sqrt(n).
  const bandAt = (m: ModelStats, n: number) =>
    rate ? (ciHalf(m) ?? 0) * Math.sqrt(m.hands / Math.max(n, 1)) : band(m, n) * (metric === 'chips' ? bigBlind ?? 1 : 1);
  if (sel) drawn.get(sel.name)!.forEach(([n, v]) => ys.push(v + bandAt(sel, n), v - bandAt(sel, n)));
  // The y axis spans the data (and zero over the whole session), with a little air.
  let lo = Math.min(...ys, ...(whole ? [0] : [])), hi = Math.max(...ys, ...(whole ? [0] : []));
  if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
  if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
  const air = (hi - lo) * 0.04;
  const [yMin, yMax] = [lo - air, hi + air];
  const yTicks = niceTicks(yMin, yMax, mini ? 5 : 8).filter(t => t >= yMin && t <= yMax);
  const xTicks = niceTicks(from, lastHand, mini ? 6 : 10, true).filter(t => t >= from && t <= lastHand);
  const w = Math.max(width, 200);
  const fs = mini ? 12 : 14;
  const logo = mini ? 16 : 18;
  const tick = (t: number) => (metric === 'chips' ? t.toLocaleString() : String(t)).replace('-', '−');
  const right = mini ? logo + 10 : race ? 240 : 12;
  const left = 10 + fs * 0.62 * Math.max(4, ...yTicks.map(t => tick(t).length)); // room for the widest y label
  const padTop = fs + 10; // the y axis title sits above the plot
  const padBottom = fs + 10 + fs + 8; // tick labels, then the x axis title
  const x = (n: number) => left + ((n - from) / (lastHand - from || 1)) * (w - left - right);
  const y = (v: number) => padTop + ((yMax - v) / (yMax - yMin || 1)) * (height - padTop - padBottom);
  const line = (p: [number, number][]) => p.map(([n, v], i) => `${i ? 'L' : 'M'}${x(n)},${y(v)}`).join('');
  const selPts = sel ? drawn.get(sel.name)! : [];
  const bandPath = sel
    ? line(selPts.map(([n, v]) => [n, v + bandAt(sel, n)])) +
      [...selPts].reverse().map(([n, v]) => `L${x(n)},${y(v - bandAt(sel, n))}`).join('') + 'Z'
    : '';
  const tween = { duration: reduce || drawnFor === models ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] as const };
  const hot = shown.find(m => m.name === (hover?.name ?? highlight)); // the hovered line
  const ordered = [...shown.filter(m => m !== sel && m !== hot), ...(sel && sel !== hot ? [sel] : []), ...(hot ? [hot] : [])]; // selected, then hovered on top
  // Every line ends in a label in the right-hand gutter (a logo in the tile; logo, name and the
  // final figure on the Race screen), spread so none overlap, with a dotted leader to the line's end.
  const ends = shown
    .map(m => { const p = drawn.get(m.name)!; return { m, n: p.at(-1)![0], v: p.at(-1)![1] }; })
    .sort((a, b) => b.v - a.v);
  const rowH = mini ? logo + 1 : 22;
  const [eLo, eHi] = [padTop + rowH / 2, height - padBottom - rowH / 2];
  const endYs = spread(ends.map(e => y(e.v)), Math.min(rowH, (eHi - eLo) / Math.max(1, ends.length - 1)), eLo, eHi); // highest value first: ascending y
  const readout = hover
    ? shown.flatMap(m => { const v = at(m, hover.n); return v === null ? [] : [{ m, v }]; }).sort((a, b) => b.v - a.v)
    : [];

  const pick = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const n = Math.round(Math.min(Math.max(from + ((clientX - r.left - left) / (w - left - right)) * (lastHand - from), from), lastHand));
    const near = shown.reduce<{ name: string; d: number }>((best, m) => {
      const v = at(m, n);
      const d = v === null ? Infinity : Math.abs(y(v) - (clientY - r.top));
      return d < best.d ? { name: m.name, d } : best;
    }, { name: '', d: Infinity });
    setHover({ n, name: near.name });
  };
  const yTitle = rate ? 'bb/100 (running)' : metric === 'chips' ? 'Chips won' : 'Big blinds won';
  const summary = shown.map(m => `${m.name} ${fmt(finalOf(m))} ${unit} after ${pts(m).at(-1)![0]} hands`).join('; ');
  const label = `${yTitle} over hands played. ${summary}.${sel ? ` Shaded: 95% band for ${sel.name}.` : ''}`;
  const lead = readout[0];
  const said = hover && lead
    ? `Hand ${hover.n}: ${lead.m.name} leads at ${fmt(lead.v)} ${unit}` + (hot && hot !== lead.m ? `; ${hot.name} ${fmt(readout.find(r => r.m === hot)?.v ?? 0)} ${unit}.` : '.')
    : '';

  // The readout sits beside the crosshair on whichever side it fits, clamped inside the plot.
  const crossX = hover ? x(hover.n) : 0;
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip) return;
    const tw = tip.offsetWidth;
    const want = crossX + 12 + tw <= w - right ? crossX + 12 : crossX - 12 - tw;
    tip.style.left = `${Math.max(left, Math.min(want, w - tw - 4))}px`;
  });

  const step = Math.max(1, Math.round((lastHand - from) / 40));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setHover(null);
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const n0 = hover?.n ?? (e.key === 'ArrowLeft' ? lastHand + step : from - step);
    setHover({ n: Math.min(Math.max(n0 + (e.key === 'ArrowRight' ? step : -step), from), lastHand), name: hover?.name || sel?.name || '' });
  };
  const plotH = height - padTop - padBottom;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter(s => s !== v) : [...list, v]);
  // The filters in words, for the overview tile.
  const filters = [
    rate ? 'bb/100' : 'Chips',
    lineup === 'all' && 'All models',
    license !== 'all' && (license === 'open' ? 'Open weights' : 'Proprietary'),
    fams.length && fams.join(', '),
    top && `Top ${top}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {interactive && (
        <div className="mb-2 flex flex-col gap-1.5 text-[14px]" style={{ color: MUTED }}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span>Metric</span>
            <Segmented label="Metric" options={[{ label: 'bb/100', value: 'bb100' as const }, { label: 'Chips', value: 'chips' as const }]} value={metricPick} onChange={setMetric} />
            <span className="ml-3">Lineup</span>
            <Segmented label="Lineup" options={[{ label: 'Seated now', value: 'seated' as const }, { label: 'All models', value: 'all' as const, disabled: !everyone?.length }]} value={lineup} onChange={setLineup} />
            <span className="ml-3">License</span>
            <Segmented label="License" options={[{ label: 'All', value: 'all' as const }, { label: 'Open weights', value: 'open' as const }, { label: 'Proprietary', value: 'closed' as const }]} value={license} onChange={setLicense} />
            <span className="ml-3">Show</span>
            <Segmented label="Top models" options={[{ label: 'All', value: 0 }, { label: 'Top 5', value: 5 }]} value={top} onChange={setTop} />
            <span className="ml-auto"><Segmented
              label="Hands shown"
              options={RANGES.map(r => ({ label: r.label, value: r.n, disabled: r.n > 0 && r.n >= lastHand }))}
              value={range && range < lastHand ? range : 0}
              onChange={setRange}
            /></span>
          </div>
          <div role="group" aria-label="Family" className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1">Family</span>
            {families.map(f => (
              <button
                key={f}
                onClick={() => setFams(toggle(fams, f))}
                aria-pressed={fams.includes(f)}
                className="rounded-full border px-2.5 py-px text-[13px] font-medium"
                style={fams.includes(f) ? { background: TEXT, borderColor: TEXT, color: 'white' } : { borderColor: 'rgba(55, 53, 47, 0.16)', color: TEXT }}
              >
                {f}
              </button>
            ))}
            {fams.length > 0 && <button onClick={() => setFams([])} className="px-1.5 text-[13px] underline">Clear</button>}
          </div>
        </div>
      )}
      {race && mini && <div className="-mt-1 mb-1 text-[12px] truncate" style={{ color: MUTED }}>{filters}</div>}
      {/* The svg is absolute so its height comes from the panel, never the other way round. */}
      <div
        ref={ref}
        className={`relative w-full flex-1 ${mini ? 'min-h-[100px]' : 'min-h-[160px]'} outline-offset-2 overflow-hidden`}
        onPointerMove={interactive ? e => e.pointerType !== 'touch' && pick(e.clientX, e.clientY) : undefined}
        onPointerDown={interactive ? e => pick(e.clientX, e.clientY) : undefined}
        onPointerLeave={interactive ? e => e.pointerType !== 'touch' && setHover(null) : undefined} // a tap keeps its readout
        // Focusable only where the chart is interactive (the Race screen).
        tabIndex={interactive && onSelect ? 0 : undefined}
        onKeyDown={interactive && onSelect ? onKey : undefined}
        onBlur={interactive ? () => setHover(null) : undefined}
        role="img"
        aria-label={interactive && onSelect ? `${label} Left and right arrows step through the hands.` : label}
      >
        <svg className="absolute inset-0" width="100%" height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden>
          {/* Axis titles: the unit above the y labels, the hands under the x labels. */}
          <text x={4} y={fs} fontSize={fs} fontWeight={600} fill={AXIS}>{yTitle}</text>
          <text x={left + (w - left - right) / 2} y={height - 4} textAnchor="middle" fontSize={fs} fontWeight={600} fill={AXIS}>Hands played</text>
          {yTicks.map(t => (
            <g key={t}>
              <line x1={left} x2={w - right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(55, 53, 47, 0.5)' : GRID} />
              <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={fs} fill={AXIS} className="tabular-nums">{tick(t)}</text>
            </g>
          ))}
          <line x1={left} x2={left} y1={padTop} y2={padTop + plotH} stroke={GRID} />
          {xTicks.map(t => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={padTop + plotH} y2={padTop + plotH + 4} stroke={AXIS} />
              <text x={x(t)} y={padTop + plotH + fs + 6} textAnchor="middle" fontSize={fs} fill={AXIS} className="tabular-nums">{t.toLocaleString()}</text>
            </g>
          ))}
          {sel && <motion.path initial={false} animate={{ d: bandPath }} transition={tween} fill={modelColor(sel.name)} opacity={0.14} />}
          {ordered.map(m => {
            const d = line(drawn.get(m.name)!);
            return (
              <motion.path
                key={`${m.name}:${draw}`}
                fill="none"
                stroke={modelColor(m.name)}
                strokeWidth={m === hot || m === sel ? 3 : 2}
                strokeLinejoin="round"
                opacity={!hot || m === hot || m === sel ? 1 : 0.25}
                // Lines draw in the first time the chart scrolls into view, then tween as hands finish.
                initial={{ d, pathLength: reduce ? 1 : 0 }}
                animate={{ d }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true }}
                transition={{ d: tween, pathLength: { duration: reduce ? 0 : DRAW, ease: 'linear' } }}
              />
            );
          })}
          {race && ends.map((e, i) => (
            // A dotted leader from the line's end to its label, so a nudged label never reads as data.
            <motion.path key={`${e.m.name}:${draw}`} d={`M${x(e.n)},${y(e.v)}L${w - right + 4},${endYs[i]}`} stroke={modelColor(e.m.name)} strokeWidth={1} strokeDasharray="2 2" fill="none"
              initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: hot && hot !== e.m ? 0.2 : 0.6 }} transition={{ delay: reduce ? 0 : DRAW * 0.9, duration: 0.4 }} />
          ))}
          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.n)} x2={x(hover.n)} y1={padTop} y2={padTop + plotH} stroke="rgba(55, 53, 47, 0.55)" strokeDasharray="3 3" />
              {readout.map(({ m, v }) => (
                <circle key={m.name} cx={x(hover.n)} cy={y(v)} r={m === hot ? 4.5 : 3} fill={modelColor(m.name)} stroke="white" strokeWidth={1} />
              ))}
            </g>
          )}
        </svg>
        {race && !shown.length && (
          <p className="absolute inset-0 flex items-center justify-center text-[14px]" style={{ color: MUTED }}>
            {listed.length ? 'Every line is switched off in the legend.' : rate ? `No model here has played ${RATE_FROM} hands yet.` : 'No model matches these filters.'}
          </p>
        )}
        {race && ends.map((e, i) => mini ? (
          <div key={e.m.name} className="absolute pointer-events-none" style={{ left: w - right + 6, top: endYs[i] - logo / 2 }} title={e.m.name}>
            <LLMLogo model={e.m.name} size={logo} />
          </div>
        ) : (
          // Logo, name and final figure at each line's end; a click shades its 95% band.
          <motion.button
            key={`${e.m.name}:${draw}`}
            initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: hot && hot !== e.m ? 0.45 : 1 }} transition={{ delay: reduce ? 0 : DRAW * 0.9, duration: 0.4 }}
            onClick={() => onSelect?.(selected === e.m.name ? '' : e.m.name)}
            onPointerMove={ev => ev.stopPropagation()}
            onPointerEnter={() => { setHover(null); onHighlight?.(e.m.name); }}
            onPointerLeave={() => onHighlight?.(undefined)}
            onFocus={() => onHighlight?.(e.m.name)}
            onBlur={() => onHighlight?.(undefined)}
            aria-pressed={selected === e.m.name}
            className="absolute flex items-center gap-1.5 rounded px-1 text-[14px] leading-none tabular-nums text-left hover:bg-[rgba(55,53,47,0.06)]"
            style={{ left: w - right + 6, top: endYs[i] - rowH / 2, height: rowH, width: right - 8, color: TEXT, boxShadow: selected === e.m.name ? `inset 3px 0 0 ${modelColor(e.m.name)}` : undefined }}
          >
            <LLMLogo model={e.m.name} size={logo} />
            <span className={`flex-1 min-w-0 truncate ${e.m === hot || i === 0 ? 'font-bold' : 'font-medium'}`}>{e.m.name}</span>
            <span className="font-bold" style={{ color: netColor(e.v) }}>{fmt(e.v)}</span>
          </motion.button>
        ))}
        {/* Always mounted, so the first arrow press is announced too; it says the leader and the highlighted line. */}
        {race && <div role="status" className="sr-only">{said}</div>}
        {/* The readout floats over the plot (no layout shift), on the side away from the cursor. */}
        {hover && readout.length > 0 && (
          <div
            ref={tipRef}
            aria-hidden
            className="absolute z-10 pointer-events-none rounded bg-white px-2.5 py-2 text-[14px] tabular-nums"
            style={{
              top: padTop,
              left: Math.min(crossX + 12, w - 4),
              boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px',
            }}
          >
            <div className="font-bold mb-1" style={{ color: TEXT }}>Hand {hover.n.toLocaleString()}</div>
            {readout.map(({ m, v }) => (
              <div key={m.name} className={`flex items-center gap-2 whitespace-nowrap leading-[20px] ${m === hot ? 'font-bold' : ''}`} style={{ color: TEXT }}>
                <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: modelColor(m.name) }} />
                <span className="flex-1 min-w-0">{m.name}</span>
                <span className="pl-4" style={{ color: netColor(v) }}>{fmt(v)} {unit}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* The legend, Arena style: a click switches a line off or on, hovering brings it forward. */}
      {interactive && listed.length > 0 && (
        <div role="group" aria-label="Lines shown" className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px]">
          {listed.map(m => {
            const on = !hidden.includes(m.name);
            return (
              <button
                key={m.name}
                onClick={() => setHidden(toggle(hidden, m.name))}
                onPointerEnter={() => on && onHighlight?.(m.name)}
                onPointerLeave={() => onHighlight?.(undefined)}
                aria-pressed={on}
                className="flex items-center gap-1.5 rounded px-1 hover:bg-[rgba(55,53,47,0.06)]"
                style={{ color: on ? TEXT : MUTED, textDecoration: on ? undefined : 'line-through' }}
              >
                <span aria-hidden className="inline-block w-3 h-[3px] rounded-full" style={{ background: on ? modelColor(m.name) : 'rgba(55, 53, 47, 0.25)' }} />
                {m.name}
              </button>
            );
          })}
          {rate && <span className="ml-auto" style={{ color: MUTED }}>Lines start at {RATE_FROM} hands · hover for every model · click an end label for its 95% band</span>}
        </div>
      )}
      {!race && <p className="mt-2 text-[13px]" style={{ color: MUTED }}>Shaded: 95% band</p>}

      {/* The chart's numbers for screen readers; tables ignore sr-only's 1px box, so a div clips it. */}
      {sel && (
        <div className="sr-only"><table>
          <caption>{sel.name}: {yTitle} with 95% band</caption>
          <thead>
            <tr style={{ color: MUTED }}>
              <th scope="col" className="text-right font-medium px-2">Hand</th>
              <th scope="col" className="text-right font-medium px-2">{unit}</th>
              <th scope="col" className="text-right font-medium px-2">Low</th>
              <th scope="col" className="text-right font-medium px-2">High</th>
            </tr>
          </thead>
          <tbody>
            {pts(sel).map(([n, v]) => (
              <tr key={n} className="border-t border-notion">
                <th scope="row" className="text-right font-normal px-2">{n}</th>
                <td className="text-right px-2">{fmt(v)}</td>
                <td className="text-right px-2">{fmt(v - bandAt(sel, n))}</td>
                <td className="text-right px-2">{fmt(v + bandAt(sel, n))}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
