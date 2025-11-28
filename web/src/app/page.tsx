"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, CircleNotch, ArrowClockwise, GameController, Television, Wrench, Timer } from "@phosphor-icons/react";
import PokerTable, { getPlayerLayout } from "@/components/PokerTable";
import ActionPanel from "@/components/ActionPanel";
import WinningsPanel from "@/components/WinningsPanel";
import { useGameState } from "@/hooks/useGameState";

// All available LLM players
const ALL_LLMS = [
  "GPT-4o", "Claude 3.5", "Gemini Pro", "Llama 3", 
  "Mistral Large", "DeepSeek V3", "Grok 2", "Qwen 2.5", "Cohere R+"
];

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
  } = useGameState();

  const [showWinnings, setShowWinnings] = useState(true);
  const [gameMode, setGameMode] = useState<'spectate' | 'play' | 'test'>('spectate');
  const [selectedLLMs, setSelectedLLMs] = useState<string[]>([]);
  const [elapsedTime, setElapsedTime] = useState<string>('00:00:00');
  
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
          startingStack: 2000,
          smallBlind: 5,
          bigBlind: 10,
          mode: 'play',
        });
      } else {
        // Spectate or test mode: all LLMs
        newGame({
          playerNames: ALL_LLMS,
          startingStack: 2000,
          smallBlind: 5,
          bigBlind: 10,
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

  const handleStartHand = () => {
    startHand();
  };

  const handleAction = (action: 'fold' | 'check' | 'call' | 'raise' | 'all-in', amount?: number) => {
    submitAction(action, amount);
  };

  const handleBackToSpectate = () => {
    setGameMode('spectate');
    setSelectedLLMs([]);
    newGame({
      playerNames: ALL_LLMS,
      startingStack: 2000,
      smallBlind: 5,
      bigBlind: 10,
      mode: 'simulate',
    });
  };

  // Determine if action panel should be shown
  const showActionPanel = (() => {
    if (currentPlayerIdx < 0 || isHandComplete || !players[currentPlayerIdx]) return false;
    
    // Test mode: always show action panel (dev testing)
    if (gameMode === 'test') return true;
    
    // Play mode: only show when it's the user's turn (player 0)
    if (gameMode === 'play' && currentPlayerIdx === 0) return true;
    
    // Spectate mode: never show action panel
    return false;
  })();

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
            Watch SOTA LLMs play each other in a No Limit Texas Hold&apos;em cash game (and tournament soon)!
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

          {/* Next hand button */}
          {isHandComplete && (
            <>
              <button 
                onClick={handleStartHand}
                disabled={isLoading}
                className="btn-brutal px-3 py-1 text-[10px] flex items-center gap-2"
              >
                {isLoading ? <CircleNotch size={12} className="animate-spin" /> : <ArrowClockwise size={12} weight="bold" />}
                NEXT HAND
              </button>
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

        {/* Winners announcement */}
        {winners.length > 0 && isHandComplete && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 text-sm max-w-2xl">
            <div className="font-bold mb-1">🎉 Hand Complete!</div>
            {(() => {
              const consolidated = winners.reduce((acc, w) => {
                const name = players[w.playerIdx]?.name || `Player ${w.playerIdx}`;
                if (!acc[name]) {
                  acc[name] = { total: 0, handDesc: w.handDesc || w.handType };
                }
                acc[name].total += w.amount;
                return acc;
              }, {} as Record<string, { total: number; handDesc: string }>);
              
              return Object.entries(consolidated).map(([name, data]) => (
                <div key={name}>
                  {name} wins ¤{data.total.toLocaleString()} with {data.handDesc}
                </div>
              ));
            })()}
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
              <div className="mt-6 flex w-full justify-end">
                <ActionPanel
                  currentPlayer={players[currentPlayerIdx]}
                  currentBet={currentBet}
                  minRaise={minRaise}
                  validActions={validActions}
                  stakes={stakes}
                  actionRequired={!!actionRequired}
                  onAction={handleAction}
                />
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
