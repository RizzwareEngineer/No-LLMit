'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import LLMLogo from '@/components/LLMLogo';
import About from '@/components/About';
import { ArrowDown, Warning } from '@phosphor-icons/react';
import Panel, { Added, CARD, CARD_SHADOW, GLIDE, GLIDE_MS, HEADER, HUG, NEXT_BUTTON, NEXT_STYLE, Segmented, TITLE, backToOverview, currentScreen, hold, pageBy, setScreen, stopPaging } from '@/components/Section';
import CumulativeChart, { H, W, valueAt } from '@/components/CumulativeChart';
import StatsTable, { MINI_CHROME, TABLE_VIEW, type TableView } from '@/components/StatsTable';
import HeadToHead, { NAMES, STRIP, TOTALS } from '@/components/HeadToHead';
import { SampleBadge, StatsMessage } from '@/components/StatsPanel';
import { MIN_HANDS, MUTED, ModelStats, TEXT, leaderBy, netColor, seatedModels, signedBrief, useStats } from '@/lib/stats';
import { remember, remembered, useRememberedBox } from '@/lib/boxes';
import { Timeline, matchupsAt, playedAt, profilesAt, syncAttrs, useReplayHand, useReplaySnap, useTimeline } from '@/lib/timeline';

type Stats = ReturnType<typeof useStats>;

