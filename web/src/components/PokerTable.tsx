"use client";

import CornerBorders from "@/components/CornerBorders";
import Player from "@/components/Player";
import TableFelt from "@/components/TableFelt";
import { PlayerState } from "@/lib/api";

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
  buttonIdx: number;
  communityCards: string[];
  pot: number;
  winnersByIdx?: Record<number, WinnerInfo>;
}

// Calculate position name based on seat relative to button
function getPosition(playerIdx: number, buttonIdx: number, totalPlayers: number): string {
  if (buttonIdx < 0) return '';
  
  // Calculate how many seats after the button this player is
  const seatsFromButton = (playerIdx - buttonIdx + totalPlayers) % totalPlayers;
  
  // Positions depend on table size
  // 9-max: BTN, SB, BB, UTG, UTG+1, UTG+2, LJ, HJ, CO
  // 8-max: BTN, SB, BB, UTG, UTG+1, LJ, HJ, CO
  // 7-max: BTN, SB, BB, UTG, LJ, HJ, CO
  // 6-max: BTN, SB, BB, UTG, HJ, CO
  
  if (seatsFromButton === 0) return 'BTN';
  if (seatsFromButton === 1) return 'SB';
  if (seatsFromButton === 2) return 'BB';
  
  // Remaining positions depend on table size
  const posFromUTG = seatsFromButton - 3; // 0 = UTG
  
  if (totalPlayers === 9) {
    // 9-max: UTG, UTG+1, UTG+2, LJ, HJ, CO
    const positions = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO'];
    return positions[posFromUTG] || '';
  } else if (totalPlayers === 8) {
    // 8-max: UTG, UTG+1, LJ, HJ, CO
    const positions = ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO'];
    return positions[posFromUTG] || '';
  } else if (totalPlayers === 7) {
    // 7-max: UTG, LJ, HJ, CO
    const positions = ['UTG', 'LJ', 'HJ', 'CO'];
    return positions[posFromUTG] || '';
  } else if (totalPlayers === 6) {
    // 6-max: UTG, HJ, CO
    const positions = ['UTG', 'HJ', 'CO'];
    return positions[posFromUTG] || '';
  }
  
  return '';
}

