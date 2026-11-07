'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import LLMLogo from '@/components/LLMLogo';
import { Warning } from '@phosphor-icons/react';
import Panel, { Added, CARD, CARD_SHADOW, CountUp, GLIDE_MS, HEADER, Segmented, TITLE, backToOverview, currentScreen, hold, setScreen } from '@/components/Section';
import CumulativeChart, { H, W, valueAt } from '@/components/CumulativeChart';
import StatsTable, { MINI_ROW } from '@/components/StatsTable';
import HeadToHead, { PairwiseBars, pairwiseLeader } from '@/components/HeadToHead';
import { SampleBadge, StatsMessage } from '@/components/StatsPanel';
import { MIN_HANDS, MUTED, ModelStats, TEXT, chips, netColor, seatedModels, useStats } from '@/lib/stats';
import { Timeline, matchupsAt, playedAt, profilesAt, syncAttrs, useReplayHand, useReplaySnap, useTimeline } from '@/lib/timeline';

type Stats = ReturnType<typeof useStats>;

// Screens 2-5, each an empty full-height snap point in the page flow. Over them sits one layer:
// the overview stage (pinned from the overview on), whose History tile fills the stage on the History
// screen, then the Profiles and Matchups cards, which slide up over it as stacked cards while the
// card under them recedes. Old #h2h and #head-to-head links land on the pairwise screen.
const SCREENS = [
  { id: 'stats', label: 'Overview' },
  { id: 'race', label: 'History' },
  { id: 'stats-table', label: 'Profiles' },
  { id: 'pairwise', label: 'Matchups' },
] as const;
type Screen = (typeof SCREENS)[number]['id'];
type Tile = Exclude<Screen, 'stats'>;
// Each detail screen's overview tile, and the element that takes focus on landing there.
const TILES: Record<Tile, { panel: string; land: string }> = {
  race: { panel: 'race-panel', land: 'race-panel' },
  'stats-table': { panel: 'stats-panel', land: 'stats-card' },
  pairwise: { panel: 'pairwise-panel', land: 'pairwise-card' },
};
const isTile = (id: string): id is Tile => id in TILES;
const ALIASES: Record<string, Screen> = { 'head-to-head': 'pairwise', h2h: 'pairwise' };
const INPUTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
const asScreen = (id: string): Screen => ALIASES[id] ?? SCREENS.find(s => s.id === id)?.id ?? 'stats';
const order = (id: string) => (id === '' ? -1 : SCREENS.findIndex(s => s.id === asScreen(id))); // '' is the table
const jump = (id: string) => {
  const el = document.getElementById(id);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
};

// Scroll-driven animations (CSS) where the browser has them; motion's useScroll otherwise.
const noop = () => () => {};
const useNativeTimeline = () =>
  useSyncExternalStore(noop, () => CSS.supports('animation-timeline: view()') && CSS.supports('timeline-scope: --a'), () => true);

