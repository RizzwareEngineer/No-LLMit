'use client';

import { memo, useEffect, useRef, useState } from 'react';
import LLMLogo from '@/components/LLMLogo';
import Panel, { CountUp } from '@/components/Section';
import CumulativeChart from '@/components/CumulativeChart';
import StatsTable from '@/components/StatsTable';
import HeadToHead from '@/components/HeadToHead';
import { SampleBadge, SmallSampleNote, StatsMessage } from '@/components/StatsPanel';
import { MIN_HANDS, MUTED, TEXT, netColor, useStats } from '@/lib/stats';

type Stats = ReturnType<typeof useStats>;

// Screens 2-5. Each is an empty full-height snap point; the panels sit on one sticky stage
// above them. On the overview (#stats) the three panels share the stage; on each later screen
// one panel fills it. Old #head-to-head links still land on the head-to-head screen.
const SCREENS = [
  { id: 'stats', label: 'Overview' },
  { id: 'race', label: 'Race' },
  { id: 'stats-table', label: 'Stats' },
  { id: 'h2h', label: 'Head-to-head' },
] as const;
type Screen = (typeof SCREENS)[number]['id'];
const ALIASES: Record<string, Screen> = { 'head-to-head': 'h2h' };
const INPUTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
const asScreen = (id: string): Screen => ALIASES[id] ?? SCREENS.find(s => s.id === id)?.id ?? 'stats';

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
  const [active, setActive] = useState<Screen>('stats');
  // A failed refetch keeps the last good data on screen, with the problem as a status line.
  const ready = !!data && current;

  // The screen crossing the middle of the window picks the stage's layout; screen 1 counts
  // as the overview. pageBy announces its target first so the zoom starts with the key press.
  useEffect(() => {
    const io = new IntersectionObserver(
      entries => entries.forEach(e => e.isIntersecting && setActive(asScreen(e.target.id))),
      { rootMargin: '-50% 0px -50% 0px' },
    );
    document.querySelectorAll('[data-screen]').forEach(el => io.observe(el));
    const onScreen = (e: Event) => setActive(asScreen((e as CustomEvent<string>).detail));
    window.addEventListener('screenchange', onScreen);
    return () => {
      io.disconnect();
      window.removeEventListener('screenchange', onScreen);
    };
  }, []);

  // A link to /#stats (or a panel) lands before the sections have data: jump to the screen's
  // exact top once they arrive, once per page load.
  const jumped = useRef(false);
  useEffect(() => {
    if (!ready || jumped.current) return;
    jumped.current = true;
    const id = window.location.hash.slice(1);
    if (id !== 'stats' && !(id in ALIASES) && !SCREENS.some(s => s.id === id)) return;
    const el = document.getElementById(asScreen(id));
    if (!el) return;
    // Screen 1 can still change height as the table fills in (and scroll anchoring may move the
    // page with it); keep the landing on the screen's edge for a few seconds, until the visitor
    // scrolls or presses a key.
    const land = () => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
    const ro = new ResizeObserver(land);
    const stop = () => {
      ro.disconnect();
      clearTimeout(timer);
      INPUTS.forEach(t => window.removeEventListener(t, stop));
    };
    const timer = setTimeout(stop, 4000);
    INPUTS.forEach(t => window.addEventListener(t, stop, { passive: true }));
    ro.observe(document.querySelector('[data-screen]')!);
    land();
    return stop;
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
  const zoomed = active === 'stats' ? null : active;
  const panel = (screen: Screen) => ({ focused: zoomed === screen, covered: !!zoomed && zoomed !== screen, href: `#${screen}` });

  return (
    <div className="relative w-full">
      {SCREENS.map(s => (
        <div key={s.id} id={s.id} data-screen aria-hidden className="h-svh snap-start snap-always" />
      ))}
      {/* The stage: pinned while any of the four screens is in view. pt-14 clears the sticky bar;
          the clip keeps a zoom's spring overshoot from adding a page scrollbar. */}
      <div className="absolute inset-0">
        <div
          className="sticky top-0 h-svh max-w-[1300px] mx-auto pt-14 pb-[calc(0.75rem+var(--bar-h,0px))] overflow-clip [overflow-clip-margin:8px]"
        >
          <div className="relative h-full grid gap-3 grid-cols-1 grid-rows-[repeat(3,minmax(0,1fr))] md:gap-x-4 md:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] md:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
            <Panel
              id="race-panel"
              title="Race"
              {...panel('race')}
              className="row-start-1 md:col-start-1"
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
                <CumulativeChart models={models} selected={selected || bestRate?.name || ''} onSelect={zoomed === 'race' ? setSelected : undefined} />
              ) : message}
            </Panel>

            <Panel id="stats-panel" title={<>Stats {sample && <SampleBadge />}</>} {...panel('stats-table')} className="row-start-2 md:row-start-1 md:col-start-2">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px]" style={{ color: MUTED }}>
                {ready && (
                  <span className="tabular-nums">
                    <CountUp value={data.scope.hands} /> hands · blinds ¤{data.scope.big_blind / 2}/{data.scope.big_blind}
                  </span>
                )}
                {zoomed === 'stats-table' && (
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
                )}
              </div>
              {!ready ? message : (
                <>
                  {stale}
                  {zoomed === 'stats-table' && models.some(m => m.hands < MIN_HANDS) && (
                    <SmallSampleNote>Models marked with a warning have fewer than {MIN_HANDS} hands, so their win rates are mostly luck so far. Read the ± first.</SmallSampleNote>
                  )}
                  {data.partial && (
                    <p className="mb-2 text-[12px]" style={{ color: MUTED }} role="status">All-in EV still computing…</p>
                  )}
                  <StatsTable models={models} expandable={zoomed === 'stats-table'} />
                </>
              )}
            </Panel>

            <Panel id="h2h-panel" title="Head-to-head" {...panel('h2h')} className="row-start-3 md:row-start-2 md:col-span-2">
              {ready ? <HeadToHead models={race} /> : message}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
});
