'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { MotionConfig } from 'motion/react';
import { CaretDown, CaretUp, Info, Warning } from '@phosphor-icons/react';
import LLMLogo from '@/components/LLMLogo';
import StatsPanel, { SampleBadge, SmallSampleNote, StatsMessage } from '@/components/StatsPanel';
import CumulativeChart from '@/components/CumulativeChart';
import HeadToHead from '@/components/HeadToHead';
import { MIN_HANDS, MUTED, ModelStats, STAT_DEFINITIONS, DASH, TEXT, ciHalf, modelSlug, netColor, pct, signed, useStats } from '@/lib/stats';

interface Column {
  key: keyof typeof STAT_DEFINITIONS;
  label: string;
  value: (m: ModelStats) => number | null;
  render: (m: ModelStats) => React.ReactNode;
  lowerIsBetter?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'hands', label: 'Hands', value: m => m.hands, render: m => m.hands.toLocaleString() },
  {
    key: 'bb100', label: 'bb/100', value: m => m.bb100,
    render: m => <span style={{ color: netColor(m.bb100) }} className="font-bold">{signed(m.bb100)} <span className="font-normal" style={{ color: MUTED }}>± {ciHalf(m)?.toFixed(1) ?? DASH}</span></span>,
  },
  { key: 'aiev_bb100', label: 'All-in EV bb/100', value: m => m.aiev_bb100, render: m => signed(m.aiev_bb100) },
  { key: 'vpip', label: 'VPIP', value: m => m.vpip, render: m => pct(m.vpip) },
  { key: 'pfr', label: 'PFR', value: m => m.pfr, render: m => pct(m.pfr) },
  { key: 'three_bet', label: '3-bet', value: m => m.three_bet, render: m => pct(m.three_bet) },
  { key: 'af', label: 'AF', value: m => m.af, render: m => m.af?.toFixed(1) ?? DASH },
  { key: 'cbet', label: 'C-bet', value: m => m.cbet, render: m => pct(m.cbet) },
  { key: 'fold_to_cbet', label: 'Fold to c-bet', value: m => m.fold_to_cbet, render: m => pct(m.fold_to_cbet) },
  { key: 'wtsd', label: 'WTSD', value: m => m.wtsd, render: m => pct(m.wtsd) },
  { key: 'wsd', label: 'W$SD', value: m => m.wsd, render: m => pct(m.wsd) },
  { key: 'fold_when_check_free', label: 'Fold when check free', value: m => m.fold_when_check_free, render: m => pct(m.fold_when_check_free), lowerIsBetter: true },
  { key: 'error_rate', label: 'Errors', value: m => m.error_rate, render: m => pct(m.error_rate), lowerIsBetter: true },
  { key: 'cost_per_hand_usd', label: 'Cost/hand', value: m => m.cost_per_hand_usd, render: m => `$${m.cost_per_hand_usd.toFixed(4)}`, lowerIsBetter: true },
];

