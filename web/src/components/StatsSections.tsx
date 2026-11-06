'use client';

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import Panel, { CountUp, SHADOW } from '@/components/Section';
import CumulativeChart from '@/components/CumulativeChart';
import StatsTable from '@/components/StatsTable';
import HeadToHead, { PairwiseBars, pairwiseLeader, pairwiseVerdict } from '@/components/HeadToHead';
import { SampleBadge, SmallSampleNote, StatsMessage } from '@/components/StatsPanel';
import { MIN_HANDS, MUTED, TEXT, netColor, seatedModels, signed, signedBrief, useStats } from '@/lib/stats';

type Stats = ReturnType<typeof useStats>;

// Screens 2-5, each an empty full-height snap point in the page flow. Over them sits one layer:
// the overview stage (pinned from the overview on), in which the Race panel zooms to fill the
// stage on the Race screen (the page's one zoom), then the Stats and Pairwise cards, which slide
// up over it as stacked cards while the card under them recedes. Old #h2h and #head-to-head links
// land on the pairwise screen.
const SCREENS = [
  { id: 'stats', label: 'Overview' },
  { id: 'race', label: 'Race' },
  { id: 'stats-table', label: 'Stats' },
  { id: 'pairwise', label: 'Pairwise results' },
] as const;
type Screen = (typeof SCREENS)[number]['id'];
const ALIASES: Record<string, Screen> = { 'head-to-head': 'pairwise', h2h: 'pairwise' };
const INPUTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
const asScreen = (id: string): Screen => ALIASES[id] ?? SCREENS.find(s => s.id === id)?.id ?? 'stats';
const order = (id: string) => (id === '' ? -1 : SCREENS.findIndex(s => s.id === asScreen(id))); // '' is the table

// Scroll-driven animations (CSS) where the browser has them; motion's useScroll otherwise.
const noop = () => () => {};
const useNativeTimeline = () =>
  useSyncExternalStore(noop, () => CSS.supports('animation-timeline: view()') && CSS.supports('timeline-scope: --a'), () => true);

