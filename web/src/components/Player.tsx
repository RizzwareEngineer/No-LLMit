"use client";

import Card from "@/components/Card";
import FitName from "@/components/FitName";
import LLMLogo from "@/components/LLMLogo";
import { logoFile } from "@/lib/families";
import { CHIP, LOGO, type Spot, bubbleAt, chipTop, seatLabel, seatPlace, textBox } from "@/lib/phoneTable";
import { useRef, useState } from "react";
import { motion } from "motion/react";
import { PlayerState } from "@/lib/api";
import { formatAmount, useBigBlind } from "@/lib/amounts";
import { BLUE, MUTED, modelHref } from "@/lib/stats";
import { CARD_CLASS, useCardSize } from "@/lib/tableSwitches";
import { useFillIn } from "@/lib/boxes";
import { clockMs, clockShare, type Clock } from "@/lib/stream";
import { useSecondsDraw } from "@/hooks/useSecondsDraw";

const RING_R = 27, RING_C = 2 * Math.PI * RING_R; // the phone seat's shot clock ring round its logo

interface PlayerProps {
  player: PlayerState;
  active?: boolean;
  position?: string;
  winAmount?: number;
  winDesc?: string;
  isThinking?: boolean;
  showAction?: boolean; // false until the seat has acted on this street: its last action is from an earlier one
  seatIdx?: number; // where TableMotion's chips and cards fly to and from
  handNumber?: number;
  dealDelays?: number[]; // seconds until each dealt card lands, when the deal is animated
  compact?: boolean; // the phone table's seat (PokerTable), placed at `spot` (phoneTable.ts)
  spot?: Spot;
  ring?: Clock | null; // the shot clock, for the seat on the clock; null: no clock
  bubble?: string; // the action just taken, shown for a moment (phone)
  onOpen?: () => void; // phone: a tap on the logo opens its basic stats (PokerTable's SeatStats); without it, the drawer
  fillIn?: boolean; // fade in on mount (the table filling); false for a seat mounted by a layout switch mid-hand
}

// Position badge colors, for exactly the engine's names (game.PositionName)
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

// The phone seat's logo: a dark rim, the desktop seat's border drawn darker (owner 2026-11-15: "the same sort of dark
// borders that we see on the rectangles"), and its shadow. PokerTable's blank logo has the same.
// The phone's position chip: one size for every name, as the desktop badges (w-8), wide enough for UTG+1 at 11px with
// 4px a side (the audit: at 42px it had almost none).
export const LOGO_RIM = { border: '2px solid rgb(55, 53, 47)', boxShadow: 'rgba(15, 15, 15, 0.1) 0px 2px 4px' } as const;

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