// The three panels under the live table. `picked` is the session chosen in the Profiles
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
  const [view, setView] = useState<'matrix' | 'bars'>('matrix'); // Matchups: the 9x9 grid, or a bar per model
  // The tile filling the stage (null: the overview grid); `lift`, the one focused last, stays on top
  // while it glides back. Race fills it on every screen after the overview: the cards slide over it.
  const [tiles, setTiles] = useState<{ on: Tile | null; snap: boolean; lift: Tile | null }>({ on: null, snap: false, lift: null });
  const stage = useRef<HTMLDivElement>(null);
  const statsCard = useRef<HTMLElement>(null);
  const statsScreen = useRef<HTMLDivElement>(null);
  const pairwiseScreen = useRef<HTMLDivElement>(null);
  // A failed refetch keeps the last good data on screen, with the problem as a status line.
  const ready = !!data && current;
  // The History card's height: its tile's, plus the filter bar and the legend the card adds, so the
  // chart keeps its size (the stage's height at most: past that the chart shrinks a little, evenly).
  const [raceFit, setRaceFit] = useState<number>();
  const zoomedNow = tiles.on === 'race';
  useLayoutEffect(() => {
    const sec = document.getElementById('race-panel');
    const tile = sec?.parentElement; // the grid cell keeps the tile's size while the card is out
    if (!sec || !tile) return;
    const fit = () => {
      // The chart's root: its filter bar, then its box (the tallest child), whose own legend reserve is LEGEND.
      const root = sec.querySelector('.panel-scroll')?.lastElementChild;
      const kids = root ? [...root.children] as HTMLElement[] : [];
      const box = kids.reduce<HTMLElement | null>((a, c) => (!a || c.offsetHeight > a.offsetHeight ? c : a), null);
      const bar = zoomedNow && root && box ? root.clientHeight - box.offsetHeight : 64 + 8;
      const h = Math.ceil(tile.offsetHeight + bar + LEGEND);
      setRaceFit(f => (f !== undefined && Math.abs(f - h) < 1 ? f : h));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(tile);
    if (zoomedNow) ro.observe(sec);
    return () => ro.disconnect();
  }, [zoomedNow, ready]);

  // The screen crossing the middle of the window sets the stage; the table screen counts as the
  // overview. pageBy announces its target first so the Race tile starts gliding with the key press.
  // While a scroll to an announced screen runs, the screens it passes on the way are ignored.
  // Cards under another card leave the tab order (set directly: no re-render mid-scroll).
  // A click on a tile glides it to its card's place while the others slide off the screen (the page stays on the
  // overview), then the page jumps to that tile's screen, whose card sits exactly there. Back to
  // overview does the reverse: under the card, the stage snaps to that tile filling it, the page
  // jumps to the overview, and the tile glides back while the others slide back in.
  useEffect(() => {
    let target: string | null = null;
    let busy = false; // a glide from a click or Back is running: arrivals leave the stage alone
    const put = (on: Tile | null, snap = false) => {
      // A tile about to slide off goes inert, and inert taking focus away cancels a running page
      // scroll: hand focus to the tile that stays first.
      const held = document.activeElement?.closest('[data-stage] section');
      if (on && held && held.id !== TILES[on].panel) document.getElementById(TILES[on].panel)?.focus({ preventScroll: true });
      setTiles(s => (s.on === on ? s : { on, snap, lift: on ?? s.lift }));
    };
    // `arrived`: the page is on that screen now. Inert waits for it: making the focused panel
    // inert as a click on it starts the scroll would cancel that scroll. Arriving under a card
    // puts Race back in the stage at once, so scrolling back up finds the History screen.
    const show = (id: string, arrived = true) => {
      const i = order(id);
      if (!busy) put(i >= 1 ? 'race' : null, arrived && i >= 2);
      if (!arrived) return;
      setScreen(id);
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
    // An interrupted scroll never reaches its target: settle on the screen in the middle.
    const onEnd = () => {
      if (target === null) return;
      target = null;
      const el = middle();
      if (el) show(el.id);
    };
    const glide = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : GLIDE_MS);
    const open = (tile: Tile) => {
      if (busy) return;
      busy = true;
      hold(glide());
      put(tile);
      history.replaceState(null, '', `#${tile}`); // shareable; fires no hashchange, so the #model= drawer is untouched
      setTimeout(() => {
        busy = false;
        jump(tile);
        document.getElementById(TILES[tile].land)?.focus({ preventScroll: true });
      }, glide());
    };
    const back = () => {
      const at = currentScreen();
      if (busy || !isTile(at)) return;
      busy = true;
      hold(glide());
      put(at, true);
      // Two frames: the snapped stage is painted under the card before the card leaves.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        busy = false;
        history.replaceState(null, '', '#stats');
        const el = stage.current;
        el?.removeAttribute('inert');
        // A view timeline can lag the jump by a frame, showing the stage still receded: no recede
        // until the overview is painted (under the card, a stage at full size looks the same).
        el?.style.setProperty('animation', 'none');
        requestAnimationFrame(() => requestAnimationFrame(() => el?.style.removeProperty('animation')));
        jump('stats');
        put(null);
        document.getElementById(TILES[at].panel)?.focus({ preventScroll: true });
      }));
    };
    const onOpen = (e: Event) => open((e as CustomEvent<Tile>).detail);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]') && back();
    window.addEventListener('screenchange', onScreen);
    window.addEventListener('scrollend', onEnd);
    window.addEventListener('overview', back);
    window.addEventListener('tileopen', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      io.disconnect();
      window.removeEventListener('screenchange', onScreen);
      window.removeEventListener('scrollend', onEnd);
      window.removeEventListener('overview', back);
      window.removeEventListener('tileopen', onOpen);
      window.removeEventListener('keydown', onKey);
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
  // History, the overview and Matchups show the models at the table now (past sessions carry no
  // lineup: everyone). The Profiles screen has its own "All models" toggle.
  const seated = data?.seated ?? lineup;
  const field = useMemo(() => seatedModels(data?.models ?? [], seated), [data, seated]);
  const bigBlind = data?.scope.big_blind ?? 10;
  // One scope for History, Profiles and Matchups (all time by default; the session picker changes all
  // three) and one clock: History's replay, which the other two follow through the timeline.
  const tl = useTimeline(session, data?.scope.hands);
  const live = !!session && !!all.data?.sessions.some(s => s.id === session && !s.ended_at);
  const range = session === '' ? 'all time' : live ? 'this session' : 'that session';
  // The leader, in one unit and one scope on every screen: net chips over the range shown.
  const lead = ready && <Leader tl={tl} models={field} bigBlind={bigBlind} scope={range} />;
  const scope = ready && (
    <span className="tabular-nums text-[14px]" style={{ color: MUTED }}>
      <CountUp value={data.scope.hands} /> hands · {range} · blinds {bigBlind / 2}/{bigBlind}
    </span>
  );

  // Each card's header extras and body, shared by its card and by its tile while that tile glides
  // in or out, so the page can swap one for the other without a visible change.
  const statsAside = <>
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
  </>;
  // Each card's body, in its tile (`card` false: the tile's content alone) and in the card. The tile's
  // table or matrix stays the same element when it opens and grows into the card's; what the card adds
  // around it fades in (`fade`), never the content itself.
  const statsBody = (card: boolean, fade = false) => !ready ? message : (
    <>
      {card && (
        <Added still={!fade}>
          {stale}
          <Definition>
            Rank spread: the best and worst rank each model&apos;s 95% interval allows. Click rows to compare them.
            {models.some(m => m.hands < MIN_HANDS) && <> <Warning size={14} weight="bold" className="inline -mt-0.5" style={{ color: 'rgb(140, 95, 20)' }} aria-hidden /> Under {MIN_HANDS} hands: mostly luck so far.</>}
            {data.partial && ' All-in EV still computing…'}
          </Definition>
        </Added>
      )}
      <SyncedProfiles key={session} tl={tl} models={models} seated={seated} mini={!card} />
    </>
  );
  const pairwiseAside = <>
    {scope}
    <Segmented label="View" options={[{ label: 'Matrix', value: 'matrix' }, { label: 'Bars', value: 'bars' }]} value={view} onChange={setView} />
    {lead}
  </>;
  const pairwiseBody = (card: boolean, fade = false) => !ready ? message : (
    <>
      {card && (
        <Added still={!fade}>
          <Definition>
            Each cell: chips the row model took from the column model (green) or lost to it (red) in the hands both played; rows and columns in rank order.
            <AtHand tl={tl} models={field}>
              {ms => { const top = pairwiseLeader(ms); return top?.from && <> {top.leader} took the most from {top.from.name}: {chips(top.from.net)} chips.</>; }}
            </AtHand>
          </Definition>
        </Added>
      )}
      <AtHand key={session} tl={tl} models={field}>
        {(ms, hand) => (
          <div {...syncAttrs(tl, hand)} className="contents">
            {card && view === 'bars' ? <PairwiseBars models={ms} /> : <HeadToHead models={ms} hand={hand} bigBlind={bigBlind} zoomed={card} mini={!card} />}
          </div>
        )}
      </AtHand>
    </>
  );
  const { on, snap, lift } = tiles;
  const zoomed = on === 'race';
  const tile = (t: Tile) => ({
    focused: on === t,
    covered: on !== null && on !== t,
    lifted: lift === t,
    snap,
    onOpen: () => window.dispatchEvent(new CustomEvent('tileopen', { detail: t })),
  });

  return (
    <div
      className="relative isolate w-full"
      style={{ timelineScope: '--card-stats, --card-pairwise' } as React.CSSProperties}
      // A click on the page around a detail screen's card (not on the card) goes back to the overview.
      onClick={e => !(e.target as Element).closest('.card-chrome') && backToOverview()}
    >
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
            sticky bar (44px) plus the table screen's own outer padding; the clip, at the window's
            edges (the page pads its sides), keeps tiles sliding off from adding a page scrollbar. */}
        <Recede by={statsScreen} timeline="--card-stats" ref={stage} className="sticky top-0 z-0 h-svh overflow-clip [overflow-clip-margin:12px] lg:[overflow-clip-margin:16px]">
          <div className={`@container ${BLOCK} ${EDGE}`} style={BLOCK_VARS}>
            {/* Overview: three tiles, each a miniature of its screen, History on top (stacked on phones).
                Every size comes from content and fixed shapes, never the window's height: History's row
                is its chart's shape at the block's width plus the tile's padding and header (72px), the
                second row holds ten fixed-height table rows (and Matchups' square of ten cells), and the
                block's width is what lets the two fit the window, at most 1252px, centred. */}
            <div className="relative h-full md:h-(--block-h) grid gap-3 grid-cols-1 grid-rows-[repeat(3,minmax(0,1fr))] md:grid-cols-[minmax(0,1fr)_var(--col2)] md:grid-rows-[var(--row1)_var(--row2)]">
              <Panel id="race-panel" title="History" href="#race" away={{ y: -1 }} className="row-start-1 md:col-span-2" aside={lead} fit={raceFit} {...tile('race')}>
                {stale}
                {/* One chart in both states, so the lines never redraw on the glide. */}
                {ready ? (
                  <CumulativeChart race mini={!zoomed} bigBlind={bigBlind} models={field} everyone={models} timeline={tl} selected={selected} highlight={highlight} onHighlight={setHighlight} onSelect={zoomed ? setSelected : undefined} />
                ) : message}
              </Panel>

              <Panel
                id="stats-panel"
                title={<>Profiles {sample && <SampleBadge />}</>}
                href="#stats-table"
                away={{ x: -1 }}
                className="row-start-2 md:col-start-1"
                extra={on === 'stats-table' && <div className={ASIDE}>{statsAside}</div>}
                fit="content"
                {...tile('stats-table')}
              >
                {statsBody(on === 'stats-table', !snap)}
              </Panel>

              <Panel
                id="pairwise-panel"
                title="Matchups"
                href="#pairwise"
                away={{ x: 1 }}
                className="row-start-3 md:row-start-2 md:col-start-2"
                extra={on === 'pairwise' && <div className={ASIDE}>{pairwiseAside}</div>}
                {...tile('pairwise')}
              >
                {pairwiseBody(on === 'pairwise', !snap)}
              </Panel>
            </div>
          </div>
        </Recede>

        {/* The History screen's scroll range: the stage stays as it is. */}
        <div className="h-svh" aria-hidden />

        <Card id="stats-card" title={<>Profiles {sample && <SampleBadge />}</>} aside={statsAside} by={pairwiseScreen} timeline="--card-pairwise" ref={statsCard} z="z-10" fit>
          {statsBody(true)}
        </Card>

        <Card id="pairwise-card" title="Matchups" aside={pairwiseAside} z="z-20">
          {pairwiseBody(true)}
        </Card>
      </div>
    </div>
  );
});

