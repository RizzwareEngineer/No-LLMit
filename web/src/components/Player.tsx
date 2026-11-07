"use client";

import Card from "@/components/Card";
import LLMLogo from "@/components/LLMLogo";
import { useState } from "react";
import { PlayerState } from "@/lib/api";
import { DASH, ModelStats, ciHalf, pct, signed } from "@/lib/stats";

interface PlayerProps {
  player: PlayerState;
  active?: boolean;
  position?: string;
  folded?: boolean;
  winAmount?: number;
  winDesc?: string;
  isThinking?: boolean;
  stats?: ModelStats; // all-time stats, shown while the seat is hovered
}

// Position badge colors
const POSITION_COLORS: Record<string, string> = {
  'BTN': 'bg-amber-700 text-white',
  'SB': 'bg-blue-600 text-white',
  'BB': 'bg-blue-700 text-white',
  'UTG': 'bg-red-700 text-white',
  'UTG+1': 'bg-red-600 text-white',
  'UTG+2': 'bg-orange-700 text-white',
  'LJ': 'bg-purple-700 text-white',
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
    'UTG+2': 'Under The Gun +2',
    'LJ': 'Lojack',
    'HJ': 'Hijack',
    'CO': 'Cutoff',
  };
  return names[pos] || pos;
}

export default function Player({ player, active, position, folded = false, winAmount, winDesc, isThinking = false, stats }: PlayerProps) {
  const [hovered, setHovered] = useState(false);
  const cards = player.holeCards || [];
  const positionColor = position ? POSITION_COLORS[position] || 'bg-gray-600 text-white' : '';
  const isWinner = winAmount !== undefined && winAmount > 0;
  
  return (
    <div 
      className={`overflow-hidden relative ${active ? "border-animation" : ""} h-full w-full flex flex-col ${folded && !isWinner ? "opacity-40" : ""} transition-colors rounded`}
      style={{ 
        boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px',
        background: isWinner ? 'rgb(237, 253, 244)' : '#ffffff'
      }}
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
              <div className="text-[11px] font-semibold truncate" style={{ color: 'rgb(55, 53, 47)' }} title={player.name}>{player.name}</div>
              <div className="text-[10px] tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{player.stack.toLocaleString()}</div>
            </div>
          </div>
          {/* Position badge, top-right */}
          {position && (
            <div 
              className={`w-8 py-0.5 rounded text-[8px] font-bold shrink-0 text-center ${positionColor}`}
              title={getPositionFullName(position)}
            >
              {position}
            </div>
          )}
        </div>

        {/* Hover stats in the empty band between the name block and the bottom row; absolute, so the seat never changes size. */}
        {hovered && (
          <div className="absolute left-3 right-3 top-[46px] text-[11px] leading-[14px] tabular-nums whitespace-nowrap overflow-hidden" style={{ color: 'rgba(55, 53, 47, 0.65)' }} aria-hidden>
            {stats ? (
              <>
                <div><b style={{ color: 'rgb(55, 53, 47)' }}>{pct(stats.vpip).replace('%', '')}</b> VPIP · <b style={{ color: 'rgb(55, 53, 47)' }}>{pct(stats.pfr).replace('%', '')}</b> PFR · <b style={{ color: 'rgb(55, 53, 47)' }}>{stats.af === null ? DASH : stats.af.toFixed(1)}</b> AF</div>
                <div><b style={{ color: 'rgb(55, 53, 47)' }}>{signed(stats.bb100, 0)}</b> bb/100{ciHalf(stats) !== null && ` ±${ciHalf(stats)!.toFixed(0)}`} · {stats.hands.toLocaleString()} hands</div>
              </>
            ) : 'No stats yet'}
          </div>
        )}

        {/* Bottom row: the action at the left, the hole cards at the right. */}
        <div className="mt-auto flex items-end justify-between gap-2 p-3 pt-0 min-w-0">
          <div className="flex items-center gap-2 min-w-0 mb-0.5">
            {isWinner ? (
              <div className="flex flex-row items-center gap-1 min-w-0">
                <span className="font-bold text-[11px] shrink-0" style={{ color: 'rgb(15, 123, 108)' }}>+{winAmount.toLocaleString()}</span>
                <span className="text-[11px] truncate min-w-0" style={{ color: 'rgb(15, 123, 108)' }}>({winDesc})</span>
              </div>
            ) : player.lastAction ? (
              <div className="flex flex-row items-center gap-1 min-w-0 overflow-hidden">
                <div className="text-[11px] font-mono uppercase font-bold tracking-wider shrink-0" style={{ color: 'rgb(55, 53, 47)' }}>
                  {player.lastAction}
                </div>
                {(player.lastAmount ?? 0) > 0 && (
                  <div className="text-[11px] shrink-0 tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{player.lastAmount?.toLocaleString()}</div>
                )}
              </div>
            ) : player.currentBet > 0 ? (
              // Chips out with no action yet: the blinds. Their amount sits in front of the seat.
              <div className="text-[11px] font-mono uppercase tracking-wider truncate" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>
                {position === 'SB' ? 'SMALL BLIND' : position === 'BB' ? 'BIG BLIND' : `BET ${player.currentBet.toLocaleString()}`}
              </div>
            ) : (
              <div className="text-[11px] font-mono uppercase truncate" style={{ color: isThinking ? 'rgb(35, 131, 226)' : 'rgba(55, 53, 47, 0.65)' }}>
                {player.status === 'folded' ? 'FOLD' : 
                 player.status === 'all-in' ? 'ALL-IN' :
                 player.status === 'eliminated' ? 'OUT' : 
                 isThinking ? 'THINKING' : 'WAITING'}
              </div>
            )}
          </div>
          <div className="flex flex-row items-center gap-1 shrink-0">
            {cards.length > 0 ? (
              cards.map((card, i) => (
                <Card key={`${card}-${i}`} value={card} className="w-7 h-10" />
              ))
            ) : (
              <>
                <Card value="" className="w-7 h-10" />
                <Card value="" className="w-7 h-10" />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