export default function Player({ player, active, position, winAmount, winDesc, isThinking = false, showAction = true, seatIdx, handNumber = 0, dealDelays, compact = false, spot, ring, bubble, onOpen, fillIn = true }: PlayerProps) {
  const bb = useBigBlind();
  const cards = player.holeCards || [];
  const positionColor = position ? POSITION_COLORS[position] || 'bg-gray-600 text-white' : '';
  const folded = player.status === 'folded';
  const isWinner = winAmount !== undefined && winAmount > 0;
  const size = useCardSize();
  const cardClass = CARD_CLASS[size];
  const seatBg = isWinner ? 'rgb(237, 253, 244)' : '#ffffff';
  // A seat mounts where the blank one stood (PokerTable) when the table fills: its content fades in.
  // Not a seat mounted by a layout switch (PokerTable): it shows the table as it was. Only how it mounted counts.
  const ref = useRef<HTMLDivElement>(null);
  // The phone seat's shot clock: the share of the turn left (ring), drawn on each whole-second edge (useSecondsDraw);
  // the whole ring with no clock; red for the last 5 s.
  const arc = useRef<SVGCircleElement>(null);
  useSecondsDraw(ring ? now => clockMs(ring, now) : null, s => {
    const e = arc.current;
    if (!e) return;
    e.setAttribute('stroke-dashoffset', String(RING_C * (1 - (s === null || !ring ? 1 : clockShare(s, ring.budgetMs)))));
    e.setAttribute('stroke', s !== null && s <= 5 ? 'rgb(235, 87, 87)' : BLUE);
  }, !!ring?.running);
  const [fill] = useState(fillIn);
  useFillIn(ref, fill);

  const hole = (
    <div data-hole className="flex flex-row items-center gap-1 shrink-0">
      {cards.length > 0 ? (
        cards.map((card, i) => (
          // Face up as soon as it is dealt (owner, 2026-11-20: "just reveal as soon as cards are dealt"). Keyed by hand, so a
          // card dealt while watching shows once its flight lands.
          <motion.div
            key={`${handNumber}-${card}-${i}`}
            initial={dealDelays ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.1, delay: dealDelays?.[i] ?? 0 }}
          >
            <Card value={card} className={cardClass} />
          </motion.div>
        ))
      ) : (
        <>
          <Card value="" className={cardClass} />
          <Card value="" className={cardClass} />
        </>
      )}
    </div>
  );
  const badge = position && (
    <div
      data-position
      className={`min-w-8 px-1 text-[11px] leading-4 rounded font-bold shrink-0 text-center whitespace-nowrap ${positionColor}`}
      title={getPositionFullName(position)}
    >
      {position}
    </div>
  );
  const seatBox = `overflow-hidden relative ${active ? "border-animation" : ""} h-full w-full flex flex-col ${folded && !isWinner ? "opacity-40" : ""} transition-colors rounded`;
  const seatStyle = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px', background: seatBg };

  if (compact && spot) {
    // The phone table's seat (PokerTable): a round logo on the felt's rim with its position chip on the logo's lower
    // edge, the stack and a short label under it, the two hole cards toward the middle (phoneTable's spot). The seat on
    // the clock has the shot clock as a ring round its logo; its action shows over the logo for a moment (`bubble`). The
    // box is the seat's whole extent (the cards' flights and the peek's bounds); only what it draws takes taps.
    const place = seatPlace(spot), [ox, oy] = place.logo, logo = logoFile(player.name);
    const c = spot.cards, R = RING_R, C = RING_C, tb = textBox(spot), say = bubbleAt(spot);
    return (
      <div ref={ref} data-seat={seatIdx} className={`absolute pointer-events-none transition-opacity ${folded && !isWinner ? 'opacity-40' : ''}`} style={place.style}>
        {active && (
          // The shot clock (its arc drawn by useSecondsDraw, above).
          <svg data-clock-ring aria-hidden width={2 * R + 4} height={2 * R + 4} className="absolute -rotate-90" style={{ left: ox - R - 2, top: oy - R - 2 }}>
            <circle cx={R + 2} cy={R + 2} r={R} fill="none" stroke="rgba(31, 111, 196, 0.15)" strokeWidth={3} />
            <circle ref={arc} cx={R + 2} cy={R + 2} r={R} fill="none" strokeWidth={3} strokeLinecap="round"
              strokeDasharray={C} className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-linear" />
          </svg>
        )}
        <a data-lcp="seat-logo" href={modelHref(player.name)} aria-label={player.name} aria-haspopup={onOpen ? 'dialog' : undefined}
          onClick={e => { if (onOpen && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onOpen(); } }} className="absolute pointer-events-auto rounded-full bg-white flex items-center justify-center" style={{ left: ox - LOGO / 2, top: oy - LOGO / 2, width: LOGO, height: LOGO, ...LOGO_RIM }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo ? <img src={logo} alt="" width={28} height={28} /> : <span className="text-[13px] font-bold" style={{ color: 'rgb(55, 53, 47)' }}>{player.name.slice(0, 2).toUpperCase()}</span>}
        </a>
        {position && (
          // A tap on the chip (over the logo's lower edge) opens the seat's stats as a tap on the logo does.
          <div data-position title={getPositionFullName(position)} onClick={onOpen} className={`absolute pointer-events-auto rounded text-[11px] leading-4 font-bold whitespace-nowrap text-center ${positionColor}`}
            style={{ left: ox - CHIP.w / 2, top: oy + chipTop(spot), width: CHIP.w, height: CHIP.h, boxShadow: '0 0 0 1.5px white' }}>
            {position}
          </div>
        )}
        <div className={`absolute flex flex-col ${tb[0] > 0 ? 'items-start' : tb[2] < 0 ? 'items-end' : 'items-center'} pointer-events-auto tabular-nums whitespace-nowrap`} style={{ left: ox + tb[0], top: oy + tb[1], width: tb[2] - tb[0] }}>
          <div data-lcp="seat-stack" data-chips={player.stack} className="text-[12px] leading-[14px] font-bold" style={{ color: 'rgb(55, 53, 47)' }}>{formatAmount(player.stack, bb)}</div>
          {isWinner
            ? <div data-label data-lcp="seat-label" data-chips={winAmount} className="text-[11px] leading-[14px] font-bold" style={{ color: 'rgb(15, 123, 108)' }} aria-label={`won ${formatAmount(winAmount, bb)}, ${winDesc}`}>+{formatAmount(winAmount, bb)}</div>
            : <div data-label data-lcp="seat-label" className="text-[11px] leading-[14px]" style={{ color: MUTED }}>{seatLabel(player.name)}</div>}
        </div>
        <div className="absolute pointer-events-auto" style={{ left: ox + c[0] - 30, top: oy + c[1] - 20 }}>{hole}</div>
        {/* The action, for a moment, on the seat's side away from the middle, where its cards never are: over the logo
            for a seat in the table's top half (its cards are under it), under its stack, over its label, for one in the
            bottom half (its cards are over it). Never over its cards, logo, chip or stack (the audit: 'Raise 632' hid the
            seat's own face-up cards). */}
        {bubble && (
          <div data-bubble className={`absolute z-10 rounded-full bg-white px-2 text-[12px] leading-5 font-bold whitespace-nowrap ${say.align === 'center' ? '-translate-x-1/2' : say.align === 'right' ? '-translate-x-full' : ''} motion-safe:animate-[bubble_2s_ease-out_both]`}
            style={{ left: ox + say.x, top: oy + say.top, color: 'rgb(55, 53, 47)', boxShadow: 'rgba(15, 15, 15, 0.12) 0px 0px 0px 1px, rgba(15, 15, 15, 0.12) 0px 2px 6px' }}>
            {bubble}
          </div>
        )}
      </div>
    );
  }

  return (
    <div 
      ref={ref}
      data-seat={seatIdx}
      className={seatBox}
      style={seatStyle}
    >
      <div 
        className="relative flex-1 flex flex-col overflow-hidden transition-colors"
        style={{ background: 'inherit' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(55, 53, 47, 0.03)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'inherit'; }}
      >
        {/* Top-left, as in the original seat: logo, then the name over the stack. The name has the
            whole row because the hole cards sit bottom-right, so it fits on one line. */}
        <div className="flex items-start justify-between gap-2 p-3 pb-0 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <LLMLogo model={player.name} size={20} />
            <div className="flex flex-col min-w-0">
              <FitName name={player.name} className="text-[11px] font-bold" style={{ color: 'rgb(55, 53, 47)' }} />
              <div data-chips={player.stack} className="text-[11px] tabular-nums whitespace-nowrap" style={{ color: MUTED }}>{formatAmount(player.stack, bb)}</div>
            </div>
          </div>
          {/* Position badge, top-right */}
          {badge}
        </div>

        {/* Bottom row: the action at the left, the hole cards at the right. */}
        <div className="mt-auto flex items-end justify-between gap-2 p-3 pt-0 min-w-0">
          <div className="flex items-center gap-2 min-w-0 mb-0.5">
            {isWinner ? (
              <div className="flex flex-row items-center gap-1 min-w-0">
                <span data-chips={winAmount} className="font-bold text-[11px] shrink-0 tabular-nums" style={{ color: 'rgb(15, 123, 108)' }}>+{formatAmount(winAmount, bb)}</span>
                <span className="text-[11px] truncate min-w-0" style={{ color: 'rgb(15, 123, 108)' }}>({winDesc})</span>
              </div>
            ) : player.lastAction && showAction ? (
              <div className="flex flex-row items-center gap-1 min-w-0 overflow-hidden">
                <div data-action className="text-[11px] uppercase font-bold tracking-wider shrink-0" style={{ color: 'rgb(55, 53, 47)' }}>
                  {player.lastAction}
                </div>
                {(player.lastAmount ?? 0) > 0 && (
                  <div data-chips={player.lastAmount} className="text-[11px] shrink-0 tabular-nums" style={{ color: MUTED }}>{formatAmount(player.lastAmount ?? 0, bb)}</div>
                )}
              </div>
            ) : player.currentBet > 0 ? (
              // Chips out with no action yet: the blinds. Their amount sits in front of the seat.
              <div data-action className="text-[11px] uppercase tracking-wider truncate" style={{ color: MUTED }}>
                {position === 'SB' ? 'SMALL BLIND' : position === 'BB' ? 'BIG BLIND' : <>BET <span data-chips={player.currentBet}>{formatAmount(player.currentBet, bb)}</span></>}
              </div>
            ) : (
              <div data-action className="text-[11px] uppercase truncate" style={{ color: isThinking ? BLUE : MUTED }}>
                {player.status === 'folded' ? 'FOLD' : 
                 player.status === 'all-in' ? 'ALL-IN' :
                 player.status === 'eliminated' ? 'OUT' : 
                 isThinking ? 'THINKING' : 'WAITING'}
              </div>
            )}
          </div>
          {hole}
        </div>
      </div>
    </div>
  );
}
