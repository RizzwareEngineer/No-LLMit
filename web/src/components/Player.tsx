"use client";

import Card from "@/components/Card";
import NumberFlow from '@number-flow/react';
import LLMLogo from "@/components/LLMLogo";
import { PlayerState } from "@/lib/api";

interface PlayerProps {
  player: PlayerState;
  active?: boolean;
  position?: string;
  folded?: boolean;
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

export default function Player({ player, active, position, folded = false }: PlayerProps) {
  const cards = player.holeCards || [];
  const positionColor = position ? POSITION_COLORS[position] || 'bg-gray-400 text-white' : '';
  
  return (
    <div className={`p-px bg-stone-300 overflow-hidden relative ${active ? "border-animation" : ""} h-full flex flex-col ${folded ? "opacity-40" : ""} transition-colors`}>
      <div className="relative bg-stone-50 hover:bg-stone-100 flex-1 flex flex-col">
        <div className="flex flex-col lg:flex-row items-start gap-3 justify-between p-3">
          <div className="flex items-center gap-2">
            <LLMLogo model={player.name} size={20} />
            <div className="flex flex-col">
              <div className="text-[11px] font-bold uppercase tracking-wide">{player.name}</div>
              <div className="flex flex-row items-center gap-1">
                <div className="text-sm text-gray-700">¤</div>
                <div className="text-[11px] text-gray-700/60">
                  <NumberFlow value={player.stack} />
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-row items-center gap-1">
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

        <div className="flex flex-col mt-auto p-3 pt-0">
          <div className="flex items-center gap-2">
            {/* Position Badge */}
            {position && (
              <div 
                className={`w-8 py-0.5 rounded text-[8px] font-bold shrink-0 text-center ${positionColor}`}
                title={getPositionFullName(position)}
              >
                {position}
              </div>
            )}
            
            {player.lastAction ? (
              <div className="flex flex-row items-center gap-2">
                <div className="text-[11px] text-gray-700 font-mono uppercase font-bold tracking-wider">
                  {player.lastAction}
                </div>
                {(player.lastAmount ?? 0) > 0 && (
                  <div className="flex flex-row items-center gap-1">
                    <div className="text-sm text-gray-700/60">¤</div>
                    <div className="text-[11px] text-gray-700/60">
                      <NumberFlow value={player.lastAmount ?? 0} />
                    </div>
                  </div>
                )}
              </div>
            ) : player.currentBet > 0 ? (
              <div className="flex flex-row items-center gap-2">
                <div className="text-[11px] text-gray-700/50 font-mono uppercase tracking-wider">
                  BET
                </div>
                <div className="flex flex-row items-center gap-1">
                  <div className="text-sm text-gray-700/60">¤</div>
                  <div className="text-[11px] text-gray-700/60">
                    <NumberFlow value={player.currentBet} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-gray-700/30 font-mono uppercase">
                {player.status === 'folded' ? 'FOLDED' : 
                 player.status === 'all-in' ? 'ALL-IN' :
                 player.status === 'eliminated' ? 'OUT' : 'Waiting...'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

