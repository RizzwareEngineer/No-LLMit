"use client";

import CornerBorders from "@/components/CornerBorders";
import TypewriterText from "@/components/TypewriterText";

type DisplayPhase = 'idle' | 'waiting' | 'thinking' | 'reasoning' | 'revealed';

interface DisplayState {
  phase: DisplayPhase;
  playerIdx: number;
  playerName: string;
  reason: string | null;
  action: string | null;
  amount: number;
  turnStartTime: number;
}

interface ReasoningPanelProps {
  displayState: DisplayState | null;
  shotClockRemaining: number;
  isPaused?: boolean;
}

export default function ReasoningPanel({
  displayState,
  shotClockRemaining,
  isPaused = false,
}: ReasoningPanelProps) {

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
  const isThinking = phase === 'thinking';
  const isReasoning = phase === 'reasoning';
  const isRevealed = phase === 'revealed';
  const showReason = isReasoning || isRevealed;
  const showShotClock = isThinking || isReasoning; // Hide after action is revealed

  // Dynamic font size based on reason length
  const getReasonFontSize = (text: string | null | undefined) => {
    if (!text) return 'text-sm';
    const len = text.length;
    if (len < 100) return 'text-sm';
    if (len < 200) return 'text-xs';
    return 'text-[11px]';
  };
  const reasonFontSize = getReasonFontSize(reason);

  return (
    <div 
      className="relative bg-white h-[100px] rounded overflow-hidden"
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <CornerBorders />
      <div className="flex h-full">
        {/* Left section - Player name + countdown */}
        <div 
          className={`w-[120px] shrink-0 flex flex-col items-center justify-center border-r border-notion`}
          style={{ 
            background: isPaused ? 'rgba(203, 145, 47, 0.1)' : 
                        !isIdle ? 'rgba(35, 131, 226, 0.06)' :
                        'rgba(55, 53, 47, 0.02)'
          }}
        >
          <span className="text-xs font-bold truncate max-w-[100px] px-2" style={{ color: 'rgb(55, 53, 47)' }}>
            {playerName}
          </span>
          
          {/* Shot clock countdown - visible during thinking and reasoning only */}
          {showShotClock && (
            <div className="flex items-center gap-1 mt-1">
              <span 
                className="font-mono text-lg font-bold"
                style={{ 
                  color: shotClockRemaining <= 5 ? 'rgb(235, 87, 87)' : 
                         isPaused ? 'rgb(203, 145, 47)' : 
                         'rgb(35, 131, 226)'
                }}
              >
                {shotClockRemaining}s
              </span>
              {isPaused && <span style={{ color: 'rgb(203, 145, 47)' }} className="text-xs">⏸</span>}
            </div>
          )}
        </div>

        {/* Right section - Thinking or Reasoning text */}
        <div className="flex-1 flex flex-col justify-center px-4 min-w-0">
          {isThinking && (
            <div className="text-sm italic flex items-center gap-2" style={{ color: 'rgba(55, 53, 47, 0.5)' }}>
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: 'rgba(55, 53, 47, 0.4)' }} />
              Thinking...
            </div>
          )}
          
          {showReason && reason && (
            <>
              {/* Reasoning label with action */}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgb(35, 131, 226)' }}>Reasoning</span>
                {action && (
                  <span className="text-[10px] font-bold" style={{ color: 'rgb(15, 123, 108)' }}>
                    → {formatAction(action, amount)}
                  </span>
                )}
              </div>
              <p className={`${reasonFontSize} italic line-clamp-3 leading-snug`} style={{ color: 'rgb(55, 53, 47)' }}>
                <TypewriterText text={reason} speed={25} />
              </p>
            </>
          )}
          
          {isIdle && (
            <div className="text-xs italic" style={{ color: 'rgba(55, 53, 47, 0.4)' }}>
              Waiting for next action...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
