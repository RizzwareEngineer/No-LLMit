"use client";

import Card from "@/components/Card";
import LLMLogo from "@/components/LLMLogo";
import { useId, useState } from "react";
import { PlayerState } from "@/lib/api";
import { HudCard, HudLine, useHud, type CardAlign } from "@/components/Hud";

interface PlayerProps {
  player: PlayerState;
  active?: boolean;
  position?: string;
  folded?: boolean;
  winAmount?: number;
  winDesc?: string;
  isThinking?: boolean;
  cardAlign?: CardAlign;
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

export default function Player({ player, active, position, folded = false, winAmount, winDesc, isThinking = false, cardAlign = "center" }: PlayerProps) {
  const { stats, on: hudOn, followed, toggleFollow } = useHud();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const cardId = useId();
  const pinned = followed === player.name;
  const cardOpen = !hudOn && (hovered || focused || pinned);
  const cards = player.holeCards || [];
  const positionColor = position ? POSITION_COLORS[position] || 'bg-gray-600 text-white' : '';
  const isWinner = winAmount !== undefined && winAmount > 0;
  
  return (
    <div
      className="relative h-full w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
      onKeyDown={(e) => { if (e.key === "Escape") { setHovered(false); setFocused(false); } }}
    >
    <div
      role="button"
      tabIndex={0}
      aria-pressed={pinned}
      aria-describedby={hudOn ? undefined : cardId}
      aria-label={`${player.name}, stack ${player.stack.toLocaleString()}${pinned ? ", following" : ""}`}
      onClick={() => toggleFollow(player.name)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFollow(player.name); } }}
      className={`cursor-pointer outline-offset-2 overflow-hidden relative ${active ? "border-animation" : ""} h-full w-full flex flex-col ${folded && !isWinner ? "opacity-40" : ""} transition-colors rounded`}
      style={{ 
        boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px',
        background: isWinner ? 'rgb(237, 253, 244)' : pinned ? 'rgba(35, 131, 226, 0.08)' : '#ffffff'
      }}
    >
      <div 
        className="relative flex-1 flex flex-col overflow-hidden transition-colors"
        style={{ background: 'inherit' }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(55, 53, 47, 0.03)'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'inherit'}
      >
        <div className="flex flex-col lg:flex-row items-start gap-3 justify-between p-3 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            <LLMLogo model={player.name} size={20} />
            <div className="flex flex-col min-w-0">
              <div className="text-[11px] font-semibold truncate" style={{ color: 'rgb(55, 53, 47)' }} title={player.name}>{player.name}</div>
              <div className="text-[10px]" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>¤{player.stack.toLocaleString()}</div>
            </div>
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

        {hudOn && <HudLine stats={stats?.[player.name]} />}

        <div className="flex flex-col mt-auto p-3 pt-0 min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0">
            {/* Position Badge */}
            {position && (
              <div 
                className={`w-8 py-0.5 rounded text-[8px] font-bold shrink-0 text-center ${positionColor}`}
                title={getPositionFullName(position)}
              >
                {position}
              </div>
            )}
            
            {/* Winner display */}
            {isWinner ? (
              <div className="flex flex-row items-center gap-1 min-w-0">
                <span className="font-bold text-[11px] shrink-0" style={{ color: 'rgb(15, 123, 108)' }}>+¤{winAmount.toLocaleString()}</span>
                <span className="text-[11px] truncate min-w-0" style={{ color: 'rgb(15, 123, 108)' }}>({winDesc})</span>
              </div>
            ) : player.lastAction ? (
              <div className="flex flex-row items-center gap-1 min-w-0 overflow-hidden">
                <div className="text-[11px] font-mono uppercase font-bold tracking-wider shrink-0" style={{ color: 'rgb(55, 53, 47)' }}>
                  {player.lastAction}
                </div>
                {(player.lastAmount ?? 0) > 0 && (
                  <div className="flex flex-row items-center shrink-0">
                    <div className="text-[11px]" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>¤{player.lastAmount?.toLocaleString()}</div>
                  </div>
                )}
              </div>
            ) : player.currentBet > 0 ? (
              <div className="flex flex-row items-center gap-1 min-w-0 overflow-hidden">
                <div className="text-[11px] font-mono uppercase tracking-wider shrink-0" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>BET</div>
                <div className="text-[11px] shrink-0" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>¤{player.currentBet.toLocaleString()}</div>
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
        </div>
      </div>
    </div>
    <HudCard id={cardId} stats={stats?.[player.name]} loaded={stats !== null} open={cardOpen} align={cardAlign} />
    </div>
  );
}
