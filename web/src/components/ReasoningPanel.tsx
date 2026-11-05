"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import TypewriterText from "@/components/TypewriterText";
import type { DisplayState } from "@/hooks/useGameState";

interface Decision {
  key: string;
  playerName: string;
  action: string;
  amount: number;
  reason: string;
}

interface ReasoningPanelProps {
  displayState: DisplayState | null;
  shotClockRemaining: number;
}

export default function ReasoningPanel({
  displayState,
  shotClockRemaining,
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

  // The last three decisions: the newest is typed out on top, the two before it sit below.
  const reduce = useReducedMotion();
  const [history, setHistory] = useState<Decision[]>([]);
  const currentKey = showReason && reason && action ? `${displayState?.playerIdx}|${reason}` : null;
  if (currentKey && history[0]?.key !== currentKey) {
    setHistory([{ key: currentKey, playerName, action: action!, amount, reason: reason! }, ...history].slice(0, 3));
  }
  const older = currentKey ? history.slice(1, 3) : history.slice(0, 2);
  // Full text for screen readers, announced once per action (not the typewriter partials)
  const spokenAction = action ? `${action.toLowerCase().replace('_', '-')}${amount > 0 ? ` ${amount}` : ''}` : '';
  const announcement = showReason && reason ? `${playerName}: ${spokenAction}. ${reason}` : '';

  return (
    <div 
      className="relative bg-white h-[156px] rounded overflow-hidden"
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="flex h-full">
        {/* Left section - Player name + countdown */}
        <div 
          className={`w-[120px] shrink-0 flex flex-col items-center justify-center border-r border-notion`}
          style={{ 
            background: !isIdle ? 'rgba(35, 131, 226, 0.06)' : 'rgba(55, 53, 47, 0.02)'
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
                  color: shotClockRemaining <= 5 ? 'rgb(235, 87, 87)' : 'rgb(35, 131, 226)'
                }}
              >
                {shotClockRemaining}s
              </span>
            </div>
          )}
        </div>

        {/* Right section - Thinking or Reasoning text */}
        <div className="flex-1 flex flex-col px-4 py-2 min-w-0 overflow-hidden">
        <div className="h-[84px] shrink-0 flex flex-col justify-center min-w-0">
          {isThinking && (
            <div className="text-sm italic flex items-center gap-2" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'rgba(55, 53, 47, 0.65)', animation: 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
              Thinking…
            </div>
          )}
          
          {showReason && reason && (
            <>
              {/* Reasoning label with action */}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] uppercase tracking-wider" style={{ color: 'rgb(35, 131, 226)' }}>Reasoning</span>
                {action && (
                  <span className="text-[11px] font-bold" style={{ color: 'rgb(15, 123, 108)' }}>
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
            <div className="text-xs italic" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>
              Waiting for next action…
            </div>
          )}
        </div>

        {/* Earlier decisions, smaller and fading with age */}
        <ul className="flex flex-col gap-1 min-w-0" aria-label="Earlier decisions">
          <AnimatePresence initial={false}>
            {older.map((d, i) => (
              <motion.li
                key={d.key}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: i === 0 ? 0.65 : 0.4, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.25 }}
                className="text-[11px] italic truncate"
                style={{ color: 'rgb(55, 53, 47)' }}
              >
                <span className="not-italic font-bold">{d.playerName}</span>
                <span className="not-italic" style={{ color: 'rgb(15, 123, 108)' }}> → {formatAction(d.action, d.amount)}</span>
                {' '}{d.reason}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        </div>
      </div>
    </div>
  );
}