// The leader by net chips over the range shown, at the hand History is replaying (its chart value then),
// else now; nobody before anyone has a hand. `scope` names the range, the same words on every card.
function Leader({ tl, models, bigBlind, scope }: { tl: Timeline | null; models: ModelStats[]; bigBlind: number; scope: string }) {
  const hand = useReplayHand(tl);
  const played = (m: ModelStats) => (hand === null ? m.hands : playedAt(tl!, m.name, hand));
  const net = (m: ModelStats) => (hand === null ? m.net_chips : Math.round(valueAt(m.cumulative_bb, played(m)) * bigBlind));
  const [top] = models.filter(m => played(m) > 0).map(m => ({ m, n: net(m) })).sort((a, b) => b.n - a.n);
  return top && (
    <span className="flex items-center gap-1.5 tabular-nums text-[14px]" style={{ color: TEXT }}>
      <span style={{ color: MUTED }}>Leader</span>
      <LLMLogo model={top.m.name} size={18} />
      <span className="font-bold">{top.m.name}</span>
      <span className="font-bold" style={{ color: netColor(top.n) }}>{chips(top.n)} chips {scope}</span>
    </span>
  );
}

// Matchups' `models` at the hand History is replaying (each pair's running net, from the timeline),
// else now. Re-renders once per hand the replay passes.
function AtHand({ tl, models, children }: { tl: Timeline | null; models: ModelStats[]; children: (models: ModelStats[], hand: number | null) => React.ReactNode }) {
  const hand = useReplayHand(tl);
  const shown = useMemo(() => (hand === null ? models : matchupsAt(tl!, models, hand)), [tl, models, hand]);
  return children(shown, hand);
}

