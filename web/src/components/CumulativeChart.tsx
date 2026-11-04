'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import { ModelStats, ciHalf, signed } from '@/lib/stats';

const MUTED = 'rgba(55, 53, 47, 0.65)';
const GRID = 'rgba(55, 53, 47, 0.09)';
const HEIGHT = 260;
const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

// 95% band around the cumulative line after n hands. The per-hand spread implied by the
// bb/100 interval over N hands is h*sqrt(N)/196, so n hands spread by h*sqrt(N*n)/100.
function band(m: ModelStats, n: number) {
  return (ciHalf(m) * Math.sqrt(m.hands * n)) / 100;
}

function niceTicks(min: number, max: number, count = 4) {
  const step0 = (max - min) / count || 1;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map(f => f * mag).find(s => s >= step0) ?? step0;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(+t.toFixed(6));
  return ticks;
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
  const [width, setWidth] = useState(720);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sel = models.find(m => m.name === selected) ?? models[0];
  const maxHand = Math.max(1, ...models.flatMap(m => m.cumulative_bb.map(p => p[0])));
  const ys = models.flatMap(m => m.cumulative_bb.map(p => p[1]));
  if (sel) sel.cumulative_bb.forEach(([n, v]) => ys.push(v + band(sel, n), v - band(sel, n)));
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(0, ...ys);
  const w = Math.max(width, 200);
  const x = (n: number) => PAD.left + (n / maxHand) * (w - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin || 1)) * (HEIGHT - PAD.top - PAD.bottom);
  const line = (pts: [number, number][]) => pts.map(([n, v], i) => `${i ? 'L' : 'M'}${x(n)},${y(v)}`).join('');
  const bandPath = sel
    ? line(sel.cumulative_bb.map(([n, v]) => [n, v + band(sel, n)])) +
      [...sel.cumulative_bb].reverse().map(([n, v]) => `L${x(n)},${y(v - band(sel, n))}`).join('') + 'Z'
    : '';
  const ordered = sel ? [...models.filter(m => m !== sel), sel] : models; // selected drawn on top
  const summary = models
    .map(m => `${m.name} ${signed(m.cumulative_bb.at(-1)?.[1] ?? 0)} bb after ${m.cumulative_bb.at(-1)?.[0] ?? 0} hands`)
    .join('; ');

  return (
    <div>
      <div ref={ref} className="w-full">
        <svg width="100%" height={HEIGHT} viewBox={`0 0 ${w} ${HEIGHT}`} role="img" aria-label={`Cumulative big blinds won over hands. ${summary}. Shaded: 95% band for ${sel?.name}.`}>
          {niceTicks(yMin, yMax).map(t => (
            <g key={t}>
              <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(55, 53, 47, 0.35)' : GRID} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={MUTED} className="tabular-nums">{t}</text>
            </g>
          ))}
          {niceTicks(0, maxHand, 4).map(t => (
            <text key={t} x={x(t)} y={HEIGHT - 6} textAnchor="middle" fontSize={11} fill={MUTED} className="tabular-nums">{t}</text>
          ))}
          {sel && <path d={bandPath} fill={modelColor(sel.name)} opacity={0.14} />}
          {ordered.map(m => (
            <motion.path
              key={m.name}
              d={line(m.cumulative_bb)}
              fill="none"
              stroke={modelColor(m.name)}
              strokeWidth={m === sel ? 2.5 : 1.5}
              strokeLinejoin="round"
              opacity={m === sel ? 1 : 0.35}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6 }}
            />
          ))}
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

      <button
        onClick={() => setShowTable(v => !v)}
        aria-expanded={showTable}
        className="mt-2 text-[12px] hover:underline"
        style={{ color: 'rgb(35, 131, 226)' }}
      >
        {showTable ? 'Hide' : 'Show'} chart data as a table
      </button>
      {showTable && sel && (
        <table className="mt-2 text-[12px] tabular-nums">
          <caption className="text-left text-[12px] mb-1" style={{ color: MUTED }}>{sel.name}: cumulative bb with 95% band</caption>
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
        </table>
      )}
    </div>
  );
}
