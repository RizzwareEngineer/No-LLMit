"use client";

import { useMemo, useState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { MotionConfig } from "motion/react";
import { ArrowDown, CircleNotch } from "@phosphor-icons/react";
import PokerTable, { getPlayerLayout } from "@/components/PokerTable";
import WinningsPanel from "@/components/WinningsPanel";
import ReasoningPanel from "@/components/ReasoningPanel";
import SoundToggle, { UnitToggle } from "@/components/SoundToggle";
import UsageIndicator, { useUsage } from "@/components/UsageIndicator";
import StatsSections from "@/components/StatsSections";
import PlaySoonButton from "@/components/PlaySoonButton";
import ModelDrawer from "@/components/ModelDrawer";
import StickyBar from "@/components/StickyBar";
import SessionProgress from "@/components/SessionProgress";
import { useGameState } from "@/hooks/useGameState";
import { useStats } from "@/lib/stats";
import { NEXT_BUTTON, NEXT_STYLE, isPaging, pageBy, pageTo, resnap, scrollsInside } from "@/components/Section";
import { holdBoxes } from "@/lib/boxes";

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

export default function Home() {
  const {
    gameState,
    isConnected,
    gaveUp,
    tableNotice,
    isLoading,
    error,
    lastHandResult,
    displayState,
    shotClockRemaining,
    buttonDetermination,
    connect,
    retry,
    clearError,
  } = useGameState();

  const [elapsedTime, setElapsedTime] = useState<string>('00:00:00');
  const [nextHandCountdown, setNextHandCountdown] = useState<number | null>(null);
  const [usageRefreshTrigger, setUsageRefreshTrigger] = useState(0);
  const { usage, error: usageError } = useUsage(usageRefreshTrigger);
  const watching = usageError ? undefined : usage?.table?.spectators;
  const isLive = isConnected && !tableNotice;
  // The connection bar waits for the first attempt (3 s at most): on a refresh the socket opens in a moment, and a bar
  // shown until then moved every screen by its height (--bar-h) twice.
  const [tried, setTried] = useState(false);
  const bar = (tried && !isConnected) || !!error;

  // Auto-connect on mount
  useEffect(() => {
    const t = setTimeout(() => setTried(true), 3000);
    if (!isConnected && !isLoading) {
      connect().catch(err => {
        console.error('Failed to auto-connect:', err);
      }).finally(() => setTried(true));
    }
    return () => clearTimeout(t);
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh usage stats when an LLM action is revealed
  useEffect(() => {
    if (displayState?.phase === 'revealed') {
      // Mirrors a server event (an action revealed) into a refetch key; runs once per reveal.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUsageRefreshTrigger(prev => prev + 1);
    }
  }, [displayState?.phase]);

  // Timer effect - update elapsed time every second using server's gameStartTime
  useEffect(() => {
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
  const layout = getPlayerLayout(players.length || 9);
  const pot = gameState?.pot || 0;
  const communityCards = gameState?.communityCards || [];
  const street = gameState?.street || 'preflop';
  const buttonIdx = gameState?.buttonIdx ?? -1;
  // Use displayState.playerIdx for highlight when actively displaying a player's turn
  // This keeps the highlight on the current player during reasoning + 5s wait
  const currentPlayerIdx = displayState?.playerIdx ?? (gameState?.currentPlayerIdx ?? -1);
  const stakes = gameState?.stakes || { smallBlind: 5, bigBlind: 10 };
  const handNumber = gameState?.handNumber || 0;
  const winners = gameState?.winners || lastHandResult?.winners || [];
  const isHandComplete = street === 'complete';

  // All-time stats feed the leaderboard, the drawer and the stats sections; they refetch as each hand finishes.
  const all = useStats(undefined, true, handNumber);
  // Profits & Losses covers the live table session (the one not ended yet: the table the engine
  // is playing). Until that session has a saved hand, the panel shows this game's winnings.
  const liveId = all.data?.sessions.find(s => !s.ended_at)?.id;
  const live = useStats(liveId, !!liveId, handNumber);
  // Who is at the table now: the engine's lineup, else (an older engine) the live session's models.
  const seated = all.data?.seated ?? live.data?.models.map(m => m.name);
  // Hover stats on the seats: all-time, from the same fetch; the bundled dev sample never feeds them.
  const seatStats = useMemo(() => (all.data && !all.sample ? Object.fromEntries(all.data.models.map(m => [m.name, m])) : undefined), [all.data, all.sample]);

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

  const tableRef = useRef<HTMLDivElement>(null);
  // Plain IntersectionObserver: motion's useInView never reports "out" for an element that
  // starts out of view (a reload below the table).
  const [tableInView, setTableInView] = useState(true);
  useEffect(() => {
    // The top 44px sit under the bar itself, so they do not count as visible.
    const io = new IntersectionObserver(([e]) => setTableInView(e.isIntersecting), { rootMargin: '-44px 0px 0px 0px' });
    if (tableRef.current) io.observe(tableRef.current);
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

  return (
    <MotionConfig reducedMotion="user">
    {/* --bar-h: room the connection bar takes at the bottom, so it never covers a screen's edge. data-page: the page's
        one background (globals.css) behind every screen. */}
    <div data-page className="px-3 lg:px-4" style={{ ['--bar-h' as string]: bar ? '40px' : '0px' }}>
      <main className="flex flex-col items-center-safe">
      {/* Screen 1: the live table and nothing else. Each screen is a scroll-snap point (globals.css). */}
      <section data-screen aria-label="Live table" className="relative w-full min-h-svh snap-start snap-always overflow-x-auto flex flex-col items-center-safe justify-center-safe pt-3 pb-[calc(1rem+var(--bar-h))] lg:pt-4">
      {/* Header - Title centered */}
        <div className="mb-1 text-center">
          <h1 className="text-[28px] font-bold" style={{ color: 'rgb(55, 53, 47)', lineHeight: 1.1 }}>No-LLMit</h1>
          <p className="text-[14px]" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>
            Spectate (or play against) SOTA LLMs in a No Limit Texas Hold&apos;em cash game.{' '}
            {/* The home page's last screen; /about stays its own page (a new tab, a shared link). */}
            <Link
              href="/about"
              onClick={e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); pageTo('about'); } }}
              className="hover:underline"
              style={{ color: 'rgb(35, 131, 226)' }}
            >
              ⓘ About
            </Link>
          </p>
        </div>

        {/* Action buttons row */}
        <div className="mb-1.5 flex items-center justify-center gap-3">
          <PlaySoonButton />
        </div>

        {/* Status row - live indicator, hand counter, blinds, timer */}
        <div className="mb-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {/* Live indicator */}
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: isLive ? 'rgb(220, 38, 38)' : 'rgba(55, 53, 47, 0.65)' }}
            />
            <span className="text-[14px] font-medium tabular-nums" style={{ color: 'rgb(55, 53, 47)' }}>
              {!isConnected ? 'Offline' : tableNotice ? (tableNotice.kind === 'closed' ? 'Closed' : 'Paused') : 'Live'}
              {watching !== undefined && ` · ${watching.toLocaleString()} watching`}
            </span>
          </div>

          {/* Hand counter, blinds, timer. Held blank until the first state, so the row keeps its width (a phone wraps it
              to the same lines) and nothing under it moves when they fill in. */}
          <div className={`contents ${handNumber > 0 ? '' : '[&>*]:invisible'}`}>
            <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
            <span className="text-[14px] tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>Hand #{handNumber || '00'}</span>
            <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
            <span className="text-[14px]" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{stakes.smallBlind}/{stakes.bigBlind}</span>
            <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
            <span className="text-[14px] font-mono tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{elapsedTime}</span>
          </div>
          <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
          <UnitToggle bigBlind={stakes.bigBlind} />
          <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
          <SoundToggle />
        </div>

        <SessionProgress table={usageError ? undefined : usage?.table} />

        {/* Main content: a fixed gap under the header, not pushed to the middle of the screen */}
        <div className="mt-6 flex items-center-safe justify-center-safe w-full md:w-auto">
          {/* suppressHydrationWarning: BEFORE_PAINT fits it before React hydrates. */}
          <div ref={stageRef} className="stage-zoom flex flex-col w-full md:w-auto" suppressHydrationWarning>
            {/* Row 1: Table + Winnings (stacked on phones) */}
            <div id="table" ref={tableRef} className="flex flex-col md:flex-row gap-4 md:gap-6 items-stretch relative">
              {/* Main game grid */}
              <PokerTable
                players={players}
                layout={layout}
                currentPlayerIdx={currentPlayerIdx}
                buttonIdx={buttonIdx}
                communityCards={communityCards}
                pot={pot}
                winnersByIdx={winnersByIdx}
                nextHandCountdown={nextHandCountdown}
                thinkingPlayerIdx={(displayState?.phase === 'thinking' || displayState?.phase === 'reasoning') ? displayState.playerIdx : undefined}
                buttonDetermination={buttonDetermination}
                hidePositions={!!buttonDetermination}
                notice={tableNotice}
                street={street}
                handNumber={handNumber}
                stats={seatStats}
              />

              {/* Right sidebar column - leaderboard, then API usage */}
              <div className="flex flex-col w-full md:w-[240px] shrink-0">
                <div className="flex-1 flex flex-col min-h-0">
                  <WinningsPanel players={players} />
                </div>
                <div className="mt-4">
                  <UsageIndicator usage={usage} error={usageError} />
                </div>
              </div>
            </div>

            {/* Reasoning Panel - LLM thinking + reasoning */}
            <div className="mt-4 w-full">
              <ReasoningPanel
                displayState={displayState}
                shotClockRemaining={shotClockRemaining}
                blank={players.length === 0}
              />
            </div>
          </div>
        </div>

        <button onClick={() => pageBy(1)} className={`mt-6 ${NEXT_BUTTON}`} style={NEXT_STYLE}>
          Stats <ArrowDown size={16} weight="bold" aria-hidden />
        </button>
      </section>
      <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />

      {/* Screens 2-5: the overview, then race, stats and pairwise one at a time. */}
      <StatsSections
        all={all}
        seated={seated}
      />
      <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />
      </main>

      <StickyBar show={!tableInView} blank={players.length === 0} pot={pot} handNumber={handNumber} display={displayState} />
      <ModelDrawer models={all.data?.models ?? []} error={all.error} loading={all.loading} slug={drawerSlug} onClose={closeModel} />

      {/* Fixed notification bar for connection status/errors */}
      {bar && (
        <div role="status" className="fixed bottom-0 left-0 right-0 px-4 py-2 flex items-center justify-center gap-4 z-50" style={{ background: 'rgb(203, 145, 47)', color: 'rgb(30, 28, 24)' }}>
          <div className="flex items-center gap-2">
            {gaveUp ? (
              <span className="text-sm font-medium">Can&apos;t reach the game server.</span>
            ) : !isConnected ? (
              <>
                <CircleNotch size={14} className="animate-spin" aria-hidden />
                <span className="text-sm font-medium">Connecting to the game server…</span>
              </>
            ) : (
              <span className="text-sm font-medium">{error}</span>
            )}
          </div>
          {(gaveUp || (isConnected && error)) && (
            <button
              onClick={() => {
                clearError();
                if (gaveUp) retry();
              }}
              className="text-xs bg-white/40 hover:bg-white/60 px-3 py-1 rounded font-bold"
            >
              {gaveUp ? 'Retry' : 'Dismiss'}
            </button>
          )}
        </div>
      )}
    </div>
    </MotionConfig>
  );
}
