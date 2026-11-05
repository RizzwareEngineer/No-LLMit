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
}: {
  models: ModelStats[];
  selected: string;
  onSelect?: (name: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ width, height }, setSize] = useState({ width: 720, height: 300 }); // the plot fills its panel
  const reduce = useReducedMotion();

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
  const left = 12 + 7 * Math.max(...yTicks.map(t => String(t).length)); // room for the widest y label
  const x = (n: number) => left + (n / maxHand) * (w - left - PAD.right);
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin || 1)) * (height - PAD.top - PAD.bottom);
  const line = (pts: [number, number][]) => pts.map(([n, v], i) => `${i ? 'L' : 'M'}${x(n)},${y(v)}`).join('');
  const selPts = sel ? drawn.get(sel.name)! : [];
  const bandPath = sel
    ? line(selPts.map(([n, v]) => [n, v + band(sel, n)])) +
      [...selPts].reverse().map(([n, v]) => `L${x(n)},${y(v - band(sel, n))}`).join('') + 'Z'
    : '';
  const tween = { duration: reduce ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] as const };
  const ordered = sel ? [...models.filter(m => m !== sel), sel] : models; // selected drawn on top
  const summary = models
    .map(m => `${m.name} ${signed(m.cumulative_bb.at(-1)?.[1] ?? 0)} bb after ${m.cumulative_bb.at(-1)?.[0] ?? 0} hands`)
    .join('; ');

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* The svg is absolute so its height comes from the panel, never the other way round. */}
      <div ref={ref} className="relative w-full flex-1 min-h-[120px]">
        <svg className="absolute inset-0" width="100%" height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={`Cumulative big blinds won over hands. ${summary}. Shaded: 95% band for ${sel?.name}.`}>
          {yTicks.map(t => (
            <g key={t}>
              <line x1={left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(55, 53, 47, 0.35)' : GRID} />
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
                strokeWidth={m === sel ? 2.5 : 1.5}
                strokeLinejoin="round"
                opacity={m === sel ? 1 : 0.35}
                // Lines draw in the first time the chart scrolls into view, then tween as hands finish.
                initial={{ d, pathLength: reduce ? 1 : 0 }}
                animate={{ d }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true }}
                transition={{ d: tween, pathLength: { duration: reduce ? 0 : 1.2, ease: 'easeOut' } }}
              />
            );
          })}
        </svg>
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
