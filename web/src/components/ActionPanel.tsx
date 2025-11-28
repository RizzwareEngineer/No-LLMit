"use client";

import { useState, useEffect } from "react";
import CornerBorders from "@/components/CornerBorders";
import { ValidAction, PlayerState } from "@/lib/api";

interface ActionPanelProps {
  currentPlayer: PlayerState;
  currentBet: number;
  minRaise: number;
  validActions: ValidAction[];
  stakes: { smallBlind: number; bigBlind: number };
  actionRequired?: boolean;
  onAction: (action: 'fold' | 'check' | 'call' | 'raise' | 'all-in', amount?: number) => void;
}

export default function ActionPanel({
  currentPlayer,
  currentBet,
  minRaise,
  validActions,
  stakes,
  actionRequired,
  onAction,
}: ActionPanelProps) {
  const [raiseAmount, setRaiseAmount] = useState(minRaise + currentBet);
  const currentPlayerStack = currentPlayer.stack;
  const toCall = currentBet - (currentPlayer.currentBet || 0);

  // Update raise amount when min raise changes
  useEffect(() => {
    const minRaiseTotal = currentBet + minRaise;
    if (raiseAmount < minRaiseTotal) {
      setRaiseAmount(minRaiseTotal);
    }
  }, [minRaise, currentBet, raiseAmount]);

  // Check if a specific action is available
  const canDoAction = (actionType: string) => {
    return validActions.some(a => a.type.toLowerCase() === actionType.toLowerCase());
  };

  return (
    <div className="w-[557px] border border-gray-300 bg-stone-50 shadow-sm relative">
      <CornerBorders />
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-700/50">Action for:</div>
            <div className="text-sm font-bold text-gray-700">
              {currentPlayer.name}
            </div>
            {actionRequired && (
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-gray-700/50">To Call:</span>
            <span className="text-sm font-bold text-gray-700">¤{toCall}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onAction('fold')}
            disabled={!canDoAction('fold')}
            className="btn-brutal btn-brutal-danger w-20 h-9 text-xs disabled:opacity-50 flex items-center justify-center"
          >
            FOLD
          </button>
          
          {canDoAction('check') ? (
            <button 
              onClick={() => onAction('check')}
              className="btn-brutal w-20 h-9 text-xs flex items-center justify-center"
            >
              CHECK
            </button>
          ) : canDoAction('call') && (
            <button 
              onClick={() => onAction('call')}
              className="btn-brutal w-24 h-9 text-xs flex items-center justify-center"
            >
              CALL ¤{toCall}
            </button>
          )}
          
          {canDoAction('raise') && (
            <div className="flex items-center gap-2">
              <button 
                onClick={() => onAction('raise', raiseAmount)}
                className="btn-brutal btn-brutal-warning w-20 h-9 text-xs flex items-center justify-center"
              >
                RAISE
              </button>
              <div className="flex items-center border border-gray-700/20 h-9">
                <span className="text-gray-700/50 px-2 text-sm">¤</span>
                <input
                  type="number"
                  value={raiseAmount}
                  onChange={(e) => setRaiseAmount(Number(e.target.value))}
                  min={currentBet + minRaise}
                  max={currentPlayerStack + (currentPlayer.currentBet || 0)}
                  step={stakes.bigBlind}
                  className="input-brutal w-16 px-2 py-1 text-sm text-right h-full"
                />
              </div>
            </div>
          )}
          
          {canDoAction('all-in') && (
            <button 
              onClick={() => onAction('all-in')}
              className="btn-brutal btn-brutal-success w-28 h-9 text-xs ml-auto flex items-center justify-center"
            >
              ALL-IN ¤{currentPlayerStack}
            </button>
          )}
        </div>
        
        {canDoAction('raise') && (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[10px] text-gray-500">¤{currentBet + minRaise}</span>
            <input
              type="range"
              min={currentBet + minRaise}
              max={currentPlayerStack + (currentPlayer.currentBet || 0)}
              step={stakes.bigBlind}
              value={raiseAmount}
              onChange={(e) => setRaiseAmount(Number(e.target.value))}
              className="flex-1 h-2 bg-gray-300 rounded appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-gray-700 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <span className="text-[10px] text-gray-500">¤{currentPlayerStack}</span>
          </div>
        )}
      </div>
    </div>
  );
}

