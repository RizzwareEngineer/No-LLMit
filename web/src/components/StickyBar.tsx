'use client';

import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp } from '@phosphor-icons/react';
import NumberFlow from '@number-flow/react';
import LLMLogo from '@/components/LLMLogo';
import type { DisplayState } from '@/hooks/useGameState';
import { MUTED, TEXT } from '@/lib/stats';

const ACTIONS: Record<string, string> = { FOLD: 'folds', CHECK: 'checks', CALL: 'calls', RAISE: 'raises to', BET: 'bets', ALL_IN: 'all-in' };

// What the seat to act is doing, in a few words.
function acting(d: DisplayState | null) {
  if (!d || d.phase === 'idle' || d.phase === 'waiting') return null;
  if (d.phase === 'revealed' && d.action) {
    const amount = d.amount > 0 && d.action !== 'FOLD' && d.action !== 'CHECK' ? ` ¤${d.amount.toLocaleString()}` : '';
    return `${ACTIONS[d.action] ?? d.action.toLowerCase()}${amount}`;
  }
  return 'thinking…';
}

// One-line bar fixed to the top once the live table has scrolled out of view.
export default function StickyBar({ show, pot, handNumber, display }: { show: boolean; pot: number; handNumber: number; display: DisplayState | null }) {
  const doing = acting(display);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed top-0 inset-x-0 z-40 border-b border-notion bg-white/85 backdrop-blur-md"
          initial={{ y: '-100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-100%', opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="max-w-[1300px] mx-auto h-11 px-4 flex items-center gap-3 text-[13px] whitespace-nowrap" style={{ color: TEXT }}>
            <span className="font-bold hidden sm:inline">No-LLMit</span>
            {handNumber > 0 && <span className="tabular-nums hidden sm:inline" style={{ color: MUTED }}>#{handNumber}</span>}
            <span className="tabular-nums shrink-0">
              <span style={{ color: MUTED }}>Pot </span>
              <span className="font-bold">¤<NumberFlow value={pot} /></span>
            </span>
            {display && doing && (
              <div className="flex items-center gap-1.5 min-w-0">
                <LLMLogo model={display.playerName} size={16} />
                <span className="font-bold truncate">{display.playerName}</span>
                <span className="shrink-0" style={{ color: MUTED }}>{doing}</span>
              </div>
            )}
            <button
              onClick={() => window.scrollTo({ top: 0 })} // smooth via scroll-behavior in globals.css
              className="ml-auto shrink-0 flex items-center gap-1 rounded px-2 py-1 font-medium hover:bg-[rgba(55,53,47,0.06)]"
              style={{ color: 'rgb(35, 131, 226)' }}
            >
              <ArrowUp size={13} weight="bold" aria-hidden />
              <span className="hidden sm:inline">Back to table</span>
              <span className="sm:hidden">Table</span>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
