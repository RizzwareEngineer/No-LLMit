"use client";

import { motion } from "motion/react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import LLMLogo from "@/components/LLMLogo";
import { PlayerState } from "@/lib/api";
import { formatAmount, useBigBlind } from "@/lib/amounts";
import { useRememberedBox } from "@/lib/boxes";
import { MUTED } from "@/lib/stats";

interface WinningsPanelProps {
  players: PlayerState[];
}

export default function WinningsPanel({ players }: WinningsPanelProps) {
  const bb = useBigBlind();
  // No state yet: a blank box at its size (a phone's is as tall as its rows: remembered).
  const [box, size, attrs] = useRememberedBox<HTMLDivElement>('pnl', players.length > 0);
  return (
    <div 
      ref={box}
      {...attrs}
      className={`flex flex-col relative w-full bg-white flex-1 rounded overflow-hidden ${players.length ? '' : '[&>*]:invisible'}`}
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px', ...size }}
    >
      <div className="flex items-start justify-between p-3 border-b border-notion">
        <div className="flex flex-col">
          <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgb(55, 53, 47)' }}>Profits & Losses</h2>
        </div>
        {/* In big blinds the column's unit sits here, so the rows stay as narrow as in chips and no name is cut shorter. */}
        {bb && <span data-unit className="text-xs font-bold uppercase tracking-wider" style={{ color: MUTED }}>BB</span>}
      </div>
      <div className="flex-1 overflow-auto">
        {players.length > 0 && <Rankings players={players} />}
      </div>
    </div>
  );
}

function RankingItem({ player, rank }: { player: PlayerState; rank: number }) {
  const bb = useBigBlind();
  const winnings = player.winnings || 0;
  const color = winnings > 0 ? 'rgb(15, 123, 108)' : winnings < 0 ? 'rgb(200, 50, 50)' : MUTED;

  return (
    <div className="flex flex-row items-center gap-2 p-2 px-3">
      <span className="text-[13px] w-5 font-bold tabular-nums" style={{ color: MUTED }}>{rank}.</span>
      <LLMLogo model={player.name} size={20} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold truncate" style={{ color: 'rgb(55, 53, 47)' }} title={player.name}>{player.name}</div>
      </div>
      <div className="flex flex-row items-center gap-1 text-[13px] font-bold tabular-nums" style={{ color }}>
        {winnings > 0 && <CaretUp size={11} weight="bold" aria-hidden />}
        {winnings < 0 && <CaretDown size={11} weight="bold" aria-hidden />}
        <span data-chips={Math.abs(winnings)}>{winnings > 0 ? '+' : winnings < 0 ? '−' : ''}{formatAmount(Math.abs(winnings), bb, false)}</span>
      </div>
    </div>
  );
}

// Sorted by winnings. motion's layout animation slides rows to their new rank; not draggable.
function Rankings({ players }: { players: PlayerState[] }) {
  const ranked = [...players].sort((a, b) => (b.winnings || 0) - (a.winnings || 0));

  return (
    <ol className="flex flex-col divide-y divide-black/10">
      {ranked.map((player, index) => (
        <motion.li key={player.id} layout transition={{ duration: 0.3 }}>
          <RankingItem player={player} rank={index + 1} />
        </motion.li>
      ))}
    </ol>
  );
}
