"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, CircleNotch, ArrowClockwise, GameController, Television, Wrench, Timer, Bug } from "@phosphor-icons/react";
import PokerTable, { getPlayerLayout } from "@/components/PokerTable";
import ActionPanel from "@/components/ActionPanel";
import WinningsPanel from "@/components/WinningsPanel";
import { useGameState } from "@/hooks/useGameState";
import { ALL_LLMS, DEFAULT_GAME_CONFIG } from "@/lib/constants";

export default function Home() {
  const router = useRouter();
  const {
    gameState,
    isConnected,
    isLoading,
    error,
    actionRequired,
    lastHandResult,
    connect,
    disconnect,
    newGame,
    startHand,
    submitAction,
    clearError,
  } = useGameState();

  const [showWinnings, setShowWinnings] = useState(true);
  const [gameMode, setGameMode] = useState<'spectate' | 'play' | 'test'>('spectate');
  const [selectedLLMs, setSelectedLLMs] = useState<string[]>([]);
  const [elapsedTime, setElapsedTime] = useState<string>('00:00:00');
  const [nextHandCountdown, setNextHandCountdown] = useState<number | null>(null);
  
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

  // Show loading while connecting
  if (!isConnected) {
  return (
      <div className="flex flex-col min-h-screen p-4 lg:p-8 overflow-auto bg-stone-100">
        <div className="text-gray-700 flex-1 flex flex-col items-center justify-center">
          <div className="flex items-center gap-3">
            <CircleNotch size={24} className="animate-spin text-gray-400" />
            <span className="text-sm text-gray-500">Connecting...</span>
          </div>
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm max-w-md">
              {error}
            <button
                onClick={() => connect()}
                className="block mt-2 text-red-700 underline text-xs"
              >
                Retry connection
            </button>
          </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen p-4 lg:p-8 overflow-auto bg-stone-100">
      <div className="text-gray-700 flex-1 flex flex-col items-center">
        
      {/* Header - Title centered */}
        <div className="mb-2 text-center">
          <h1 className="text-2xl font-bold tracking-wider">No-LLMit</h1>
          <p className="text-[11px] text-gray-500 mt-1">
          Spectate (or play against) SOTA LLMs in a No Limit Texas Hold'em cash game (or, soon, tournament)!
          </p>
        </div>

        {/* Subheader - Controls row */}
        <div className="mb-4 flex items-center gap-4">
          {/* Mode indicator */}
          <div className="flex items-center gap-2">
            {gameMode === 'spectate' && (
              <>
                <Television size={14} weight="bold" className="text-blue-500" />
                <span className="text-[10px] text-blue-500 uppercase font-bold">Spectating</span>
              </>
            )}
            {gameMode === 'play' && (
              <>
                <GameController size={14} weight="bold" className="text-green-500" />
                <span className="text-[10px] text-green-500 uppercase font-bold">Playing</span>
              </>
            )}
            {gameMode === 'test' && (
              <>
                <Wrench size={14} weight="bold" className="text-amber-500" />
                <span className="text-[10px] text-amber-500 uppercase font-bold">Test Mode</span>
              </>
            )}
          </div>
          <div className="h-4 w-px bg-gray-300" />

          {/* Hand counter & Timer */}
          {handNumber > 0 && (
            <>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-gray-500 uppercase">Hand #{handNumber}</span>
                <div className="h-4 w-px bg-gray-300" />
                <div className="flex items-center gap-1">
                  <Timer size={12} className="text-gray-400" />
                  <span className="text-[10px] text-gray-500 font-mono">{elapsedTime}</span>
                </div>
              </div>
              <div className="h-4 w-px bg-gray-300" />
            </>
          )}

          {/* Next hand countdown/button */}
          {isHandComplete && (
            <>
              {nextHandCountdown !== null && nextHandCountdown > 0 ? (
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                  <CircleNotch size={12} className="animate-spin text-gray-400" />
                  <span>{nextHandCountdown}s</span>
                  <button
                    onClick={() => {
                      setNextHandCountdown(null);
                      startHand();
                    }}
                    className="text-blue-500 hover:underline"
                  >
                    Skip
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleStartHand}
                  disabled={isLoading}
                  className="btn-brutal px-3 py-1 text-[10px] flex items-center gap-2"
                >
                  {isLoading ? <CircleNotch size={12} className="animate-spin" /> : <ArrowClockwise size={12} weight="bold" />}
                  NEXT HAND
                </button>
              )}
              <div className="h-4 w-px bg-gray-300" />
            </>
          )}

          {/* Play / Spectate buttons */}
          {gameMode === 'play' ? (
            <button
              onClick={handleBackToSpectate}
              className="btn-brutal px-3 py-1 text-[10px] flex items-center gap-2"
              style={{ textTransform: 'none' }}
            >
              <Television size={12} weight="bold" />
              Back to Spectate
            </button>
          ) : (
            <button
              onClick={() => router.push('/play')}
              className="btn-brutal btn-brutal-success px-3 py-1 text-[10px] flex items-center gap-2"
              style={{ textTransform: 'none' }}
            >
              <GameController size={12} weight="bold" />
              Play vs. LLMs
            </button>
          )}
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm max-w-2xl">
            {error}
          </div>
        )}


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
                stakes={stakes}
                winnersByIdx={winnersByIdx}
              />

              {/* Rankings sidebar */}
              {showWinnings && (
                <WinningsPanel 
                  players={players} 
                  onHide={() => setShowWinnings(false)} 
                />
              )}
              
              {!showWinnings && (
            <button
                  onClick={() => setShowWinnings(true)}
                  className="absolute top-0 right-0 flex items-center justify-center w-10 h-10 border border-gray-300 bg-stone-50 shadow-sm text-gray-400 hover:text-gray-700 transition-colors"
                  title="Show winnings"
                >
                  <Eye size={18} weight="bold" />
            </button>
              )}
            </div>

            {/* Action Panel - shown based on mode */}
            {showActionPanel && (
              <div className="mt-6 flex w-full justify-start">
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

      {/* Dev-only test mode toggle - only visible in development */}
      {process.env.NODE_ENV === 'development' && gameMode !== 'test' && (
        <button
          onClick={() => {
            window.location.href = '/?test=true';
          }}
          className="fixed bottom-4 left-4 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded shadow-lg flex items-center gap-2 text-xs font-bold z-50"
          title="Enter Test Mode (Dev Only)"
        >
          <Bug size={16} weight="bold" />
          TEST MODE
        </button>
      )}

      {/* Exit test mode button */}
      {process.env.NODE_ENV === 'development' && gameMode === 'test' && (
        <button
          onClick={() => {
            window.location.href = '/';
          }}
          className="fixed bottom-4 left-4 bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded shadow-lg flex items-center gap-2 text-xs font-bold z-50"
          title="Exit Test Mode"
        >
          <Bug size={16} weight="bold" />
          EXIT TEST
        </button>
      )}
    </div>
  );
}
