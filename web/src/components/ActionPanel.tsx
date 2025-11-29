"use client";

import { useState, useEffect } from "react";
import CornerBorders from "@/components/CornerBorders";
import { ValidAction, PlayerState } from "@/lib/api";

interface ActionPanelProps {
  currentPlayer: PlayerState | null;
  currentBet: number;
  minRaise: number;
  validActions: ValidAction[];
  stakes: { smallBlind: number; bigBlind: number };
  actionRequired?: boolean;
  onAction: (action: 'fold' | 'check' | 'call' | 'raise' | 'all-in', amount?: number) => void;
  disabled?: boolean;
}

export default function ActionPanel({
  currentPlayer,
  currentBet,
  minRaise,
  validActions,
  stakes,
  actionRequired,
  onAction,
  disabled = false,
}: ActionPanelProps) {
  const [raiseInputValue, setRaiseInputValue] = useState<string>('');
  const currentPlayerStack = currentPlayer?.stack || 0;
  const toCall = currentBet - (currentPlayer?.currentBet || 0);
  const minRaiseTotal = currentBet + minRaise;
  const maxRaise = currentPlayerStack + (currentPlayer?.currentBet || 0);
  
  // Can the player afford to make a raise? (need more than just calling)
  const canAffordRaise = maxRaise > minRaiseTotal;
  // Effective min raise is capped by what player can afford
  const effectiveMinRaise = Math.min(minRaiseTotal, maxRaise);

  // Update raise input when min raise changes - cap to what player can afford
  useEffect(() => {
    setRaiseInputValue(String(effectiveMinRaise));
  }, [effectiveMinRaise]);

  // Round to nearest big blind increment, clamped to valid range
  const getRoundedRaiseAmount = (): number => {
    const parsed = parseInt(raiseInputValue) || 0;
    const bb = stakes.bigBlind;
    // Round to nearest big blind
    const rounded = Math.round(parsed / bb) * bb;
    // Clamp to valid range (use effectiveMinRaise which is capped)
    return Math.max(effectiveMinRaise, Math.min(maxRaise, rounded));
  };

  // Check if a specific action is available
  const canDoAction = (actionType: string) => {
    if (disabled || !currentPlayer) return false;
    return validActions.some(a => a.type.toLowerCase() === actionType.toLowerCase());
  };

  // Show waiting state when disabled or no player
  const isWaiting = disabled || !currentPlayer;
  
  // Special case: if "call" isn't in validActions but "all-in" is, and we need to call,
  // then "call" is effectively going all-in - allow it
  const canCall = canDoAction('call') || (canDoAction('all-in') && toCall > 0 && toCall >= currentPlayerStack);

  // Handle raise action - round the value before submitting
  const handleRaise = () => {
    const amount = getRoundedRaiseAmount();
    setRaiseInputValue(String(amount)); // Update display to show rounded value
    onAction('raise', amount);
  };
  
  // Handle call - if it's an all-in call, send all-in action
  const handleCall = () => {
    if (toCall >= currentPlayerStack) {
      onAction('all-in');
    } else {
      onAction('call');
    }
  };

  return (
    <div className={`w-[557px] border border-gray-300 bg-stone-50 shadow-sm relative ${isWaiting ? 'opacity-60' : ''}`}>
      <CornerBorders />
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-700/50">Action for:</div>
            <div className="text-sm font-bold text-gray-700">
              {currentPlayer?.name || '—'}
            </div>
            {actionRequired && !isWaiting && (
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            )}
            {isWaiting && (
              <span className="text-[10px] text-gray-400 uppercase">Waiting...</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-gray-700/50">To Call:</span>
            <span className="text-sm font-bold text-gray-700">¤{isWaiting ? '—' : toCall}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onAction('fold')}
            disabled={!canDoAction('fold')}
            className="btn-brutal btn-brutal-danger w-[90px] h-9 text-xs disabled:opacity-50 flex items-center justify-center"
          >
            FOLD
          </button>
          
          {canDoAction('check') ? (
            <button 
              onClick={() => onAction('check')}
              className="btn-brutal w-[90px] h-9 text-xs flex items-center justify-center"
            >
              CHECK
            </button>
          ) : (
            <button 
              onClick={handleCall}
              disabled={!canCall}
              className="btn-brutal w-[90px] h-9 text-xs flex items-center justify-center disabled:opacity-50"
            >
              CALL {!isWaiting && `¤${Math.min(toCall, currentPlayerStack)}`}
            </button>
          )}
          
          <div className="flex items-center gap-0">
            <button 
              onClick={handleRaise}
              disabled={!canDoAction('raise')}
              className="btn-brutal btn-brutal-warning w-[90px] h-9 text-xs flex items-center justify-center disabled:opacity-50 rounded-r-none border-r-0"
            >
              RAISE
            </button>
            <div className={`relative border-2 ${canDoAction('raise') ? 'border-black' : 'border-gray-300'} bg-white h-9 w-[90px] rounded-r ${!canDoAction('raise') ? 'opacity-50' : ''}`}>
              <span className="absolute left-1 top-1/2 -translate-y-1/2 text-amber-600 text-sm font-bold pointer-events-none">¤</span>
              <input
                type="text"
                inputMode="numeric"
                value={canDoAction('raise') ? raiseInputValue : ''}
                onChange={(e) => setRaiseInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={() => setRaiseInputValue(String(getRoundedRaiseAmount()))}
                disabled={isWaiting || !canDoAction('raise')}
                className="w-full h-full pl-4 pr-1 text-sm text-right bg-transparent text-amber-700 font-bold focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>
          
          <button 
            onClick={() => onAction('all-in')}
            disabled={!canDoAction('all-in')}
            className="btn-brutal btn-brutal-success h-9 px-4 text-xs ml-auto flex items-center justify-center disabled:opacity-50"
          >
            ALL-IN {!isWaiting && currentPlayerStack > 0 && `¤${currentPlayerStack}`}
          </button>
        </div>
        
        {/* Always show slider - disabled when raise not available */}
        <div className={`mt-3 flex items-center gap-3 ${!canAffordRaise || !canDoAction('raise') ? 'opacity-40' : ''}`}>
          <span className="text-[10px] text-gray-500">¤{effectiveMinRaise || 0}</span>
          <input
            type="range"
            min={effectiveMinRaise || 0}
            max={Math.max(maxRaise, effectiveMinRaise || 1)}
            step={stakes.bigBlind}
            value={parseInt(raiseInputValue) || effectiveMinRaise || 0}
            onChange={(e) => setRaiseInputValue(e.target.value)}
            disabled={isWaiting || !canAffordRaise || !canDoAction('raise')}
            className="flex-1 h-2 bg-gray-300 rounded appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-gray-700 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:disabled:bg-gray-400"
          />
          <span className="text-[10px] text-gray-500">¤{maxRaise || 0}</span>
        </div>
      </div>
    </div>
  );
}
