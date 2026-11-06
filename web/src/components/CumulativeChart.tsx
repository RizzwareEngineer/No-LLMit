'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import { MUTED, ModelStats, ciHalf, signed } from '@/lib/stats';

const GRID = 'rgba(55, 53, 47, 0.09)';
// Every line is redrawn through this many points, so a new hand changes the numbers in each
// path but not its shape and motion can tween the old line into the new one.
const SAMPLES = 160;
const PAD = { top: 12, right: 12, bottom: 24 };

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

// The curve at SAMPLES evenly spaced hands over [0, last hand], linearly interpolated.
export function resample(pts: [number, number][]): [number, number][] {
  const last = pts.at(-1)?.[0] ?? 0;
  if (pts.length < 2) return Array.from({ length: SAMPLES }, (_, i) => [(i / (SAMPLES - 1)) * last, pts[0]?.[1] ?? 0]);
  let j = 0;
  return Array.from({ length: SAMPLES }, (_, i) => {
    const n = (i / (SAMPLES - 1)) * last;
    while (j < pts.length - 2 && pts[j + 1][0] < n) j++;
    const [n0, v0] = pts[j], [n1, v1] = pts[j + 1];
    return [n, n1 === n0 ? v1 : v0 + ((n - n0) / (n1 - n0)) * (v1 - v0)];
  });
}

