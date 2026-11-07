"use client";

import CornerBorders from "@/components/CornerBorders";
import LLMLogo from "@/components/LLMLogo";
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
  // Full text for screen readers, announced once per action (not the typewriter partials)
  const spokenAction = action ? `${action.toLowerCase().replace('_', '-')}${amount > 0 ? ` ${amount}` : ''}` : '';
  const announcement = showReason && reason ? `${playerName}: ${spokenAction}. ${reason}` : '';

  return (
    <div 
      className="relative bg-white h-[100px] rounded overflow-hidden"
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <CornerBorders />
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="flex h-full">
        {/* Left section - Player name + countdown */}
        <div 
          className={`w-[200px] shrink-0 flex flex-col items-center justify-center border-r border-notion`}
          style={{ 
            background: isPaused ? 'rgba(203, 145, 47, 0.1)' : 
                        !isIdle ? 'rgba(35, 131, 226, 0.06)' :
                        'rgba(55, 53, 47, 0.02)'
          }}
        >
          <div className="flex items-center justify-center gap-2 w-full px-2">
            {!isIdle && <LLMLogo model={playerName} size={18} />}
            <span className="text-sm font-bold truncate" style={{ color: 'rgb(55, 53, 47)' }}>{playerName}</span>
          </div>
          
          {/* Shot clock countdown - visible during thinking and reasoning only. Its line is always
              reserved, so the name does not jump when the clock goes. */}
          {(
            <div className={`flex items-center gap-1 mt-1 ${showShotClock ? '' : 'invisible'}`}>
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
            <div className="text-sm italic flex items-center gap-2" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: 'rgba(55, 53, 47, 0.65)' }} />
              Thinking…
            </div>
          )}
          
          {showReason && reason && (
            <>
              {/* Reasoning label with action */}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] uppercase tracking-wider" style={{ color: 'rgb(35, 131, 226)' }}>Reasoning</span>
                {action && (
                  // The same look as the action on each seat: mono, uppercase, bold, the amount muted.
                  <span className="flex flex-row items-center gap-1">
                    <span className="text-[11px] font-mono uppercase font-bold tracking-wider" style={{ color: 'rgb(55, 53, 47)' }}>{action.replace('_', '-')}</span>
                    {amount > 0 && action !== 'FOLD' && action !== 'CHECK' && (
                      <span className="text-[11px] tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{amount.toLocaleString()}</span>
                    )}
                  </span>
                )}
              </div>
              <p className={`${reasonFontSize} italic line-clamp-3 leading-snug`} style={{ color: 'rgb(55, 53, 47)' }}>
                <TypewriterText text={reason} speed={25} />
              </p>
            </>
          )}
          
          {isIdle && (
            <div className="text-xs italic" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>
              Waiting for next action…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
