"use client";

import { HudSlot, useHud } from "@/components/Hud";
import Player from "@/components/Player";
import TableFelt from "@/components/TableFelt";
import { useId, useState } from "react";
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
  handNumber,
  winnersByIdx = {},
  nextHandCountdown,
  thinkingPlayerIdx,
  buttonDetermination,
  hidePositions = false,
  notice,
}: PokerTableProps) {
  const { on: hudOn } = useHud();
  // A late joiner sees the hand already dealt; only hands dealt while watching wait for their flight.
  const [firstHand, setFirstHand] = useState(0);
  const slotIds = { phone: useId(), desk: useId() }; // each layout has its own felt and slot
  if (!firstHand && handNumber && players.length) setFirstHand(handNumber);
  const dealt = firstHand > 0 && handNumber !== firstHand;

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

  const seat = (idx: number, hudSlotId: string) => players[idx] && (
    <Player
      player={players[idx]}
      active={idx === currentPlayerIdx}
      position={hidePositions ? '' : players[idx].position}
      folded={players[idx]?.status === 'folded'}
      winAmount={winnersByIdx[idx]?.amount}
      winDesc={winnersByIdx[idx]?.handDesc}
      isThinking={idx === thinkingPlayerIdx}
      hudSlotId={hudSlotId}
      seatIdx={idx}
      handNumber={handNumber}
      dealDelays={dealt ? [0, 1].map(round => dealStart(players, idx, round) + FLIGHT) : undefined}
    />
  );

  const felt = (slotId: string) => (
    <TableFelt
      cards={communityCards}
      pot={pot}
      winners={Object.entries(winnersByIdx).map(([idx, info]) => ({
        name: players[Number(idx)]?.name || `Player ${idx}`,
        amount: info.amount,
        handDesc: info.handDesc,
      }))}
      nextHandCountdown={nextHandCountdown}
      buttonDetermination={buttonDetermination}
      notice={notice}
      hudSlot={<HudSlot id={slotId} />}
    />
  );

  const cardStyle = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };

  // 200px a column, grown to fill the window beside the 240px sidebar (up to 20% wider). --fit is
  // the CSS zoom on short windows (globals.css), so the zoomed table still reaches the edge.
  const numCols = layout.top.length + (layout.left.length > 0 ? 1 : 0) + (layout.right.length > 0 ? 1 : 0);
  const tableWidth = numCols * 200;
  const line = '1px solid rgba(55, 53, 47, 0.09)';
  const rows = Math.max(layout.left.length, layout.right.length);

  return (
    <>
      <TableMotion
        players={players}
        handNumber={handNumber}
        boardCount={communityCards.length}
        winnerIdxs={Object.keys(winnersByIdx).map(Number)}
      />
      {/* Phones: felt on top, seats in a 3-column grid in seat order */}
      <div className="md:hidden flex flex-col gap-2 w-full">
        <div className="relative bg-white rounded min-h-[200px] flex" style={cardStyle}>
          {felt(slotIds.phone)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {players.map((p, idx) => (
            <div key={p.id} className={hudOn ? "h-[170px]" : "h-[150px]"}>{seat(idx, slotIds.phone)}</div>
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
                <td className="w-[200px] h-[100px]" style={{ borderRight: line, borderBottom: line }} />
              )}
              {layout.top.map((idx, i) => (
                <td
                  key={`top-${idx}`}
                  className="w-[200px] h-[100px]"
                  style={{ borderBottom: line, borderRight: i < layout.top.length - 1 ? line : undefined }}
                >
                  {seat(idx, slotIds.desk)}
                </td>
              ))}
              {layout.right.length > 0 && (
                <td className="w-[200px] h-[100px]" style={{ borderLeft: line, borderBottom: line }} />
              )}
            </tr>

            {/* MIDDLE ROWS */}
            {Array.from({ length: rows }).map((_, rowIdx) => (
              <tr key={`middle-${rowIdx}`}>
                {layout.left.length > 0 && (
                  <td className="w-[200px] h-[100px]" style={{ borderRight: line, borderBottom: line }}>
                    <div className="flex justify-end h-full">
                      {layout.left[rowIdx] !== undefined && seat(layout.left[rowIdx], slotIds.desk)}
                    </div>
                  </td>
                )}

                {rowIdx === 0 && (
                  <td colSpan={layout.top.length} rowSpan={rows} style={{ borderBottom: line }}>
                    <div className="flex items-center justify-center h-full">{felt(slotIds.desk)}</div>
                  </td>
                )}

                {layout.right.length > 0 && (
                  <td className="w-[200px] h-[100px]" style={{ borderLeft: line, borderBottom: line }}>
                    <div className="flex justify-start h-full">
                      {layout.right[rowIdx] !== undefined && seat(layout.right[rowIdx], slotIds.desk)}
                    </div>
                  </td>
                )}
              </tr>
            ))}

            {/* BOTTOM ROW */}
            <tr>
              {layout.left.length > 0 && (
                <td className="w-[200px] h-[100px]" style={{ borderRight: line }} />
              )}
              <td colSpan={layout.top.length} className="h-[100px] p-0">
                <div className="flex h-full">
                  {layout.bottom.map((playerIdx, i) => (
                    <div
                      key={`bottom-${playerIdx}`}
                      className="flex-1"
                      style={{ borderRight: i < layout.bottom.length - 1 ? line : undefined }}
                    >
                      {seat(playerIdx, slotIds.desk)}
                    </div>
                  ))}
                </div>
              </td>
              {layout.right.length > 0 && (
                <td className="w-[200px] h-[100px]" style={{ borderLeft: line }} />
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
