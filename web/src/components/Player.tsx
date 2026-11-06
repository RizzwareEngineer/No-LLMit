"use client";

import Card from "@/components/Card";
import LLMLogo from "@/components/LLMLogo";
import NumberFlow from "@number-flow/react";
import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { PlayerState } from "@/lib/api";
import { HudRow, useHud } from "@/components/Hud";

interface PlayerProps {
  player: PlayerState;
  active?: boolean;
  position?: string;
  folded?: boolean;
  winAmount?: number;
  winDesc?: string;
  isThinking?: boolean;
  seatIdx?: number;
  handNumber?: number;
  dealDelays?: number[]; // seconds until each dealt card lands, when the deal is animated
  showAction?: boolean; // false once a new street starts, until this seat acts on it
  isBet?: boolean; // its RAISE opened the betting on this street, so it reads BET
}

// What the seat line says after the stack. Raises read as the total ("RAISE TO 100"), calls as
// the chips added ("CALL 49"); posted blinds read "SB 5" / "BB 10"; nothing before the seat acts.
export function seatAction(p: PlayerState, { shown, isBet, thinking }: { shown: boolean; isBet: boolean; thinking: boolean }): string {
  const n = (v?: number) => ((v ?? 0) > 0 ? ` ${v!.toLocaleString()}` : '');
  if (p.status === 'folded') return 'FOLD';
  if (p.status === 'eliminated') return 'OUT';
  if (thinking) return 'THINKING';
  if (shown && p.lastAction) {
    if (p.lastAction === 'RAISE') return `${isBet ? 'BET' : 'RAISE TO'}${n(p.lastAmount)}`;
    return `${p.lastAction}${p.lastAction === 'CHECK' ? '' : n(p.lastAmount)}`;
  }
  if (p.status === 'all-in') return 'ALL-IN';
  if (p.currentBet > 0) return `${p.position === 'SB' || p.position === 'BB' ? p.position : 'POST'}${n(p.currentBet)}`;
  return '';
}

// Position badge colors
const POSITION_COLORS: Record<string, string> = {
  'BTN': 'bg-amber-700 text-white',
  'SB': 'bg-blue-600 text-white',
  'BB': 'bg-blue-700 text-white',
  'UTG': 'bg-red-700 text-white',
  'UTG+1': 'bg-red-600 text-white',
  'MP': 'bg-orange-700 text-white',
  'MP+1': 'bg-purple-700 text-white',
  'HJ': 'bg-purple-600 text-white',
  'CO': 'bg-green-700 text-white',
};

// Full position names for tooltips
function getPositionFullName(pos: string): string {
  const names: Record<string, string> = {
    'BTN': 'Button (Dealer)',
    'SB': 'Small Blind',
    'BB': 'Big Blind',
    'UTG': 'Under The Gun',
    'UTG+1': 'Under The Gun +1',
    'MP': 'Middle Position',
    'MP+1': 'Middle Position +1',
    'HJ': 'Hijack',
    'CO': 'Cutoff',
  };
  return names[pos] || pos;
}

const GREEN = 'rgb(15, 123, 108)';
const BLUE = 'rgb(35, 131, 226)';

export default function Player({ player, active, position, folded = false, winAmount, winDesc, isThinking = false, seatIdx, handNumber = 0, dealDelays, showAction = true, isBet = false }: PlayerProps) {
  const reduce = useReducedMotion();
  const { stats, on: hudOn, followed, toggleFollow, hovered, hover } = useHud();
  const pinned = followed === player.name;
  const hudShown = hudOn || pinned || hovered === player.name;
  const hudId = useId();
  const cards = player.holeCards || [];
  const positionColor = position ? POSITION_COLORS[position] || 'bg-gray-600 text-white' : '';
  const isWinner = winAmount !== undefined && winAmount > 0;
  const action = seatAction(player, { shown: showAction, isBet, thinking: isThinking });

  // Three fixed rows: name and cards; position, stack and action; the HUD row (reserved when empty).
  return (
    <div
      data-seat={seatIdx}
      className={`relative h-full w-full flex flex-col rounded ${active ? "border-animation" : ""} ${folded && !isWinner ? "opacity-40" : ""} motion-safe:transition-[opacity,background-color] motion-safe:duration-300`}
      style={{
        boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px',
        background: isWinner ? 'rgb(237, 253, 244)' : pinned ? 'rgba(35, 131, 226, 0.08)' : '#ffffff'
      }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") hover(player.name); }} // touch taps pin instead
      // Leaving with the mouse keeps the HUD of a seat that still has keyboard focus.
      onPointerLeave={(e) => { if (e.pointerType === "mouse") hover(e.currentTarget.contains(document.activeElement) && document.activeElement?.matches(":focus-visible") ? player.name : null); }}
      onFocus={(e) => { if (e.target.matches(":focus-visible")) hover(player.name); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) hover(null); }}
      onKeyDown={(e) => { if (e.key === "Escape") hover(null); }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-pressed={pinned}
        aria-describedby={hudShown ? hudId : undefined}
        aria-label={`${player.name}, stack ${player.stack.toLocaleString()}${pinned ? ", following" : ""}`}
        onClick={() => toggleFollow(player.name)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFollow(player.name); } }}
        className="flex-1 min-h-0 flex flex-col gap-3 p-3 pb-0 cursor-pointer outline-offset-2 rounded-t overflow-hidden hover:bg-[rgba(55,53,47,0.03)]"
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <LLMLogo model={player.name} size={20} />
            <div className="text-[12px] md:text-[14px] font-semibold truncate" style={{ color: 'rgb(55, 53, 47)' }} title={player.name}>{player.name}</div>
          </div>
          {/* A folded hand slides down while the seat dims */}
          <motion.div
            data-hole
            className="flex flex-row items-center gap-1 shrink-0"
            initial={false}
            animate={{ y: folded ? 4 : 0 }}
            transition={{ duration: reduce ? 0 : 0.3 }}
          >
            {cards.length > 0 ? (
              cards.map((card, i) => (
                <Card key={`${handNumber}-${card}-${i}`} value={card} className="w-7 h-10" delay={dealDelays?.[i] ?? 0} />
              ))
            ) : (
              <>
                <Card value="" className="w-7 h-10" />
                <Card value="" className="w-7 h-10" />
              </>
            )}
          </motion.div>
        </div>

        {/* Stack, action and amount: one run of text, so one font size and one baseline. */}
        <div className="mt-auto flex flex-wrap items-baseline gap-x-1.5 min-w-0">
          {position && (
            <span
              className={`min-w-8 px-1 rounded text-[12px] leading-[18px] font-bold shrink-0 text-center ${positionColor}`}
              title={getPositionFullName(position)}
            >
              {position}
            </span>
          )}
          <span data-seat-line className="min-w-0 flex-1 max-md:basis-full truncate text-[12px] md:text-[14px] leading-5 tabular-nums" style={{ color: 'rgb(55, 53, 47)' }}>
            <b data-stack><NumberFlow value={player.stack} /></b>
            {(isWinner || action) && <span style={{ color: 'rgba(55, 53, 47, 0.65)' }}> · </span>}
            {isWinner ? (
              <span style={{ color: GREEN }}>+{winAmount.toLocaleString()} ({winDesc})</span>
            ) : (
              <span data-action className="uppercase font-medium" style={{ color: isThinking ? BLUE : undefined }}>{action}</span>
            )}
          </span>
        </div>
      </div>

      <HudRow id={hudId} stats={stats?.[player.name]} show={hudShown} />
    </div>
  );
}
