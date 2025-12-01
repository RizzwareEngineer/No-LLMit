"use client";

import Card from "@/components/Card";
import LLMLogo from "@/components/LLMLogo";
import { PlayerState } from "@/lib/api";

interface PlayerProps {
  player: PlayerState;
  active?: boolean;
  position?: string;
  folded?: boolean;
  winAmount?: number;
  winDesc?: string;
}

// Position badge colors
const POSITION_COLORS: Record<string, string> = {
  'BTN': 'bg-amber-500 text-white',
  'SB': 'bg-blue-500 text-white',
  'BB': 'bg-blue-600 text-white',
  'UTG': 'bg-red-500 text-white',
  'UTG+1': 'bg-red-400 text-white',
  'UTG+2': 'bg-red-300 text-white',
  'LJ': 'bg-purple-500 text-white',
  'HJ': 'bg-purple-400 text-white',
  'CO': 'bg-green-500 text-white',
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

export default function Player({ player, active, position, folded = false, winAmount, winDesc }: PlayerProps) {
  const cards = player.holeCards || [];
  const positionColor = position ? POSITION_COLORS[position] || 'bg-gray-400 text-white' : '';
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
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(55, 53, 47, 0.03)'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'inherit'}
      >
        <div className="flex flex-col lg:flex-row items-start gap-3 justify-between p-3 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            <LLMLogo model={player.name} size={20} />
            <div className="flex flex-col min-w-0">
              <div className="text-[11px] font-semibold truncate" style={{ color: 'rgb(55, 53, 47)' }}>{player.name}</div>
              <div className="text-[11px]" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>¤{player.stack.toLocaleString()}</div>
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
                <span className="text-[9px] truncate min-w-0" style={{ color: 'rgba(15, 123, 108, 0.7)' }}>({winDesc})</span>
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
                <div className="text-[11px] font-mono uppercase tracking-wider shrink-0" style={{ color: 'rgba(55, 53, 47, 0.5)' }}>BET</div>
                <div className="text-[11px] shrink-0" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>¤{player.currentBet.toLocaleString()}</div>
              </div>
            ) : (
              <div className="text-[11px] font-mono uppercase truncate" style={{ color: 'rgba(55, 53, 47, 0.35)' }}>
                {player.status === 'folded' ? 'FOLD' : 
                 player.status === 'all-in' ? 'ALL-IN' :
                 player.status === 'eliminated' ? 'OUT' : 'WAITING'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
