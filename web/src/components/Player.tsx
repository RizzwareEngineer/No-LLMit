"use client";

import Card from "@/components/Card";
import HoleCard from "@/components/HoleCard";
import LLMLogo from "@/components/LLMLogo";
import { logoFile } from "@/lib/families";
import { LOGO, type Spot, seatLabel, seatPlace } from "@/lib/phoneTable";
import { useRef, useState } from "react";
import { motion } from "motion/react";
import { PlayerState } from "@/lib/api";
import { formatAmount, useBigBlind } from "@/lib/amounts";
import { BLUE, DASH, MUTED, ModelStats, ciHalf, modelHref, pct, signed } from "@/lib/stats";
import { CARD_CLASS, CARD_SIZES, useCardSize } from "@/lib/tableSwitches";
import { useFillIn } from "@/lib/boxes";

interface PlayerProps {
  player: PlayerState;
  active?: boolean;
  position?: string;
  winAmount?: number;
  winDesc?: string;
  isThinking?: boolean;
  stats?: ModelStats; // all-time stats, shown while the seat is hovered
  showAction?: boolean; // false until the seat has acted on this street: its last action is from an earlier one
  seatIdx?: number; // where TableMotion's chips and cards fly to and from
  handNumber?: number;
  dealDelays?: number[]; // seconds until each dealt card lands, when the deal is animated
  faceUp?: boolean; // the hole cards show their faces: the seat's turn has come this hand, or the hand is over
  peek?: boolean; // they turn up by the peek (HoleCard): the seat's turn; otherwise (the hand's end) they just turn over
  compact?: boolean; // the phone table's seat (PokerTable), placed at `spot` (phoneTable.ts)
  spot?: Spot;
  ring?: { left: number; urgent: boolean } | null; // the shot clock's share left, for the seat on the clock; null: no clock
  bubble?: string; // the action just taken, shown for a moment (phone)
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

export default function Player({ player, active, position, winAmount, winDesc, isThinking = false, stats, showAction = true, seatIdx, handNumber = 0, dealDelays, faceUp = true, peek = false, compact = false, spot, ring, bubble }: PlayerProps) {
  const [hovered, setHovered] = useState(false);
  const bb = useBigBlind();
  const cards = player.holeCards || [];
  const positionColor = position ? POSITION_COLORS[position] || 'bg-gray-600 text-white' : '';
  const folded = player.status === 'folded';
  const isWinner = winAmount !== undefined && winAmount > 0;
  const size = useCardSize();
  const cardClass = CARD_CLASS[size];
  // The hand whose dealt cards have both landed: until then they stay face down, so the first seat to act (its turn
  // comes during the deal) peeks once its cards are in place, not unseen in flight.
  const [landed, setLanded] = useState(0);
  const up = faceUp && (!dealDelays || landed === handNumber);
  const seatBg = isWinner ? 'rgb(237, 253, 244)' : '#ffffff';
  // A picked bigger size reaches up into the hover band: its lines then sit on the hovered seat's colour, above the cards.
  const bandLine = size ? { background: `linear-gradient(rgba(55, 53, 47, 0.03), rgba(55, 53, 47, 0.03)), ${seatBg}` } : undefined;
  // A seat mounts where the blank one stood (PokerTable) when the table fills: its content fades in.
  const ref = useRef<HTMLDivElement>(null);
  useFillIn(ref, true);

  const hole = (
    <div data-hole className="flex flex-row items-center gap-1 shrink-0">
      {cards.length > 0 ? (
        cards.map((card, i) => (
          // Keyed by hand, so a card dealt while watching waits for its flight to land.
          <motion.div
            key={`${handNumber}-${card}-${i}`}
            initial={dealDelays ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.1, delay: dealDelays?.[i] ?? 0 }}
          >
            <HoleCard value={card} faceUp={up} peek={peek} slot={i ? 1 : 0} w={CARD_SIZES[size].w} hand={handNumber} seat={seatIdx} settle={dealDelays?.[i]} onLanded={i ? () => setLanded(handNumber) : undefined} className={cardClass} />
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
      className={`w-8 py-0.5 text-[8px] rounded font-bold shrink-0 text-center ${positionColor}`}
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
    const c = spot.cards, R = 27, C = 2 * Math.PI * R;
    return (
      <div ref={ref} data-seat={seatIdx} className={`absolute pointer-events-none transition-opacity ${folded && !isWinner ? 'opacity-40' : ''}`} style={place.style}>
        {active && (
          // The shot clock: the share of the turn left (ring), the whole ring with no clock; red for the last 5 s.
          <svg data-clock-ring aria-hidden width={2 * R + 4} height={2 * R + 4} className="absolute -rotate-90" style={{ left: ox - R - 2, top: oy - R - 2 }}>
            <circle cx={R + 2} cy={R + 2} r={R} fill="none" stroke="rgba(31, 111, 196, 0.15)" strokeWidth={3} />
            <circle cx={R + 2} cy={R + 2} r={R} fill="none" stroke={ring?.urgent ? 'rgb(235, 87, 87)' : BLUE} strokeWidth={3} strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - (ring?.left ?? 1))} className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-linear" />
          </svg>
        )}
        <a href={modelHref(player.name)} aria-label={player.name} className="absolute pointer-events-auto rounded-full bg-white flex items-center justify-center" style={{ left: ox - LOGO / 2, top: oy - LOGO / 2, width: LOGO, height: LOGO, boxShadow: 'rgba(15, 15, 15, 0.12) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo ? <img src={logo} alt="" width={28} height={28} /> : <span className="text-[13px] font-bold" style={{ color: 'rgb(55, 53, 47)' }}>{player.name.slice(0, 2).toUpperCase()}</span>}
        </a>
        {position && (
          <div data-position title={getPositionFullName(position)} className={`absolute pointer-events-auto -translate-x-1/2 rounded px-1 text-[11px] leading-4 font-bold whitespace-nowrap ${positionColor}`}
            style={{ left: ox, top: oy + 11, boxShadow: '0 0 0 1.5px white' }}>
            {position}
          </div>
        )}
        <div className="absolute flex flex-col items-center pointer-events-auto tabular-nums whitespace-nowrap" style={{ left: ox - 28, top: oy + LOGO / 2 + 4, width: 56 }}>
          <div data-chips={player.stack} className="text-[12px] leading-[14px] font-bold" style={{ color: 'rgb(55, 53, 47)' }}>{formatAmount(player.stack, bb)}</div>
          {isWinner
            ? <div data-label data-chips={winAmount} className="text-[11px] leading-[14px] font-bold" style={{ color: 'rgb(15, 123, 108)' }} aria-label={`won ${formatAmount(winAmount, bb)}, ${winDesc}`}>+{formatAmount(winAmount, bb)}</div>
            : <div data-label className="text-[11px] leading-[14px]" style={{ color: MUTED }}>{seatLabel(player.name)}</div>}
        </div>
        <div className="absolute pointer-events-auto" style={{ left: ox + c[0] - 30, top: oy + c[1] - 20 }}>{hole}</div>
        {bubble && (
          <div data-bubble className="absolute z-10 rounded-full bg-white px-2 text-[12px] leading-5 font-bold whitespace-nowrap -translate-x-1/2 motion-safe:animate-[bubble_2s_ease-out_both]"
            style={{ left: ox, top: oy - LOGO / 2 - 14, color: 'rgb(55, 53, 47)', boxShadow: 'rgba(15, 15, 15, 0.12) 0px 0px 0px 1px, rgba(15, 15, 15, 0.12) 0px 2px 6px' }}>
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
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(55, 53, 47, 0.03)'; setHovered(true); }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'inherit'; setHovered(false); }}
      >
        {/* Top-left, as in the original seat: logo, then the name over the stack. The name has the
            whole row because the hole cards sit bottom-right, so it fits on one line. */}
        <div className="flex items-start justify-between gap-2 p-3 pb-0 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <LLMLogo model={player.name} size={20} />
            <div className="flex flex-col min-w-0">
              <div className="text-[11px] font-bold truncate" style={{ color: 'rgb(55, 53, 47)' }} title={player.name}>{player.name}</div>
              <div data-chips={player.stack} className="text-[11px] tabular-nums whitespace-nowrap" style={{ color: MUTED }}>{formatAmount(player.stack, bb)}</div>
            </div>
          </div>
          {/* Position badge, top-right */}
          {badge}
        </div>

        {/* Hover stats in the empty band between the name block and the bottom row; absolute, so the seat never changes size. */}
        {hovered && (
          <div className={`absolute left-3 right-3 top-[46px] ${size ? 'z-10 [&>*]:w-fit' : ''} text-[11px] leading-[14px] tabular-nums whitespace-nowrap overflow-hidden`} style={{ color: MUTED }} aria-hidden>
            {stats ? (
              <>
                <div style={bandLine}><b style={{ color: 'rgb(55, 53, 47)' }}>{pct(stats.vpip).replace('%', '')}</b> VPIP · <b style={{ color: 'rgb(55, 53, 47)' }}>{pct(stats.pfr).replace('%', '')}</b> PFR · <b style={{ color: 'rgb(55, 53, 47)' }}>{stats.af === null ? DASH : stats.af.toFixed(1)}</b> AF</div>
                <div style={bandLine}><b style={{ color: 'rgb(55, 53, 47)' }}>{signed(stats.bb100, 0)}</b> bb/100{ciHalf(stats) !== null && ` ±${ciHalf(stats)!.toFixed(0)}`} · {stats.hands.toLocaleString()} hands</div>
              </>
            ) : 'No stats yet'}
          </div>
        )}

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
