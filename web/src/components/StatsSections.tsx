'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import LLMLogo from '@/components/LLMLogo';
import About from '@/components/About';
import { ArrowDown, Warning } from '@phosphor-icons/react';
import Panel, { Added, CARD, CARD_SHADOW, GLIDE, GLIDE_MS, HEADER, HUG, NEXT_BUTTON, NEXT_STYLE, TITLE, backToOverview, currentScreen, hold, pageBy, setScreen, stopPaging } from '@/components/Section';
import CumulativeChart, { H, W, valueAt } from '@/components/CumulativeChart';
import StatsTable from '@/components/StatsTable';
import HeadToHead, { NAMES, STRIP, TOTALS } from '@/components/HeadToHead';
import { SampleBadge, StatsMessage } from '@/components/StatsPanel';
import { MIN_HANDS, MUTED, ModelStats, TEXT, chips, netColor, seatedModels, useStats } from '@/lib/stats';
import { Timeline, matchupsAt, playedAt, profilesAt, syncAttrs, useReplayHand, useReplaySnap, useTimeline } from '@/lib/timeline';

type Stats = ReturnType<typeof useStats>;

// Screens 2-6, each an empty full-height snap point in the page flow. Over them sits one layer:
// the overview stage (pinned from the overview on), About (the main scroll's last screen, sliding up
// over the overview), the History screen, where the History tile fills the stage, then the Profiles and
// Matchups cards, which slide up over it as stacked cards while the card under them recedes.
// Main scroll: table, overview, About. The cards are a loop entered from the overview's tiles: paging
// moves History, Profiles, Matchups, and up on History or down on Matchups goes back to the overview
// (data-back, read by pageBy). The URL never names a screen (only the model drawer's #model=).
const SCREENS = [
  { id: 'stats', label: 'Overview' },
  { id: 'about', label: 'About' },
  { id: 'race', label: 'History' },
  { id: 'stats-table', label: 'Profiles' },
  { id: 'pairwise', label: 'Matchups' },
] as const;
type Screen = (typeof SCREENS)[number]['id'];
type Tile = Exclude<Screen, 'stats' | 'about'>;
// Each detail screen's overview tile, and the element that takes focus on landing there.
const TILES: Record<Tile, { panel: string; land: string }> = {
  race: { panel: 'race-panel', land: 'race-panel' },
  'stats-table': { panel: 'stats-panel', land: 'stats-card' },
  pairwise: { panel: 'pairwise-panel', land: 'pairwise-card' },
};
const isTile = (id: string): id is Tile => id in TILES;
const jump = (id: string) => {
  const el = document.getElementById(id);
  stopPaging();
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
};

// Scroll-driven animations (CSS) where the browser has them; motion's useScroll otherwise.
const noop = () => () => {};
const useNativeTimeline = () =>
  useSyncExternalStore(noop, () => CSS.supports('animation-timeline: view()') && CSS.supports('timeline-scope: --a'), () => true);

