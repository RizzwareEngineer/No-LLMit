"use client";

import { useMemo, useState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { MotionConfig } from "motion/react";
import { ArrowDown, Brain, CircleNotch, GameController } from "@phosphor-icons/react";
import PokerTable, { getPlayerLayout } from "@/components/PokerTable";
import WinningsPanel from "@/components/WinningsPanel";
import ReasoningPanel from "@/components/ReasoningPanel";
import SoundToggle from "@/components/SoundToggle";
import UsageIndicator, { useUsage } from "@/components/UsageIndicator";
import StatsSections from "@/components/StatsSections";
import ModelDrawer from "@/components/ModelDrawer";
import StickyBar from "@/components/StickyBar";
import SessionProgress from "@/components/SessionProgress";
import { useGameState } from "@/hooks/useGameState";
import { MUTED, useStats } from "@/lib/stats";
import { isPaging, pageBy, resnap, scrollsInside } from "@/components/Section";

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
  
  // Auto-connect on mount
  useEffect(() => {
    if (!isConnected && !isLoading) {
      connect().catch(err => {
        console.error('Failed to auto-connect:', err);
      });
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh usage stats when an LLM action is revealed
  useEffect(() => {
    if (displayState?.phase === 'revealed') {
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

  // All-time stats feed the leaderboard and drawer; the session picker below the table may
  // narrow the sections. Both refetch as each hand finishes; a finished session never changes.
  // The session the stats screens show: the live table session by default, the scope of Profits
  // & Losses, until the visitor picks another one or all time ('') in the Stats screen's picker.
  const [chosen, setSession] = useState<string | null>(null);
  const all = useStats(undefined, true, handNumber);
  const session = chosen ?? all.data?.sessions.find(s => !s.ended_at)?.id ?? '';
  const pickedLive = !!session && !!all.data?.sessions.some(s => s.id === session && !s.ended_at);
  const picked = useStats(session || undefined, !!session, pickedLive ? handNumber : undefined);
  // Profits & Losses covers the live table session (the one not ended yet: the table the engine
  // is playing). Until that session has a saved hand, the panel shows this game's winnings.
  const liveId = all.data?.sessions.find(s => !s.ended_at)?.id;
  const live = useStats(liveId, !!liveId, handNumber);
  // Who is at the table now: the engine's lineup, else (an older engine) the live session's models.
  const seated = all.data?.seated ?? live.data?.models.map(m => m.name);
  // Hover stats on the seats: all-time, from the same fetch; the bundled dev sample never feeds them.
  const seatStats = useMemo(() => (all.data && !all.sample ? Object.fromEntries(all.data.models.map(m => [m.name, m])) : undefined), [all.data, all.sample]);

  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => '');
  const drawerSlug = hash.startsWith('#model=') ? hash.slice('#model='.length) : null;

  const tableRef = useRef<HTMLDivElement>(null);
  // Plain IntersectionObserver: motion's useInView never reports "out" for an element that
  // starts out of view, as it does after a deep link to #stats.
  const [tableInView, setTableInView] = useState(true);
  useEffect(() => {
    // The top 44px sit under the bar itself, so they do not count as visible.
    const io = new IntersectionObserver(([e]) => setTableInView(e.isIntersecting), { rootMargin: '-44px 0px 0px 0px' });
    if (tableRef.current) io.observe(tableRef.current);
    return () => io.disconnect();
  }, []);

  // ↑ ↓ ← → and PageUp/PageDown page between screens, unless a field, the drawer or a panel
  // that can still scroll that way has the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = PAGE_KEYS[e.key];
      if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('input, select, textarea, [contenteditable], dialog')) return;
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
      if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const t = e.target instanceof Element ? e.target : null;
      const dir = e.deltaY > 0 ? 1 : -1;
      if (t?.closest('dialog')) return;
      const now = e.timeStamp; // when the input happened, so main-thread jank never reads as a pause
      // A reversal pages only when it is deliberate: one small opposite event in a noisy
      // momentum tail just extends the lock. The lock comes before the panel check: the tail of a
      // flick that paged onto a card must not scroll that card's panel, then page again at its end.
      const abs = Math.abs(e.deltaY);
      if (abs > lastAbs) {
        if (!rises) riseAt = now - lastT > 30 || lastAbs <= 2 ? now : -1;
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
    {/* --bar-h: room the connection bar takes at the bottom, so it never covers a screen's edge. */}
    <div className="px-3 lg:px-4" style={{ background: '#FFFFFF', ['--bar-h' as string]: !isConnected || error ? '40px' : '0px' }}>
      <main className="flex flex-col items-center-safe">
      {/* Screen 1: the live table and nothing else. Each screen is a scroll-snap point (globals.css). */}
      <section data-screen aria-label="Live table" className="relative w-full min-h-svh snap-start snap-always overflow-x-clip flex flex-col items-center-safe pt-3 pb-[calc(2.25rem+var(--bar-h))] lg:pt-4">
      {/* Header - Title centered */}
        <div className="mb-1 text-center">
          <h1 className="text-[28px] font-bold" style={{ color: 'rgb(55, 53, 47)', lineHeight: 1.1 }}>No-LLMit</h1>
          <p className="text-[14px]" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>
            Spectate (or play against) SOTA LLMs in a No Limit Texas Hold&apos;em cash game.{' '}
            <Link 
              href="/about" 
              className="hover:underline"
              style={{ color: 'rgb(35, 131, 226)' }}
            >
              ⓘ About
            </Link>
          </p>
        </div>

        {/* Action buttons row */}
        <div className="mb-1.5 flex items-center justify-center gap-3">
          <button
            disabled
            className="btn-brutal-disabled px-3 py-1 text-[14px] flex items-center gap-2"
          >
            <GameController size={14} weight="bold" />
            Play vs. LLMs — (coming soon)!
          </button>
          <button
            disabled
            className="btn-brutal-disabled px-3 py-1 text-[14px] flex items-center gap-2"
          >
            <Brain size={14} weight="bold" />
            Train an LLM to play like you (coming soon)!
          </button>
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

          {/* Hand counter, blinds, timer */}
          {handNumber > 0 && (
            <>
              <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
              <span className="text-[14px] tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>Hand #{handNumber}</span>
              <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
              <span className="text-[14px]" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{stakes.smallBlind}/{stakes.bigBlind}</span>
              <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
              <span className="text-[14px] font-mono tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{elapsedTime}</span>
            </>
          )}
          <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
          <SoundToggle />
        </div>

        <SessionProgress table={usageError ? undefined : usage?.table} />

        {/* Main content */}
        <div className="flex-1 flex items-center-safe justify-center-safe w-full md:w-auto">
          <div className="stage-zoom flex flex-col w-full md:w-auto">
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
              />
            </div>
          </div>
        </div>

        <button
          onClick={() => pageBy(1)}
          className="absolute bottom-[calc(0.5rem+var(--bar-h))] left-1/2 -translate-x-1/2 flex items-center gap-1 rounded px-2 py-1 text-[12px] font-medium hover:bg-[rgba(55,53,47,0.06)]"
          style={{ color: MUTED }}
        >
          Stats <ArrowDown size={12} weight="bold" aria-hidden />
        </button>
      </section>

      {/* Screens 2-5: the overview, then race, stats and pairwise one at a time. */}
      <StatsSections
        all={all}
        picked={session ? picked : all}
        seated={!session || pickedLive ? seated : undefined}
        session={session}
        onSession={setSession}
      />
      </main>

      <StickyBar show={!tableInView && players.length > 0} pot={pot} handNumber={handNumber} display={displayState} />
      <ModelDrawer models={all.data?.models ?? []} error={all.error} loading={all.loading} slug={drawerSlug} onClose={closeModel} />

      {/* Fixed notification bar for connection status/errors */}
      {(!isConnected || error) && (
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
