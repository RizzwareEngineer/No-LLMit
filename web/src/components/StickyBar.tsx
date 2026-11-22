'use client';

import { memo, useRef, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, SpeakerHigh, SpeakerSlash, SquaresFour } from '@phosphor-icons/react';
import NumberFlow from '@number-flow/react';
import LLMLogo from '@/components/LLMLogo';
import type { DisplayState } from '@/lib/stream';
import { amountParts, formatAmount, useBigBlind } from '@/lib/amounts';
import { BLUE, MUTED, TEXT } from '@/lib/stats';
import { isDraftA } from '@/lib/layout';
import { backToOverview, useScreen } from '@/components/Section';
import SoundToggle, { UnitToggle } from '@/components/SoundToggle';
import { useFillIn } from '@/lib/boxes';
import { isSoundOn, setSoundOn, subscribeSound } from '@/lib/sound';

const ACTIONS: Record<string, string> = { FOLD: 'folds', CHECK: 'checks', CALL: 'calls', RAISE: 'raises to', BET: 'bets', ALL_IN: 'all-in' };

// What the seat to act is doing, in a few words; an amount in the unit of the Chips/BB switch (bb null: chips).
function acting(d: DisplayState | null, bb: number | null) {
  if (!d) return null;
  if (d.phase === 'revealed' && d.action) {
    const amount = d.amount > 0 && d.action !== 'FOLD' && d.action !== 'CHECK' ? ` ${formatAmount(d.amount, bb)}` : '';
    return `${ACTIONS[d.action] ?? d.action.toLowerCase()}${amount}`;
  }
  return 'thinking…';
}

