"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { MotionConfig } from "motion/react";
import { CircleNotch } from "@phosphor-icons/react";
import PokerTable, { getPlayerLayout } from "@/components/PokerTable";
import WinningsPanel from "@/components/WinningsPanel";
import ReasoningPanel from "@/components/ReasoningPanel";
import UsageIndicator, { useUsage } from "@/components/UsageIndicator";
import { useGameState } from "@/hooks/useGameState";

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
  // Use displayState.playerIdx for highlight when actively displaying a player's turn
  // This keeps the highlight on the current player during reasoning + 5s wait
  const currentPlayerIdx = displayState?.playerIdx ?? (gameState?.currentPlayerIdx ?? -1);
  const stakes = gameState?.stakes || { smallBlind: 5, bigBlind: 10 };
  const handNumber = gameState?.handNumber || 0;
  const buttonIdx = gameState?.buttonIdx ?? -1;
  const winners = gameState?.winners || lastHandResult?.winners || [];
  const isHandComplete = street === 'complete';

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
    <div className="flex flex-col min-h-screen p-3 lg:p-4 overflow-auto" style={{ background: '#FFFFFF' }}>
      <main className="flex-1 flex flex-col items-center-safe">
        
      {/* Header - Title centered */}
        <div className="mb-2 text-center">
          <h1 className="text-[24px] font-bold" style={{ color: 'rgb(55, 53, 47)', lineHeight: 1.2 }}>No-LLMit</h1>
          <p className="text-[15px] mt-1" style={{ color: 'rgb(55, 53, 47)' }}>
            9 LLMs play No Limit Hold&apos;em against each other, live. Watch each one explain its move.{' '}
            <Link 
              href="/about" 
              className="hover:underline whitespace-nowrap"
              style={{ color: 'rgb(35, 131, 226)' }}
            >
              About
            </Link>
          </p>
        </div>

        {/* Status row - live indicator, hand counter, blinds, timer */}
        <div className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {/* Live indicator */}
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={`inline-block w-2 h-2 rounded-full ${isLive ? 'animate-pulse' : ''}`}
              style={{ background: isLive ? 'rgb(220, 38, 38)' : 'rgba(55, 53, 47, 0.65)' }}
            />
            <span className="text-[12px] font-medium tabular-nums" style={{ color: 'rgb(55, 53, 47)' }}>
              {!isConnected ? 'Offline' : tableNotice ? (tableNotice.kind === 'closed' ? 'Closed' : 'Paused') : 'Live'}
              {watching !== undefined && ` · ${watching.toLocaleString()} watching`}
            </span>
          </div>

          {/* Hand counter, blinds, timer */}
          {handNumber > 0 && (
            <>
              <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
              <span className="text-[12px] tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>Hand #{handNumber}</span>
              <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
              <span className="text-[12px]" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>¤{stakes.smallBlind}/{stakes.bigBlind}</span>
              <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
              <span className="text-[12px] font-mono tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{elapsedTime}</span>
            </>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 flex items-center-safe justify-center-safe w-full md:w-auto">
          <div className="flex flex-col w-full md:w-auto">
            {/* Row 1: Table + Winnings (stacked on phones) */}
            <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-stretch relative">
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
      </main>

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
