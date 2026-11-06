"use client";

import { motion } from "motion/react";
import LLMLogo from "@/components/LLMLogo";
import { PlayerState } from "@/lib/api";
import { StatsResponse, DASH, MUTED, chips, modelHref, netColor } from "@/lib/stats";

interface WinningsPanelProps {
  players: PlayerState[]; // the seated models
  stats: StatsResponse | null; // the live table session (/api/stats?session=<live id>), refetched after each hand
}

interface Row {
  name: string;
  net: number | null; // null: seated, no hands yet this session
}

export default function WinningsPanel({ players, stats }: WinningsPanelProps) {
  // Net chips this table session for the models seated now; until the first good session
  // response, this game's in-memory winnings. The page keeps the last good response, so the
  // source does not flip back.
  const net = new Map(stats?.models.map(m => [m.name, m.net_chips]));
  const rows: Row[] = players.map(p => ({ name: p.name, net: stats ? net.get(p.name) ?? null : p.winnings || 0 }));

  return (
    <div 
      className="flex flex-col relative w-full bg-white flex-1 rounded overflow-hidden"
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <div className="px-3 py-2 border-b border-notion">
        <h2 className="text-[14px] font-bold" style={{ color: 'rgb(55, 53, 47)' }}>Profits &amp; Losses</h2>
      </div>
      <div className="flex-1 overflow-auto">
        {/* Keyed by source: switching from this game's winnings to the session stats remounts
            the list instead of sliding every row to its new place. */}
        {rows.length > 0 && <Rankings key={stats ? 'stats' : 'game'} rows={rows} />}
      </div>
    </div>
  );
}

function RankingItem({ row, rank }: { row: Row; rank: number }) {
  const color = row.net === null ? MUTED : netColor(row.net);

  return (
    <a href={modelHref(row.name)} className="lift flex flex-row items-center gap-2 py-1.5 px-3">
      <span className="text-[13px] w-5 font-bold tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{rank}.</span>
      <LLMLogo model={row.name} size={20} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold truncate" style={{ color: 'rgb(55, 53, 47)' }} title={row.name}>{row.name}</div>
      </div>
      <div className="text-[14px] font-bold tabular-nums" style={{ color }}>
        {row.net === null ? DASH : chips(row.net)}
      </div>
    </a>
  );
}

// Sorted by net chips. motion's layout animation slides rows to their new rank; not draggable.
function Rankings({ rows }: { rows: Row[] }) {
  // Seated models with no hands yet (net null) go last.
  const ranked = [...rows].sort((a, b) =>
    a.net === null || b.net === null ? (a.net === null ? 1 : 0) - (b.net === null ? 1 : 0) : b.net - a.net);

  return (
    <ol className="flex flex-col divide-y divide-black/10">
      {ranked.map((row, index) => (
        <motion.li key={row.name} layout="position" initial={false} transition={{ duration: 0.3 }}>
          <RankingItem row={row} rank={index + 1} />
        </motion.li>
      ))}
    </ol>
  );
}