function HeaderCell({ col, sort, onSort }: { col: Column; sort: { key: string; desc: boolean }; onSort: () => void }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const active = sort.key === col.key;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      className="relative p-2 font-medium text-right align-bottom leading-tight"
      style={{ color: active ? TEXT : MUTED }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="inline-flex items-end justify-end gap-0.5">
        <button onClick={onSort} className="hover:underline text-right">
          {col.label}
          {active && (sort.desc ? <CaretDown size={10} weight="bold" aria-hidden /> : <CaretUp size={10} weight="bold" aria-hidden />)}
        </button>
        <button
          onClick={() => setOpen(true)} // not a toggle: hover and focus already opened it
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={e => e.key === 'Escape' && setOpen(false)}
          aria-label={`What ${col.label} means`}
          aria-expanded={open}
          aria-describedby={tipId}
          className="p-1.5 -m-1 opacity-60 hover:opacity-100"
        >
          <Info size={12} aria-hidden />
        </button>
      </span>
      {/* Always in the DOM so aria-describedby resolves; hidden until opened. */}
      <span
        id={tipId}
        role="tooltip"
        hidden={!open}
        className="absolute right-0 top-full z-20 mt-1 w-56 rounded bg-white p-2 text-left text-[12px] font-normal whitespace-normal"
        style={{ color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px' }}
      >
        {STAT_DEFINITIONS[col.key]}
      </span>
    </th>
  );
}

export default function StatsPage() {
  const [session, setSession] = useState('');
  // The session list comes from the all-time response: a per-session response lists only its own session.
  const all = useStats();
  const picked = useStats(session || undefined, !!session);
  const { data, sample, loading, error, current } = session ? picked : all;
  const [sort, setSort] = useState({ key: 'bb100', desc: true });
  const [selected, setSelected] = useState('');

  const col = COLUMNS.find(c => c.key === sort.key) ?? COLUMNS[1];
  // Nulls (nothing to count yet) sort last in both directions.
  const models = [...(data?.models ?? [])].sort((a, b) => {
    const va = col.value(a), vb = col.value(b);
    if (va === null || vb === null) return (va === null ? 1 : 0) - (vb === null ? 1 : 0);
    return (sort.desc ? -1 : 1) * (va - vb);
  });
  // Default highlight: the best bb/100, independent of the table's sort.
  const leader = data?.models.reduce((a, b) => (b.bb100 > a.bb100 ? b : a), data.models[0]);
  const toggleSort = (c: Column) =>
    setSort(s => (s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: !c.lowerIsBetter }));
  const ready = data && current && !error && !loading;

  return (
    <MotionConfig reducedMotion="user">
      <div className="mb-6">
        <h1 className="text-[24px] font-bold mb-1" style={{ color: TEXT }}>
          Stats {sample && <SampleBadge />}
        </h1>
        <p className="text-[15px]" style={{ color: MUTED }}>
          How each model plays, from every hand at the shared table.
          {ready && ` ${data.scope.hands.toLocaleString()} hands, blinds ¤${data.scope.big_blind / 2}/${data.scope.big_blind}.`}
        </p>
        <label className="mt-3 flex items-center gap-2 text-[13px]" style={{ color: TEXT }}>
          Session
          <select
            value={session}
            onChange={e => setSession(e.target.value)}
            className="rounded border border-[rgba(55,53,47,0.16)] bg-white px-2 py-1 text-[13px]"
          >
            <option value="">All time</option>
            {(all.data?.sessions ?? []).map(s => (
              <option key={s.id} value={s.id}>
                {new Date(s.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                {s.ended_at ? '' : ' (live)'} · {s.hands.toLocaleString()} hands
              </option>
            ))}
          </select>
        </label>
      </div>

      {!ready ? (
        <StatsMessage error={current ? error : null} loading={current && loading} />
      ) : (
        <>
          {data.models.some(m => m.hands < MIN_HANDS) && (
            <SmallSampleNote>Models marked with a warning have fewer than {MIN_HANDS} hands, so their win rates are mostly luck so far. Read the ± first.</SmallSampleNote>
          )}

          <StatsPanel title="Every model" className="mb-6">
            <div className="relative overflow-x-auto -m-3">
              <table className="w-full text-[12px] tabular-nums">
                <caption className="sr-only">Stats per model. Column headers sort the table; the info buttons explain each stat.</caption>
                <thead>
                  <tr className="border-b border-notion">
                    <th scope="col" className="p-2 text-left font-medium align-bottom sticky left-0 bg-white" style={{ color: MUTED }}>Model</th>
                    {COLUMNS.map(c => <HeaderCell key={c.key} col={c} sort={sort} onSort={() => toggleSort(c)} />)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {models.map(m => (
                    <tr key={m.name}>
                      <th scope="row" className="p-2 text-left font-bold sticky left-0 bg-white whitespace-nowrap">
                        <Link href={`/stats/${modelSlug(m.name)}`} className="flex items-center gap-2 hover:underline" style={{ color: TEXT }}>
                          <LLMLogo model={m.name} size={20} />
                          {m.name}
                          {m.hands < MIN_HANDS && (
                            <Warning size={13} weight="bold" style={{ color: 'rgb(140, 95, 20)' }} aria-label={`Fewer than ${MIN_HANDS} hands`} />
                          )}
                        </Link>
                      </th>
                      {COLUMNS.map(c => <td key={c.key} className="p-2 text-right whitespace-nowrap">{c.render(m)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </StatsPanel>

          <div className="flex flex-col gap-6">
            <StatsPanel title="Cumulative big blinds">
              <CumulativeChart models={data.models} selected={selected || leader?.name || ''} onSelect={setSelected} />
            </StatsPanel>
            <StatsPanel title="Head to head">
              <HeadToHead models={models} />
            </StatsPanel>
          </div>
        </>
      )}
    </MotionConfig>
  );
}