// Screens 2-6, each an empty full-height snap point in the page flow. Over them sits one layer:
// the overview stage, About (the main scroll's last screen, under the overview in the flow: the two move
// like pages), the History screen, where the History tile fills the stage, then the Profiles and
// Matchups cards, which slide up over it as stacked cards while the card under them recedes. The stage
// scrolls with the page on the main scroll and is pinned for the cards' loop (data-pin).
// Main scroll: table, overview, About. The cards are a loop entered from the overview's tiles: paging
// moves History, Profiles, Matchups, and up on History or down on Matchups goes back to the overview
// (data-back, read by pageBy). The URL never names a screen (only the model drawer's #model=).
const SCREENS = [
  { id: 'stats', label: 'Overview' },
  { id: 'about', label: 'About' },
  { id: 'race', label: 'Trends' },
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
  // Still loading (not failed): every tile and card stands in blank at its place and size.
  const blank = !ready && !(current && error);
  // The Trends card's height: its tile's, plus the filter bar and the legend the card adds, so the
  // chart keeps its size (the stage's height at most: past that the chart shrinks a little, evenly).
  // Phones (PHONE): the tile and the card are what is around the chart plus the chart at their full width,
  // in its shape (raceTile, raceFit); the chart sizes to its box, so the box must be given that height.
  const [raceFit, setRaceFit] = useState<number>();
  const [raceTile, setRaceTile] = useState<number>();
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
      const keep = (h: number) => (f: number | undefined) => (f !== undefined && Math.abs(f - h) < 1 ? f : h);
      if (innerWidth < 768) {
        const name = zoomedNow ? 'race-fit' : 'race-tile';
        // No chart yet (a blank tile or card): the height it last had with its chart (lib/boxes).
        if (!root?.lastElementChild) {
          const h = remembered(name)?.[1];
          if (h) (zoomedNow ? setRaceFit : setRaceTile)(keep(h));
          return;
        }
        // Everything above the chart's box (padding, header, the card's filter bar), whatever the section's height now.
        // The box is the chart's last child (a phone's filter bar can be taller).
        let above = 0;
        for (let e = root?.lastElementChild as HTMLElement | null; e && e !== sec; e = e.offsetParent as HTMLElement | null) above += e.offsetTop;
        // Under the plot, the card's legend: LEGEND reserved, more where a phone wraps it to more rows.
        const area = root?.lastElementChild as HTMLElement | null;
        // Its content's extent, not the box's height (which follows the card's: that would feed back).
        const parts = area ? ([...area.children] as HTMLElement[]) : [];
        const under = Math.max(0, ...parts.map(k => k.offsetTop + k.offsetHeight)) - (parts[0]?.offsetHeight ?? 0);
        const legend = zoomedNow ? Math.max(LEGEND, under) : 0;
        const h = Math.ceil(above + ((sec.clientWidth - 32) * H) / W + legend + 16);
        remember(name, 0, h);
        (zoomedNow ? setRaceFit : setRaceTile)(keep(h));
        return;
      }
      // The card's filter bar, measured over the chart; before the chart is in (a blank card), the height it last had.
      const bar = zoomedNow && root && box ? root.clientHeight - box.offsetHeight : (remembered('race-bar')?.[1] ?? 64 + 8);
      if (zoomedNow && root && box) remember('race-bar', 0, bar);
      setRaceFit(keep(Math.ceil(tile.offsetHeight + bar + LEGEND)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(tile);
    ro.observe(sec);
    if (sec.firstElementChild) ro.observe(sec.firstElementChild); // the header, which wraps on a phone
    // The chart's box, which gives way when the card's filter bar appears above it.
    [...(sec.querySelector('.panel-scroll')?.lastElementChild?.children ?? [])].forEach(k => ro.observe(k));
    return () => ro.disconnect();
  }, [zoomedNow, ready]);

  // Profiles' tile at its content's width (BLOCK_VARS): its longest name (full, even when truncated) plus the
  // rest of its row (MINI_CHROME). Matchups' names column: its longest name, whole, the 4px after it (the link's
  // pr-1) and 1px for scrollWidth's rounding. Names change with the roster only, so the overview never shifts mid-replay.
  const room = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      // Before the names are in, the widths they last had (lib/boxes), so the blank tiles take their places.
      const widest = (sel: string, plus: number, v: string) => {
        const names = [...document.querySelectorAll<HTMLElement>(sel)];
        const w = names.length ? Math.max(...names.map(e => e.scrollWidth)) + plus : remembered(v)?.[0];
        if (names.length) remember(v, w!, 0);
        if (w) room.current?.style.setProperty(v, `${w}px`);
      };
      widest('#stats-panel tbody th [translate=no]', MINI_CHROME, '--prof-w');
      widest('#pairwise-panel a [translate=no]', 5, '--mu-names');
    };
    measure();
    document.fonts?.ready.then(measure);
  }, [ready, data]);
  // A phone's overview scrolls inside its stage: a tile opening starts from the stage's top, where its card sits.
  useLayoutEffect(() => {
    if (tiles.on && innerWidth < 768) stage.current?.scrollTo({ top: 0, behavior: 'instant' });
    // A close is over once the tile is back to its overview content (nothing it adds is mounted): a card reached
    // afterwards by scrolling shows all of itself again.
    if (!tiles.on) room.current?.removeAttribute('data-leaving');
  }, [tiles.on]);

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
    let handing = false; // the page has just jumped to an opened card: the stage stays shown under it
    // The stage moves with the page on the main scroll (table, overview, About) and is pinned from half-way between
    // About and Trends on (the cards' loop, whose cards slide over it). Only a scrollbar drag stops in between.
    const pin = (on = (document.getElementById('race')?.getBoundingClientRect().top ?? innerHeight) < innerHeight / 2) =>
      stage.current?.toggleAttribute('data-pin', on);
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
      room.current?.removeAttribute('data-leaving');
      if (tile !== 'race') still();
      // The card takes over once the tile has landed (Panel's glideend). A timer fired before a busy machine's glide had
      // ended (it starts when React commits), and the card took over off the tile; a late one stays as the fallback.
      const late = glide() && glide() + 1500;
      hold(late);
      pin(true); // before the jump into the loop (on the overview pinned or not looks the same)
      put(tile);
      const land = (e?: Event) => {
        if (!busy || (e && (e as CustomEvent<string>).detail !== TILES[tile].panel)) return;
        clearTimeout(timer);
        window.removeEventListener('glideend', land);
        hold(0);
        // The card shows what the tile showed: its top (the tile never scrolls on its way).
        const card = document.querySelector(`#${TILES[tile].land} .panel-scroll`);
        if (card) card.scrollTop = 0;
        // For two frames the landed tile stays shown under the card, unreceded: a card not yet fully painted in its
        // first frame after the jump would show the page through, or a frame of its chrome without its rows.
        const el = stage.current;
        // ...and the card is drawn all but transparent meanwhile, so its layers are painted before it shows.
        const chrome = tile === 'race' ? null : document.querySelector<HTMLElement>(`#${TILES[tile].land} .card-chrome`);
        handing = true;
        el?.style.setProperty('animation', 'none');
        chrome?.style.setProperty('opacity', '0.001');
        jump(tile);
        document.getElementById(TILES[tile].land)?.focus({ preventScroll: true });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          handing = false;
          busy = false;
          el?.style.removeProperty('animation');
          chrome?.style.removeProperty('opacity');
          hideUnder();
          if (currentScreen() === tile) put('race', true); // as arriving under a card does (show)
        }));
      };
      window.addEventListener('glideend', land);
      const timer = setTimeout(land, late);
    };
    const back = () => {
      const at = currentScreen();
      if (busy || !isTile(at)) return;
      busy = true;
      // Closing mirrors opening: what the card adds to its tile fades out (data-leaving, globals.css), in the card and
      // in the tile snapped under it, before the tile glides back with what it shows on the overview.
      const fade = at !== 'race' && glide() ? FADE_MS : 0;
      hold(glide() + fade);
      if (at !== 'race') still();
      room.current?.toggleAttribute('data-leaving', fade > 0);
      put(at, true);
      // The fade, then two frames: the snapped stage is painted under the card before the card leaves. The fade is
      // waited for (its animations), not timed: mounting the stand-in can hold the main thread past FADE_MS.
      const faded = () => Promise.race([
        Promise.all((document.getElementById(TILES[at].land)?.getAnimations({ subtree: true }) ?? [])
          .filter(a => (a as CSSAnimation).animationName === 'add-out').map(a => a.finished.catch(() => {}))),
        new Promise(r => setTimeout(r, 500)),
      ]);
      setTimeout(() => faded().then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        busy = false;
        // The tile standing in is scrolled as the card was.
        const from = document.querySelector(`#${TILES[at].land} .panel-scroll`), to = document.querySelector(`#${TILES[at].panel} .panel-scroll`);
        if (from && to && from !== to) to.scrollTop = from.scrollTop;
        const el = stage.current;
        el?.removeAttribute('inert');
        // A view timeline can lag the jump by a frame, showing the stage still receded: no recede
        // until the overview is painted (under the card, a stage at full size looks the same).
        el?.style.setProperty('animation', 'none');
        requestAnimationFrame(() => requestAnimationFrame(() => el?.style.removeProperty('animation')));
        jump('stats');
        hideUnder(); // now, not at the next frame's scroll event: that frame would paint the stage still hidden (blank)
        put(null);
        document.getElementById(TILES[at].panel)?.focus({ preventScroll: true });
      }))), fade);
    };
    // Hover waits for the pointer to move: content gliding (or a card landing) under a still pointer shows no readout.
    let rest: number[] | null = null, last = [NaN, NaN];
    const still = () => { rest = last; room.current?.setAttribute('data-still', ''); };
    const moved = (e: PointerEvent) => {
      last = [e.clientX, e.clientY];
      if (rest && (e.clientX !== rest[0] || e.clientY !== rest[1])) { rest = null; room.current?.removeAttribute('data-still'); }
    };
    // Once the page sits on a card's screen, every card under it is hidden outright, from the scroll
    // position alone (the scroll-driven recede only fades it, and can miss a jump): the opened card
    // is the only one on screen after any jump, wheel, key or click. Scrolling back up shows it again.
    const hideUnder = () => {
      const y = window.scrollY + 1;
      const reached = (el: HTMLElement | null) => !!el && y >= el.getBoundingClientRect().top + window.scrollY;
      const hide = (el: HTMLElement | null, on: boolean) => (on ? el?.style.setProperty('opacity', '0', 'important') : el?.style.removeProperty('opacity'));
      hide(stage.current, !handing && reached(statsScreen.current));
      hide(statsCard.current, reached(pairwiseScreen.current));
      pin();
    };
    hideUnder();
    const onOpen = (e: Event) => open((e as CustomEvent<Tile>).detail);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]') && back();
    window.addEventListener('screenchange', onScreen);
    window.addEventListener('scrollend', onEnd);
    window.addEventListener('overview', back);
    window.addEventListener('tileopen', onOpen);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointermove', moved, { passive: true });
    window.addEventListener('scroll', hideUnder, { passive: true });
    window.addEventListener('resize', hideUnder);
    return () => {
      io.disconnect();
      window.removeEventListener('screenchange', onScreen);
      window.removeEventListener('scrollend', onEnd);
      window.removeEventListener('overview', back);
      window.removeEventListener('tileopen', onOpen);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', moved);
      window.removeEventListener('scroll', hideUnder);
      window.removeEventListener('resize', hideUnder);
    };
  }, []);

  const message = <StatsMessage error={current ? error : null} />;
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
  // which the other two follow through the timeline. It is fetched again every 25 hands (the engine's smallest
  // profile_step: a new Profiles snapshot at most that often), not after every hand; its end is stretched to the
  // stream's hand count, so every line's tip stays at now.
  const hands = data?.scope.hands;
  const fetched = useTimeline(hands === undefined ? undefined : Math.floor(hands / 25));
  const tl = useMemo(() => (fetched && hands !== undefined && hands > fetched.hands ? { ...fetched, hands } : fetched), [fetched, hands]);
  // The leader, in one unit and one scope on every screen: bb/100 over the range shown, among the models shown.
  const lead = ready && <Leader tl={tl} models={field} />;
  // The Matchups card's lineup: the models seated now (the tile's, and Trends' default) or everyone with hands.
  const [muLineup, setMuLineup] = useState<'seated' | 'all'>('seated');
  const muModels = muLineup === 'all' ? models : field;
  const muAside = ready && (
    <>
      <div className="flex min-w-0 items-center gap-2 text-[14px]" style={{ color: MUTED }}>
        <span className="shrink-0">Lineup</span>
        <Segmented label="Lineup" options={[{ label: 'Seated now', value: 'seated' as const }, { label: 'All models', value: 'all' as const, disabled: models.length <= field.length }]} value={muLineup} onChange={setMuLineup} />
      </div>
      <Leader tl={tl} models={muModels} />
    </>
  );

  // Profiles' sort, "All models" and picked rows: one view for the tile and the card, so neither shows the other's.
  const profView = useState<TableView>(TABLE_VIEW);
  // Each card's body, in its tile (`card` false: the tile's content alone) and in the card. The tile's
  // table or matrix stays the same element when it opens and grows into the card's; what the card adds
  // around it fades in (`fade`), never the content itself.
  const statsBody = (card: boolean, fade = false, snap = false) => !ready ? message : (
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
      <SyncedProfiles tl={tl} models={models} seated={seated} mini={!card} snap={snap} view={profView} />
    </>
  );
  const pairwiseBody = (card: boolean, snap = false) => !ready ? message : (
    <AtHand tl={tl} models={card ? muModels : field}>
      {(ms, hand) => (
        <div {...syncAttrs(tl, hand)} className="contents">
          <HeadToHead models={ms} hand={hand} bigBlind={bigBlind} zoomed={card} mini={!card} snap={snap} fitTo={field.length} leader={leaderAt(tl, ms, hand)?.m.name} />
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
      ref={room}
      className="stats-room relative isolate w-full"
      style={{ timelineScope: '--card-stats, --card-pairwise' } as React.CSSProperties}
      // A click on the page around a detail screen's card (not on the card) goes back to the overview.
      onClick={e => !(e.target as Element).closest('.card-chrome') && backToOverview()}
    >
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
        {/* The overview stage: in the page's flow on the main scroll, pinned for the cards' loop (data-pin). The top
            padding clears the sticky bar (44px) plus the table screen's own outer padding; the clip, at the window's
            edges (the page pads its sides), keeps tiles sliding off from adding a page scrollbar.
            Phones (PHONE) scroll it instead: the tiles stack at their content's size. */}
        <Recede by={statsScreen} timeline="--card-stats" ref={stage} scrolls className="sticky data-pin:top-0 z-0 h-svh overflow-clip [overflow-clip-margin:12px] lg:[overflow-clip-margin:16px] max-md:overflow-x-hidden max-md:overflow-y-auto">
          {/* A phone's opened Profiles or Matchups tile takes its card's box: the block no taller than its content (with the
              About band under it, exactly the window), so it is neither centred lower nor narrowed by a scrollbar. */}
          <div className={`@container ${BLOCK} ${PAD} max-md:h-auto ${on && on !== 'race' ? '' : 'max-md:min-h-full'} max-md:pb-[var(--bar-h,0px)]`} style={BLOCK_VARS}>
            {/* Overview: three tiles, each a miniature of its screen, Trends on top (stacked on phones). Profiles
                at its content's width, Matchups across the rest; the rows share the height (BLOCK_VARS). On a phone, a
                focused tile's card takes the window's box (Trends: its own height), as the cards do. */}
            <div
              className={`relative grid gap-3 grid-cols-1 md:h-(--block-h) md:grid-cols-[var(--p)_minmax(0,1fr)] md:grid-rows-[var(--row1)_var(--row2)] ${on ? 'max-md:h-(--focus-h) max-md:overflow-hidden' : ''}`}
              style={{
                '--race-tile': raceTile && `${raceTile}px`,
                '--focus-h': on === 'race' && raceFit ? `${raceFit}px` : PHONE_BOX,
                // Matchups' tile on a phone: its matrix as wide as leaves its names 140px, cells 26px at least.
                '--mu-h': `calc(max(${27 * field.length + 2}px, 100cqw - ${32 + NAMES}px) + ${MU_V}px)`,
              } as React.CSSProperties}
            >
              <Panel id="race-panel" title="Trends" away={{ y: -1 }} className="row-start-1 md:col-span-2 max-md:h-(--race-tile)" aside={lead} fit={raceFit} blank={blank} {...tile('race')}>
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
                blank={blank}
                {...tile('stats-table')}
              >
                {statsBody(on === 'stats-table', !snap, snap)}
              </Panel>

              <Panel
                id="pairwise-panel"
                title="Matchups"
                away={{ x: 1 }}
                className="row-start-3 md:row-start-2 md:col-start-2 max-md:h-(--mu-h)"
                extra={on === 'pairwise' && <div className={ASIDE}>{muAside}</div>}
                fit="hug"
                blank={blank}
                {...tile('pairwise')}
              >
                {pairwiseBody(on === 'pairwise', snap)}
              </Panel>
            </div>
          </div>
          {/* "About ↓", centred in the band under the block, on the overview only (it pages like a gesture). */}
          <motion.div
            inert={on !== null}
            initial={false}
            animate={{ opacity: on === null ? 1 : 0 }}
            transition={GLIDE}
            className="absolute bottom-[var(--bar-h,0px)] inset-x-0 flex items-center justify-center max-md:relative max-md:bottom-auto"
            style={{ height: BELOW }}
          >
            {/* Compact (same style, smaller) on a window too short for the full size beside 32px Matchups cells. */}
            <button onClick={() => pageBy(1)} className={`${NEXT_BUTTON} [@media(max-height:959px)]:py-0.5 [@media(max-height:959px)]:text-[14px]`} style={NEXT_STYLE}>
              About <ArrowDown size={16} weight="bold" aria-hidden />
            </button>
          </motion.div>
        </Recede>

        {/* About: the screen under the overview, its cards in the overview's block (width, centre, margins), centred in the
            window; taller than the window (a phone), it scrolls inside itself. Opaque in the page's colour, so a scrollbar
            dragged on towards Trends never shows the stage pinning under it. */}
        <section aria-label="About" className="relative z-10 h-svh -mx-3 lg:-mx-4 bg-(--page)">
          <div className="panel-scroll h-full overflow-auto">
            <div className={`min-h-full flex flex-col justify-center-safe px-3 lg:px-4 ${PAD}`}>
              <div className="w-full md:max-w-(--block-w) mx-auto" style={BLOCK_VARS}><About heading="h2" /></div>
            </div>
          </div>
        </section>

        {/* The History screen's scroll range: the stage stays as it is. */}
        <div className="h-svh" aria-hidden />

        <Card id="stats-card" title={<>Profiles {sample && <SampleBadge />}</>} aside={lead} by={pairwiseScreen} timeline="--card-pairwise" ref={statsCard} z="z-10" fit blank={blank}>
          {statsBody(true)}
        </Card>

        <Card id="pairwise-card" title="Matchups" aside={muAside} z="z-20" fit="hug" blank={blank} record={muLineup === 'seated'}>
          {pairwiseBody(true)}
        </Card>
      </div>
    </div>
  );
});