// Profiles at the latest snapshot at or before the hand History is replaying (so they change every
// profile_step hands, not every hand), else now. `pending`: no hands yet then; `hand`: the snapshot's.
function useProfilesAt(tl: Timeline | null, models: ModelStats[]) {
  const i = useReplaySnap(tl);
  return useMemo(
    () => (i === null ? { shown: models, pending: [], hand: null } : { ...profilesAt(tl!, models, i), hand: i < 0 ? 0 : tl!.snaps[i] }),
    [tl, models, i],
  );
}

// Profiles' table, on the tile (`mini`: fewer columns, short rows) and in the card: one element, so
// opening the tile grows this table into the card's.
function SyncedProfiles({ tl, models, seated, mini = false }: { tl: Timeline | null; models: ModelStats[]; seated?: string[]; mini?: boolean }) {
  const { shown, pending, hand } = useProfilesAt(tl, models);
  return <div {...syncAttrs(tl, hand, true)} className="contents"><StatsTable models={shown} seated={seated} pending={pending} mini={mini} /></div>;
}

const PAGE = '#FAFAF9';
const ASIDE = 'flex flex-wrap items-center gap-x-5 gap-y-1'; // a card header's extras

// The overview block and every card: the live table's 1252px wide at most, and on wider screens
// only as wide as lets History's tile (its chart's shape) and the second row fit the window's height;
// centred, with the page around it. Its height comes from that width (BLOCK_VARS), never the window.
const ROW2 = 72 + 10 * MINI_ROW; // the second row: a tile's padding and header, and ten table rows
const LEGEND = 68; // the room CumulativeChart keeps under its plot for the legend (its LEGEND_H)
const BLOCK = 'h-full w-full max-w-[1252px] md:max-w-(--block-w) mx-auto flex flex-col justify-center';
const BLOCK_VARS = {
  '--block-w': `max(560px, min(1252px, calc((100svh - 44px - 7svh - var(--bar-h, 0px) - ${12 + 72 + ROW2}px) * ${W / H} + 32px)))`,
  '--row1': `calc((100cqw - 32px) * ${H / W} + 72px)`,
  '--row2': `${ROW2}px`,
  '--col2': `${ROW2 - 72 + 32 + 48}px`, // Matchups: its square of ten cells, its padding and a little air
  '--block-h': `calc(var(--row1) + 12px + var(--row2))`,
} as React.CSSProperties;

