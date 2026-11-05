'use client';

import LLMLogo from '@/components/LLMLogo';
import { MUTED, ModelStats, TEXT, chips, modelHref, netColor, plural } from '@/lib/stats';
import { HeaderCell } from '@/components/StatsTable';

// One extra column on the right of the grid (heads-up bb/100 and hands).
interface Extra {
  key: string; // its STAT_DEFINITIONS entry, shown on header hover
  label: string;
  render: (m: ModelStats) => React.ReactNode;
}

// Chips won from each opponent in pots they both played. With `focus`, one model's opponents
// as a list; without it, the full grid (row model's net against the column model). `field`
// picks all shared pots (`vs`, the pairwise results) or heads-up flops only (`heads_up_vs`).
export default function HeadToHead({
  models,
  focus,
  field = 'vs',
  extra,
  caption = 'Pairwise results: chips each row model won from each column model, and pots they played together',
}: {
  models: ModelStats[];
  focus?: ModelStats;
  field?: 'vs' | 'heads_up_vs';
  extra?: Extra;
  caption?: string;
}) {
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

  if (!models.some(m => Object.keys(m[field] ?? {}).length > 0)) {
    return <p className="text-[13px]" style={{ color: MUTED }}>No shared pots yet.</p>;
  }

  // The grid fills its panel: a size container whose cells share the space and whose text
  // scales with it (cq units). Under 768px of width the row labels drop to logos only.
  return (
    <div
      className="relative flex-1 min-h-0 overflow-auto"
      style={{ containerType: 'size' }}
    >
      {/* cq units resolve against the wrapper above, never the element that sets them. */}
      <table
        className="w-full h-full min-h-[180px] table-fixed tabular-nums border-collapse whitespace-nowrap"
        style={{ minWidth: 56 * (models.length + (extra ? 2 : 1)), fontSize: 'clamp(10px, min(2.2cqh, 1.25cqw), 18px)' }}
      >
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <td className="w-[48px] @3xl:w-[22%]" />
            {models.map(m => (
              <th key={m.name} scope="col" className="p-1 font-medium" title={m.name}>
                <span className="flex justify-center"><LLMLogo model={m.name} size={18} /></span>
                <span className="sr-only">{m.name}</span>
              </th>
            ))}
            {extra && <HeaderCell col={extra} sort={{ key: extra.key, desc: true }} className="p-1 w-[15%]" />}
          </tr>
        </thead>
        <tbody>
          {models.map(row => (
            <tr key={row.name} className="border-t border-notion">
              <th scope="row" className="text-left font-medium p-1 pr-2 whitespace-nowrap overflow-hidden text-ellipsis">
                <a href={modelHref(row.name)} className="flex items-center gap-1.5 hover:underline" style={{ color: TEXT }} title={row.name}>
                  <LLMLogo model={row.name} size={18} />
                  <span className="truncate @max-3xl:sr-only">{row.name}</span>
                </a>
              </th>
              {models.map(col => {
                const v = row[field]?.[col.name];
                if (row.name === col.name || !v) {
                  return <td key={col.name} className="p-1 text-center" style={{ color: MUTED, background: 'rgba(55, 53, 47, 0.04)' }}>·</td>;
                }
                return (
                  <td key={col.name} className="lift p-1 text-center rounded" title={`${row.name} vs ${col.name}: ${chips(v.net_chips)} over ${plural(v.pots, 'pot')}`}>
                    <div className="font-bold" style={{ color: netColor(v.net_chips) }}>{chips(v.net_chips)}</div>
                    <div style={{ color: MUTED }}>{plural(v.pots, 'pot')}</div>
                  </td>
                );
              })}
              {extra && <td className="p-1 pl-2 text-right border-l border-notion">{extra.render(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
