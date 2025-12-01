"use client";

import { useState, useEffect } from "react";
import { Reorder } from "motion/react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import CornerBorders from "@/components/CornerBorders";
import LLMLogo from "@/components/LLMLogo";
import { PlayerState } from "@/lib/api";

interface WinningsPanelProps {
  players: PlayerState[];
}

export default function WinningsPanel({ players }: WinningsPanelProps) {
  return (
    <div 
      className="flex flex-col relative w-[240px] shrink-0 bg-white flex-1 rounded overflow-hidden"
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <CornerBorders />
      <div className="flex items-start justify-between p-3 border-b border-notion">
        <div className="flex flex-col">
          <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgb(55, 53, 47)' }}>Profits & Losses</h2>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {players.length > 0 && <Rankings players={players} />}
      </div>
    </div>
  );
}

function RankingItem({ player, rank }: { player: PlayerState; rank: number }) {
  const winnings = player.winnings || 0;
  
  return (
    <div 
      className="flex flex-row items-center gap-2 p-2 px-3 transition-colors"
      style={{ background: 'transparent' }}
      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(55, 53, 47, 0.03)'}
      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      <span className="text-[10px] w-4 font-bold" style={{ color: 'rgba(55, 53, 47, 0.35)' }}>{rank}.</span>
      <LLMLogo model={player.name} size={20} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wide truncate" style={{ color: 'rgb(55, 53, 47)' }}>{player.name}</div>
      </div>
      <div className="flex flex-row items-center gap-1">
        {winnings > 0 && (
          <>
            <CaretUp size={10} style={{ color: 'rgb(15, 123, 108)' }} weight="bold" />
            <div className="text-[10px] font-bold" style={{ color: 'rgb(15, 123, 108)' }}>
              +{winnings}
            </div>
          </>
        )}
        {winnings < 0 && (
          <>
            <CaretDown size={10} style={{ color: 'rgb(235, 87, 87)' }} weight="bold" />
            <div className="text-[10px] font-bold" style={{ color: 'rgb(235, 87, 87)' }}>
              {winnings}
            </div>
          </>
        )}
        {winnings === 0 && (
          <div className="text-[10px] font-bold" style={{ color: 'rgba(55, 53, 47, 0.35)' }}>0</div>
        )}
      </div>
    </div>
  );
}

function Rankings({ players }: { players: PlayerState[] }) {
  const [rankedPlayers, setRankedPlayers] = useState<PlayerState[]>([]);

  useEffect(() => {
    setRankedPlayers([...players].sort((a, b) => (b.winnings || 0) - (a.winnings || 0)));
  }, [players]);

  if (rankedPlayers.length === 0) return null;

  return (
    <Reorder.Group 
      as="ol" 
      axis="y" 
      values={rankedPlayers} 
      onReorder={setRankedPlayers} 
      className="flex flex-col divide-y divide-black/10"
    >
      {rankedPlayers.map((player, index) => (
        <Reorder.Item key={player.id} value={player}>
          <RankingItem player={player} rank={index + 1} />
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}
