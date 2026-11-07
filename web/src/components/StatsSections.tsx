'use client';

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import LLMLogo from '@/components/LLMLogo';
import { Warning } from '@phosphor-icons/react';
import Panel, { CARD, CARD_SHADOW, CountUp, HEADER, Segmented, TITLE } from '@/components/Section';
import CumulativeChart from '@/components/CumulativeChart';
import StatsTable, { Flash, MINI_FLASHED, Moved, SLIDE, UpdatedTag, figures } from '@/components/StatsTable';
import HeadToHead, { PairwiseBars, pairwiseLeader } from '@/components/HeadToHead';
import { SampleBadge, StatsMessage } from '@/components/StatsPanel';
import { DASH, MIN_HANDS, MUTED, ModelStats, TEXT, brief, chips, ciHalf, netColor, pct, seatedModels, signed, signedBrief, useChanges, useStats } from '@/lib/stats';

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
  const [view, setView] = useState<'matrix' | 'bars'>('matrix'); // Pairwise: the 9x9 grid, or a bar per model
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
    <p className="mb-2 text-[14px]" style={{ color: MUTED }} role="status">
      {error ? 'Could not refresh the stats; showing the last good numbers.' : 'Stats are refreshing…'}
    </p>
  );
  const models = ready ? data.models : [];
  // Race, the overview and Pairwise show the models at the table now (past sessions carry no
  // lineup: everyone). The Stats screen has its own "All models" toggle.
  const seated = data?.seated ?? lineup;
  const field = useMemo(() => seatedModels(data?.models ?? [], seated), [data, seated]);
  const bigBlind = data?.scope.big_blind ?? 10;
  // The Race is each model's whole history, so it always charts all time, whatever session is picked:
  // a fresh live session has no hands to race yet.
  const raceAll = all.data?.models ?? models;
  const raceField = useMemo(() => seatedModels(raceAll, all.data?.seated ?? seated), [raceAll, all.data?.seated, seated]);
  // The leader, in one unit on every screen: net chips over the range shown (the live session by default).
  const leadOf = (list: ModelStats[], suffix = '') => {
    const leader = [...list].sort((a, b) => b.net_chips - a.net_chips)[0];
    return ready && leader && (
    <span className="flex items-center gap-1.5 tabular-nums text-[14px]" style={{ color: TEXT }}>
      <span style={{ color: MUTED }}>Leader</span>
      <LLMLogo model={leader.name} size={18} />
      <span className="font-bold">{leader.name}</span>
      <span className="font-bold" style={{ color: netColor(leader.net_chips) }}>{chips(leader.net_chips)} chips{suffix}</span>
    </span>
    );
  };
  const lead = leadOf(field);
  const byRate = [...field].sort((a, b) => b.bb100 - a.bb100);
  const top = pairwiseLeader(field);
  const live = !!session && !!all.data?.sessions.some(s => s.id === session && !s.ended_at);
  const range = session === '' ? 'all time' : live ? 'this session' : 'that session';
  const scope = ready && (
    <span className="tabular-nums text-[14px]" style={{ color: MUTED }}>
      <CountUp value={data.scope.hands} /> hands · {range} · blinds {bigBlind / 2}/{bigBlind}
    </span>
  );

  return (
    <div className="relative isolate w-full" style={{ timelineScope: '--card-stats, --card-pairwise' } as React.CSSProperties}>
      {/* Off-white behind the stats cards, edge to edge (the page pads its sides), so a card reads as a card. */}
      <div aria-hidden className="absolute inset-y-0 -inset-x-3 lg:-inset-x-4 -z-10" style={{ background: PAGE }} />
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
          <div className={`h-full ${WIDTH} mx-auto ${EDGE} overflow-clip [overflow-clip-margin:24px]`}>
            {/* Overview: three tiles, each a miniature of its screen, Race on top (stacked on phones). */}
            <div className="relative h-full grid gap-3 grid-cols-1 grid-rows-[repeat(3,minmax(0,1fr))] md:grid-cols-2 md:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
              <Panel
                id="race-panel"
                title="Race"
                href="#race"
                land="race-panel"
                focused={zoomed}
                className="row-start-1 md:col-span-2"
                aside={<>{ready && all.data && <UpdatedTag hand={all.data.scope.hands} />}{leadOf(raceField, ' all time')}</>}
              >
                {stale}
                {/* One chart in both states, so the lines never redraw on the zoom. */}
                {ready ? (
                  <CumulativeChart race mini={!zoomed} bigBlind={bigBlind} models={raceField} everyone={raceAll} selected={selected} highlight={highlight} onHighlight={setHighlight} onSelect={zoomed ? setSelected : undefined} />
                ) : message}
              </Panel>

              <Panel id="stats-panel" title={<>Stats {sample && <SampleBadge />}</>} href="#stats-table" land="stats-card" covered={zoomed} className="row-start-2 md:col-start-1">
                {ready ? <MiniStats key={session} models={byRate} /> : message}
              </Panel>

              <Panel id="pairwise-panel" title="Pairwise results" href="#pairwise" land="pairwise-card" covered={zoomed} className="row-start-3 md:row-start-2 md:col-start-2">
                {ready ? <HeadToHead key={session} models={field} mini /> : message}
              </Panel>
            </div>
          </div>
        </Recede>

        {/* The Race screen's scroll range: the stage stays as it is. */}
        <div className="h-svh" aria-hidden />

        <Card
          id="stats-card"
          title={<>Stats {sample && <SampleBadge />}</>}
          aside={<>
            {scope}
            <label className="flex items-center gap-2 text-[14px]" style={{ color: TEXT }}>
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
            {lead}
            {ready && <UpdatedTag key={`tag${session}`} hand={data.scope.hands} models={models} />}
          </>}
          by={pairwiseScreen}
          timeline="--card-pairwise"
          ref={statsCard}
          z="z-10"
        >
          {!ready ? message : (
            <>
              {stale}
              <Definition>
                Rank spread: the best and worst rank each model&apos;s 95% interval allows. Click rows to compare them.
                {models.some(m => m.hands < MIN_HANDS) && <> <Warning size={14} weight="bold" className="inline -mt-0.5" style={{ color: 'rgb(140, 95, 20)' }} aria-hidden /> Under {MIN_HANDS} hands: mostly luck so far.</>}
                {data.partial && ' All-in EV still computing…'}
              </Definition>
              <StatsTable key={session} models={models} seated={seated} />
            </>
          )}
        </Card>

        <Card
          id="pairwise-card"
          title="Pairwise results"
          aside={<>
            {scope}
            <Segmented label="View" options={[{ label: 'Matrix', value: 'matrix' }, { label: 'Bars', value: 'bars' }]} value={view} onChange={setView} />
            {lead}
            {ready && <UpdatedTag key={`tag${session}`} hand={data.scope.hands} />}
          </>}
          z="z-20"
        >
          {!ready ? message : (
            <>
              <Definition>
                Each cell: chips the row model took from the column model (green) or lost to it (red) in the hands both played; rows and columns in rank order.
                {top?.from && <> {top.leader} took the most from {top.from.name}: {chips(top.from.net)} chips.</>}
              </Definition>
              {view === 'matrix' ? <HeadToHead key={session} models={field} bigBlind={bigBlind} zoomed /> : <PairwiseBars models={field} />}
            </>
          )}
        </Card>
      </div>
    </div>
  );
});

