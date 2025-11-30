"use client";

import { useState, useEffect } from "react";
import { Reorder } from "motion/react";
import { CaretDown, CaretUp, EyeSlash } from "@phosphor-icons/react";
import CornerBorders from "@/components/CornerBorders";
import LLMLogo from "@/components/LLMLogo";
import { PlayerState } from "@/lib/api";

interface WinningsPanelProps {
  players: PlayerState[];
  onHide: () => void;
}

export default function WinningsPanel({ players, onHide }: WinningsPanelProps) {
  return (
    <div className="flex flex-col border border-gray-300 relative w-[240px] shrink-0 bg-stone-50 shadow-sm flex-1">
      <CornerBorders />
      <div className="flex items-start justify-between p-3 border-b border-gray-700/20">
        <div className="flex flex-col">
          <h2 className="text-xs font-bold uppercase tracking-wider">Winnings</h2>
          <p className="text-[10px] text-gray-700/50">How the models are doing</p>
        </div>
        <button 
          onClick={onHide}
          className="text-gray-400 hover:text-gray-700 transition-colors p-1"
          title="Hide winnings"
        >
          <EyeSlash size={16} weight="bold" />
        </button>
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
    <div className="flex flex-row items-center gap-2 p-2 px-3 hover:bg-gray-700/5">
      <span className="text-[10px] text-gray-700/30 w-4 font-bold">{rank}.</span>
      <LLMLogo model={player.name} size={20} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wide truncate">{player.name}</div>
      </div>
      <div className="flex flex-row items-center gap-1">
        {winnings > 0 && (
          <>
            <CaretUp size={10} className="text-green-600" weight="bold" />
            <div className="text-[10px] text-green-600 font-bold">
              +{winnings}
            </div>
          </>
        )}
        {winnings < 0 && (
          <>
            <CaretDown size={10} className="text-[#ff0000]" weight="bold" />
            <div className="text-[10px] text-[#ff0000] font-bold">
              {winnings}
            </div>
          </>
        )}
        {winnings === 0 && (
          <div className="text-[10px] text-gray-700/30 font-bold">0</div>
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