// One-line bar fixed to the top once the live table has scrolled out of view: it slides down on a scroll (`slide`) and
// fades in where it sits on a load below the table. `blank`: no table state yet: the bar at its size with nothing in it.
function StickyBar({ show, slide = true, blank = false, pot, handNumber, display }: { show: boolean; slide?: boolean; blank?: boolean; pot: number; handNumber: number; display: DisplayState | null }) {
  const bb = useBigBlind(); // the Chips/BB switch, as the felt's
  const doing = acting(display, bb);
  const screen = useScreen();
  const potIn = amountParts(pot, bb);
  const detail = screen === 'race' || screen === 'stats-table' || screen === 'pairwise';
  const row = useRef<HTMLDivElement>(null);
  useFillIn(row, !blank);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          data-desk-bar
          className="fixed top-0 inset-x-0 z-40 border-b border-notion bg-white/85 backdrop-blur-md max-md:hidden"
          initial={{ y: slide ? '-100%' : 0, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-100%', opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* The page's padding, the stats column (--stage-w, page.tsx) and the cards' padding (16px from lg, at the stats' scale --sz), so the
              bar's text lines up with the card content below. */}
          <div className="px-3 lg:px-4"><div ref={row} className={`max-w-(--stage-w) mx-auto h-11 px-3 lg:px-[calc(16px*var(--sz,1))] flex items-center gap-3 text-[13px] whitespace-nowrap ${blank ? '[&>*]:invisible' : ''}`} style={{ color: TEXT }}>
            <span className="font-bold hidden sm:inline">No-LLMit</span>
            {handNumber > 0 && <span className="tabular-nums hidden sm:inline" style={{ color: MUTED }}>#{handNumber}</span>}
            <span className="tabular-nums shrink-0">
              <span style={{ color: MUTED }}>Pot </span>
              <span className="font-bold"><NumberFlow animated={!isDraftA()} locales="en-US" value={potIn.value} format={potIn.format} suffix={potIn.suffix} /></span>
            </span>
            {display && doing && (
              <div className="flex items-center gap-1.5 min-w-0">
                <LLMLogo model={display.playerName} size={16} />
                <span className="font-bold truncate">{display.playerName}</span>
                <span className="shrink-0" style={{ color: MUTED }}>{doing}</span>
              </div>
            )}
            {/* The stats screens get the switch too: Trends plays a sound on every overtake. */}
            <div className="ml-auto shrink-0"><SoundToggle /></div>
            {detail && (
              <button
                onClick={backToOverview}
                className="shrink-0 flex items-center gap-1 rounded px-2 py-1 font-medium hover:bg-[rgba(55,53,47,0.06)]"
                style={{ color: BLUE }}
              >
                <SquaresFour size={13} weight="bold" aria-hidden />
                <span className="hidden sm:inline">Back to overview</span>
                <span className="sm:hidden">Overview</span>
              </button>
            )}
            <button
              onClick={() => window.scrollTo({ top: 0 })} // smooth via scroll-behavior in globals.css
              className="shrink-0 flex items-center gap-1 rounded px-2 py-1 font-medium hover:bg-[rgba(55,53,47,0.06)]"
              style={{ color: BLUE }}
            >
              <ArrowUp size={13} weight="bold" aria-hidden />
              <span className="hidden sm:inline">Back to table</span>
              <span className="sm:hidden">Table</span>
            </button>
          </div></div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// While About's prompt is open (<html data-hold>, about/content.tsx) the bar keeps its last frame; it catches up on the next event.
export default memo(StickyBar, () => document.documentElement.hasAttribute('data-hold'));

// A switch's small button made a 44px tap target: its hit area reaches past it (a pseudo-element), its look stays.
const TAP = "[&_button]:relative [&_button]:after:absolute [&_button]:after:-inset-x-1 [&_button]:after:-inset-y-[11px] [&_button]:after:content-['']";

// Phones: one slim bar always at the top, under the notch: live and how many watch, the hand (not the pot: the table shows
// it right under the bar, owner 2026-11-15: "there's no need to repeat the pot again"), the Chips/BB and
// sound switches (the sound's as its icon alone; page.tsx starts the sound on the first gesture, since a phone does not mount
// the desktop status row), and on a stats card the way back to the overview.
export function PhoneBar({ blank = false, live, watching, handNumber, bigBlind }: { blank?: boolean; live: boolean; watching?: number; handNumber: number; pot?: number; bigBlind: number }) {
  const screen = useScreen();
  const detail = screen === 'race' || screen === 'stats-table' || screen === 'pairwise';
  const sound = useSyncExternalStore(subscribeSound, isSoundOn, () => false);
  const row = useRef<HTMLDivElement>(null);
  useFillIn(row, !blank);
  return (
    <div data-phone-bar className="md:hidden fixed top-0 inset-x-0 z-40 border-b border-notion bg-white pt-[env(safe-area-inset-top)]">
      <div ref={row} className={`h-11 px-3 flex items-center gap-3 text-[13px] whitespace-nowrap ${blank ? '[&>*]:invisible' : ''}`} style={{ color: TEXT }}>
        {/* The site's name, as the desktop header's, then the live dot and how many watch (labelled: a bare number read as nothing). */}
        <span data-brand className="font-bold">No-LLMit</span>
        <span data-watching className="flex items-center gap-1.5 tabular-nums" title={watching === undefined ? undefined : `${watching.toLocaleString('en-US')} watching`}
          aria-label={`${live ? 'Live' : 'Not live'}${watching !== undefined ? `, ${watching.toLocaleString('en-US')} watching` : ''}`} role="status">
          <span aria-hidden className="inline-block w-2 h-2 rounded-full" style={{ background: live ? 'rgb(220, 38, 38)' : MUTED }} />
          {watching !== undefined && <span aria-hidden>{watching.toLocaleString('en-US')}<span className="max-[400px]:hidden"> watching</span></span>}
        </span>
        {/* Under 360px (a laptop at 500%) the hand number gives way, so the bar never runs past the window. */}
        {handNumber > 0 && !detail && <span className="tabular-nums max-[359px]:hidden" style={{ color: MUTED }}>Hand #{handNumber}</span>}
        {detail && (
          <button onClick={backToOverview} className="shrink-0 flex items-center gap-1 rounded px-2 h-11 font-medium" style={{ color: BLUE }}>
            <SquaresFour size={13} weight="bold" aria-hidden />Overview
          </button>
        )}
        <div className="ml-auto shrink-0 flex items-center gap-1">
          {!detail && <span className={TAP}><UnitToggle bigBlind={bigBlind} /></span>}
          <button type="button" onClick={() => setSoundOn(!sound)} aria-pressed={sound} aria-label="Sound" data-sound className="flex items-center justify-center w-11 h-11 -mr-2" style={{ color: sound ? TEXT : MUTED }}>
            {sound ? <SpeakerHigh size={18} weight="bold" aria-hidden /> : <SpeakerSlash size={18} weight="bold" aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