// The Stats tile: every seated model by bb/100, with its interval and VPIP, rows sharing the tile's height.
// Changed bb/100 and VPIP flash (bb/100 floats its delta), rows slide to a new rank with a brief ▲/▼.
function MiniStats({ models }: { models: ModelStats[] }) {
  const { deltas, seq } = useChanges(figures(models, MINI_FLASHED));
  const reduce = useReducedMotion();
  return (
    <div className="flex-1 min-h-0">
      <table className="w-full h-full table-fixed tabular-nums text-[13px]" style={{ color: TEXT }}>
        <thead>
          <tr style={{ color: MUTED }}>
            <th scope="col" className="text-left font-medium">Model</th>
            <th scope="col" className="w-[42%] text-right font-medium">bb/100 ± 95% CI</th>
            <th scope="col" className="w-[18%] text-right font-medium">VPIP</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m, i) => {
            const half = ciHalf(m);
            const [bb, vpip, moved] = ['bb100', 'vpip', '#'].map(k => deltas.get(`${m.name}|${k}`));
            return (
              <motion.tr key={m.name} layout={reduce ? false : 'position'} {...SLIDE} className="border-t border-notion">
                <th scope="row" className="text-left font-medium">
                  <span className="flex items-center gap-2 min-w-0"><LLMLogo model={m.name} size={16} /><span className="truncate">{m.name}</span>{moved ? <Moved key={seq} by={moved} /> : null}</span>
                </th>
                <td className="relative text-right whitespace-nowrap">
                  {bb ? <Flash key={seq} delta={bb} delay={i * 40} rise={signed(bb)} left /> : null}
                  <span className="font-bold" style={{ color: netColor(m.bb100) }}>{signedBrief(m.bb100)}</span>
                  <span style={{ color: MUTED }}> ±{half === null ? DASH : brief(half, 0)}</span>
                </td>
                <td className="relative text-right">
                  {vpip ? <Flash key={seq} delta={vpip} delay={i * 40} /> : null}
                  {pct(m.vpip)}
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const PAGE = '#FAFAF9';

// The cards are the main thing on their screen but not the whole screen: about 90% of the
// width (the live table's 1252px at most) and about 80% of the height, centred under the bar.
const WIDTH = 'max-w-[1252px]';

// Under the 44px sticky bar and above the connection bar, with 7% of the window above the
// card and 9% below it, so the card reads as a card on a page rather than a page of its own.
const EDGE = 'pt-[calc(44px+7svh)] pb-[calc(9svh+var(--bar-h,0px))]';

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
  // No box of its own: only the cards inside show, and --dim darkens each one (card-chrome).
  return (
    <motion.div
      ref={ref}
      className={`${className} ${by && native ? 'recede' : ''} origin-center`}
      style={{ ['--recede-by' as string]: timeline, scale: fallback ? scale : undefined, ['--dim' as string]: fallback ? dim : undefined }}
    >
      {children}
    </motion.div>
  );
}

// A screen after Race: a full-height card that slides up over the one before it, in the same
// chrome, size and place as the zoomed Race panel.
function Card({
  id,
  title,
  aside,
  by,
  timeline,
  ref,
  z,
  children,
}: {
  id: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
  by?: React.RefObject<HTMLElement | null>;
  timeline?: string;
  ref?: React.Ref<HTMLElement>;
  z: string;
  children: React.ReactNode;
}) {
  return (
    <section ref={ref} id={id} tabIndex={-1} aria-labelledby={`${id}-title`} className={`sticky top-0 h-svh outline-none ${z}`}>
      <Recede by={by} timeline={timeline} className="h-full">
        <div className={`h-full ${WIDTH} mx-auto ${EDGE} flex flex-col`}>
          <div className={`${CARD} relative flex-1`} style={{ boxShadow: CARD_SHADOW }}>
            <div className={HEADER}>
              <h2 id={`${id}-title`} className={TITLE} style={{ color: TEXT }}>{title}</h2>
              {aside && <div className="flex flex-wrap items-center gap-x-5 gap-y-1">{aside}</div>}
            </div>
            <div className="panel-scroll flex-1 min-h-0 min-w-0 flex flex-col [&>*]:shrink-0 overflow-auto">{children}</div>
          </div>
        </div>
      </Recede>
    </section>
  );
}

// One muted line under a card title saying what the card counts.
function Definition({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[14px] leading-snug" style={{ color: MUTED }}>{children}</p>;
}
