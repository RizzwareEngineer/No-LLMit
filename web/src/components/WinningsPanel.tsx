"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import CornerBorders from "@/components/CornerBorders";
import LLMLogo from "@/components/LLMLogo";
import { PlayerState } from "@/lib/api";
import { fetchStats, modelSlug } from "@/lib/stats";

interface WinningsPanelProps {
  players: PlayerState[];
  handNumber: number;
}

interface Row {
  name: string;
  net: number;
  hands?: number;
}

export default function WinningsPanel({ players, handNumber }: WinningsPanelProps) {
  // Net chips and hands from /api/stats, refreshed after each hand; null falls back to this session's winnings.
  const [statsRows, setStatsRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchStats()
      .then(s => !cancelled && setStatsRows(s.models.map(m => ({ name: m.name, net: m.net_chips, hands: m.hands }))))
      .catch(() => !cancelled && setStatsRows(null));
    return () => { cancelled = true; };
  }, [handNumber]);

  const rows: Row[] = statsRows ?? players.map(p => ({ name: p.name, net: p.winnings || 0 }));

  return (
    <div 
      className="flex flex-col relative w-full bg-white flex-1 rounded overflow-hidden"
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <CornerBorders />
      <div className="flex items-start justify-between p-3 border-b border-notion">
        <div className="flex flex-col">
          <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgb(55, 53, 47)' }}>Profits & Losses</h2>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {rows.length > 0 && <Rankings rows={rows} />}
      </div>
    </div>
  );
}

function RankingItem({ row, rank }: { row: Row; rank: number }) {
  const color = row.net > 0 ? 'rgb(15, 123, 108)' : row.net < 0 ? 'rgb(200, 50, 50)' : 'rgba(55, 53, 47, 0.65)';

  return (
    <Link href={`/stats/${modelSlug(row.name)}`} className="flex flex-row items-center gap-2 p-2 px-3 hover:bg-[rgba(55,53,47,0.04)]">
      <span className="text-[12px] w-5 font-bold tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{rank}.</span>
      <LLMLogo model={row.name} size={20} />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold truncate" style={{ color: 'rgb(55, 53, 47)' }} title={row.name}>{row.name}</div>
        {row.hands !== undefined && (
          <div className="text-[11px] tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{row.hands.toLocaleString()} hands</div>
        )}
      </div>
      <div className="flex flex-row items-center gap-1 text-[12px] font-bold tabular-nums" style={{ color }}>
        {row.net > 0 && <CaretUp size={11} weight="bold" aria-hidden />}
        {row.net < 0 && <CaretDown size={11} weight="bold" aria-hidden />}
        {row.net > 0 ? '+' : row.net < 0 ? '−' : ''}¤{Math.abs(row.net).toLocaleString()}
      </div>
    </Link>
  );
}

// Sorted by net chips. motion's layout animation slides rows to their new rank; not draggable.
function Rankings({ rows }: { rows: Row[] }) {
  const ranked = [...rows].sort((a, b) => b.net - a.net);

  return (
    <ol className="flex flex-col divide-y divide-black/10">
      {ranked.map((row, index) => (
        <motion.li key={row.name} layout transition={{ duration: 0.3 }}>
          <RankingItem row={row} rank={index + 1} />
        </motion.li>
      ))}
    </ol>
  );
}