// The three panels under the live table, all time. Memoized: the page re-renders every
// second for its clock, and these only change when stats do.
export default memo(function StatsSections({
  all,
  seated: lineup,
}: {
  all: Stats;
  seated?: string[]; // the page's lineup (with its fallback for an older engine)
}) {
  const { data, sample, loading, error, current } = all;
  const [selected, setSelected] = useState('');
  const [highlight, setHighlight] = useState<string | undefined>();
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
      const card = id === 'stats-table' || id === 'pairwise';
      if (!busy) put(isTile(id) ? 'race' : null, arrived && card);
      if (!arrived) return;
      setScreen(id);
      stage.current?.toggleAttribute('inert', card || id === 'about');
      statsCard.current?.toggleAttribute('inert', id === 'pairwise');
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
    // Once the page sits on a card's screen, every card under it is hidden outright, from the scroll
    // position alone (the scroll-driven recede only fades it, and can miss a jump): the opened card
    // is the only one on screen after any jump, wheel, key or click. Scrolling back up shows it again.
    const hideUnder = () => {
      const y = window.scrollY + 1;
      const reached = (el: HTMLElement | null) => !!el && y >= el.getBoundingClientRect().top + window.scrollY;
      const hide = (el: HTMLElement | null, on: boolean) => (on ? el?.style.setProperty('opacity', '0', 'important') : el?.style.removeProperty('opacity'));
      hide(stage.current, reached(statsScreen.current));
      hide(statsCard.current, reached(pairwiseScreen.current));
    };
    hideUnder();
    const onOpen = (e: Event) => open((e as CustomEvent<Tile>).detail);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]') && back();
    window.addEventListener('screenchange', onScreen);
    window.addEventListener('scrollend', onEnd);
    window.addEventListener('overview', back);
    window.addEventListener('tileopen', onOpen);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hideUnder, { passive: true });
    window.addEventListener('resize', hideUnder);
    return () => {
      io.disconnect();
      window.removeEventListener('screenchange', onScreen);
      window.removeEventListener('scrollend', onEnd);
      window.removeEventListener('overview', back);
      window.removeEventListener('tileopen', onOpen);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hideUnder);
      window.removeEventListener('resize', hideUnder);
    };
  }, []);

  const message = <StatsMessage error={current ? error : null} loading={current && loading} />;
  const stale = ready && (error || loading) && (
    <p className="mb-2 text-[13px]" style={{ color: MUTED }} role="status">
      {error ? 'Could not refresh the stats; showing the last good numbers.' : 'Stats are refreshing…'}
    </p>
  );
  const models = ready ? data.models : [];
  // History, the overview and Matchups show the models at the table now (past sessions carry no
  // lineup: everyone). The Profiles screen has its own "All models" toggle.
  const seated = data?.seated ?? lineup;
  const field = useMemo(() => seatedModels(data?.models ?? [], seated), [data, seated]);
  const bigBlind = data?.scope.big_blind ?? 10;
  // One scope for History, Profiles and Matchups (all time) and one clock: History's replay,
  // which the other two follow through the timeline.
  const tl = useTimeline('', data?.scope.hands);
  // The leader, in one unit and one scope on every screen: net chips over the range shown.
  const lead = ready && <Leader tl={tl} models={field} bigBlind={bigBlind} scope="all time" />;

  // Each card's body, in its tile (`card` false: the tile's content alone) and in the card. The tile's
  // table or matrix stays the same element when it opens and grows into the card's; what the card adds
  // around it fades in (`fade`), never the content itself.
  const statsBody = (card: boolean, fade = false) => !ready ? message : (
    <>
      {card && (
        <Added still={!fade}>
          {stale}
          <Definition>
            Click rows to compare them.
            {models.some(m => m.hands < MIN_HANDS) && <> <Warning size={14} weight="bold" className="inline -mt-0.5" style={{ color: 'rgb(140, 95, 20)' }} aria-hidden /> Under {MIN_HANDS} hands: mostly luck so far.</>}
            {data.partial && ' All-in EV still computing…'}
          </Definition>
        </Added>
      )}
      <SyncedProfiles tl={tl} models={models} seated={seated} mini={!card} />
    </>
  );
  const pairwiseBody = (card: boolean) => !ready ? message : (
    <AtHand tl={tl} models={field}>
      {(ms, hand) => (
        <div {...syncAttrs(tl, hand)} className="contents">
          <HeadToHead models={ms} hand={hand} bigBlind={bigBlind} zoomed={card} mini={!card} />
        </div>
      )}
    </AtHand>
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
      className="stats-room relative isolate w-full"
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
          data-end={s.id === 'about' || undefined}
          data-back={s.id === 'race' ? 'up' : s.id === 'pairwise' ? 'down' : undefined}
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
          <div className={`@container ${BLOCK}`} style={BLOCK_VARS}>
            {/* Overview: three tiles, each a miniature of its screen, History on top (stacked on phones).
                History's row is its chart's shape at the block's width plus the tile's padding and header
                (72px); the second row is a little shorter (BLOCK_VARS), split into Profiles and Matchups. */}
            <div className="relative h-full md:h-(--block-h) grid gap-3 grid-cols-1 grid-rows-[repeat(3,minmax(0,1fr))] md:grid-cols-[minmax(0,1fr)_var(--col2)] md:grid-rows-[var(--row1)_var(--row2)]">
              <Panel id="race-panel" title="History" away={{ y: -1 }} className="row-start-1 md:col-span-2" aside={lead} fit={raceFit} {...tile('race')}>
                {stale}
                {/* One chart in both states, so the lines never redraw on the glide. */}
                {ready ? (
                  <CumulativeChart race mini={!zoomed} bigBlind={bigBlind} models={field} everyone={models} timeline={tl} selected={selected} highlight={highlight} onHighlight={setHighlight} onSelect={zoomed ? setSelected : undefined} />
                ) : message}
              </Panel>

              <Panel
                id="stats-panel"
                title={<>Profiles {sample && <SampleBadge />}</>}
                away={{ x: -1 }}
                className="row-start-2 md:col-start-1"
                extra={on === 'stats-table' && <div className={ASIDE}>{lead}</div>}
                fit="content"
                {...tile('stats-table')}
              >
                {statsBody(on === 'stats-table', !snap)}
              </Panel>

              <Panel
                id="pairwise-panel"
                title="Matchups"
                away={{ x: 1 }}
                className="row-start-3 md:row-start-2 md:col-start-2"
                extra={on === 'pairwise' && <div className={ASIDE}>{lead}</div>}
                fit="hug"
                {...tile('pairwise')}
              >
                {pairwiseBody(on === 'pairwise')}
              </Panel>
            </div>
          </div>
          {/* "About ↓", centred in the band under the block, on the overview only (it pages like a gesture). */}
          <motion.div
            inert={on !== null}
            initial={false}
            animate={{ opacity: on === null ? 1 : 0 }}
            transition={GLIDE}
            className="absolute inset-x-0 flex items-center justify-center"
            style={{ bottom: 'var(--bar-h, 0px)', height: BELOW }}
          >
            {/* Compact (same style, smaller) on a window too short for the full size beside 32px Matchups cells. */}
            <button onClick={() => pageBy(1)} className={`${NEXT_BUTTON} [@media(max-height:959px)]:py-0.5 [@media(max-height:959px)]:text-[14px]`} style={NEXT_STYLE}>
              About <ArrowDown size={16} weight="bold" aria-hidden />
            </button>
          </motion.div>
        </Recede>

        {/* About: a sheet over the overview (the page's own colour, edge to edge), scrolling inside itself when taller than the window. */}
        <section aria-label="About" className="relative z-10 h-svh -mx-3 lg:-mx-4 bg-white">
          <div className="panel-scroll h-full overflow-auto pt-[calc(44px+2svh)] pb-[calc(2svh+var(--bar-h,0px))]">
            <div className="max-w-[1300px] mx-auto px-6 py-6"><About heading="h2" /></div>
          </div>
        </section>

        {/* The History screen's scroll range: the stage stays as it is. */}
        <div className="h-svh" aria-hidden />

        <Card id="stats-card" title={<>Profiles {sample && <SampleBadge />}</>} aside={lead} by={pairwiseScreen} timeline="--card-pairwise" ref={statsCard} z="z-10" fit>
          {statsBody(true)}
        </Card>

        <Card id="pairwise-card" title="Matchups" aside={lead} z="z-20" fit="hug">
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
      <span translate="no" className="font-bold">{top.m.name}</span>
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
// A snapshot waits until the rows' last slide (0.3s) has finished, so rows never pile up mid-slide.
function useProfilesAt(tl: Timeline | null, models: ModelStats[]) {
  const want = useReplaySnap(tl);
  const [i, setI] = useState(want);
  const at = useRef(0);
  useEffect(() => {
    if (want === i) return;
    const t = setTimeout(() => { at.current = performance.now(); setI(want); }, Math.max(0, at.current + SLIDE_MS - performance.now()));
    return () => clearTimeout(t);
  }, [want, i]);
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
const SLIDE_MS = 320; // a Profiles row's slide (StatsTable's SLIDE), and a frame to spare
const ASIDE = 'flex flex-wrap items-center gap-x-5 gap-y-1'; // a card header's extras

// The overview block and every card, centred with the page around them. The block is as wide as lets
// History's row (its chart's shape plus the tile's 72px of padding and header) and the second row fit
// the window with a margin above and below (MARGIN), at most MAX_W and never within SIDE of the window's
// sides. History leads by area (it spans the block) and stays the tallest row, LEAD taller than the second;
// the second row is nearly as tall, so Matchups' cells have room (about 34px at 1440x900, 43px at
// 1728x1117). Matchups' tile is its names, its matrix and its totals, edge to edge; Profiles, five compact
// columns, takes the rest of the row. Only viewport units, so every var resolves the same in nested containers.
const MAX_W = 1320; // about three quarters of a 1728px window: the overview reads as cards on a page
const SIDE = 64; // the least page beside the block
// The page above the block and the "About ↓" band below it (.stats-room in globals.css): 16px and 42px on a short
// window (the compact pill), else the margin (24px, 46px on 1117px) and the margin plus 34px (the full-size pill).
const MARGIN = 'var(--top)';
const BELOW = 'var(--below)';
const LEAD = 4; // px: History's row over the second row
const LEGEND = 68; // the room CumulativeChart keeps under its plot for the legend (its LEGEND_H)
const A = (H / W).toFixed(5);
const ROOM = `(100svh - 44px - var(--bar-h, 0px) - ${MARGIN} - ${BELOW})`; // the block's height at most
const BLOCK = 'h-full w-full md:max-w-(--block-w) mx-auto flex flex-col justify-center';
const BLOCK_VARS = {
  '--block-w': `max(560px, min(${MAX_W}px, 100vw - ${2 * SIDE}px, ((${ROOM} - 12px + ${LEAD}px) / 2 - 72px) / ${A} + 32px))`,
  '--row1': `calc((var(--block-w) - 32px) * ${A} + 72px)`,
  '--row2': `calc(var(--row1) - ${LEAD}px)`,
  '--mini-row': 'calc((var(--row2) - 72px) / 10)',
  '--col2': `calc(var(--row2) - 72px - ${STRIP}px + 32px + ${NAMES + TOTALS}px)`, // Matchups: names, its matrix, totals, padding
  '--block-h': 'calc(var(--row1) + 12px + var(--row2))',
  // The opened Matchups card's matrix width: a little over History's row, so the two cards have the same presence.
  '--card-m': 'min(var(--row1) + 40px, var(--block-h) - 260px)',
  // Under the 44px sticky bar the margin, above the connection bar the About band; the block fills what is
  // left (centred when the window's width holds it back), and every card takes the same box.
  paddingTop: `calc(44px + ${MARGIN})`,
  paddingBottom: `calc(${BELOW} + var(--bar-h, 0px))`,
} as React.CSSProperties;

// Shrinks and dims its content as the screen `by` slides up over it, then hides it as that screen lands: a CSS scroll-driven
// animation on the named view timeline of that screen where supported, motion's useScroll
// otherwise. Transform and opacity only; scrolling back reverses it; only the hiding under reduced motion.
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
  const hide = useTransform(scrollYProgress, [0, 1], [1, 0]); // the keyframes' fade, over the whole range
  const fallback = !!by && !native && !reduce;
  // No box of its own: only the cards inside show, and --dim darkens each one (card-chrome).
  return (
    <motion.div
      ref={ref}
      className={`${className} ${by && native ? 'recede' : ''} origin-center`}
      style={{ ['--recede-by' as string]: timeline, scale: fallback ? scale : undefined, ['--dim' as string]: fallback ? dim : undefined, opacity: by && !native ? hide : undefined }}
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
  fit?: boolean | 'hug'; // as tall as its content (centred, at most the overview's height), not the overview's box; 'hug': as wide too
  children: React.ReactNode;
}) {
  return (
    <section ref={ref} id={id} tabIndex={-1} aria-labelledby={`${id}-title`} className={`sticky top-0 h-svh outline-none ${z}`}>
      <Recede by={by} timeline={timeline} className="h-full">
        <div className={`@container ${BLOCK}`} style={BLOCK_VARS}>
          {/* The overview's box, where its tile stands in for this card. */}
          <div className="relative h-full md:h-(--block-h)">
          <div className={`${CARD} absolute ${fit === 'hug' ? HUG : `inset-x-0 inset-y-0 my-auto max-h-full ${fit ? 'h-fit' : ''}`}`} style={{ boxShadow: CARD_SHADOW }}>
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
  // Secondary text, 13px muted. Contained: it wraps to the card's width and never widens a card that hugs its content.
  return <p className="mb-2 text-[13px] leading-snug [contain:inline-size]" style={{ color: MUTED }}>{children}</p>;
}