// The leader by bb/100 over the range shown among `models` with at least MIN_HANDS hands then, at the hand
// Trends is replaying (its chart value then, over its hands then), else now; null when none qualifies.
function leaderAt(tl: Timeline | null, models: ModelStats[], hand: number | null) {
  if (hand !== null && !tl) return null;
  const rows = models.map(m => {
    const hands = hand === null ? m.hands : Math.floor(playedAt(tl!, m.name, hand));
    return { m, hands, bb100: hand === null ? m.bb100 : hands ? (valueAt(m.cumulative_bb, hands) / hands) * 100 : 0 };
  });
  return leaderBy(rows);
}

// The Leader line: the model leaderAt names, its bb/100 and the scope; one plain line when none has MIN_HANDS
// hands yet. The scope says when: "at hand N" while the replay plays, "all time" once it has finished or been
// skipped; the same words on every card (one shared clock). `data-scope` carries it for the checks.
function Leader({ tl, models }: { tl: Timeline | null; models: ModelStats[] }) {
  const hand = useReplayHand(tl);
  const scope = hand === null ? 'all time' : `at hand ${hand.toLocaleString()}`;
  const top = leaderAt(tl, models, hand);
  return (
    // One line: on a phone the name truncates rather than wrapping, so the header keeps its height as the leader changes.
    <span className="flex items-center gap-1.5 min-w-0 whitespace-nowrap tabular-nums text-[14px]" style={{ color: TEXT }} data-scope={scope}>
      <span style={{ color: MUTED }}>Leader</span>
      {top ? <>
        <LLMLogo model={top.m.name} size={18} />
        <span translate="no" className="font-bold truncate">{top.m.name}</span>
        <span className="font-bold shrink-0" style={{ color: netColor(top.bb100) }}>{signedBrief(top.bb100)} bb/100 {scope}</span>
      </> : <span className="truncate" style={{ color: MUTED }}>No model has {MIN_HANDS} hands yet{hand === null ? '' : ` ${scope}`}</span>}
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
function SyncedProfiles({ tl, models, seated, mini = false, snap = false, view }: { tl: Timeline | null; models: ModelStats[]; seated?: string[]; mini?: boolean; snap?: boolean; view: [TableView, React.Dispatch<React.SetStateAction<TableView>>] }) {
  const { shown, pending, hand } = useProfilesAt(tl, models);
  return <div {...syncAttrs(tl, hand, true)} className="contents"><StatsTable models={shown} seated={seated} pending={pending} mini={mini} snap={snap} view={view} /></div>;
}

const FADE_MS = 120; // closing: what the card adds fades out (globals.css, [data-leaving])
const SLIDE_MS = 320; // a Profiles row's slide (StatsTable's SLIDE), and a frame to spare
const ASIDE = 'flex flex-wrap items-center gap-x-5 gap-y-1 min-w-0'; // a card header's extras

// The overview block and every card take the table stage's column (--stage-w, from page.tsx's fit()), so the table
// screen, the overview and About have the same page beside them at every window size (from md; phones stack the
// tiles at their content's size and scroll, see PHONE). The block is as tall as the window leaves it (ROOM) or less.
// The second row is Profiles at its content's width (--prof-w, measured: the longest name and four compact columns,
// so no gap before Hands) and Matchups across the rest: its names (--mu-names, measured: the longest in full) and its
// matrix, as tall as the row, its cells widening with the column (wider than tall: full figures; never taller than
// wide). The rows share the height: Trends spans the block on top and stays the dominant tile (at least AREA times
// Matchups' area, the second row at most DOM times its row), never so short that its chart's text shrinks (R1_MIN)
// and never taller than its chart at its design shape across the block (--r1-max). Its chart takes the extra width
// (CumulativeChart widens its layout to its box). The opened Matchups card spans the block too: names, a matrix of
// the tile's shape (it grows into the card without stretching) and totals, as tall as that makes it.
// Lengths divide through tan(atan2(a, b)) = a / b (calc() cannot divide by a length).
// The page above the block and the "About ↓" band below it (.stats-room in globals.css): 16px and 42px on a short
// window (the compact pill), else the margin (24px, 46px on 1117px) and the margin plus 34px (the full-size pill).
const MARGIN = 'var(--top)';
const BELOW = 'var(--below)';
const DOM = 1.1; // the second row is at most this times Trends' row
const AREA = 1.51; // Trends' tile at least this times Matchups' area (1.5, overview-history-leads, and 1% to spare)
// Trends' row at least this tall (or half the room, on a short window): CumulativeChart keeps its text at 13px on
// screen down to a 1/1.5 scale of its H-tall layout (history-type).
const R1_MIN = Math.ceil(H / 1.5 + 72);
const LEGEND = 68; // the room CumulativeChart keeps under its plot for the legend (its LEGEND_H)
const A = (H / W).toFixed(5);
const ROOM = `(100svh - 44px - var(--bar-h, 0px) - ${MARGIN} - ${BELOW})`; // the block's height at most
const BLOCK = 'h-full w-full md:max-w-(--block-w) mx-auto flex flex-col justify-center';
// Matchups' tile around its matrix, top to bottom: padding and header (72), then the column logos' row.
const MU_V = 72 + STRIP;
const BLOCK_VARS = {
  '--block-w': 'var(--stage-w, 1264px)',
  '--p': `var(--prof-w, ${NAMES + MINI_CHROME}px)`,
  '--names': `var(--mu-names, ${NAMES}px)`,
  '--col2': 'calc(var(--block-w) - var(--p) - 12px)', // Matchups' tile
  '--mw': 'calc(var(--col2) - 32px - var(--names))', // its matrix's width
  '--rows': `calc(${ROOM} - 12px)`, // both rows together, at most
  '--r1-max': `calc((var(--block-w) - 32px) * ${A} + 72px)`, // Trends' chart at its W x H shape across the block
  '--row2': `min(${DOM} * var(--rows) / ${1 + DOM}, var(--rows) - min(${R1_MIN}px, var(--rows) / 2), var(--rows) * tan(atan2(var(--block-w), var(--block-w) + ${AREA} * var(--col2))), var(--r1-max) * min(${DOM}, tan(atan2(var(--block-w), ${AREA} * var(--col2)))), var(--mw) + ${MU_V}px)`,
  '--row1': 'min(var(--rows) - var(--row2), var(--r1-max))',
  '--mini-row': 'calc((var(--row2) - 72px) / 10)',
  '--block-h': 'calc(var(--row1) + 12px + var(--row2))',
  // The opened Matchups card: names, the matrix and its totals across the block; the matrix in the tile's shape.
  '--card-m': `calc(var(--block-w) - 32px - var(--names) - ${TOTALS}px)`,
  '--card-mh': `calc(var(--card-m) * tan(atan2(var(--row2) - ${MU_V}px, var(--mw))))`,
} as React.CSSProperties;
// Phones (under md, 768px: a phone, or a laptop at 200% zoom) stack the tiles at their content's size: Trends
// at its chart's shape (raceTile), Profiles at its rows, Matchups at a square that leaves its names 140px; the
// overview scrolls inside its stage. An opened card takes the window's box under the sticky bar (PHONE_BOX), as
// the Profiles and Matchups cards do, and scrolls inside itself; Trends' card is as tall as its content.
const PHONE_BOX = 'calc(100svh - 44px - var(--top) - var(--below) - var(--bar-h, 0px))';
// Under the 44px sticky bar the margin, above the connection bar the About band; the block fills what is
// left (centred when the window's width holds it back), and every card takes the same box.
const PAD = 'pt-[calc(44px+var(--top))] pb-[calc(var(--below)+var(--bar-h,0px))]';

// Shrinks and dims its content as the screen `by` slides up over it, then hides it as that screen lands: a CSS scroll-driven
// animation on the named view timeline of that screen where supported, motion's useScroll
// otherwise. Transform and opacity only; scrolling back reverses it; only the hiding under reduced motion.
function Recede({
  by,
  timeline,
  ref,
  className,
  scrolls = false,
  children,
}: {
  by?: React.RefObject<HTMLElement | null>;
  timeline?: string;
  ref?: React.Ref<HTMLDivElement>;
  className: string;
  scrolls?: boolean; // scrolls itself (a phone's overview): motion's layout measurements account for it
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
      layoutScroll={scrolls}
      className={`${className} ${by && native ? 'recede' : ''} origin-center`}
      style={{ ['--recede-by' as string]: timeline, scale: fallback ? scale : undefined, ['--dim' as string]: fallback ? dim : undefined, opacity: by && !native ? hide : undefined }}
    >
      {children}
    </motion.div>
  );
}

// A screen after Trends: a card that slides up over the one before it, in the same chrome, size
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
  blank = false,
  record = true,
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
  blank?: boolean; // its data is still loading: blank, at the size it last had with its data (lib/boxes)
  record?: boolean; // its size now is the one to stand in at (the Matchups card's default lineup)
  children: React.ReactNode;
}) {
  const [chrome, size, attrs] = useRememberedBox<HTMLDivElement>(id, !blank && record, fit === 'hug' ? 'wh' : 'h');
  return (
    <section ref={ref} id={id} tabIndex={-1} aria-labelledby={`${id}-title`} className={`sticky top-0 h-svh outline-none ${z}`}>
      <Recede by={by} timeline={timeline} className="h-full">
        <div className={`@container ${BLOCK} ${PAD}`} style={BLOCK_VARS}>
          {/* The overview's box, where its tile stands in for this card. */}
          <div className="relative h-full md:h-(--block-h)">
          <div ref={chrome} {...attrs} className={`${CARD} absolute ${fit === 'hug' ? HUG : `inset-x-0 inset-y-0 my-auto max-h-full ${fit ? 'h-fit' : ''}`} ${blank ? '[&>*]:invisible' : ''}`} style={{ boxShadow: CARD_SHADOW, ...size }}>
            <div className={HEADER}>
              <h2 id={`${id}-title`} className={TITLE} style={{ color: TEXT }}>{title}</h2>
              {aside && <div className={ASIDE}>{aside}</div>}
            </div>
            <motion.div layoutScroll className="panel-scroll flex-1 min-h-0 min-w-0 flex flex-col [&>*]:shrink-0 overflow-auto">{children}</motion.div>
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
