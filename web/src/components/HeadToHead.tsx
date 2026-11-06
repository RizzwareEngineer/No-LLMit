'use client';

import { useRef, useState } from 'react';
import LLMLogo from '@/components/LLMLogo';
import { MUTED, ModelStats, TEXT, chips, modelHref, netColor, plural, signed } from '@/lib/stats';

// A model's net chips over every pot it shared with another model.
export const pairwiseTotal = (m: ModelStats) => Object.values(m.vs ?? {}).reduce((s, v) => s + v.net_chips, 0);

// One sentence naming the pairwise leader and where most of its chips came from.
export function pairwiseVerdict(models: ModelStats[]) {
  const [leader] = [...models].sort((a, b) => pairwiseTotal(b) - pairwiseTotal(a));
  const total = leader ? pairwiseTotal(leader) : 0;
  if (!leader || total <= 0) return 'Nobody is up against the field yet.';
  const [from, v] = Object.entries(leader.vs).sort((a, b) => b[1].net_chips - a[1].net_chips)[0];
  return `${leader.name} is up ${chips(total).slice(1)}, ${v.net_chips > total / 2 ? 'most of it' : 'the biggest share'} from ${from}.`;
}

// +¤53,743 as +53.7k, for cells too narrow for the full figure.
const short = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: Math.abs(n) < 1e4 ? 1 : 0 }).format(Math.abs(n))}`;

// Chips won from each opponent in pots they both played. With `focus`, one model's opponents
// as a list (the drawer); without it, the full grid of row model against column model, rows
// and columns sorted by net chips over all shared pots, with a Net column on the right.
export default function HeadToHead({
  models,
  focus,
  bigBlind = 0,
  zoomed = false,
}: {
  models: ModelStats[];
  focus?: ModelStats;
  bigBlind?: number; // for bb/100 in the cell readout
  zoomed?: boolean; // the Pairwise screen: larger type
}) {
  const outer = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ row: string; col: string; x: number; y: number; below: boolean } | null>(null);

  if (focus) {
    const rows = Object.entries(focus.vs ?? {}).sort((a, b) => b[1].net_chips - a[1].net_chips);
    if (rows.length === 0) return <p className="text-[13px]" style={{ color: MUTED }}>No shared pots yet.</p>;
    return (
      <table className="w-full text-[12px] tabular-nums">
        <caption className="sr-only">{focus.name} against each opponent</caption>
        <thead>
          <tr className="border-b border-notion" style={{ color: MUTED }}>
            <th scope="col" className="text-left font-medium p-2">Opponent</th>
            <th scope="col" className="text-right font-medium p-2">Pots</th>
            <th scope="col" className="text-right font-medium p-2">Net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {rows.map(([name, v]) => (
            <tr key={name} className="lift">
              <th scope="row" className="text-left font-medium p-2">
                <a href={modelHref(name)} className="flex items-center gap-2 hover:underline" style={{ color: TEXT }}>
                  <LLMLogo model={name} size={18} />
                  {name}
                </a>
              </th>
              <td className="text-right p-2">{v.pots}</td>
              <td className="text-right p-2 font-bold" style={{ color: netColor(v.net_chips) }}>{chips(v.net_chips)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (!models.some(m => Object.keys(m.vs ?? {}).length > 0)) {
    return <p className="text-[13px]" style={{ color: MUTED }}>No shared pots yet.</p>;
  }

  const sorted = [...models].sort((a, b) => pairwiseTotal(b) - pairwiseTotal(a));
  const maxCell = Math.max(1, ...sorted.flatMap(m => Object.values(m.vs ?? {}).map(v => Math.abs(v.net_chips))));
  const maxTotal = Math.max(1, ...sorted.map(m => Math.abs(pairwiseTotal(m))));
  // Cell tint: stronger with the size of the result, green when the row model won.
  const tint = (n: number) => `rgba(${n > 0 ? '15, 123, 108' : '200, 50, 50'}, ${(0.05 + 0.3 * Math.abs(n) / maxCell).toFixed(3)})`;
  const bb100 = (net: number, pots: number) => (bigBlind && pots ? signed((net / bigBlind / pots) * 100) : null);
  const show = (e: React.MouseEvent, row: string, col: string) => {
    const o = outer.current!.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const below = r.top - o.top < 70; // no room above the cell: show it underneath
    setTip({ row, col, x: Math.min(Math.max(r.left - o.left + r.width / 2, 110), o.width - 110), y: below ? r.bottom - o.top + 4 : r.top - o.top - 4, below });
  };
  const tipV = tip && sorted.find(m => m.name === tip.row)?.vs[tip.col];

  // The grid fills its panel: a size container whose cells share the space and whose text scales
  // with it (cq units). Narrow panels show logos for row names and short figures in the cells.
  return (
    <div ref={outer} className="relative flex-1 min-h-0 flex flex-col">
      {/* No scroller of its own: a grid taller than a phone's preview spills into the panel's one scroll. */}
      <div className="flex-1 min-h-0" style={{ containerType: 'size' }} onMouseLeave={() => setTip(null)}>
        {/* cq units resolve against the wrapper above, never the element that sets them. */}
        <table
          className="w-full h-full table-fixed tabular-nums border-separate border-spacing-px @3xl:border-spacing-[2px]"
          style={{ fontSize: zoomed ? 'clamp(9px, min(2.6cqh, 1.35cqw), 20px)' : 'clamp(10px, min(2.4cqh, 1.3cqw), 15px)' }}
        >
          <caption className="sr-only">Pairwise results: chips each row model won from each column model, sorted by net chips</caption>
          <thead>
            <tr>
              <td className="w-[30px] @3xl:w-[19%]" />
              {sorted.map(m => (
                <th key={m.name} scope="col" className="p-0.5 font-medium" title={m.name}>
                  <span className="flex justify-center"><LLMLogo model={m.name} size={zoomed ? 20 : 16} /></span>
                  <span className="sr-only">{m.name}</span>
                </th>
              ))}
              <th scope="col" className="w-[14%] @xl:w-[20%] @3xl:w-[15%] px-1 text-right font-bold align-bottom" style={{ color: TEXT }}>Net</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => {
              const total = pairwiseTotal(row);
              return (
                <tr key={row.name}>
                  <th scope="row" className="text-left font-medium pr-1 overflow-hidden">
                    <a href={modelHref(row.name)} className="flex items-center gap-1.5 min-w-0 hover:underline" style={{ color: TEXT }} title={row.name}>
                      <LLMLogo model={row.name} size={zoomed ? 20 : 16} />
                      <span className="truncate @max-3xl:sr-only">{row.name}</span>
                    </a>
                  </th>
                  {sorted.map(col => {
                    const v = row.vs?.[col.name];
                    if (row.name === col.name || !v) {
                      return <td key={col.name} className="text-center rounded-sm" style={{ color: MUTED, background: 'rgba(55, 53, 47, 0.04)' }}>·</td>;
                    }
                    return (
                      <td
                        key={col.name}
                        className="text-center rounded-sm font-bold whitespace-nowrap overflow-hidden"
                        style={{ color: netColor(v.net_chips), background: tint(v.net_chips) }}
                        onMouseEnter={e => show(e, row.name, col.name)}
                      >
                        <span className="@max-4xl:hidden">{chips(v.net_chips)}</span>
                        <span className="@4xl:hidden">{short(v.net_chips)}</span>
                        <span className="sr-only"> vs {col.name} over {plural(v.pots, 'pot')}</span>
                      </td>
                    );
                  })}
                  <td className="pl-1 text-right font-bold whitespace-nowrap overflow-hidden" style={{ color: netColor(total), fontSize: zoomed ? 'max(14px, 1.1em)' : '1.05em' }}>
                    <span className="flex items-center gap-1.5">
                      {/* A bar as long as the total, against the largest total either way. */}
                      <span aria-hidden className="flex-1 h-2 rounded-sm @max-xl:hidden" style={{ background: 'rgba(55, 53, 47, 0.06)' }}>
                        <span className="block h-full rounded-sm" style={{ width: `${(Math.abs(total) / maxTotal) * 100}%`, background: netColor(total), opacity: 0.7 }} />
                      </span>
                      <span className="@max-4xl:hidden">{chips(total)}</span>
                      <span className="@4xl:hidden">{short(total)}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* The hovered cell's readout floats over the grid, clamped inside it. */}
      {tip && tipV && (
        <div
          role="tooltip"
          className="absolute z-10 pointer-events-none w-[220px] rounded bg-white px-2 py-1.5 text-[12px] tabular-nums"
          style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`, color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px' }}
        >
          <div className="font-medium">{tip.row} vs {tip.col}</div>
          <div><span className="font-bold" style={{ color: netColor(tipV.net_chips) }}>{chips(tipV.net_chips)}</span> over {plural(tipV.pots, 'pot')}</div>
          {bb100(tipV.net_chips, tipV.pots) && <div style={{ color: MUTED }}>{bb100(tipV.net_chips, tipV.pots)} bb per 100 shared pots</div>}
        </div>
      )}
    </div>
  );
}
