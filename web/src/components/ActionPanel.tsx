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
    <div 
      className={`w-[557px] h-[100px] bg-white relative rounded overflow-hidden ${isWaiting ? 'opacity-60' : ''}`}
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <CornerBorders />
      <div className="p-3 h-full flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-[11px] uppercase tracking-wider" style={{ color: 'rgba(55, 53, 47, 0.5)' }}>Action for:</div>
            <div className="text-[13px] font-semibold" style={{ color: 'rgb(55, 53, 47)' }}>
              {currentPlayer?.name || '—'}
            </div>
            {actionRequired && !isWaiting && (
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'rgb(35, 131, 226)' }} />
            )}
            {isWaiting && (
              <span className="text-[11px]" style={{ color: 'rgba(55, 53, 47, 0.4)' }}>Waiting...</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider" style={{ color: 'rgba(55, 53, 47, 0.5)' }}>To Call:</span>
            <span className="text-[13px] font-semibold" style={{ color: 'rgb(55, 53, 47)' }}>¤{isWaiting ? '—' : toCall}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => onAction('fold')}
            disabled={!canDoAction('fold')}
            className="btn-brutal-danger w-[80px] h-8 text-[11px] font-medium disabled:opacity-50 flex items-center justify-center rounded"
          >
            Fold
          </button>
          
          {canDoAction('check') ? (
            <button 
              onClick={() => onAction('check')}
              className="btn-brutal-primary w-[80px] h-8 text-[11px] font-medium flex items-center justify-center rounded"
            >
              Check
            </button>
          ) : (
            <button 
              onClick={handleCall}
              disabled={!canCall}
              className="btn-brutal-primary w-[80px] h-8 text-[11px] font-medium flex items-center justify-center disabled:opacity-50 rounded"
            >
              Call ¤{!isWaiting ? Math.min(toCall, currentPlayerStack) : '—'}
            </button>
          )}
          
          <div className="flex items-center gap-0">
            <button 
              onClick={handleRaise}
              disabled={!canDoAction('raise')}
              className="btn-brutal-warning w-[70px] h-8 text-[11px] font-medium flex items-center justify-center disabled:opacity-50 rounded-l rounded-r-none"
            >
              {currentBet === 0 ? 'Bet' : 'Raise'}
            </button>
            <div 
              className={`relative bg-white h-8 w-[70px] rounded-r ${!canDoAction('raise') ? 'opacity-50' : ''}`}
              style={{ border: '1px solid rgb(203, 145, 47)', borderLeft: 'none' }}
            >
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[11px] font-medium pointer-events-none" style={{ color: 'rgb(203, 145, 47)' }}>¤</span>
              <input
                type="text"
                inputMode="numeric"
                value={canDoAction('raise') ? raiseInputValue : ''}
                onChange={(e) => setRaiseInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={() => setRaiseInputValue(String(getRoundedRaiseAmount()))}
                disabled={isWaiting || !canDoAction('raise')}
                className="w-full h-full pl-4 pr-1 text-[11px] text-right bg-transparent font-medium focus:outline-none disabled:opacity-50"
                style={{ color: 'rgb(180, 120, 40)' }}
              />
            </div>
          </div>
          
          <button 
            onClick={() => onAction('all-in')}
            disabled={!canDoAction('all-in')}
            className="btn-brutal-success h-8 px-3 text-[11px] font-medium ml-auto flex items-center justify-center disabled:opacity-50 rounded"
          >
            All-In ¤{!isWaiting && currentPlayerStack > 0 ? currentPlayerStack : '—'}
          </button>
        </div>
        
        {/* Always show slider - disabled when raise not available */}
        <div className={`flex items-center gap-2 ${!canAffordRaise || !canDoAction('raise') ? 'opacity-40' : ''}`}>
          <span className="text-[10px]" style={{ color: 'rgba(55, 53, 47, 0.5)' }}>¤{effectiveMinRaise || 0}</span>
          <input
            type="range"
            min={effectiveMinRaise || 0}
            max={Math.max(maxRaise, effectiveMinRaise || 1)}
            step={stakes.bigBlind}
            value={parseInt(raiseInputValue) || effectiveMinRaise || 0}
            onChange={(e) => setRaiseInputValue(e.target.value)}
            disabled={isWaiting || !canAffordRaise || !canDoAction('raise')}
            className="flex-1 h-1 bg-gray-200 rounded appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-gray-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:disabled:bg-gray-300"
          />
          <span className="text-[10px]" style={{ color: 'rgba(55, 53, 47, 0.5)' }}>¤{maxRaise || 0}</span>
        </div>
      </div>
    </div>
  );
}
