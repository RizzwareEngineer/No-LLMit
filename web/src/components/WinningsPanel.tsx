"use client";

import { motion } from "motion/react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import LLMLogo, { modelColor } from "@/components/LLMLogo";
import { PlayerState } from "@/lib/api";
import { formatAmount, useBigBlind } from "@/lib/amounts";
import { useFillIn, useRememberedBox } from "@/lib/boxes";
import { MUTED } from "@/lib/stats";
import FitName from "@/components/FitName";

interface WinningsPanelProps {
  players: PlayerState[];
  landing?: boolean; // phone draft A's landing fill: a small label, short rows spread over its height, re-sorting without a slide
}

export default function WinningsPanel({ players, landing = false }: WinningsPanelProps) {
  const bb = useBigBlind();
  // No state yet: a blank box at its size (a phone's is as tall as its rows: remembered).
  // The landing fill sizes its own copy: never held at a remembered size (its two versions differ), and under its own name
  // so it never writes the phone P&L window's.
  const [box, size, attrs] = useRememberedBox<HTMLDivElement>(landing ? 'pnl-fill' : 'pnl', landing || players.length > 0);
  useFillIn(box, players.length > 0);
  return (
    <div 
      ref={box}
      {...attrs}
      className={`flex flex-col relative w-full bg-white flex-1 rounded ${landing ? '' : 'overflow-hidden'} ${players.length ? '' : '[&>*]:invisible'}`}
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px', ...size }}
    >
      <div className={`flex items-start justify-between border-b border-notion ${landing ? 'px-3 py-2' : 'p-3'}`}>
        <div className="flex flex-col">
          {/* Phones: a Stats window's title, as Trends, Profiles and Matchups (the desktop sidebar keeps its small label). */}
          {/* The landing fill's: the chart's label style above it (Trends · bb/100). */}
          {landing
            ? <h2 className="text-[13px] leading-4" style={{ color: MUTED }}>Profits & Losses · this session</h2>
            : <h2 className="text-[13px] leading-4 font-medium uppercase tracking-wider max-md:text-[20px] max-md:leading-8 max-md:font-bold max-md:normal-case max-md:tracking-normal" style={{ color: 'rgb(55, 53, 47)' }}>Profits & Losses</h2>}
        </div>
        {/* In big blinds the column's unit sits here, so the rows stay as narrow as in chips and no name is cut shorter. */}
        {bb && <span data-unit className="text-[13px] leading-4 font-medium uppercase tracking-wider" style={{ color: MUTED }}>BB</span>}
      </div>
      <div className={landing ? 'flex-1 flex flex-col' : 'flex-1 overflow-auto'}>
        {players.length > 0 && <Rankings players={players} landing={landing} />}
      </div>
    </div>
  );
}

function RankingItem({ player, rank, short = false }: { player: PlayerState; rank: number; short?: boolean }) {
  const bb = useBigBlind();
  const winnings = player.winnings || 0;
  const color = winnings > 0 ? 'rgb(15, 123, 108)' : winnings < 0 ? 'rgb(200, 50, 50)' : MUTED;

  return (
    // The name takes all the row the rank, logo and number leave it (owner's audit: names were cut while there was room).
    // 4px between them: at 6px a five-digit figure left "DeepSeek Flash", the shortest form of "DeepSeek V4 Flash",
    // 100px of the 102 it needs (desktop-table-text), and it was cut.
    // Short (the landing fill): a bar in the model's line colour names its line in the chart above; lighter type, so the
    // table above stays the heaviest thing on the screen.
    <div className={`flex flex-row items-center gap-1 px-2 ${short ? 'h-6' : 'py-2'}`}>
      {short && <span aria-hidden className="w-[3px] h-3.5 rounded-full shrink-0 mr-0.5" style={{ background: modelColor(player.name) }} />}
      <span className={`text-[13px] min-w-3.5 tabular-nums shrink-0 ${short ? '' : 'font-bold'}`} style={{ color: MUTED }}>{rank}.</span>
      <LLMLogo model={player.name} size={18} />
      <div className="flex-1 min-w-0">
        <FitName name={player.name} className={`text-[13px] ${short ? 'font-medium' : 'font-bold'}`} style={{ color: 'rgb(55, 53, 47)' }} />
      </div>
      <div className={`flex flex-row items-center gap-0.5 shrink-0 text-[13px] tabular-nums ${short ? 'font-semibold' : 'font-bold'}`} style={{ color }}>
        {winnings > 0 && <CaretUp size={10} weight="bold" aria-hidden />}
        {winnings < 0 && <CaretDown size={10} weight="bold" aria-hidden />}
        <span data-chips={Math.abs(winnings)}>{winnings > 0 ? '+' : winnings < 0 ? '−' : ''}{formatAmount(Math.abs(winnings), bb, false)}</span>
      </div>
    </div>
  );
}

// Sorted by winnings. motion's layout animation slides rows to their new rank (not on the landing fill); not draggable.
function Rankings({ players, landing }: { players: PlayerState[]; landing: boolean }) {
  const ranked = [...players].sort((a, b) => (b.winnings || 0) - (a.winnings || 0));

  return (
    <ol className={`flex flex-col divide-y divide-black/10 ${landing ? 'flex-1' : ''}`}>
      {ranked.map((player, index) => (
        <motion.li key={player.id} layout={!landing} transition={{ duration: 0.3 }} className={landing ? 'flex-1 flex flex-col justify-center' : undefined}>
          <RankingItem player={player} rank={index + 1} short={landing} />
        </motion.li>
      ))}
    </ol>
  );
}