export default function CumulativeChart({
  models,
  selected,
  onSelect,
  race = false,
}: {
  models: ModelStats[];
  selected: string;
  onSelect?: (name: string) => void;
  race?: boolean; // several lines: a logo at each line's end and a hover readout of every line
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ width, height }, setSize] = useState({ width: 720, height: 300 }); // the plot fills its panel
  const reduce = useReducedMotion();
  // The hand under the pointer (or picked with the arrow keys) and the line nearest it.
  const [hover, setHover] = useState<{ n: number; name: string } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxHand = Math.max(1, ...models.flatMap(m => m.cumulative_bb.map(p => p[0])));
  // The axis fits the lines as drawn (resampled), so it never reaches past all of them.
  const drawn = new Map(models.map(m => [m.name, resample(m.cumulative_bb)]));
  const ys = [...drawn.values()].flatMap(pts => pts.map(p => p[1]));
  const sel = models.find(m => m.name === selected) ?? models[0];
  if (sel) drawn.get(sel.name)!.forEach(([n, v]) => ys.push(v + band(sel, n), v - band(sel, n)));
  const yTicks = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys), 5);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const w = Math.max(width, 200);
  // End logos sit in a right-hand gutter; smaller in the overview preview.
  const logo = height < 260 ? 14 : height < 400 ? 16 : 20;
  const right = race ? logo + 10 : PAD.right;
  const left = 12 + 7 * Math.max(...yTicks.map(t => String(t).length)); // room for the widest y label
  const x = (n: number) => left + (n / maxHand) * (w - left - right);
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin || 1)) * (height - PAD.top - PAD.bottom);
  const line = (pts: [number, number][]) => pts.map(([n, v], i) => `${i ? 'L' : 'M'}${x(n)},${y(v)}`).join('');
  const selPts = sel ? drawn.get(sel.name)! : [];
  const bandPath = sel
    ? line(selPts.map(([n, v]) => [n, v + band(sel, n)])) +
      [...selPts].reverse().map(([n, v]) => `L${x(n)},${y(v - band(sel, n))}`).join('') + 'Z'
    : '';
  const tween = { duration: reduce ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] as const };
  const hot = hover ? models.find(m => m.name === hover.name) : undefined; // the hovered line
  const ordered = [...models.filter(m => m !== sel && m !== hot), ...(sel && sel !== hot ? [sel] : []), ...(hot ? [hot] : [])]; // selected, then hovered, on top
  // End logos: each line's last value, nudged apart so none overlap.
  const ends = [...models].map(m => ({ m, n: m.cumulative_bb.at(-1)?.[0] ?? 0, v: m.cumulative_bb.at(-1)?.[1] ?? 0 })).sort((a, b) => y(a.v) - y(b.v));
  const endYs = spread(ends.map(e => y(e.v)), logo + 2, PAD.top + logo / 2 - 6, height - PAD.bottom - logo / 2 + 6);
  const readout = hover ? [...models].map(m => ({ m, v: valueAt(m.cumulative_bb, hover.n) })).sort((a, b) => b.v - a.v) : [];

  const pick = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const n = Math.round(Math.min(Math.max(((clientX - r.left - left) / (w - left - right)) * maxHand, 0), maxHand));
    const near = models.reduce<{ name: string; d: number }>((best, m) => {
      const d = Math.abs(y(valueAt(m.cumulative_bb, n)) - (clientY - r.top));
      return d < best.d ? { name: m.name, d } : best;
    }, { name: '', d: Infinity });
    setHover({ n, name: near.name });
  };
  const step = Math.max(1, Math.round(maxHand / 40));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setHover(null);
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const n0 = hover?.n ?? (e.key === 'ArrowLeft' ? maxHand + step : -step);
    setHover({ n: Math.min(Math.max(n0 + (e.key === 'ArrowRight' ? step : -step), 0), maxHand), name: hover?.name || sel?.name || '' });
  };
  const summary = models
    .map(m => `${m.name} ${signed(m.cumulative_bb.at(-1)?.[1] ?? 0)} bb after ${m.cumulative_bb.at(-1)?.[0] ?? 0} hands`)
    .join('; ');

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* The svg is absolute so its height comes from the panel, never the other way round. */}
      <div
        ref={ref}
        className="relative w-full flex-1 min-h-[120px] outline-offset-2"
        onPointerMove={race ? e => e.pointerType !== 'touch' && pick(e.clientX, e.clientY) : undefined}
        onPointerDown={race ? e => pick(e.clientX, e.clientY) : undefined}
        onPointerLeave={race ? () => setHover(null) : undefined}
        // Focusable only where the chart is interactive (the zoomed Race screen).
        tabIndex={race && onSelect ? 0 : undefined}
        onKeyDown={race && onSelect ? onKey : undefined}
        onBlur={race ? () => setHover(null) : undefined}
        aria-label={race && onSelect ? 'Race chart. Left and right arrows step through the hands and read out every model.' : undefined}
      >
        <svg className="absolute inset-0" width="100%" height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={`Cumulative big blinds won over hands. ${summary}. Shaded: 95% band for ${sel?.name}.`}>
          {yTicks.map(t => (
            <g key={t}>
              <line x1={left} x2={w - right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(55, 53, 47, 0.35)' : GRID} />
              <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={MUTED} className="tabular-nums">{t}</text>
            </g>
          ))}
          {niceTicks(0, maxHand, 4, true).filter(t => t <= maxHand).map(t => (
            <text key={t} x={x(t)} y={height - 6} textAnchor="middle" fontSize={11} fill={MUTED} className="tabular-nums">{t}</text>
          ))}
          {sel && <motion.path initial={false} animate={{ d: bandPath }} transition={tween} fill={modelColor(sel.name)} opacity={0.14} />}
          {ordered.map(m => {
            const d = line(drawn.get(m.name)!);
            return (
              <motion.path
                key={m.name}
                fill="none"
                stroke={modelColor(m.name)}
                strokeWidth={m === sel || m === hot ? 2.5 : 1.5}
                strokeLinejoin="round"
                opacity={m === sel || m === hot ? 1 : hot ? 0.2 : 0.35}
                // Lines draw in the first time the chart scrolls into view, then tween as hands finish.
                initial={{ d, pathLength: reduce ? 1 : 0 }}
                animate={{ d }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true }}
                transition={{ d: tween, pathLength: { duration: reduce ? 0 : 1.2, ease: 'easeOut' } }}
              />
            );
          })}
          {race && ends.map((e, i) => (
            // A leader from the line's end to its logo, visible once the logo was nudged.
            <path key={e.m.name} d={`M${x(e.n)},${y(e.v)}L${w - right + 2},${endYs[i]}`} stroke={modelColor(e.m.name)} strokeWidth={1} opacity={0.5} fill="none" />
          ))}
          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.n)} x2={x(hover.n)} y1={PAD.top} y2={height - PAD.bottom} stroke="rgba(55, 53, 47, 0.45)" strokeDasharray="3 3" />
              {readout.map(({ m, v }) => (
                <circle key={m.name} cx={x(hover.n)} cy={y(v)} r={m === hot ? 4 : 2.5} fill={modelColor(m.name)} stroke="white" strokeWidth={1} />
              ))}
            </g>
          )}
        </svg>
        {race && ends.map((e, i) => (
          <div key={e.m.name} className="absolute pointer-events-none" style={{ left: w - right + 4, top: endYs[i] - logo / 2 }} title={e.m.name}>
            <LLMLogo model={e.m.name} size={logo} />
          </div>
        ))}
        {/* The readout floats over the plot (no layout shift), on the side away from the cursor. */}
        {hover && (
          <div
            aria-live="polite"
            className="absolute z-10 pointer-events-none rounded bg-white px-2 py-1.5 text-[12px] tabular-nums"
            style={{
              top: PAD.top,
              ...(x(hover.n) > w / 2 ? { right: w - x(hover.n) + 10 } : { left: x(hover.n) + 10 }),
              boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px',
            }}
          >
            <div className="font-medium mb-0.5" style={{ color: MUTED }}>Hand {hover.n.toLocaleString()}</div>
            {(height < 260 ? readout.filter((r, i) => i < 3 || i >= readout.length - 1 || r.m === hot) : readout).map(({ m, v }) => (
              <div key={m.name} className={`flex items-center gap-1.5 whitespace-nowrap ${m === hot ? 'font-bold' : ''}`} style={{ color: 'rgb(55, 53, 47)' }}>
                <span aria-hidden className="inline-block w-2 h-2 rounded-full" style={{ background: modelColor(m.name) }} />
                <span className="flex-1">{m.name}</span>
                <span className="pl-3">{signed(v)} bb</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] mt-1" style={{ color: MUTED }}>x: hands played · y: big blinds won · shaded: 95% band for the selected model</p>

      {onSelect && (
      <div className="flex flex-wrap gap-1.5 mt-2" role="group" aria-label="Highlight a model">
        {models.map(m => (
          <button
            key={m.name}
            onClick={() => onSelect(m.name)}
            aria-pressed={m === sel}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] border transition-colors"
            style={{
              borderColor: m === sel ? modelColor(m.name) : GRID,
              background: m === sel ? 'rgba(55, 53, 47, 0.04)' : 'white',
              color: 'rgb(55, 53, 47)',
            }}
          >
            <span aria-hidden className="inline-block w-3 h-0.5 rounded" style={{ background: modelColor(m.name) }} />
            <LLMLogo model={m.name} size={16} />
            {m.name}
          </button>
        ))}
      </div>
      )}

      {/* The chart's numbers for screen readers; tables ignore sr-only's 1px box, so a div clips it. */}
      {sel && (
        <div className="sr-only"><table>
          <caption>{sel.name}: cumulative bb with 95% band</caption>
          <thead>
            <tr style={{ color: MUTED }}>
              <th scope="col" className="text-right font-medium px-2">Hand</th>
              <th scope="col" className="text-right font-medium px-2">bb</th>
              <th scope="col" className="text-right font-medium px-2">Low</th>
              <th scope="col" className="text-right font-medium px-2">High</th>
            </tr>
          </thead>
          <tbody>
            {sel.cumulative_bb.map(([n, v]) => (
              <tr key={n} className="border-t border-notion">
                <th scope="row" className="text-right font-normal px-2">{n}</th>
                <td className="text-right px-2">{signed(v)}</td>
                <td className="text-right px-2">{signed(v - band(sel, n))}</td>
                <td className="text-right px-2">{signed(v + band(sel, n))}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
