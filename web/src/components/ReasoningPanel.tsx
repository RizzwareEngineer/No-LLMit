"use client";

import { useEffect, useState } from "react";
import CornerBorders from "@/components/CornerBorders";
import TypewriterText from "@/components/TypewriterText";

type DisplayPhase = 'idle' | 'thinking' | 'reasoning' | 'revealed' | 'settling';

interface DisplayState {
  phase: DisplayPhase;
  playerIdx: number;
  playerName: string;
  reason: string | null;
  action: string | null;
  amount: number;
  phaseStartTime: number;
}

interface ReasoningPanelProps {
  displayState: DisplayState | null;
  isPaused?: boolean;
}

// Timing constants (must match useGameState)
const THINKING_DURATION = 3;        // 3s
const MIN_REASONING_DURATION = 10;  // 10s
const SETTLE_DURATION = 5;          // 5s

export default function ReasoningPanel({
  displayState,
  isPaused = false,
}: ReasoningPanelProps) {
  const [countdown, setCountdown] = useState<number | null>(null);

  // Calculate countdown based on phase
  useEffect(() => {
    if (!displayState || isPaused) {
      setCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const elapsed = Math.floor((Date.now() - displayState.phaseStartTime) / 1000);
      
      switch (displayState.phase) {
        case 'thinking':
          setCountdown(Math.max(0, THINKING_DURATION - elapsed));
          break;
        case 'reasoning':
          setCountdown(Math.max(0, MIN_REASONING_DURATION - elapsed));
          break;
        case 'revealed':
        case 'settling':
          setCountdown(Math.max(0, SETTLE_DURATION - elapsed));
          break;
        default:
          setCountdown(null);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 100);
    return () => clearInterval(interval);
  }, [displayState, isPaused]);

  // Format action for display
  const formatAction = (action: string, amount: number) => {
    const actionMap: Record<string, string> = {
      'FOLD': '🃏 Fold',
      'CHECK': '✋ Check',
      'CALL': '📞 Call',
      'RAISE': '⬆️ Raise',
      'BET': '💰 Bet',
      'ALL_IN': '🔥 All-In',
    };
    const formatted = actionMap[action] || action;
    if (amount > 0 && (action === 'RAISE' || action === 'BET' || action === 'CALL' || action === 'ALL_IN')) {
      return `${formatted} ¤${amount.toLocaleString()}`;
    }
    return formatted;
  };

  const phase = displayState?.phase || 'idle';
  const playerName = displayState?.playerName || '—';
  const reason = displayState?.reason;
  const action = displayState?.action;
  const amount = displayState?.amount || 0;
  const isIdle = !displayState || phase === 'idle';
  const showReason = phase === 'reasoning' || phase === 'revealed' || phase === 'settling';
  const showAction = phase === 'revealed' || phase === 'settling';

  // Dynamic font size based on reason length
  const getReasonFontSize = (text: string | null) => {
    if (!text) return 'text-sm';
    const len = text.length;
    if (len < 100) return 'text-sm';
    if (len < 200) return 'text-xs';
    return 'text-[11px]';
  };
  const reasonFontSize = getReasonFontSize(reason);

  return (
    <div className="relative border border-gray-300 bg-stone-50 shadow-sm h-[100px]">
      <CornerBorders />
      <div className="flex h-full">
        {/* Left section - Player name + countdown */}
        <div className={`w-[120px] shrink-0 flex flex-col items-center justify-center border-r border-gray-300 ${
          isPaused ? 'bg-amber-50' : 
          phase === 'thinking' ? 'bg-gray-100' :
          showReason && !showAction ? 'bg-blue-50' :
          showAction ? 'bg-green-50' :
          'bg-gray-50'
        }`}>
          <span className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            {isIdle ? 'Waiting' : 
             phase === 'thinking' ? 'Thinking' :
             phase === 'reasoning' ? 'Reading' :
             'Acted'}
          </span>
          <span className="text-xs font-bold text-gray-700 truncate max-w-[100px] px-2">
            {playerName}
          </span>
          
          {/* Countdown display */}
          {countdown !== null && countdown > 0 && (
            <div className="flex items-center gap-1 mt-1">
              <span className={`font-mono text-lg font-bold ${
                countdown <= 3 ? 'text-red-600' : 
                isPaused ? 'text-amber-600' : 
                phase === 'thinking' ? 'text-gray-500' :
                showAction ? 'text-green-600' :
                'text-blue-600'
              }`}>
                {countdown}s
              </span>
              {isPaused && <span className="text-amber-600 text-xs">⏸</span>}
            </div>
          )}
          
          {/* Show action in left panel when revealed */}
          {showAction && action && (
            <div className="mt-1 text-[10px] font-bold text-green-700">
              {formatAction(action, amount)}
            </div>
          )}
        </div>

        {/* Right section - Reasoning text */}
        <div className="flex-1 flex flex-col justify-center px-4 min-w-0">
          {phase === 'thinking' && (
            <div className="text-gray-500 text-sm italic flex items-center gap-2">
              <span className="inline-block w-2 h-2 bg-gray-400 rounded-full animate-pulse" />
              Thinking...
            </div>
          )}
          
          {showReason && reason && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider text-blue-500">Reasoning</span>
                {showAction && action && (
                  <span className="text-[10px] font-bold text-green-600">
                    → {formatAction(action, amount)}
                  </span>
                )}
              </div>
              <p className={`${reasonFontSize} text-gray-700 italic line-clamp-3 leading-snug`}>
                <TypewriterText text={reason} speed={15} />
              </p>
            </>
          )}
          
          {isIdle && (
            <div className="text-gray-400 text-xs italic">
              Waiting for next action...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
