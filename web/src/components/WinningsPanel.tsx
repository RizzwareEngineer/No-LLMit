"use client";

import { motion } from "motion/react";
import LLMLogo from "@/components/LLMLogo";
import { PlayerState } from "@/lib/api";
import { StatsResponse, DASH, MUTED, chips, modelHref, netColor } from "@/lib/stats";

interface WinningsPanelProps {
  players: PlayerState[];
  stats: StatsResponse | null; // all-time, refetched by the page after each hand
  seated?: string[]; // who is at the table now: stats.seated, else the live session's models
}

interface Row {
  name: string;
  net: number | null; // null: seated, no hands yet
}

export default function WinningsPanel({ players, stats, seated }: WinningsPanelProps) {
  // All-time net chips from /api/stats for the models seated now (a seat with no hands yet shows
  // a dash); until the first good response the panel shows this game's in-memory winnings.
  // The page keeps the last good response, so the source does not flip.
  const net = new Map(stats?.models.map(m => [m.name, m.net_chips]));
  const statsRows: Row[] | null = stats && seated
    ? seated.map(name => ({ name, net: net.get(name) ?? null }))
    : null;

  const rows: Row[] = statsRows ?? players.map(p => ({ name: p.name, net: p.winnings || 0 }));

  return (
    <div 
      className="flex flex-col relative w-full bg-white flex-1 rounded overflow-hidden"
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <div className="flex items-start justify-between p-3 border-b border-notion">
        <div className="flex flex-col">
          <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgb(55, 53, 47)' }}>Profits & Losses · chips</h2>
          <span className="text-[11px]" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{statsRows ? 'All-time' : 'This game'}</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {/* Keyed by source: switching from this game's winnings to all-time stats remounts
            the list instead of sliding every row to its new place. */}
        {rows.length > 0 && <Rankings key={statsRows ? 'stats' : 'game'} rows={rows} />}
      </div>
    </div>
  );
}

function RankingItem({ row, rank }: { row: Row; rank: number }) {
  const color = row.net === null ? MUTED : netColor(row.net);

  return (
    <a href={modelHref(row.name)} className="lift flex flex-row items-center gap-2 p-2 px-3">
      <span className="text-[12px] w-5 font-bold tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{rank}.</span>
      <LLMLogo model={row.name} size={20} />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold truncate" style={{ color: 'rgb(55, 53, 47)' }} title={row.name}>{row.name}</div>
      </div>
      <div className="text-[13px] font-bold tabular-nums" style={{ color }}>
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
