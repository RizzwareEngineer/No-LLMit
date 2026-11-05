'use client';

import Link from 'next/link';
import LLMLogo from '@/components/LLMLogo';
import { MUTED, ModelStats, TEXT, chips, modelSlug, netColor } from '@/lib/stats';


// Chips won from each opponent in pots they both played. With `focus`, one model's opponents
// as a list; without it, the full grid (row model's net against the column model).
export default function HeadToHead({ models, focus }: { models: ModelStats[]; focus?: ModelStats }) {
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
            <tr key={name}>
              <th scope="row" className="text-left font-medium p-2">
                <Link href={`/stats/${modelSlug(name)}`} className="flex items-center gap-2 hover:underline" style={{ color: TEXT }}>
                  <LLMLogo model={name} size={18} />
                  {name}
                </Link>
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

  return (
    <div className="relative overflow-x-auto">
      <table className="text-[11px] tabular-nums border-collapse">
        <caption className="sr-only">Head-to-head: chips each row model won from each column model, and pots they played together</caption>
        <thead>
          <tr>
            <td />
            {models.map(m => (
              <th key={m.name} scope="col" className="p-1 font-medium" title={m.name}>
                <span className="flex justify-center"><LLMLogo model={m.name} size={18} /></span>
                <span className="sr-only">{m.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {models.map(row => (
            <tr key={row.name} className="border-t border-notion">
              <th scope="row" className="text-left font-medium p-1 pr-2 whitespace-nowrap">
                <Link href={`/stats/${modelSlug(row.name)}`} className="flex items-center gap-1.5 hover:underline" style={{ color: TEXT }}>
                  <LLMLogo model={row.name} size={18} />
                  {row.name}
                </Link>
              </th>
              {models.map(col => {
                const v = row.vs?.[col.name];
                if (row.name === col.name || !v) {
                  return <td key={col.name} className="p-1 text-center" style={{ color: MUTED, background: 'rgba(55, 53, 47, 0.04)' }}>·</td>;
                }
                return (
                  <td key={col.name} className="p-1 text-center min-w-[56px]" title={`${row.name} vs ${col.name}: ${chips(v.net_chips)} over ${v.pots} pots`}>
                    <div className="font-bold" style={{ color: netColor(v.net_chips) }}>{chips(v.net_chips)}</div>
                    <div style={{ color: MUTED }}>{v.pots} pots</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
