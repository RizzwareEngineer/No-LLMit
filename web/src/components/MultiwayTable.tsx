'use client';

import LLMLogo from '@/components/LLMLogo';
import { HeaderCell } from '@/components/StatsTable';
import { DASH, MUTED, ModelStats, TEXT, modelHref, netColor, pct, signed } from '@/lib/stats';

// Hands that reached the flop with 3 or more players: the "3" and "4+" buckets together.
function multiway(m: ModelStats) {
  const three = m.by_players_to_flop?.['3'];
  const four = m.by_players_to_flop?.['4+'];
  const hands = (three?.hands ?? 0) + (four?.hands ?? 0);
  const won = (three?.won ?? 0) + (four?.won ?? 0);
  // bb/100 over both buckets: each bucket's rate weighted by its hands.
  const bb100 = hands ? ((three?.bb100 ?? 0) * (three?.hands ?? 0) + (four?.bb100 ?? 0) * (four?.hands ?? 0)) / hands : null;
  return { hands, won, bb100, three: three?.bb100 ?? null, four: four?.bb100 ?? null };
}

const rate = (n: number | null) => (n === null ? DASH : <span className="font-bold" style={{ color: netColor(n) }}>{signed(n)}</span>);

const COLUMNS = [
  { key: 'mw_hands', label: 'Hands' },
  { key: 'mw_won', label: 'Won' },
  { key: 'mw_win', label: 'Win %' },
  { key: 'mw_bb', label: 'bb/100' },
  { key: 'mw_bb100_3', label: 'bb/100 at 3' },
  { key: 'mw_bb100_4', label: 'bb/100 at 4+' },
  { key: 'mw_share', label: 'Share vs fair' },
];
const SORT = { key: 'mw_bb', desc: true }; // combined multiway bb/100

// Multiway pots per model, best combined multiway bb/100 first; models with none sort last.
export default function MultiwayTable({ models }: { models: ModelStats[] }) {
  const rows = models.map(m => ({ m, mw: multiway(m) }))
    .sort((a, b) => (b.mw.bb100 ?? -Infinity) - (a.mw.bb100 ?? -Infinity));
  if (!rows.some(r => r.mw.hands > 0)) return <p className="text-[13px]" style={{ color: MUTED }}>No multiway flops yet.</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-[12px] tabular-nums">
        <caption className="sr-only">Multiway pots per model, sorted by bb/100 over all flops with 3 or more players. Header info buttons explain each column.</caption>
        <thead>
          <tr className="border-b border-notion">
            <th scope="col" className="p-2 text-left font-medium align-bottom sticky left-0 bg-white" style={{ color: MUTED }}>Model</th>
            {COLUMNS.map(c => <HeaderCell key={c.key} col={c} sort={SORT} />)}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {rows.map(({ m, mw }) => {
            const share = m.multiway_share;
            const won = share?.chips_won_pct ?? null;
            const fair = share?.fair_share_pct ?? null;
            return (
              <tr key={m.name} className="lift">
                <th scope="row" className="p-2 text-left font-bold sticky left-0 bg-white whitespace-nowrap">
                  <a href={modelHref(m.name)} className="flex items-center gap-2 hover:underline" style={{ color: TEXT }}>
                    <LLMLogo model={m.name} size={20} />
                    {m.name}
                  </a>
                </th>
                <td className="p-2 text-right">{mw.hands}</td>
                <td className="p-2 text-right">{mw.won}</td>
                <td className="p-2 text-right">{mw.hands ? pct(mw.won / mw.hands) : DASH}</td>
                <td className="p-2 text-right whitespace-nowrap">{rate(mw.bb100)}</td>
                <td className="p-2 text-right whitespace-nowrap">{rate(mw.three)}</td>
                <td className="p-2 text-right whitespace-nowrap">{rate(mw.four)}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  {won === null || fair === null ? DASH : (
                    <>
                      <span className="font-bold" style={{ color: won > fair ? netColor(1) : TEXT }}>{pct(won)}</span>
                      <span style={{ color: MUTED }}> vs {pct(fair)}</span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
