"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CircleNotch, ArrowClockwise, GameController, Television, Wrench, Bug, Timer, Brain, Info } from "@phosphor-icons/react";
import PokerTable, { getPlayerLayout } from "@/components/PokerTable";
import ActionPanel from "@/components/ActionPanel";
import WinningsPanel from "@/components/WinningsPanel";
import ReasoningPanel from "@/components/ReasoningPanel";
import UsageIndicator from "@/components/UsageIndicator";
import { useGameState } from "@/hooks/useGameState";
import { ALL_LLMS, DEFAULT_GAME_CONFIG } from "@/lib/constants";

export default function Home() {
  const {
    gameState,
    isConnected,
    isLoading,
    error,
    actionRequired,
    lastHandResult,
    displayState,
    isPaused,
    isPausePending,
    shotClockRemaining,
    connect,
    newGame,
    startHand,
    submitAction,
    clearError,
    pause,
    resume,
  } = useGameState();

  const [gameMode, setGameMode] = useState<'spectate' | 'play' | 'test'>('spectate');
  const [selectedLLMs, setSelectedLLMs] = useState<string[]>([]);
  const [elapsedTime, setElapsedTime] = useState<string>('00:00:00');
  const [nextHandCountdown, setNextHandCountdown] = useState<number | null>(null);
  const [usageRefreshTrigger, setUsageRefreshTrigger] = useState(0);
  
  // Check for test mode via URL param (?test=true) or play mode via sessionStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('test') === 'true') {
        setGameMode('test');
      } else if (sessionStorage.getItem('playMode') === 'true') {
        setGameMode('play');
        const stored = sessionStorage.getItem('selectedLLMs');
        if (stored) {
          setSelectedLLMs(JSON.parse(stored));
        }
        // Clear after reading
        sessionStorage.removeItem('playMode');
        sessionStorage.removeItem('selectedLLMs');
      }
    }
  }, []);

  // Auto-connect and auto-start game on mount
  useEffect(() => {
    if (!isConnected && !isLoading) {
      connect().then(() => {
        // Connection successful, game will auto-start
      }).catch(err => {
        console.error('Failed to auto-connect:', err);
      });
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start game when connected but no game exists
  useEffect(() => {
    if (isConnected && !gameState?.id && !isLoading) {
      if (gameMode === 'play' && selectedLLMs.length === 8) {
        // Play mode: user vs selected LLMs
        newGame({
          playerNames: ['You', ...selectedLLMs],
          ...DEFAULT_GAME_CONFIG,
          mode: 'play',
        });
      } else {
        // Spectate or test mode: all LLMs
        newGame({
          playerNames: [...ALL_LLMS],
          ...DEFAULT_GAME_CONFIG,
          mode: gameMode === 'test' ? 'test' : 'simulate',
        });
      }
    }
  }, [isConnected, gameState?.id, isLoading, gameMode, selectedLLMs]);

  // Auto-start first hand when game is created
  useEffect(() => {
    if (isConnected && gameState?.id && gameState?.handNumber === 0 && !isLoading) {
      startHand();
    }
  }, [isConnected, gameState?.id, gameState?.handNumber, isLoading]);

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
  const currentBet = gameState?.currentBet || 0;
  const minRaise = gameState?.minRaise || 10;
  const pot = gameState?.pot || 0;
  const communityCards = gameState?.communityCards || [];
  const street = gameState?.street || 'preflop';
  const currentPlayerIdx = gameState?.currentPlayerIdx ?? -1;
  const validActions = gameState?.validActions || [];
  const stakes = gameState?.stakes || { smallBlind: 5, bigBlind: 10 };
  const handNumber = gameState?.handNumber || 0;
  const buttonIdx = gameState?.buttonIdx ?? -1;
  const winners = gameState?.winners || lastHandResult?.winners || [];
  const isHandComplete = street === 'complete';

  // Auto-start next hand countdown (5 seconds after hand completes)
  useEffect(() => {
    if (isHandComplete && nextHandCountdown === null) {
      setNextHandCountdown(7);
    } else if (!isHandComplete && nextHandCountdown !== null) {
      // Hand started, clear countdown
      setNextHandCountdown(null);
    }
  }, [isHandComplete]);

  useEffect(() => {
    if (nextHandCountdown === null) return;
    
    if (nextHandCountdown <= 0) {
      // Start next hand
      setNextHandCountdown(null);
      clearError(); // Clear any previous errors
      startHand();
      return;
    }
    
    const timer = setTimeout(() => {
      setNextHandCountdown(prev => prev !== null ? prev - 1 : null);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [nextHandCountdown, startHand, clearError]);

  const handleStartHand = () => {
    clearError();
    startHand();
  };

  const handleAction = (action: 'fold' | 'check' | 'call' | 'raise' | 'all-in', amount?: number) => {
    submitAction(action, amount);
  };

  const handleBackToSpectate = () => {
    setGameMode('spectate');
    setSelectedLLMs([]);
    newGame({
      playerNames: [...ALL_LLMS],
      ...DEFAULT_GAME_CONFIG,
      mode: 'simulate',
    });
  };

  // Determine if action panel should be shown
  const showActionPanel = (() => {
    // Test mode: always show action panel (for dev testing all players)
    if (gameMode === 'test') return true;
    
    // Play mode: always show action panel (user plays against LLMs)
    if (gameMode === 'play') return true;
    
    // Spectate mode: never show action panel
    return false;
  })();
  
  // Determine if actions are currently available (for disabling buttons)
  const canAct = currentPlayerIdx >= 0 && !isHandComplete && !!players[currentPlayerIdx];

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
    <div className="flex flex-col min-h-screen p-3 lg:p-4 overflow-auto" style={{ background: '#FFFFFF' }}>
      <div className="flex-1 flex flex-col items-center">
        
      {/* Header - Title centered */}
        <div className="mb-1 text-center">
          <h1 className="text-[24px] font-bold" style={{ color: 'rgb(55, 53, 47)', lineHeight: 1.2 }}>No-LLMit</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>
            Spectate (or play against) SOTA LLMs in a No Limit Texas Hold&apos;em cash game.{' '}
            <Link 
              href="/about" 
              className="inline-flex items-center gap-1 hover:underline"
              style={{ color: 'rgb(35, 131, 226)' }}
            >
              <Info size={12} weight="bold" />
              Learn more
            </Link>
          </p>
        </div>

        {/* Action buttons row */}
        <div className="mb-2 flex items-center justify-center gap-3">
          {gameMode === 'play' ? (
            <button
              onClick={handleBackToSpectate}
              className="btn-brutal px-3 py-1 text-[11px] flex items-center gap-2"
            >
              <Television size={12} weight="bold" />
              Back to Spectate
            </button>
          ) : (
            <>
              <button
                disabled
                className="btn-brutal-disabled px-3 py-1 text-[11px] flex items-center gap-2"
              >
                <GameController size={12} weight="bold" />
                Play vs. LLMs — (coming soon)!
              </button>
              <button
                disabled
                className="btn-brutal-disabled px-3 py-1 text-[11px] flex items-center gap-2"
              >
                <Brain size={12} weight="bold" />
                Train an LLM to play like you (coming soon)!
              </button>
            </>
          )}
        </div>

        {/* Status row - Mode indicator, hand counter, blinds, timer */}
        <div className="mb-3 flex items-center gap-4">
          {/* Mode indicator */}
          <div className="flex items-center gap-2">
            {gameMode === 'spectate' && (
              <>
                <Television size={14} weight="bold" style={{ color: 'rgb(35, 131, 226)' }} />
                <span className="text-[12px] font-medium" style={{ color: 'rgb(35, 131, 226)' }}>Spectating</span>
              </>
            )}
            {gameMode === 'play' && (
              <>
                <GameController size={14} weight="bold" style={{ color: 'rgb(15, 123, 108)' }} />
                <span className="text-[12px] font-medium" style={{ color: 'rgb(15, 123, 108)' }}>Playing</span>
              </>
            )}
            {gameMode === 'test' && (
              <>
                <Wrench size={14} weight="bold" style={{ color: 'rgb(203, 145, 47)' }} />
                <span className="text-[12px] font-medium" style={{ color: 'rgb(203, 145, 47)' }}>Test Mode</span>
              </>
            )}
          </div>

          {/* Hand counter, blinds, timer */}
          {handNumber > 0 && (
            <>
              <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
              <span className="text-[12px]" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>Hand #{handNumber}</span>
              <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
              <span className="text-[12px]" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>¤{stakes.smallBlind}/{stakes.bigBlind}</span>
              <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
              <span className="text-[12px] font-mono" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{elapsedTime}</span>
            </>
          )}

          {/* Next hand button (countdown now shown on felt) */}
          {isHandComplete && nextHandCountdown !== null && nextHandCountdown <= 0 && (
            <>
              <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
              <button
                onClick={handleStartHand}
                disabled={isLoading}
                className="btn-brutal px-3 py-1 text-[12px] flex items-center gap-2"
              >
                {isLoading ? <CircleNotch size={12} className="animate-spin" /> : <ArrowClockwise size={12} weight="bold" />}
                Next Hand
              </button>
            </>
          )}
        </div>



        {/* Main content */}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col">
            {/* Row 1: Table + Winnings */}
            <div className="flex gap-6 items-stretch relative">
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
                onSkipCountdown={() => {
                  setNextHandCountdown(null);
                  startHand();
                }}
              />

              {/* Right sidebar column - API Usage above Winnings */}
              <div className="flex flex-col w-[240px] shrink-0">
                {/* API Usage - static, above winnings */}
                <UsageIndicator isPaused={isPaused} inline refreshTrigger={usageRefreshTrigger} />
                
                {/* Winnings panel */}
                <div className="mt-4 flex-1 flex flex-col min-h-0">
                  <WinningsPanel players={players} />
                </div>
              </div>
            </div>

            {/* Reasoning Panel - LLM thinking + reasoning (always visible in spectate) */}
            {gameMode === 'spectate' && (
              <div className="mt-4" style={{ width: '50vw', maxWidth: '700px', minWidth: '500px' }}>
                <ReasoningPanel
                  displayState={displayState}
                  shotClockRemaining={shotClockRemaining}
                  isPaused={isPaused}
                />
              </div>
            )}

            {/* Action Panel - shown in play/test modes */}
            {showActionPanel && (
              <div className="mt-4 flex w-full justify-start">
                <ActionPanel
                  currentPlayer={canAct ? players[currentPlayerIdx] : null}
                  currentBet={currentBet}
                  minRaise={minRaise}
                  validActions={canAct ? validActions : []}
                  stakes={stakes}
                  actionRequired={!!actionRequired && canAct}
                  onAction={handleAction}
                  disabled={!canAct}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dev controls - top left */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed top-4 left-4 flex flex-col gap-2 z-50">
          {/* Pause/Resume button */}
          {!isHandComplete && (
            <button
              onClick={() => isPaused ? resume() : pause()}
              disabled={isPausePending}
              className={`${
                isPaused ? 'bg-green-500 hover:bg-green-600' : 
                isPausePending ? 'bg-amber-500 cursor-wait' : 
                'bg-gray-500 hover:bg-gray-600'
              } text-white px-3 py-1.5 rounded shadow-lg flex items-center gap-2 text-xs font-bold`}
              title={isPaused ? 'Resume Game' : isPausePending ? 'Waiting for current action...' : 'Pause Game'}
            >
              {isPaused ? (
                <>
                  <ArrowClockwise size={14} weight="bold" />
                  RESUME
                </>
              ) : isPausePending ? (
                <>
                  <CircleNotch size={14} weight="bold" className="animate-spin" />
                  PAUSING...
                </>
              ) : (
                <>
                  <Timer size={14} weight="bold" />
                  PAUSE
                </>
              )}
            </button>
          )}

          {/* Test mode toggle */}
          {gameMode !== 'test' ? (
            <button
              onClick={() => { window.location.href = '/?test=true'; }}
              className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded shadow-lg flex items-center gap-2 text-xs font-bold"
              title="Enter Test Mode (Dev Only)"
            >
              <Bug size={14} weight="bold" />
              TEST MODE
            </button>
          ) : (
            <button
              onClick={() => { window.location.href = '/'; }}
              className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded shadow-lg flex items-center gap-2 text-xs font-bold"
              title="Exit Test Mode"
            >
              <Bug size={14} weight="bold" />
              EXIT TEST
            </button>
          )}
        </div>
      )}

      {/* Fixed notification bar for connection status/errors */}
      {(!isConnected || error) && (
        <div className="fixed bottom-0 left-0 right-0 px-4 py-2 flex items-center justify-center gap-4 z-50" style={{ background: 'rgb(203, 145, 47)', color: '#ffffff' }}>
          <div className="flex items-center gap-2">
            {!isConnected && (
              <>
                <CircleNotch size={14} className="animate-spin" />
                <span className="text-sm font-medium">Connecting to game server...</span>
              </>
            )}
            {isConnected && error && (
              <span className="text-sm font-medium">⚠️ {error}</span>
            )}
          </div>
          {error && (
            <button
              onClick={() => {
                clearError();
                if (!isConnected) connect();
              }}
              className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded font-bold"
            >
              {isConnected ? 'Dismiss' : 'Retry'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
