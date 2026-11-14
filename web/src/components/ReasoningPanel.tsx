"use client";

import LLMLogo from "@/components/LLMLogo";
import TypewriterText from "@/components/TypewriterText";
import { formatAmount, useBigBlind } from "@/lib/amounts";
import { MUTED, BLUE } from "@/lib/stats";
import type { DisplayState } from "@/lib/stream";

interface ReasoningPanelProps {
  displayState: DisplayState | null;
  shotClockRemaining: number | null; // null: no clock
  blank?: boolean; // no table state yet: the bar at its size with nothing in it
}

export default function ReasoningPanel({
  displayState,
  shotClockRemaining,
  blank = false,
}: ReasoningPanelProps) {
  const bb = useBigBlind(); // the action's amount follows the Chips/BB switch; the model's own words stay as written

  const phase = displayState?.phase;
  const playerName = displayState?.playerName || '—';
  const reason = displayState?.reason;
  const action = displayState?.action;
  const amount = displayState?.amount || 0;
  const isIdle = !displayState;
  const isThinking = phase === 'thinking';
  const isReasoning = phase === 'reasoning';
  const isRevealed = phase === 'revealed';
  const showReason = isReasoning || isRevealed;
  const showShotClock = (isThinking || isReasoning) && shotClockRemaining !== null; // Hide after action is revealed

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
  const spokenAction = action ? `${action.toLowerCase().replace('_', '-')}${amount > 0 ? ` ${formatAmount(amount, bb)}` : ''}` : '';
  const announcement = showReason && action ? `${playerName}: ${spokenAction}.${reason ? ` ${reason}` : ''}` : '';

  return (
    <div 
      className={`relative bg-white h-[100px] rounded overflow-hidden ${blank ? '[&>*]:invisible' : ''}`}
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="flex h-full">
        {/* Left section - Player name + countdown */}
        <div 
          className={`w-[200px] shrink-0 flex flex-col items-center justify-center border-r border-notion`}
          style={{ 
            background: !isIdle ? 'rgba(35, 131, 226, 0.06)' :
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
                data-clock
                className="text-[20px] leading-7 font-bold tabular-nums"
                style={{ 
                  color: (shotClockRemaining ?? 0) <= 5 ? 'rgb(235, 87, 87)' : BLUE
                }}
              >
                {shotClockRemaining ?? 0}s
              </span>
            </div>
          )}
        </div>

        {/* Right section - Thinking or Reasoning text */}
        <div className="flex-1 flex flex-col justify-center px-4 min-w-0">
          {isThinking && (
            <div className="text-sm italic flex items-center gap-2" style={{ color: MUTED }}>
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: MUTED }} />
              Thinking…
            </div>
          )}
          
          {/* The action shows even when the model gave no reason (an answer with only ACTION and AMOUNT, or the engine's fallback). */}
          {showReason && action && (
            <>
              {/* Reasoning label with action. A narrow phone puts the action (in big blinds, longer) under the label
                  rather than cutting it off. */}
              <div className="flex flex-wrap items-center gap-x-2 mb-1">
                <span className="text-[11px] uppercase tracking-wider" style={{ color: BLUE }}>Reasoning</span>
                {action && (
                  // The same look as the action on each seat: mono, uppercase, bold, the amount muted.
                  <span className="flex flex-row items-center gap-1">
                    <span className="text-[11px] uppercase font-bold tracking-wider" style={{ color: 'rgb(55, 53, 47)' }}>{action.replace('_', '-')}</span>
                    {amount > 0 && action !== 'FOLD' && action !== 'CHECK' && (
                      <span data-chips={amount} className="text-[11px] tabular-nums whitespace-nowrap" style={{ color: MUTED }}>{formatAmount(amount, bb)}</span>
                    )}
                  </span>
                )}
              </div>
              {reason && (
                <p className={`${reasonFontSize} italic line-clamp-3 leading-snug`} style={{ color: 'rgb(55, 53, 47)' }}>
                  <TypewriterText key={reason} text={reason} />
                </p>
              )}
            </>
          )}
          
          {isIdle && (
            <div className="text-[13px] italic" style={{ color: MUTED }}>
              Waiting for next action…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
