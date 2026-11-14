"use client";

import { useMemo, useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { MotionConfig } from "motion/react";
import { ArrowDown, CircleNotch } from "@phosphor-icons/react";
import PokerTable from "@/components/PokerTable";
import WinningsPanel from "@/components/WinningsPanel";
import ReasoningPanel, { Caption } from "@/components/ReasoningPanel";
import SoundToggle, { UnitToggle } from "@/components/SoundToggle";
import UsageIndicator, { useUsage } from "@/components/UsageIndicator";
import StatsSections from "@/components/StatsSections";
import PlaySoonButton from "@/components/PlaySoonButton";
import ModelDrawer from "@/components/ModelDrawer";
import StickyBar, { PhoneBar } from "@/components/StickyBar";
import TabBar, { type Tab } from "@/components/TabBar";
import SessionProgress from "@/components/SessionProgress";
import DevPace from "@/components/DevPace";
import PeelLab from "@/components/PeelLab";
import { setTypingPace } from "@/components/TypewriterText";
import { useGameState } from "@/hooks/useGameState";
import { NEXT_BUTTON, NEXT_STYLE, backToOverview, isPaging, pageBy, pageTo, resnap, scrollsInside, useScreen } from "@/components/Section";
import { holdBoxes, useFillIn, useRememberedBox } from "@/lib/boxes";
import { MUTED, BLUE } from "@/lib/stats";

// The URL hash: #model=<slug> opens the model drawer, and Back closes it.
// openedInPage: the drawer's history entry was pushed by a click here, not a deep link, so
// closing it should step back instead of leaving an extra entry behind.
const isModelHash = (h: string) => h.startsWith("#model=");
let lastHash = "";
let openedInPage = false;
let goingBack = false; // history.back() is async: ignore a second close until the hash changes
const subscribeHash = (cb: () => void) => {
  lastHash = window.location.hash;
  openedInPage = false;
  const onChange = () => {
    const h = window.location.hash;
    if (isModelHash(h) && !isModelHash(lastHash)) openedInPage = true;
    lastHash = h;
    goingBack = false;
    cb();
  };
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const closeModel = () => {
  if (!isModelHash(window.location.hash) || goingBack) return; // Back already left the drawer's entry
  if (openedInPage) {
    openedInPage = false;
    goingBack = true;
    history.back();
    return;
  }
  history.replaceState(null, "", window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange")); // replaceState does not fire it
};

// Fit-to-screen: the stage (table, sidebar, reasoning) takes one uniform zoom so the whole
// table screen fits the window, up to 125% (the size the owner chose) and down to 75%; below
// that the screen scrolls instead of shrinking further. Browser zoom shrinks the CSS viewport,
// so it lowers this scale and is never fought. Phones (< 768px) reflow to the list layout at 1.
// The stage's width as drawn (at most the screen's, where it scrolls at the floor) is --stage-w on the root: the
// stats overview, its cards, About and the sticky bar take that column (StatsSections), so every screen has its margins.
// Self-contained (nothing from outside its body): BEFORE_PAINT runs its source inline too.
function fitStage() {
  const stage = document.querySelector<HTMLElement>('.stage-zoom'), screen = stage?.closest('section');
  if (!stage || !screen) return;
  if (window.innerWidth < 768) stage.style.zoom = '';
  else {
    const cs = getComputedStyle(screen);
    const kids = [...screen.children];
    // Everything on the screen but the stage: header, gaps, Stats button and padding.
    const chrome = kids[kids.length - 1].getBoundingClientRect().bottom - kids[0].getBoundingClientRect().top
      - stage.getBoundingClientRect().height + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    // offsetWidth/offsetHeight are the stage's unzoomed size.
    const s = Math.min(screen.clientWidth / stage.offsetWidth, (document.documentElement.clientHeight - chrome) / stage.offsetHeight);
    stage.style.zoom = String(Math.floor(Math.min(1.25, Math.max(0.75, s)) * 1000) / 1000);
  }
  document.documentElement.style.setProperty('--stage-w', `${Math.min(stage.getBoundingClientRect().width, screen.clientWidth)}px`);
}
// The prerendered page, as parsed, before its first paint: the stage fitted and the blank boxes at their remembered sizes
// (lib/boxes), as the effects set them once React has hydrated, so nothing changes size when it does. Run where the
// parser has just passed the table screen, and again after the stats.
const BEFORE_PAINT = `(${fitStage})();(${holdBoxes})(true)`;

const PAGE_KEYS: Record<string, 1 | -1> = { ArrowDown: 1, ArrowRight: 1, PageDown: 1, ArrowUp: -1, ArrowLeft: -1, PageUp: -1 };

// /?peellab shows the peek lab (PeelLab) instead of the table.
const noSubscribe = () => () => {};
export default function Home() {
  const lab = useSyncExternalStore(noSubscribe, () => new URLSearchParams(window.location.search).has('peellab'), () => false);
  return lab ? <PeelLab /> : <Table />;
}

function Table() {
  const {
    gameState,
    connection,
    gaveUp,
    tableNotice,
    displayState,
    shotClockRemaining,
    shotClockBudgetMs,
    buttonDetermination,
    stats,
    retry,
  } = useGameState();
  useEffect(() => setTypingPace(gameState?.pace), [gameState?.pace]); // reasons type in step with the table's pace

  const [elapsedTime, setElapsedTime] = useState<string>('00:00:00');
  const [nextHandCountdown, setNextHandCountdown] = useState<number | null>(null);
  const { usage, error: usageError } = useUsage(connection !== 'connecting'); // the hub counts this page once its stream opens
  const watching = usageError ? undefined : usage?.table?.spectators;
  const isLive = connection === 'open' && !tableNotice;
  // The connection bar only once the server has been unreachable for a while (useGameState): a bar shown and hidden on a
  // normal load moved every screen by its height (--bar-h).
  const bar = connection === 'down';
  // The status label and the hand counter, blinds and timer stand in blank until they are known, then fade in together,
  // with what the label appends (· N watching), so the row changes once and unseen. The label and the hand number hold
  // their remembered widths while blank (lib/boxes), so the toggles beside them do not move when they fill in.
  const statusKnown = connection === 'down' || (!!gameState && (!!usage || usageError));
  const handKnown = statusKnown && (gameState?.handNumber ?? 0) > 0;
  const labelRef = useRef<HTMLDivElement>(null), handRef = useRef<HTMLDivElement>(null);
  useFillIn(labelRef, statusKnown);
  useFillIn(handRef, handKnown);
  const [labelBox, labelSize, labelAttrs] = useRememberedBox<HTMLSpanElement>('status-label', statusKnown, 'wh');
  const [handBox, handSize, handAttrs] = useRememberedBox<HTMLSpanElement>('hand-no', handKnown, 'wh');

  // Timer effect - update elapsed time every second using server's gameStartTime. Before the paint, so the row's first
  // frame has the time and not 00:00:00.
  useLayoutEffect(() => {
    if (!gameState?.gameStartTime) return;
    
    const serverStartTime = new Date(gameState.gameStartTime);
    
    const updateTimer = () => {
      const now = new Date();
      const diff = Math.floor((now.getTime() - serverStartTime.getTime()) / 1000);
      const hours = Math.floor(diff / 3600).toString().padStart(2, '0');
      const minutes = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
      const seconds = (diff % 60).toString().padStart(2, '0');
      setElapsedTime(`${hours}:${minutes}:${seconds}`);
    };
    
    // Update immediately
    updateTimer();
    
    // Then update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [gameState?.gameStartTime]);

  // Derived state
  const players = gameState?.players || [];
  const pot = gameState?.pot || 0;
  const communityCards = gameState?.communityCards || [];
  const street = gameState?.street || 'preflop';
  // Use displayState.playerIdx for highlight when actively displaying a player's turn
  // This keeps the highlight on the current player during reasoning + 5s wait
  const currentPlayerIdx = displayState?.playerIdx ?? (gameState?.currentPlayerIdx ?? -1);
  const stakes = gameState?.stakes || { smallBlind: 5, bigBlind: 10 };
  const handNumber = gameState?.handNumber || 0;
  const winners = gameState?.winners || [];
  // Seats whose cards are face up: the engine's list, and the turn on screen until a game_state carries it.
  const peeked = gameState?.peeked ?? [];
  const isHandComplete = street === 'complete';

  // All-time stats feed the leaderboard, the drawer and the stats sections; the stream sends them on connect and as each hand is saved.
  // No stats event yet means loading; once the stream has given up with none, that is the error.
  const statsError = !stats && gaveUp ? "can't reach the game server" : null;
  // Hover stats on the seats: all-time.
  const seatStats = useMemo(() => (stats ? Object.fromEntries(stats.models.map(m => [m.name, m])) : undefined), [stats]);

  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => '');
  // The URL names no stats screen: an old #stats, #race or #pairwise link opens the page at its top.
  useEffect(() => {
    if (!window.location.hash || isModelHash(window.location.hash)) return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    const top = () => window.scrollTo({ top: 0, behavior: "instant" });
    top();
    // A production build hydrates before the load event, and the browser still scrolls to the old anchor until then.
    if (document.readyState !== "complete") window.addEventListener("load", top, { once: true });
  }, []);
  const drawerSlug = hash.startsWith('#model=') ? hash.slice('#model='.length) : null;

  // Phones: the tab bar's part is where the page is (the table while it shows, else About or the stats); a tap goes to
  // the top of that part: the table, Profits & Losses over the stats (#phone-stats), About. On an opened stats card,
  // Stats goes back to the overview.
  const screen = useScreen();

  const tableRef = useRef<HTMLDivElement>(null);
  // Plain IntersectionObserver: motion's useInView never reports "out" for an element that
  // starts out of view (a reload below the table).
  const [tableInView, setTableInView] = useState(true);
  const [scrolled, setScrolled] = useState(false); // the sticky bar slides in on a scroll, not on a load below the table
  useEffect(() => {
    let first = true;
    // The top 44px sit under the bar itself, so they do not count as visible. On a phone the row has no box of its own
    // (it lets the caption sit between the table and the sidebar), so the phone table (data-oval) is watched too.
    const seen = new Map<Element, boolean>();
    const io = new IntersectionObserver(es => {
      for (const e of es) seen.set(e.target, e.isIntersecting);
      setTableInView([...seen.values()].some(Boolean));
      if (!first) setScrolled(true);
      first = false;
    }, { rootMargin: '-44px 0px 0px 0px' });
    const row = tableRef.current;
    if (row) [row, ...row.querySelectorAll('[data-oval]')].forEach(e => io.observe(e));
    return () => io.disconnect();
  }, []);

  // The stage's fit (fitStage), kept as the window, the stage or the screen change size.
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stage = stageRef.current, screen = stage?.closest('section');
    if (!stage || !screen) return;
    fitStage();
    const ro = new ResizeObserver(fitStage);
    ro.observe(stage);
    ro.observe(screen);
    window.addEventListener('resize', fitStage);
    return () => { ro.disconnect(); window.removeEventListener('resize', fitStage); };
  }, []);

  // ↑ ↓ ← →, PageUp/PageDown and Space page between screens, unless a field, the drawer or a panel
  // that can still scroll that way has the keys. Down on the last screen goes back to the overview (pageBy).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Space and Shift+Space page like PageDown and PageUp (the browser's own Space scroll stopped wherever proximity snap left it).
      const space = e.key === ' ';
      const dir = space ? (e.shiftKey ? -1 : 1) : PAGE_KEYS[e.key];
      if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.shiftKey && !space)) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('input, select, textarea, [contenteditable], dialog')) return;
      if (space && t?.closest('button, a, summary, [role=button], [role=checkbox], [role=switch]')) return; // Space presses those
      const sideways = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      if (sideways ? t?.closest('.panel-scroll') : scrollsInside(t, dir)) return;
      e.preventDefault();
      pageBy(dir);
    };
    // One wheel or trackpad gesture moves exactly one screen. Wheel inside a panel scrolls the
    // panel until it reaches its end. Events in the paged direction keep the lock alive, so
    // momentum after a flick never pages twice; a reversal is a new gesture and pages at once.
    // Only a page that moved arms the lock: scrolling into either end of the page must not
    // swallow the reversal that follows (the trap on the last screen).
    let lockUntil = 0;
    let lockDir = 0;
    let insideUntil = 0; // the gesture scrolled a panel: its rest never pages
    let lastAbs = 0;
    let rises = 0; // events in a row with a growing |deltaY|: momentum only decays, a new swipe ramps up
    let lastT = 0;
    let riseAt = -1; // when the current ramp began, if it began from rest (a gap or a near-zero delta): a new touch
    let armedAt = 0; // when the lock or the panel guard was last armed
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('dialog')) return;
      const now = e.timeStamp; // when the input happened, so main-thread jank never reads as a pause
      // Chrome lets a page cancel a wheel gesture only from its first event: one left alone makes the rest of the
      // gesture uncancelable, and the browser then scrolls it natively alongside pageBy (mid-way landings, skips).
      // So a gesture's start that is not clearly sideways (no delta, a finger's diagonal jitter) is claimed too,
      // as is anything sideways mid-gesture; a clear sideways swipe stays the browser's (back/forward, a wide table).
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) {
        if (Math.abs(e.deltaX) < 3 || now < lockUntil) e.preventDefault();
        return;
      }
      const dir = e.deltaY > 0 ? 1 : -1;
      // A reversal pages only when it is deliberate: one small opposite event in a noisy
      // momentum tail just extends the lock. The lock comes before the panel check: the tail of a
      // flick that paged onto a card must not scroll that card's panel, then page again at its end.
      const abs = Math.abs(e.deltaY);
      if (abs > lastAbs) {
        // From rest: after a real pause, or from a near-zero delta. 120 ms, not less: when the main thread is busy
        // Chrome coalesces a steady swipe's events, so gaps of 30-60 ms with growing deltas arrive mid-gesture,
        // which read as a new touch and paged a second screen in one gesture.
        if (!rises) riseAt = now - lastT > 120 || lastAbs <= 2 ? now : -1;
        rises++;
      } else rises = 0;
      lastAbs = abs;
      lastT = now;
      const fresh = rises >= 3 && abs >= 8 && riseAt > armedAt; // fingers down again after this gesture was handled (3 rises: a coalescing spike in a momentum tail gives 2)
      if (now < lockUntil && !fresh && (dir === lockDir || abs < 10)) {
        e.preventDefault();
        lockUntil = Math.max(lockUntil, now + 200);
        return;
      }
      // A gesture that scrolls a panel stops at the panel's end; only a new one pages on.
      if (scrollsInside(t, dir)) {
        if (now >= insideUntil) armedAt = now;
        insideUntil = now + 200;
        return;
      }
      e.preventDefault();
      if (now < insideUntil && !fresh) {
        insideUntil = now + 200;
        return;
      }
      if (Math.abs(e.deltaY) < 4) return;
      lockUntil = pageBy(dir) ? now + 700 : 0;
      armedAt = now;
      lockDir = dir;
    };
    // Keyboard focus scrolls the focused element into view, which can stop between screens;
    // focus inside the stats stage lands on the overview at least. A resize moves every screen
    // edge; phones skip this (their URL bar resizes constantly, and mandatory snap re-snaps).
    const onFocus = (e: FocusEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t?.matches(':focus-visible') || t.closest('dialog')) return;
      const stats = document.getElementById('stats');
      const min = stats && t.closest('[data-stage]') ? stats.getBoundingClientRect().top + window.scrollY : 0;
      requestAnimationFrame(() => !isPaging() && resnap(min)); // a click-to-jump focuses its destination as it pages
    };
    const onResize = () => window.innerWidth >= 768 && resnap();
    // A scrollbar drag, Home/End or autoscroll can stop between screens; put the page back on one
    // (desktop only, like onResize). A paged scroll ends on an edge by itself.
    const onScrollEnd = () => window.innerWidth >= 768 && !isPaging() && resnap();
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('focusin', onFocus);
    window.addEventListener('resize', onResize);
    window.addEventListener('scrollend', onScrollEnd);
    return () => {
      window.removeEventListener('scrollend', onScrollEnd);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('focusin', onFocus);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // Next hand countdown: the server deals the next hand and tells us how long is left.
  const nextHandInMs = gameState?.nextHandInMs;
  useEffect(() => {
    if (!isHandComplete) {
      // Mirrors the server's next-hand timer into the local countdown.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNextHandCountdown(null);
    } else if (nextHandInMs) {
      setNextHandCountdown(Math.ceil(nextHandInMs / 1000));
    }
  }, [isHandComplete, nextHandInMs]);

  useEffect(() => {
    if (nextHandCountdown === null || nextHandCountdown <= 0) return;

    const timer = setTimeout(() => {
      setNextHandCountdown(prev => prev !== null ? prev - 1 : null);
    }, 1000);

    return () => clearTimeout(timer);
  }, [nextHandCountdown]);

  // Calculate winners by player index for display on player cards
  const winnersByIdx = isHandComplete && winners.length > 0
    ? winners.reduce((acc, w) => {
        if (!acc[w.playerIdx]) {
          acc[w.playerIdx] = { amount: 0, handDesc: w.handDesc || w.handType };
        }
        acc[w.playerIdx].amount += w.amount;
        return acc;
      }, {} as Record<number, { amount: number; handDesc: string }>)
    : {};

  const tab: Tab = tableInView ? 'table' : screen === 'about' ? 'about' : 'stats';
  const onTab = (t: Tab) => {
    if (t === 'table') window.scrollTo({ top: 0 });
    else if (t === 'about') pageTo('about');
    else if (screen === 'race' || screen === 'stats-table' || screen === 'pairwise') backToOverview();
    else pageTo('phone-stats');
  };

  return (
    <MotionConfig reducedMotion="user">
    {/* --bar-h: room the connection bar (and a phone's tab bar, --tab-h in globals.css) takes at the bottom, so it never
        covers a screen's edge. data-page: the page's one background (globals.css) behind every screen. */}
    <div data-page className="px-3 lg:px-4" style={{ ['--bar-h' as string]: bar ? 'calc(40px + var(--tab-h))' : 'var(--tab-h)' }}>
      <main className="flex flex-col items-center-safe">
      {/* Screen 1: the live table and nothing else. Each screen is a scroll-snap point (globals.css). */}
      {/* Phones: under the slim bar (PhoneBar) only the table and its caption fill the first screen (the header's rows are
          the bar's), Profits & Losses and API usage under them start the stats (the tab bar's Stats): their own snap point,
          which stops a swipe (the screen's own stop would hold a scroll at its end, short of them), so the screen is no
          scroll container there (clip, not auto: a snap point counts only in its nearest one). */}
      <section data-screen aria-label="Live table" className="relative w-full min-h-svh snap-start snap-always max-md:snap-normal overflow-x-auto max-md:overflow-x-clip flex flex-col items-center-safe justify-center-safe max-md:justify-start pt-3 max-md:pt-[calc(48px+env(safe-area-inset-top))] pb-[calc(1rem+var(--bar-h))] lg:pt-4">
      {/* Header - Title centered */}
        <div className="mb-1 text-center max-md:hidden">
          <h1 className="text-[28px] font-bold text-balance" style={{ color: 'rgb(55, 53, 47)', lineHeight: 1.1 }}>No-LLMit</h1>
          <p className="text-[14px]" style={{ color: MUTED }}>
            Spectate (or play against) SOTA LLMs in a No Limit Texas Hold&apos;em cash game.{' '}
            {/* The home page's last screen; /about stays its own page (a new tab, a shared link). */}
            <Link
              href="/about"
              onClick={e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); pageTo('about'); } }}
              className="hover:underline"
              style={{ color: BLUE }}
            >
              ⓘ About
            </Link>
          </p>
        </div>

        {/* Action buttons row */}
        <div className="mb-1.5 flex items-center justify-center gap-3 max-md:hidden">
          <PlaySoonButton />
        </div>

        {/* Status row - live indicator, hand counter, blinds, timer */}
        <div className="mb-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 max-md:hidden">
          {/* Live indicator */}
          <div ref={labelRef} className={`flex items-center gap-2 ${statusKnown ? '' : '[&>*]:invisible'}`}>
            <span
              aria-hidden
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: isLive ? 'rgb(220, 38, 38)' : MUTED }}
            />
            <span ref={labelBox} {...labelAttrs} className="text-[14px] font-medium tabular-nums" style={{ color: 'rgb(55, 53, 47)', ...labelSize }}>
              {connection === 'down' ? 'Offline' : tableNotice ? (tableNotice.kind === 'closed' ? 'Closed' : 'Paused') : 'Live'}
              {statusKnown && watching !== undefined && ` · ${watching.toLocaleString()} watching`}
            </span>
          </div>

          {/* Hand counter, blinds, timer. Held blank until the first state, so the row keeps its width (a phone wraps it
              to the same lines) and nothing under it moves when they fill in. */}
          <div ref={handRef} className={`contents ${handKnown ? '' : '[&>*]:invisible'}`}>
            <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
            <span ref={handBox} {...handAttrs} className="text-[14px] tabular-nums" style={{ color: MUTED, ...handSize }}>Hand #{handNumber || '00'}</span>
            <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
            <span className="text-[14px]" style={{ color: MUTED }}>{stakes.smallBlind}/{stakes.bigBlind}</span>
            <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
            <span className="text-[14px] tabular-nums" style={{ color: MUTED }}>{elapsedTime}</span>
          </div>
          <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
          <UnitToggle bigBlind={stakes.bigBlind} />
          <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
          <SoundToggle />
        </div>

        <div className="max-md:hidden"><SessionProgress table={usageError ? undefined : usage?.table} /></div>

        {/* Main content: a fixed gap under the header, not pushed to the middle of the screen */}
        <div className="mt-6 max-md:mt-0 flex items-center-safe justify-center-safe w-full md:w-auto">
          {/* suppressHydrationWarning: BEFORE_PAINT fits it before React hydrates. */}
          <div ref={stageRef} className="stage-zoom flex flex-col w-full md:w-auto" suppressHydrationWarning>
            {/* Row 1: Table + Winnings. On phones the row dissolves (contents) so the reasoning bar comes right under the
                table and the sidebar after it (order). */}
            <div id="table" ref={tableRef} className="flex flex-col md:flex-row gap-4 md:gap-6 items-stretch relative max-md:contents">
              {/* Main game grid */}
              <PokerTable
                players={players}
                currentPlayerIdx={currentPlayerIdx}
                communityCards={communityCards}
                pot={pot}
                winnersByIdx={winnersByIdx}
                nextHandCountdown={nextHandCountdown}
                thinkingPlayerIdx={(displayState?.phase === 'thinking' || displayState?.phase === 'reasoning') ? displayState.playerIdx : undefined}
                peeked={displayState ? [...peeked, displayState.playerIdx] : peeked}
                buttonDetermination={buttonDetermination}
                notice={tableNotice}
                street={street}
                handNumber={handNumber}
                stats={seatStats}
                display={displayState}
                clockLeft={displayState?.phase === 'thinking' || displayState?.phase === 'reasoning' ? shotClockRemaining : null}
                clockBudgetMs={shotClockBudgetMs}
              />

              {/* Right sidebar column - leaderboard, then API usage. Phones: the top of the stats (the tab bar's Stats lands
                  here, its top under the bar). */}
              <div id="phone-stats" className="flex flex-col w-full md:w-[240px] shrink-0 max-md:order-1 max-md:snap-start max-md:snap-always max-md:pt-[calc(56px+env(safe-area-inset-top))]">
                <div className="flex-1 flex flex-col min-h-0">
                  <WinningsPanel players={players} />
                </div>
                <div className="mt-4">
                  <UsageIndicator usage={usage} error={usageError} />
                </div>
              </div>
            </div>

            {/* Reasoning Panel - LLM thinking + reasoning; phones: the caption under the table (its shot clock is the ring
                round the seat), the first screen's slack split above the table and under the caption. */}
            <div className="mt-4 w-full max-md:hidden">
              <ReasoningPanel
                displayState={displayState}
                shotClockRemaining={shotClockRemaining}
                blank={players.length === 0}
              />
            </div>
            <div className="md:hidden mt-1.5 w-full" style={{ marginBottom: 'calc(var(--phone-slack, 0px) / 2 + 8px)' }}>
              <Caption displayState={displayState} blank={players.length === 0} />
            </div>
          </div>
        </div>

        <button onClick={() => pageBy(1)} className={`mt-6 max-md:hidden ${NEXT_BUTTON}`} style={NEXT_STYLE}>
          Stats <ArrowDown size={16} weight="bold" aria-hidden />
        </button>
      </section>
      <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />

      {/* Screens 2-5: the overview, then race, stats and pairwise one at a time. */}
      <StatsSections stats={stats} error={statsError} />
      <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />
      </main>

      <StickyBar show={!tableInView} slide={scrolled} blank={players.length === 0} pot={pot} handNumber={handNumber} display={displayState} />
      <PhoneBar blank={players.length === 0} live={isLive} watching={watching} handNumber={handNumber} pot={pot} bigBlind={stakes.bigBlind} />
      <TabBar tab={tab} onTab={onTab} />
      <ModelDrawer models={stats?.models ?? []} error={statsError} slug={drawerSlug} onClose={closeModel} />

      {/* Fixed notification bar for connection status */}
      {bar && (
        <div role="status" className="fixed bottom-0 left-0 right-0 px-4 py-2 flex items-center justify-center gap-4 z-50" style={{ bottom: 'var(--tab-h)', background: 'rgb(203, 145, 47)', color: 'rgb(30, 28, 24)' }}>
          <div className="flex items-center gap-2">
            {gaveUp ? (
              <span className="text-sm font-medium">Can&apos;t reach the game server.</span>
            ) : (
              <>
                <CircleNotch size={14} className="animate-spin" aria-hidden />
                <span className="text-sm font-medium">Connecting to the game server…</span>
              </>
            )}
          </div>
          {gaveUp && (
            <button
              onClick={retry}
              className="text-xs bg-white/40 hover:bg-white/60 px-3 py-1 rounded font-bold"
            >
              Retry
            </button>
          )}
        </div>
      )}
      <DevPace />
    </div>
    </MotionConfig>
  );
}
