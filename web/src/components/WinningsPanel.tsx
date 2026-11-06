"use client";

import { motion } from "motion/react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import LLMLogo from "@/components/LLMLogo";
import { PlayerState } from "@/lib/api";
import { MUTED, NOT_SEATED, NOT_SEATED_HINT, StatsResponse, chips, modelHref, netColor, unseated } from "@/lib/stats";

interface WinningsPanelProps {
  players: PlayerState[];
  stats: StatsResponse | null; // all-time, refetched by the page after each hand
}

interface Row {
  name: string;
  net: number;
}

export default function WinningsPanel({ players, stats }: WinningsPanelProps) {
  // All-time net chips from /api/stats; until the first good response the panel shows this
  // game's in-memory winnings. The page keeps the last good response, so the source does not flip.
  const statsRows: Row[] | null = stats?.models.map(m => ({ name: m.name, net: m.net_chips })) ?? null;

  const rows: Row[] = statsRows ?? players.map(p => ({ name: p.name, net: p.winnings || 0 }));

  return (
    <div 
      className="flex flex-col relative w-full bg-white flex-1 rounded overflow-hidden"
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <div className="flex items-start justify-between p-3 border-b border-notion">
        <div className="flex flex-col">
          <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgb(55, 53, 47)' }}>Profits & Losses</h2>
          <span className="text-[11px]" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{statsRows ? 'All-time' : 'This game'}</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {/* Keyed by source: switching from this game's winnings to all-time stats remounts
            the list instead of sliding every row to its new place. */}
        {rows.length > 0 && <Rankings key={statsRows ? 'stats' : 'game'} rows={rows} />}
        {statsRows && <NotSeated names={unseated(statsRows)} />}
      </div>
    </div>
  );
}

function RankingItem({ row, rank }: { row: Row; rank: number }) {
  const color = netColor(row.net);

  return (
    <a href={modelHref(row.name)} className="lift flex flex-row items-center gap-2 p-2 px-3">
      <span className="text-[12px] w-5 font-bold tabular-nums" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>{rank}.</span>
      <LLMLogo model={row.name} size={20} />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold truncate" style={{ color: 'rgb(55, 53, 47)' }} title={row.name}>{row.name}</div>
      </div>
      <div className="flex flex-row items-center gap-1 text-[12px] font-bold tabular-nums" style={{ color }}>
        {row.net > 0 && <CaretUp size={11} weight="bold" aria-hidden />}
        {row.net < 0 && <CaretDown size={11} weight="bold" aria-hidden />}
        {chips(row.net)}
      </div>
    </a>
  );
}

// Roster models with no hands yet, muted and without numbers, below the ranking.
function NotSeated({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="border-t border-notion" style={{ color: MUTED }}>
      <h3 className="px-3 pt-3 pb-1 text-[11px] font-medium" title={NOT_SEATED_HINT}>
        {NOT_SEATED} <span className="sr-only">: {NOT_SEATED_HINT}</span>
      </h3>
      <ul className="flex flex-col">
        {names.map(name => (
          <li key={name} className="flex flex-row items-center gap-2 p-2 px-3 opacity-60" title={NOT_SEATED_HINT}>
            <span className="w-5" aria-hidden />
            <LLMLogo model={name} size={20} />
            <span className="text-[12px] truncate">{name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Sorted by net chips. motion's layout animation slides rows to their new rank; not draggable.
function Rankings({ rows }: { rows: Row[] }) {
  const ranked = [...rows].sort((a, b) => b.net - a.net);

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
