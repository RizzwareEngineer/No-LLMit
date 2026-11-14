"use client";

import { useState } from "react";
import { useReducedMotion } from "motion/react";
import Player from "@/components/Player";
import { usePeel } from "@/lib/tableSwitches";
import TableFelt, { FeltBet } from "@/components/TableFelt";
import TableMotion, { CARD_FLIGHT, DeckPhase, dealStart } from "@/components/TableMotion";
import { PlayerState, TableNoticePayload } from "@/lib/api";
import { ModelStats } from "@/lib/stats";
import type { ButtonDetermination } from "@/lib/stream";

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
  currentPlayerIdx: number;
  communityCards: string[];
  pot: number;
  winnersByIdx?: Record<number, WinnerInfo>;
  nextHandCountdown?: number | null;
  thinkingPlayerIdx?: number;
  peeked?: number[]; // seats whose hole cards are face up this hand (the engine's peeked, and the turn on screen)
  buttonDetermination?: ButtonDetermination | null;
  notice?: TableNoticePayload | null;
  street: string;
  handNumber: number;
  stats?: Record<string, ModelStats>; // by model name, for the hover stats on each seat
}

export default function PokerTable({
  players,
  currentPlayerIdx,
  communityCards,
  pot,
  winnersByIdx = {},
  nextHandCountdown,
  thinkingPlayerIdx,
  peeked = [],
  buttonDetermination,
  notice,
  street,
  handNumber,
  stats,
}: PokerTableProps) {
  const layout = getPlayerLayout(players.length || 9);
  const hidePositions = !!buttonDetermination; // the position badges wait for the button draw
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

  // The deal: a late joiner sees the hand already dealt; a hand dealt while watching shows each card as its flight
  // lands (TableMotion), unless motion is reduced. The deck is shuffled on the felt between hands.
  const reduce = useReducedMotion();
  const [firstHand, setFirstHand] = useState(0);
  if (!firstHand && handNumber && players.length) setFirstHand(handNumber);
  const dealt = !reduce && firstHand > 0 && handNumber !== firstHand;
  const [deck, setDeck] = useState<DeckPhase | null>(null);
  const peelMotion = usePeel(); // ?peel=1|2, the owner's pick
  
  const cardStyle = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };
  // Until the first state arrives (`players` empty) the table stands in blank: the same grid, a blank seat box in every
  // seat of the default lineup (the page's layout for 9) and the felt with nothing on it, so nothing moves when it fills.
  const blank = players.length === 0;
  const seat = (idx: number) => blank ? <div data-seat={idx} className="h-full w-full rounded bg-white" style={cardStyle} /> : players[idx] && (
    <Player
      player={players[idx]}
      active={idx === currentPlayerIdx && street !== 'complete'} // between hands nobody is on the clock
      position={hidePositions ? '' : players[idx].position}
      winAmount={winnersByIdx[idx]?.amount}
      winDesc={winnersByIdx[idx]?.handDesc}
      isThinking={idx === thinkingPlayerIdx}
      stats={stats?.[players[idx].name]}
      showAction={shown(players[idx])}
      seatIdx={idx}
      handNumber={handNumber}
      dealDelays={dealt ? [0, 1].map(round => dealStart(players, idx, round) + CARD_FLIGHT) : undefined}
      faceUp={street === 'complete' || peeked.includes(idx)}
      peel={peeked.includes(idx) ? peelMotion : 1}
    />
  );

  // Each seat's bet sits on the felt edge it faces, centred on the seat's column or row.
  const rows = Math.max(layout.left.length, layout.right.length); // left/right seats per side
  const betsOut = players.reduce((sum, p) => sum + p.currentBet, 0);
  const edge = (side: FeltBet['side'], seats: number[], n: number) =>
    seats.map((seat, i) => ({ seat, side, at: (i + 0.5) / n, amount: players[seat]?.currentBet ?? 0 }));
  const feltBets: FeltBet[] = [
    ...edge('top', layout.top, layout.top.length),
    ...edge('bottom', layout.bottom, layout.bottom.length),
    ...edge('left', layout.left, rows),
    ...edge('right', layout.right, rows),
  ];

  const felt = (
    <TableFelt
      cards={communityCards}
      pot={pot}
      betsOut={betsOut}
      bets={feltBets}
      winners={Object.entries(winnersByIdx).map(([idx, info]) => ({
        name: players[Number(idx)]?.name || `Player ${idx}`,
        amount: info.amount,
        handDesc: info.handDesc,
      }))}
      nextHandCountdown={nextHandCountdown}
      buttonDetermination={buttonDetermination}
      notice={notice}
      deck={deck}
      blank={blank}
    />
  );

  // Calculate fixed width based on layout
  const numCols = layout.top.length + (layout.left.length > 0 ? 1 : 0) + (layout.right.length > 0 ? 1 : 0);
  const tableWidth = numCols * 200;
  const line = '1px solid rgba(55, 53, 47, 0.09)';

  return (
    <>
      {!blank && <TableMotion
        players={players}
        handNumber={handNumber}
        boardCount={communityCards.length}
        winnerIdxs={Object.keys(winnersByIdx).map(Number)}
        nextHandCountdown={street === 'complete' ? nextHandCountdown ?? null : null}
        onDeck={setDeck}
      />}
      {/* Phones: felt on top, seats in a 3-column grid in seat order */}
      <div className="md:hidden flex flex-col gap-2 w-full">
        <div className="relative bg-white rounded min-h-[200px] flex" style={cardStyle}>
          {felt}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(blank ? Object.values(layout).flat().sort((a, b) => a - b) : players.map((_, i) => i)).map(idx => (
            <div key={players[idx]?.id ?? idx} className="h-[150px]">{seat(idx)}</div>
          ))}
        </div>
      </div>

      {/* md and up: seats around the felt. The table is only for layout. */}
      <div
        className="hidden md:block relative bg-white shrink-0 self-stretch rounded"
        style={{ width: tableWidth, ...cardStyle }}
      >
        <table role="presentation" className="table-fixed w-full h-full" style={{ borderCollapse: 'collapse', borderSpacing: 0 }}>
          <tbody>
            {/* TOP ROW */}
            <tr>
              {layout.left.length > 0 && (
                <td className="w-[200px] h-[128px]" style={{ borderRight: line, borderBottom: line }} />
              )}
              {layout.top.map((idx, i) => (
                <td
                  key={`top-${idx}`}
                  className="w-[200px] h-[128px]"
                  style={{ borderBottom: line, borderRight: i < layout.top.length - 1 ? line : undefined }}
                >
                  {seat(idx)}
                </td>
              ))}
              {layout.right.length > 0 && (
                <td className="w-[200px] h-[128px]" style={{ borderLeft: line, borderBottom: line }} />
              )}
            </tr>

            {/* MIDDLE ROWS */}
            {Array.from({ length: rows }).map((_, rowIdx) => (
              <tr key={`middle-${rowIdx}`}>
                {layout.left.length > 0 && (
                  <td className="w-[200px] h-[128px]" style={{ borderRight: line, borderBottom: line }}>
                    <div className="flex justify-end h-full">
                      {layout.left[rowIdx] !== undefined && seat(layout.left[rowIdx])}
                    </div>
                  </td>
                )}

                {rowIdx === 0 && (
                  <td colSpan={layout.top.length} rowSpan={rows} style={{ borderBottom: line }}>
                    <div className="flex items-center justify-center h-full">{felt}</div>
                  </td>
                )}

                {layout.right.length > 0 && (
                  <td className="w-[200px] h-[128px]" style={{ borderLeft: line, borderBottom: line }}>
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
                <td className="w-[200px] h-[128px]" style={{ borderRight: line }} />
              )}
              <td colSpan={layout.top.length} className="h-[128px] p-0">
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
                <td className="w-[200px] h-[128px]" style={{ borderLeft: line }} />
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

// Helper function to get player layout based on count (6-9 players)
function getPlayerLayout(count: number): PlayerLayout {
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
