'use client';

import { memo, useEffect, useRef, useState } from 'react';
import LLMLogo from '@/components/LLMLogo';
import Section, { CountUp } from '@/components/Section';
import CumulativeChart from '@/components/CumulativeChart';
import StatsTable from '@/components/StatsTable';
import HeadToHead from '@/components/HeadToHead';
import { SampleBadge, SmallSampleNote, StatsMessage } from '@/components/StatsPanel';
import { MIN_HANDS, MUTED, TEXT, netColor, useStats } from '@/lib/stats';

type Stats = ReturnType<typeof useStats>;
const SECTIONS = ['race', 'stats', 'head-to-head'];

// The three sections under the live table. `picked` is the session chosen in the Stats
// section (or all time); `all` carries the session list. Memoized: the page re-renders every
// second for its clock, and these only change when stats do.
export default memo(function StatsSections({
  all,
  picked,
  session,
  onSession,
}: {
  all: Stats;
  picked: Stats;
  session: string;
  onSession: (id: string) => void;
}) {
  const { data, sample, loading, error, current } = picked;
  const [selected, setSelected] = useState('');
  // A failed refetch keeps the last good data on screen, with the problem as a status line.
  const ready = !!data && current;

  // A link to /#stats lands before the sections have data: jump there once they arrive,
  // once per page load.
  const jumped = useRef(false);
  useEffect(() => {
    if (!ready || jumped.current) return;
    jumped.current = true;
    const id = window.location.hash.slice(1);
    if (SECTIONS.includes(id)) document.getElementById(id)?.scrollIntoView({ behavior: 'instant' });
  }, [ready]);

  const message = <StatsMessage error={current ? error : null} loading={current && loading} />;
  const stale = ready && (error || loading) && (
    <p className="mb-2 text-[12px]" style={{ color: MUTED }} role="status">
      {error ? 'Could not refresh the stats; showing the last good numbers.' : 'Stats are refreshing…'}
    </p>
  );
  const models = ready ? data.models : [];
  const final = (pts: [number, number][]) => pts.at(-1)?.[1] ?? 0;
  const race = [...models].sort((a, b) => final(b.cumulative_bb) - final(a.cumulative_bb));
  const [leader, second] = race;
  const bestRate = models.reduce<typeof models[number] | undefined>((a, b) => (!a || b.bb100 > a.bb100 ? b : a), undefined);

  return (
    // Screen 2: on md+ one snap screen, Race and Stats side by side over Head-to-head. On phones
    // the wrapper is plain and each section snaps on its own. pt-14 clears the sticky bar.
    <div
      data-screen
      className="w-full max-w-[1300px] snap-align-none md:h-dvh md:snap-start md:snap-normal md:pt-14 md:pb-3 md:grid md:grid-cols-[55fr_45fr] md:grid-rows-[minmax(0,4fr)_minmax(0,5fr)] md:gap-x-4 md:gap-y-3"
    >
      <Section
        id="race"
        title="Race"
        aside={leader && second && (
          <div className="flex items-center gap-1.5 text-[13px] tabular-nums" style={{ color: TEXT }}>
            <LLMLogo model={leader.name} size={16} />
            <span className="font-bold">{leader.name}</span>
            <span style={{ color: MUTED }}>leads by</span>
            <span className="font-bold" style={{ color: netColor(1) }}>
              <CountUp value={final(leader.cumulative_bb) - final(second.cumulative_bb)} format={{ maximumFractionDigits: 1, minimumFractionDigits: 1 }} suffix=" bb" />
            </span>
          </div>
        )}
      >
        {stale}
        {ready ? (
          <CumulativeChart models={models} selected={selected || bestRate?.name || ''} onSelect={setSelected} />
        ) : message}
      </Section>

      <Section id="stats" title={<>Stats {sample && <SampleBadge />}</>}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px]" style={{ color: MUTED }}>
          {ready && (
            <span className="tabular-nums">
              <CountUp value={data.scope.hands} /> hands · blinds ¤{data.scope.big_blind / 2}/{data.scope.big_blind}
            </span>
          )}
          <label className="flex items-center gap-2" style={{ color: TEXT }}>
            Session
            <select
              value={session}
              onChange={e => onSession(e.target.value)}
              className="rounded border border-[rgba(55,53,47,0.16)] bg-white px-2 py-0.5 text-[12px]"
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
        {!ready ? message : (
          <>
            {stale}
            {models.some(m => m.hands < MIN_HANDS) && (
              <SmallSampleNote>Models marked with a warning have fewer than {MIN_HANDS} hands, so their win rates are mostly luck so far. Read the ± first.</SmallSampleNote>
            )}
            {data.partial && (
              <p className="mb-2 text-[12px]" style={{ color: MUTED }} role="status">All-in EV still computing…</p>
            )}
            <StatsTable models={models} />
          </>
        )}
      </Section>

      <Section id="head-to-head" title="Head-to-head" className="md:col-span-2">
        {ready ? <HeadToHead models={race} /> : message}
      </Section>
    </div>
  );
});
