"use client";

import Player from "@/components/Player";
import TableFelt, { BetStack, FeltBet } from "@/components/TableFelt";
import { useState } from "react";
import TableMotion, { FLIGHT, dealStart } from "@/components/TableMotion";
import { PlayerState, TableNoticePayload } from "@/lib/api";
import type { ButtonDetermination } from "@/hooks/useGameState";

interface PlayerLayout {
  top: number[];
  left: number[];
  right: number[];
  bottom: number[];
}

interface WinnerInfo {
  amount: number;
  handDesc: string;
}

interface PokerTableProps {
  players: PlayerState[];
  layout: PlayerLayout;
  currentPlayerIdx: number;
  communityCards: string[];
  pot: number;
  street: string;
  handNumber: number;
  winnersByIdx?: Record<number, WinnerInfo>;
  nextHandCountdown?: number | null;
  thinkingPlayerIdx?: number;
  buttonDetermination?: ButtonDetermination | null;
  hidePositions?: boolean;
  notice?: TableNoticePayload | null;
}

export default function PokerTable({
  players,
  layout,
  currentPlayerIdx,
  communityCards,
  pot,
  street,
  handNumber,
  winnersByIdx = {},
  nextHandCountdown,
  thinkingPlayerIdx,
  buttonDetermination,
  hidePositions = false,
  notice,
}: PokerTableProps) {
  // A late joiner sees the hand already dealt; only hands dealt while watching wait for their flight.
  const [firstHand, setFirstHand] = useState(0);
  if (!firstHand && handNumber && players.length) setFirstHand(handNumber);
  const dealt = firstHand > 0 && handNumber !== firstHand;

  // The engine keeps each seat's last action until the hand ends. A seat shows it only once it has
  // acted on the current street: its action, amount or stack changed since the street started, or
  // it was on the clock during this street (that catches a second CHECK in a row).
  const sig = (p: PlayerState) => `${p.lastAction}|${p.lastAmount}|${p.stack}`;
  const streetKey = `${handNumber}:${street}`;
  const [view, setView] = useState({ key: '', start: null as Record<string, string> | null, acted: [] as string[] });
  if (players.length && view.key !== streetKey) {
    // The first street seen (a late joiner) has no starting point: see `shown`.
    setView({ key: streetKey, start: view.key ? Object.fromEntries(players.map(p => [p.id, sig(p)])) : null, acted: [] });
  }
  const onClock = thinkingPlayerIdx !== undefined ? players[thinkingPlayerIdx]?.id : undefined;
  if (onClock && view.key === streetKey && !view.acted.includes(onClock)) setView({ ...view, acted: [...view.acted, onClock] });
  // Without a starting point, after the flop only seats with chips in this street have surely acted.
  const shown = (p: PlayerState) => view.start
    ? view.acted.includes(p.id) || view.start[p.id] !== sig(p)
    : street === 'preflop' || p.currentBet > 0;
  // Raises only go up, so after the flop the smallest RAISE shown this street opened the betting.
  const raises = players.filter(p => shown(p) && p.lastAction === 'RAISE').map(p => p.lastAmount ?? 0);
  const opened = street !== 'preflop' && raises.length ? Math.min(...raises) : null;

  if (players.length === 0) {
    return (
      <div 
        className="relative bg-white rounded overflow-hidden"
        style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
      >
        <div className="w-full md:w-[600px] h-[300px] flex items-center justify-center text-sm italic" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>
          Connecting to the table…
        </div>
      </div>
    );
  }

  const seat = (idx: number) => players[idx] && (
    <Player
      player={players[idx]}
      active={idx === currentPlayerIdx}
      position={hidePositions ? '' : players[idx].position}
      folded={players[idx]?.status === 'folded'}
      winAmount={winnersByIdx[idx]?.amount}
      winDesc={winnersByIdx[idx]?.handDesc}
      isThinking={idx === thinkingPlayerIdx}
      seatIdx={idx}
      handNumber={handNumber}
      dealDelays={dealt ? [0, 1].map(round => dealStart(players, idx, round) + FLIGHT) : undefined}
      showAction={shown(players[idx])}
      isBet={players[idx].lastAction === 'RAISE' && players[idx].lastAmount === opened}
    />
  );

  // Each seat's bet sits on the felt edge it faces, centred on the seat's column or row.
  const rows = Math.max(layout.left.length, layout.right.length);
  const betsOut = players.reduce((sum, p) => sum + p.currentBet, 0);
  const edge = (side: FeltBet['side'], seats: number[], n: number) =>
    seats.map((seat, i) => ({ seat, side, at: (i + 0.5) / n, amount: players[seat]?.currentBet ?? 0 }));
  const feltBets: FeltBet[] = [
    ...edge('top', layout.top, layout.top.length),
    ...edge('bottom', layout.bottom, layout.bottom.length),
    ...edge('left', layout.left, rows),
    ...edge('right', layout.right, rows),
  ];

  const felt = (bets?: FeltBet[]) => (
    <TableFelt
      cards={communityCards}
      pot={pot}
      betsOut={betsOut}
      bets={bets}
      winners={Object.entries(winnersByIdx).map(([idx, info]) => ({
        name: players[Number(idx)]?.name || `Player ${idx}`,
        amount: info.amount,
        handDesc: info.handDesc,
      }))}
      nextHandCountdown={nextHandCountdown}
      buttonDetermination={buttonDetermination}
      notice={notice}
    />
  );

  const cardStyle = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };

  // 200px a column, grown to fill the window beside the 240px sidebar (up to 20% wider). --fit is
  // the CSS zoom on short windows (globals.css), so the zoomed table still reaches the edge.
  const numCols = layout.top.length + (layout.left.length > 0 ? 1 : 0) + (layout.right.length > 0 ? 1 : 0);
  const tableWidth = numCols * 200;
  const line = '1px solid rgba(55, 53, 47, 0.09)';

  return (
    <>
      <TableMotion
        players={players}
        handNumber={handNumber}
        boardCount={communityCards.length}
        winnerIdxs={Object.keys(winnersByIdx).map(Number)}
      />
      {/* Phones: felt on top, seats in a 3-column grid in seat order, each bet just above its seat */}
      <div className="md:hidden flex flex-col gap-2 w-full">
        <div className="relative bg-white rounded min-h-[200px] flex" style={cardStyle}>
          {felt()}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {players.map((p, idx) => (
            <div key={p.id} className="flex flex-col gap-1">
              <BetStack seat={idx} amount={p.currentBet} className="h-5 justify-center" />
              <div className="h-[187px]">{seat(idx)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* md and up: seats around the felt. The table is only for layout. */}
      <div
        className="hidden md:block relative bg-white shrink-0 self-stretch rounded"
        style={{ width: `clamp(${tableWidth}px, calc((100vw - 3rem - 252px) / var(--fit, 1)), ${tableWidth * 1.2}px)`, ...cardStyle }}
      >
        <table role="presentation" className="table-fixed w-full h-full" style={{ borderCollapse: 'collapse', borderSpacing: 0 }}>
          <tbody>
            {/* TOP ROW */}
            <tr>
              {layout.left.length > 0 && (
                <td className="w-[200px] h-[118px]" style={{ borderRight: line, borderBottom: line }} />
              )}
              {layout.top.map((idx, i) => (
                <td
                  key={`top-${idx}`}
                  className="w-[200px] h-[118px]"
                  style={{ borderBottom: line, borderRight: i < layout.top.length - 1 ? line : undefined }}
                >
                  {seat(idx)}
                </td>
              ))}
              {layout.right.length > 0 && (
                <td className="w-[200px] h-[118px]" style={{ borderLeft: line, borderBottom: line }} />
              )}
            </tr>

            {/* MIDDLE ROWS */}
            {Array.from({ length: rows }).map((_, rowIdx) => (
              <tr key={`middle-${rowIdx}`}>
                {layout.left.length > 0 && (
                  <td className="w-[200px] h-[118px]" style={{ borderRight: line, borderBottom: line }}>
                    <div className="flex justify-end h-full">
                      {layout.left[rowIdx] !== undefined && seat(layout.left[rowIdx])}
                    </div>
                  </td>
                )}

                {rowIdx === 0 && (
                  <td colSpan={layout.top.length} rowSpan={rows} style={{ borderBottom: line }}>
                    <div className="flex items-center justify-center h-full">{felt(feltBets)}</div>
                  </td>
                )}

                {layout.right.length > 0 && (
                  <td className="w-[200px] h-[118px]" style={{ borderLeft: line, borderBottom: line }}>
                    <div className="flex justify-start h-full">
                      {layout.right[rowIdx] !== undefined && seat(layout.right[rowIdx])}
                    </div>
                  </td>
                )}
              </tr>
            ))}

            {/* BOTTOM ROW */}
            <tr>
              {layout.left.length > 0 && (
                <td className="w-[200px] h-[118px]" style={{ borderRight: line }} />
              )}
              <td colSpan={layout.top.length} className="h-[118px] p-0">
                <div className="flex h-full">
                  {layout.bottom.map((playerIdx, i) => (
                    <div
                      key={`bottom-${playerIdx}`}
                      className="flex-1"
                      style={{ borderRight: i < layout.bottom.length - 1 ? line : undefined }}
                    >
                      {seat(playerIdx)}
                    </div>
                  ))}
                </div>
              </td>
              {layout.right.length > 0 && (
                <td className="w-[200px] h-[118px]" style={{ borderLeft: line }} />
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

// Helper function to get player layout based on count (6-9 players)
export function getPlayerLayout(count: number): PlayerLayout {
  switch (count) {
    case 6:
      return { top: [0, 1], left: [5], right: [2], bottom: [4, 3] };
    case 7:
      return { top: [0, 1, 2], left: [6], right: [3], bottom: [5, 4] };
    case 8:
      return { top: [0, 1], left: [7, 6], right: [2, 3], bottom: [5, 4] };
    case 9:
      return { top: [0, 1, 2], left: [8, 7], right: [3, 4], bottom: [6, 5] };
    default:
      return { top: [], left: [], right: [], bottom: [] };
  }
}