// Under the 44px sticky bar and above the connection bar, at least 3% of the window above the
// block and 4% below it; the block is centred in what is left, so it reads as cards on a page.
const EDGE = 'pt-[calc(44px+3svh)] pb-[calc(4svh+var(--bar-h,0px))]';

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

// A screen after History: a card that slides up over the one before it, in the same chrome, size
// and place as its focused overview tile.
function Card({
  id,
  title,
  aside,
  by,
  timeline,
  ref,
  z,
  fit = false,
  children,
}: {
  id: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
  by?: React.RefObject<HTMLElement | null>;
  timeline?: string;
  ref?: React.Ref<HTMLElement>;
  z: string;
  fit?: boolean; // as tall as its content (centred, at most the overview's height), not the overview's box
  children: React.ReactNode;
}) {
  return (
    <section ref={ref} id={id} tabIndex={-1} aria-labelledby={`${id}-title`} className={`sticky top-0 h-svh outline-none ${z}`}>
      <Recede by={by} timeline={timeline} className="h-full">
        <div className={`@container ${BLOCK} ${EDGE}`} style={BLOCK_VARS}>
          {/* The overview's box, where its tile stands in for this card. */}
          <div className="relative h-full md:h-(--block-h)">
          <div className={`${CARD} absolute inset-x-0 inset-y-0 my-auto max-h-full ${fit ? 'h-fit' : ''}`} style={{ boxShadow: CARD_SHADOW }}>
            <div className={HEADER}>
              <h2 id={`${id}-title`} className={TITLE} style={{ color: TEXT }}>{title}</h2>
              {aside && <div className={ASIDE}>{aside}</div>}
            </div>
            <div className="panel-scroll flex-1 min-h-0 min-w-0 flex flex-col [&>*]:shrink-0 overflow-auto">{children}</div>
          </div>
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