// The three panels under the live table. `picked` is the session chosen in the Stats
// section (or all time); `all` carries the session list. Memoized: the page re-renders every
// second for its clock, and these only change when stats do.
export default memo(function StatsSections({
  all,
  picked,
  seated: lineup,
  session,
  onSession,
}: {
  all: Stats;
  picked: Stats;
  seated?: string[]; // the page's lineup (with its fallback for an older engine), when `picked` is all-time or live
  session: string;
  onSession: (id: string) => void;
}) {
  const { data, sample, loading, error, current } = picked;
  const [selected, setSelected] = useState('');
  const [highlight, setHighlight] = useState<string | undefined>();
  const [matrix, setMatrix] = useState(false); // Pairwise: the 9x9 grid instead of the bars
  // Race stays zoomed on every screen after it: the cards slide over it, it never zooms back out.
  const [zoomed, setZoomed] = useState(false);
  // The screen whose card the overview recedes under: Pairwise's during a jump straight to it.
  const [recedeBy, setRecedeBy] = useState<'stats' | 'pairwise'>('stats');
  const stage = useRef<HTMLDivElement>(null);
  const statsCard = useRef<HTMLElement>(null);
  const statsScreen = useRef<HTMLDivElement>(null);
  const pairwiseScreen = useRef<HTMLDivElement>(null);
  // A failed refetch keeps the last good data on screen, with the problem as a status line.
  const ready = !!data && current;

  // The screen crossing the middle of the window decides the zoom; the table screen counts as
  // the overview. pageBy announces its target first so the zoom starts with the key press.
  // While a scroll to an announced screen runs, the screens it passes on the way are ignored.
  // Cards under another card leave the tab order (set directly: no re-render mid-scroll).
  // A click on the Stats or Pairwise teaser skips Race (goToScreen's 'screenjump'): Race stays
  // unzoomed, and for Pairwise the Stats card hides and the overview recedes on Pairwise's
  // timeline, so only the target card slides over the overview. The jump ends when that slide
  // does (the instant landing before it ends its own scroll at once, hence the 150ms).
  useEffect(() => {
    let target: string | null = null;
    let jumpAt = 0;
    let jumpTimer: ReturnType<typeof setTimeout> | undefined;
    // `arrived`: the page is on that screen now. Inert waits for it: making the focused panel
    // inert as a click on it starts the scroll would cancel that scroll.
    const show = (id: string, arrived = true) => {
      const i = order(id);
      if (!jumpAt) setZoomed(i >= 1);
      if (!arrived) return;
      stage.current?.toggleAttribute('inert', i >= 2);
      statsCard.current?.toggleAttribute('inert', i >= 3);
    };
    const io = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (!e.isIntersecting || (target !== null && e.target.id !== target)) return;
        target = null;
        show(e.target.id);
      }),
      { rootMargin: '-50% 0px -50% 0px' },
    );
    const screens = document.querySelectorAll('[data-screen]');
    screens.forEach(el => io.observe(el));
    const onScreen = (e: Event) => {
      target = (e as CustomEvent<string>).detail;
      show(target, false);
    };
    const middle = () => [...screens].find(s => { const r = s.getBoundingClientRect(); return r.top <= innerHeight / 2 && r.bottom > innerHeight / 2; });
    const onJump = (e: Event) => {
      jumpAt = performance.now();
      clearTimeout(jumpTimer);
      jumpTimer = setTimeout(endJump, 1500); // browsers without scrollend
      if ((e as CustomEvent<string>).detail !== 'pairwise') return;
      statsCard.current?.style.setProperty('visibility', 'hidden');
      setRecedeBy('pairwise'); // flushed before paint: the jump comes from a click or key
    };
    const endJump = () => {
      if (!jumpAt) return;
      jumpAt = 0;
      clearTimeout(jumpTimer);
      statsCard.current?.style.removeProperty('visibility');
      setRecedeBy('stats');
      const el = middle();
      if (el) show(el.id);
    };
    // An interrupted scroll never reaches its target: settle on the screen in the middle.
    const onEnd = () => {
      if (jumpAt && performance.now() - jumpAt > 150) endJump();
      if (target === null) return;
      target = null;
      const el = middle();
      if (el) show(el.id);
    };
    window.addEventListener('screenchange', onScreen);
    window.addEventListener('screenjump', onJump);
    window.addEventListener('scrollend', onEnd);
    return () => {
      io.disconnect();
      clearTimeout(jumpTimer);
      window.removeEventListener('screenchange', onScreen);
      window.removeEventListener('screenjump', onJump);
      window.removeEventListener('scrollend', onEnd);
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
    // scrolls or presses a key. A scroll that leaves the screen's edge without one of those inputs
    // (the rest of the browser's smooth fragment scroll, anchoring) lands it again.
    const land = () => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
    const ro = new ResizeObserver(land);
    const onScroll = () => Math.abs(el.getBoundingClientRect().top) > 2 && land();
    const stop = () => {
      ro.disconnect();
      clearTimeout(timer);
      INPUTS.forEach(t => window.removeEventListener(t, stop));
      window.removeEventListener('scroll', onScroll);
    };
    const timer = setTimeout(stop, 4000);
    INPUTS.forEach(t => window.addEventListener(t, stop, { passive: true }));
    window.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(document.querySelector('[data-screen]')!);
    land();
    return stop;
  }, [ready]);

  const message = <StatsMessage error={current ? error : null} loading={current && loading} />;
  const stale = ready && (error || loading) && (
    <p className="mb-2 text-[13px]" style={{ color: MUTED }} role="status">
      {error ? 'Could not refresh the stats; showing the last good numbers.' : 'Stats are refreshing…'}
    </p>
  );
  const models = ready ? data.models : [];
  // Race, the overview and Pairwise show the models at the table now (past sessions carry no
  // lineup: everyone). The Stats screen has its own "All models" toggle.
  const seated = data?.seated ?? lineup;
  const field = useMemo(() => seatedModels(data?.models ?? [], seated), [data, seated]);
  const final = (pts: [number, number][]) => pts.at(-1)?.[1] ?? 0;
  const race = [...field].sort((a, b) => final(b.cumulative_bb) - final(a.cumulative_bb));
  const [leader, second] = race;
  const topRate = [...field].sort((a, b) => b.bb100 - a.bb100).slice(0, 3);
  const chipLeader = pairwiseLeader(field)?.leader;
  const hands = ready && (
    <span className="tabular-nums">
      <CountUp value={data.scope.hands} /> hands · blinds {data.scope.big_blind / 2}/{data.scope.big_blind}
    </span>
  );
  const lead = leader && second && (
    <div className="flex items-center gap-2 tabular-nums text-[15px]" style={{ color: TEXT }}>
      <LLMLogo model={leader.name} size={20} />
      <span className="font-bold">{leader.name}</span>
      <span style={{ color: MUTED }}>leads by</span>
      <span className="font-bold" style={{ color: netColor(1) }}>
        <CountUp value={final(leader.cumulative_bb) - final(second.cumulative_bb)} format={{ maximumFractionDigits: 1, minimumFractionDigits: 1 }} suffix=" bb" />
      </span>
    </div>
  );
  // Pairwise nets count only the opponents in `field`, so the verdict names that set, and the
  // session when one is picked (the P&L beside the table is always all-time).
  const among = field !== data?.models ? `the ${field.length} at the table` : `these ${field.length} models`;
  const verdict = (size: string) => ready && <p className={`${size} font-medium leading-snug`} style={{ color: TEXT }}>{pairwiseVerdict(field, among, session ? 'in this session' : '')}</p>;

  return (
    <div className="relative w-full" style={{ timelineScope: '--card-stats, --card-pairwise' } as React.CSSProperties}>
      {SCREENS.map(s => (
        <div
          key={s.id}
          id={s.id}
          ref={s.id === 'stats-table' ? statsScreen : s.id === 'pairwise' ? pairwiseScreen : undefined}
          data-screen
          aria-hidden
          className="h-svh snap-start snap-always"
          style={{ viewTimelineName: s.id === 'stats-table' ? '--card-stats' : s.id === 'pairwise' ? '--card-pairwise' : undefined }}
        />
      ))}
      <div data-stage className="absolute inset-0">
        {/* The overview stage: pinned from the overview to the end. The top padding clears the
            sticky bar (44px) plus the table screen's own outer padding; the clip keeps a zoom's
            spring overshoot from adding a page scrollbar. */}
        <Recede by={recedeBy === 'pairwise' ? pairwiseScreen : statsScreen} timeline={`--card-${recedeBy}`} ref={stage} className="sticky top-0 z-0 h-svh">
          <div className={`h-full ${WIDTH} mx-auto ${EDGE} overflow-clip [overflow-clip-margin:8px]`}>
            {/* Overview: three teaser cards in the table screen's card style, Race on top (stacked on phones). */}
            <div className="relative h-full grid gap-3 grid-cols-1 grid-rows-[repeat(3,minmax(0,1fr))] md:grid-cols-2 md:grid-rows-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <Panel
                id="race-panel"
                title="Race"
                href="#race"
                land="race-panel"
                focused={zoomed}
                className="row-start-1 md:col-span-2"
                aside={lead}
              >
                {stale}
                {ready ? (
                  // Zoomed: the chart in a fixed 16:7 box (never stretched to the window) and the
                  // standings beside it, which are its legend. One tree either way, so the lines never redraw.
                  <div className={zoomed ? 'flex-1 flex flex-col md:flex-row items-center justify-center gap-6 md:gap-10 lg:gap-14 md:px-4 lg:px-8' : 'flex-1 min-h-0 flex flex-col gap-3'}>
                    {!zoomed && (
                      <div className="flex flex-col gap-1.5">
                        {lead}
                        {/* The sparkline's legend: its three lines, in their colours. */}
                        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" style={{ color: MUTED }}>
                          {race.slice(0, 3).map(m => (
                            <li key={m.name} className="flex items-center gap-1.5">
                              <span aria-hidden className="inline-block w-3 h-0.5 rounded" style={{ background: modelColor(m.name) }} />
                              {m.name}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className={zoomed ? 'flex flex-col w-full aspect-[4/3] md:aspect-[16/7] md:w-[min(calc(100%-400px),calc(60vh*16/7))]' : 'flex-1 min-h-0 flex flex-col'}>
                      <CumulativeChart race spark={!zoomed} models={field} selected={selected} highlight={highlight} onSelect={zoomed ? setSelected : undefined} />
                    </div>
                    {zoomed && (
                      <ol className="w-full md:w-[340px] shrink-0 flex flex-col gap-0.5" aria-label="Standings: pick a model to shade its 95% band" onMouseLeave={() => setHighlight(undefined)}>
                        {race.map((m, i) => (
                          <li key={m.name}>
                            <button
                              onClick={() => setSelected(s => (s === m.name ? '' : m.name))}
                              onMouseEnter={() => setHighlight(m.name)}
                              onFocus={() => setHighlight(m.name)}
                              onBlur={() => setHighlight(undefined)}
                              aria-pressed={m.name === selected}
                              className="w-full flex items-center gap-2.5 rounded px-2 py-2.5 md:py-1.5 text-[14px] text-left tabular-nums transition-colors hover:bg-[rgba(55,53,47,0.06)]"
                              style={{ color: TEXT, background: m.name === highlight ? 'rgba(55, 53, 47, 0.06)' : undefined, boxShadow: m.name === selected ? `inset 3px 0 0 ${modelColor(m.name)}` : undefined }}
                            >
                              <span className="w-4 text-right text-[13px]" style={{ color: MUTED }}>{i + 1}</span>
                              <LLMLogo model={m.name} size={20} />
                              <span className={`flex-1 min-w-0 truncate ${m.name === selected || i < 3 ? 'font-bold' : 'font-medium'}`}>{m.name}</span>
                              <span className="font-bold" style={{ color: netColor(final(m.cumulative_bb)) }}>{signed(final(m.cumulative_bb))} bb</span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ) : message}
              </Panel>

              <Panel id="stats-panel" title={<>Stats {sample && <SampleBadge />}</>} href="#stats-table" land="stats-card" covered={zoomed} className="row-start-2 md:col-start-1">
                {ready ? (
                  <div className="flex-1 flex flex-col justify-center">
                    <p className="mb-1 text-[13px]" style={{ color: MUTED }}>Best bb/100 at the table</p>
                    <ol>
                      {topRate.map(m => (
                        <li key={m.name} className="h-11 flex items-center gap-3 border-b border-notion last:border-0 text-[15px] tabular-nums" style={{ color: TEXT }}>
                          <LLMLogo model={m.name} size={22} />
                          <span className="flex-1 min-w-0 truncate font-medium">{m.name}</span>
                          <span className="font-bold" style={{ color: netColor(m.bb100) }}>{signedBrief(m.bb100)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : message}
              </Panel>

              <Panel id="pairwise-panel" title="Pairwise results" href="#pairwise" land="pairwise-card" covered={zoomed} className="row-start-3 md:row-start-2 md:col-start-2">
                {ready ? (
                  <div className="flex-1 flex flex-col justify-center gap-3">
                    {verdict('text-[15px]')}
                    {chipLeader && <PairwiseBars models={field} only={chipLeader} />}
                  </div>
                ) : message}
              </Panel>
            </div>
          </div>
        </Recede>

        {/* The Race screen's scroll range: the stage stays as it is. */}
        <div className="h-svh" aria-hidden />

        <Card id="stats-card" title={<>Stats {sample && <SampleBadge />}</>} by={pairwiseScreen} timeline="--card-pairwise" ref={statsCard} z="z-10">
          <Definition>
            <span className="block">How each model at the table has done per 100 hands, and how it plays.</span>
            <span className="block">Click a header to sort by it; hover it for its definition.</span>
          </Definition>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[14px]" style={{ color: MUTED }}>
            {hands}
            <label className="flex items-center gap-2" style={{ color: TEXT }}>
              Session
              <select
                value={session}
                onChange={e => onSession(e.target.value)}
                className="rounded border border-[rgba(55,53,47,0.16)] bg-white px-2 py-0.5 text-[14px]"
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
                <p className="mb-2 text-[13px]" style={{ color: MUTED }} role="status">All-in EV still computing…</p>
              )}
              <StatsTable models={models} seated={seated} />
            </>
          )}
        </Card>

        <Card id="pairwise-card" title="Pairwise results · chips" z="z-20">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            {verdict('text-[16px] md:text-[17px]')}
            <div role="group" aria-label="View" className="flex shrink-0 rounded p-0.5 text-[14px]" style={{ background: 'rgba(55, 53, 47, 0.06)' }}>
              {(['Bars', 'Matrix'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setMatrix(v === 'Matrix')}
                  aria-pressed={matrix === (v === 'Matrix')}
                  className="rounded px-3 py-1 font-medium"
                  style={matrix === (v === 'Matrix') ? { background: 'white', color: TEXT, boxShadow: SHADOW } : { color: MUTED }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <Definition>
            {matrix ? 'Each row: what that model won from each column model.' : 'Each row: green for the chips that model took from an opponent, red for the chips it gave one. Hover a segment for the amount.'}
          </Definition>
          {!ready ? message : matrix ? <HeadToHead models={field} bigBlind={data.scope.big_blind} zoomed /> : <PairwiseBars models={field} />}
          <p className="mt-3 text-[13px]" style={{ color: MUTED }}>Net: chips won from the models shown only, over every pot both were in; a multiway pot counts toward every pair in it.</p>
        </Card>
      </div>
    </div>
  );
});

// As wide as the live table at 1440x900 (1392px), so the edges line up with it there.
const WIDTH = 'max-w-[1392px]';

// The table screen's outer padding under the 44px sticky bar, and above the connection bar.
const EDGE = 'pt-[56px] lg:pt-[60px] pb-[calc(0.75rem+var(--bar-h,0px))] lg:pb-[calc(1rem+var(--bar-h,0px))]';

// Shrinks and dims its content as the screen `by` slides up over it: a CSS scroll-driven
// animation on the named view timeline of that screen where supported, motion's useScroll
// otherwise. Transform and opacity only; scrolling back reverses it; nothing under reduced motion.
function Recede({
  by,
  timeline,
  ref,
  className,
  children,
}: {
  by?: React.RefObject<HTMLElement | null>;
  timeline?: string;
  ref?: React.Ref<HTMLDivElement>;
  className: string;
  children: React.ReactNode;
}) {
  const native = useNativeTimeline();
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: by, offset: ['start end', 'start start'] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.94]);
  const dim = useTransform(scrollYProgress, [0, 1], [0, 0.14]); // the keyframes in globals.css
  const fallback = !!by && !native && !reduce;
  return (
    <motion.div
      ref={ref}
      className={`${className} ${by && native ? 'recede' : ''} origin-center rounded-2xl overflow-hidden bg-white`}
      style={{ ['--recede-by' as string]: timeline, scale: fallback ? scale : undefined }}
    >
      {children}
      {by && <motion.div aria-hidden className="recede-dim" style={{ opacity: fallback ? dim : undefined }} />}
    </motion.div>
  );
}

// A screen after Race: a full-height card that slides up over the one before it.
function Card({
  id,
  title,
  by,
  timeline,
  ref,
  z,
  children,
}: {
  id: string;
  title: React.ReactNode;
  by?: React.RefObject<HTMLElement | null>;
  timeline?: string;
  ref?: React.Ref<HTMLElement>;
  z: string;
  children: React.ReactNode;
}) {
  return (
    <section ref={ref} id={id} tabIndex={-1} aria-labelledby={`${id}-title`} className={`sticky top-0 h-svh outline-none ${z}`}>
      <Recede by={by} timeline={timeline} className="card-edge h-full">
        <div className={`h-full ${WIDTH} mx-auto px-3 lg:px-4 ${EDGE} flex flex-col`}>
          <h2 id={`${id}-title`} className="mb-2 text-[18px] font-bold" style={{ color: TEXT }}>{title}</h2>
          <div className="panel-scroll flex-1 min-h-0 min-w-0 flex flex-col [&>*]:shrink-0 overflow-auto">{children}</div>
        </div>
      </Recede>
    </section>
  );
}

// One muted line under a card title saying what the card counts.
function Definition({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[14px] leading-snug" style={{ color: MUTED }}>{children}</p>;
}