export default function PokerTable({
  players,
  layout,
  currentPlayerIdx,
  buttonIdx,
  communityCards,
  pot,
  winnersByIdx = {},
}: PokerTableProps) {
  const totalPlayers = players.length;
  
  if (players.length === 0) {
    return (
      <div 
        className="relative bg-white rounded overflow-hidden"
        style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
      >
        <CornerBorders />
        <div className="w-[600px] h-[300px] flex items-center justify-center text-sm italic" style={{ color: 'rgba(55, 53, 47, 0.5)' }}>
          Start a new game to begin
        </div>
      </div>
    );
  }

  // Calculate fixed width based on layout
  const numCols = layout.top.length + (layout.left.length > 0 ? 1 : 0) + (layout.right.length > 0 ? 1 : 0);
  const tableWidth = numCols * 200;

  return (
    <div 
      className="relative bg-white shrink-0 self-stretch rounded"
      style={{ width: tableWidth, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <CornerBorders />
      <table className="table-fixed w-full h-full" style={{ borderCollapse: 'collapse', borderSpacing: 0 }}>
        <tbody>
          {/* TOP ROW */}
          <tr>
            {layout.left.length > 0 && (
              <td className="w-[200px] h-[100px]" style={{ borderRight: '1px solid rgba(55, 53, 47, 0.09)', borderBottom: '1px solid rgba(55, 53, 47, 0.09)' }} />
            )}
            {layout.top.map((idx, i) => (
              <td 
                key={`top-${idx}`} 
                className="w-[200px] h-[100px]"
                style={{ 
                  borderBottom: '1px solid rgba(55, 53, 47, 0.09)',
                  borderRight: i < layout.top.length - 1 ? '1px solid rgba(55, 53, 47, 0.09)' : undefined
                }}
              >
                <Player 
                  player={players[idx]} 
                  active={idx === currentPlayerIdx}
                  position={getPosition(idx, buttonIdx, totalPlayers)}
                  folded={players[idx]?.status === 'folded'}
                  winAmount={winnersByIdx[idx]?.amount}
                  winDesc={winnersByIdx[idx]?.handDesc}
                />
              </td>
            ))}
            {layout.right.length > 0 && (
              <td className="w-[200px] h-[100px]" style={{ borderLeft: '1px solid rgba(55, 53, 47, 0.09)', borderBottom: '1px solid rgba(55, 53, 47, 0.09)' }} />
            )}
          </tr>

          {/* MIDDLE ROWS */}
          {Array.from({ length: Math.max(layout.left.length, layout.right.length) }).map((_, rowIdx) => (
            <tr key={`middle-${rowIdx}`}>
              {layout.left.length > 0 && (
                <td className="w-[200px] h-[100px]" style={{ borderRight: '1px solid rgba(55, 53, 47, 0.09)', borderBottom: '1px solid rgba(55, 53, 47, 0.09)' }}>
                  <div className="flex justify-end h-full">
                    {layout.left[rowIdx] !== undefined && players[layout.left[rowIdx]] && (
                      <Player 
                        player={players[layout.left[rowIdx]]} 
                        active={layout.left[rowIdx] === currentPlayerIdx}
                        position={getPosition(layout.left[rowIdx], buttonIdx, totalPlayers)}
                        folded={players[layout.left[rowIdx]]?.status === 'folded'}
                        winAmount={winnersByIdx[layout.left[rowIdx]]?.amount}
                        winDesc={winnersByIdx[layout.left[rowIdx]]?.handDesc}
                      />
                    )}
                  </div>
                </td>
              )}

              {rowIdx === 0 && (
                <td 
                  colSpan={layout.top.length}
                  rowSpan={Math.max(layout.left.length, layout.right.length)}
                  style={{ borderBottom: '1px solid rgba(55, 53, 47, 0.09)' }}
                >
                  <div className="flex items-center justify-center h-full">
                    <TableFelt 
                      cards={communityCards} 
                      pot={pot} 
                      winners={Object.entries(winnersByIdx).map(([idx, info]) => ({
                        name: players[Number(idx)]?.name || `Player ${idx}`,
                        amount: info.amount,
                        handDesc: info.handDesc,
                      }))}
                    />
                  </div>
                </td>
              )}

              {layout.right.length > 0 && (
                <td className="w-[200px] h-[100px]" style={{ borderLeft: '1px solid rgba(55, 53, 47, 0.09)', borderBottom: '1px solid rgba(55, 53, 47, 0.09)' }}>
                  <div className="flex justify-start h-full">
                    {layout.right[rowIdx] !== undefined && players[layout.right[rowIdx]] && (
                      <Player 
                        player={players[layout.right[rowIdx]]} 
                        active={layout.right[rowIdx] === currentPlayerIdx}
                        position={getPosition(layout.right[rowIdx], buttonIdx, totalPlayers)}
                        folded={players[layout.right[rowIdx]]?.status === 'folded'}
                        winAmount={winnersByIdx[layout.right[rowIdx]]?.amount}
                        winDesc={winnersByIdx[layout.right[rowIdx]]?.handDesc}
                      />
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}

          {/* BOTTOM ROW */}
          <tr>
            {layout.left.length > 0 && (
              <td className="w-[200px] h-[100px]" style={{ borderRight: '1px solid rgba(55, 53, 47, 0.09)' }} />
            )}
            <td colSpan={layout.top.length} className="h-[100px] p-0">
              <div className="flex h-full">
                {layout.bottom.map((playerIdx, i) => (
                  <div 
                    key={`bottom-${playerIdx}`}
                    className="flex-1"
                    style={{ borderRight: i < layout.bottom.length - 1 ? '1px solid rgba(55, 53, 47, 0.09)' : undefined }}
                  >
                    {players[playerIdx] && (
                      <Player 
                        player={players[playerIdx]} 
                        active={playerIdx === currentPlayerIdx}
                        position={getPosition(playerIdx, buttonIdx, totalPlayers)}
                        folded={players[playerIdx]?.status === 'folded'}
                        winAmount={winnersByIdx[playerIdx]?.amount}
                        winDesc={winnersByIdx[playerIdx]?.handDesc}
                      />
                    )}
                  </div>
                ))}
              </div>
            </td>
            {layout.right.length > 0 && (
              <td className="w-[200px] h-[100px]" style={{ borderLeft: '1px solid rgba(55, 53, 47, 0.09)' }} />
            )}
          </tr>
        </tbody>
      </table>
    </div>
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
