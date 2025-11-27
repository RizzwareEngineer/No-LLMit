"use client";

import Card from "@/components/Card";
import { useState } from "react";
import NumberFlow from '@number-flow/react'
import { Reorder } from "motion/react"
import { CaretDown, CaretUp, User, Eye, EyeSlash } from "@phosphor-icons/react";
import CornerBorders from "@/components/CornerBorders";
import LLMLogo from "@/components/LLMLogo";

// Mock data for UI demonstration - 9 players (can be 6-9)
const ALL_PLAYERS = [
  { id: "1", name: "GPT-4o", stack: 2150, cards: ["Ah", "Kd"], lastAction: "RAISE", lastAmount: 40, winnings: 150 },
  { id: "2", name: "Claude 3.5", stack: 1820, cards: ["Qc", "Qs"], lastAction: "CALL", lastAmount: 40, winnings: -180 },
  { id: "3", name: "Gemini Pro", stack: 2400, cards: ["Jh", "Th"], lastAction: "FOLD", lastAmount: 0, winnings: 400 },
  { id: "4", name: "Llama 3", stack: 1650, cards: ["9s", "9d"], lastAction: "CHECK", lastAmount: 0, winnings: -350 },
  { id: "5", name: "Mistral Large", stack: 1980, cards: ["7c", "6c"], lastAction: "CALL", lastAmount: 40, winnings: -20 },
  { id: "6", name: "DeepSeek V3", stack: 2000, cards: ["As", "Ks"], lastAction: null, lastAmount: 0, winnings: 0 },
  { id: "7", name: "Grok 2", stack: 1750, cards: ["8h", "8d"], lastAction: "CALL", lastAmount: 40, winnings: -250 },
  { id: "8", name: "Qwen 2.5", stack: 2200, cards: ["Kc", "Qh"], lastAction: "RAISE", lastAmount: 80, winnings: 200 },
  { id: "9", name: "Cohere R+", stack: 1900, cards: ["Tc", "Jd"], lastAction: "FOLD", lastAmount: 0, winnings: 50 },
];

const MOCK_COMMUNITY_CARDS = ["Kh", "7d", "2c", "Qs", "5h"];
const MOCK_POT = 440;

interface MockPlayer {
  id: string;
  name: string;
  stack: number;
  cards: string[];
  lastAction: string | null;
  lastAmount: number;
  winnings: number;
}

// Get player layout based on count (6-9 players)
// Returns: { top, left, right, bottom } arrays of player indices
function getPlayerLayout(count: number): { top: number[]; left: number[]; right: number[]; bottom: number[] } {
  switch (count) {
    case 6:
      // 2 top, 1 left, 1 right, 2 bottom
      return {
        top: [0, 1],
        left: [5],
        right: [2],
        bottom: [4, 3],
      };
    case 7:
      // 3 top, 1 left, 1 right, 2 bottom
      return {
        top: [0, 1, 2],
        left: [6],
        right: [3],
        bottom: [5, 4],
      };
    case 8:
      // 2 top, 2 left, 2 right, 2 bottom
      return {
        top: [0, 1],
        left: [7, 6],
        right: [2, 3],
        bottom: [5, 4],
      };
    case 9:
      // 3 top, 2 left, 2 right, 2 bottom
      return {
        top: [0, 1, 2],
        left: [8, 7],
        right: [3, 4],
        bottom: [6, 5],
      };
    default:
      return { top: [], left: [], right: [], bottom: [] };
  }
}

export default function Home() {
  // Change this to test different player counts (6-9)
  const [playerCount] = useState(9);
  const [isUserPlaying, setIsUserPlaying] = useState(false);
  const [showWinnings, setShowWinnings] = useState(true);
  const [raiseAmount, setRaiseAmount] = useState(100);
  const players = ALL_PLAYERS.slice(0, playerCount);
  const layout = getPlayerLayout(playerCount);
  
  // Mock game state for user actions
  const [currentBet] = useState(40);
  const minRaise = currentBet * 2;
  const userStack = 2000;

  return (
    <div className="flex flex-col min-h-screen p-4 lg:p-8 overflow-auto bg-stone-100">
      <div className="text-gray-700 flex-1 flex flex-col items-center">
        
        {/* Header - Brutalist */}
        <div className="mb-4 w-full max-w-fit flex items-center gap-4">
          <h1 className="text-lg font-bold tracking-wider">No-LLMit</h1>
          <div className="h-4 w-px bg-gray-300" />
          <button 
            onClick={() => setIsUserPlaying(!isUserPlaying)}
            className={`btn-brutal px-3 py-1 text-[10px] flex items-center gap-2 ${isUserPlaying ? 'bg-gray-700 text-white' : ''}`}
          >
            <User size={12} weight="bold" />
            {isUserPlaying ? 'PLAYING' : 'SPECTATE'}
          </button>
        </div>

        {/* Main content - centered both horizontally and vertically */}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col">
          {/* Row 1: Table + Winnings */}
          <div className="flex gap-6 items-stretch relative">
          {/* Main game grid - fixed size table structure */}
          <div className="relative border border-gray-300 bg-stone-50 shadow-sm">
            <CornerBorders />
            <table className="border-collapse" style={{ borderSpacing: 0 }}>
              <tbody>
                {/* === TOP ROW === */}
                <tr>
                  {/* Top-left empty cell */}
                  {layout.left.length > 0 && (
                    <td className="border-r border-b border-gray-700/20 w-[170px] h-[120px]" />
                  )}
                  
                  {/* Top players */}
                  {layout.top.map((idx, i) => (
                    <td 
                      key={`top-${players[idx].id}`} 
                      className={`border-b border-gray-700/20 w-[170px] h-[120px] ${i < layout.top.length - 1 ? 'border-r' : ''}`}
                    >
                      <Player 
                        player={players[idx]} 
                        active={idx === 0}
                        button={idx === 0}
                        folded={players[idx].lastAction === 'FOLD'}
                      />
                    </td>
                  ))}
                  
                  {/* Top-right empty cell */}
                  {layout.right.length > 0 && (
                    <td className="border-l border-b border-gray-700/20 w-[170px] h-[120px]" />
                  )}
                </tr>

                {/* === MIDDLE ROWS (one per side player) === */}
                {Array.from({ length: Math.max(layout.left.length, layout.right.length) }).map((_, rowIdx) => (
                  <tr key={`middle-${rowIdx}`}>
                    {/* Left player for this row */}
                    {layout.left.length > 0 && (
                      <td className={`border-r border-b border-gray-700/20 w-[170px] h-[120px]`}>
                        {layout.left[rowIdx] !== undefined && (
                          <Player 
                            player={players[layout.left[rowIdx]]} 
                            active={layout.left[rowIdx] === 0}
                            button={layout.left[rowIdx] === 0}
                            folded={players[layout.left[rowIdx]].lastAction === 'FOLD'}
                          />
                        )}
                      </td>
                    )}

                    {/* Table area - spans all middle columns, only render on first middle row */}
                    {rowIdx === 0 && (
                      <td 
                        className="bg-pattern border-b border-gray-700/20"
                        colSpan={layout.top.length}
                        rowSpan={Math.max(layout.left.length, layout.right.length)}
                      >
                        <div className="flex items-center justify-center h-full">
                          <Table cards={MOCK_COMMUNITY_CARDS} pot={MOCK_POT} />
                        </div>
                      </td>
                    )}

                    {/* Right player for this row */}
                    {layout.right.length > 0 && (
                      <td className={`border-l border-b border-gray-700/20 w-[170px] h-[120px]`}>
                        {layout.right[rowIdx] !== undefined && (
                          <Player 
                            player={players[layout.right[rowIdx]]} 
                            active={layout.right[rowIdx] === 0}
                            button={layout.right[rowIdx] === 0}
                            folded={players[layout.right[rowIdx]].lastAction === 'FOLD'}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                ))}

                {/* === BOTTOM ROW === */}
                <tr>
                  {/* Bottom-left empty cell */}
                  {layout.left.length > 0 && (
                    <td className="border-r border-gray-700/20 w-[170px] h-[120px]" />
                  )}
                  
                  {/* Bottom players - equal width using flexbox inside a spanning cell */}
                  <td colSpan={layout.top.length} className="h-[120px] p-0">
                    <div className="flex h-full">
                      {layout.bottom.map((playerIdx, i) => (
                        <div 
                          key={`bottom-${players[playerIdx].id}`}
                          className={`flex-1 ${i < layout.bottom.length - 1 ? 'border-r border-gray-700/20' : ''}`}
                        >
                          <Player 
                            player={players[playerIdx]} 
                            active={playerIdx === 0}
                            button={playerIdx === 0}
                            folded={players[playerIdx].lastAction === 'FOLD'}
                          />
                        </div>
                      ))}
                    </div>
                  </td>
                  
                  {/* Bottom-right empty cell */}
                  {layout.right.length > 0 && (
                    <td className="border-l border-gray-700/20 w-[170px] h-[120px]" />
                  )}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Rankings sidebar - fixed width, only shown when showWinnings is true */}
          {showWinnings && (
            <div className="flex flex-col border border-gray-300 relative w-[240px] shrink-0 bg-stone-50 shadow-sm">
              <CornerBorders />
              <div className="flex items-start justify-between p-3 border-b border-gray-700/20">
                <div className="flex flex-col">
                  <h2 className="text-xs font-bold uppercase tracking-wider">Winnings</h2>
                  <p className="text-[10px] text-gray-700/50">How the models are doing</p>
                </div>
                <button 
                  onClick={() => setShowWinnings(false)}
                  className="text-gray-400 hover:text-gray-700 transition-colors p-1"
                  title="Hide winnings"
                >
                  <EyeSlash size={16} weight="bold" />
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                <Rankings players={players} />
              </div>
            </div>
          )}
          
          {/* Show winnings button - absolutely positioned when hidden */}
          {!showWinnings && (
            <button
              onClick={() => setShowWinnings(true)}
              className="absolute top-0 right-0 flex items-center justify-center w-10 h-10 border border-gray-300 bg-stone-50 shadow-sm text-gray-400 hover:text-gray-700 transition-colors"
              title="Show winnings"
            >
              <Eye size={18} weight="bold" />
            </button>
          )}
          </div>

          {/* Row 2: Player Action Panel - BELOW the table+winnings */}
          {isUserPlaying && (
            <div className="mt-6 flex w-full justify-end">
              {/* Action panel - fixed width, right-aligned */}
              <div className="w-[557px] border border-gray-300 bg-stone-50 shadow-sm relative">
                <CornerBorders />
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px] uppercase tracking-wider text-gray-700/50">Your Action</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-gray-700/50">To Call:</span>
                      <span className="text-sm font-bold text-gray-700">¤{currentBet}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <button className="btn-brutal btn-brutal-danger px-5 py-2 text-xs">FOLD</button>
                    <button className="btn-brutal px-5 py-2 text-xs">
                      {currentBet === 0 ? 'CHECK' : `CALL ¤${currentBet}`}
            </button>
                    <div className="flex items-center gap-2">
                      <button className="btn-brutal btn-brutal-warning px-5 py-2 text-xs">RAISE</button>
                      <div className="flex items-center border border-gray-700/20">
                        <span className="text-gray-700/50 px-2 text-sm">¤</span>
                        <input
                          type="number"
                          value={raiseAmount}
                          onChange={(e) => setRaiseAmount(Number(e.target.value))}
                          min={minRaise}
                          max={userStack}
                          step={10}
                          className="input-brutal w-16 px-2 py-1 text-sm text-right"
                        />
                      </div>
                    </div>
                    <button className="btn-brutal btn-brutal-success px-5 py-2 text-xs ml-auto">ALL-IN</button>
                  </div>
                  
                  <div className="mt-3 flex items-center gap-3">
                    <span className="text-[10px] text-gray-500">¤{minRaise}</span>
                    <input
                      type="range"
                      min={minRaise}
                      max={userStack}
                      step={10}
                      value={raiseAmount}
                      onChange={(e) => setRaiseAmount(Number(e.target.value))}
                      className="flex-1 h-2 bg-gray-300 rounded appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-gray-700 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
                    />
                    <span className="text-[10px] text-gray-500">¤{userStack}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          </div>
        </div>
      </div>

    </div>
  );
}

const Player = ({ 
  player, 
  active, 
  button, 
  folded = false 
}: { 
  player: MockPlayer; 
  active?: boolean; 
  button?: boolean;
  folded?: boolean;
}) => {
  return (
    <div className={`p-px bg-stone-300 overflow-hidden relative ${active ? "border-animation" : ""} h-full flex flex-col ${folded ? "opacity-40" : ""} transition-colors`}>
      <div className="relative bg-stone-50 hover:bg-stone-100 flex-1 flex flex-col">
        <div className="flex flex-col lg:flex-row items-start gap-3 justify-between p-3">
          <div className="flex items-center gap-2">
            <LLMLogo model={player.name} size={20} />
            <div className="flex flex-col">
              <div className="text-[11px] font-bold uppercase tracking-wide">{player.name}</div>
              <div className="flex flex-row items-center gap-1">
                <div className="text-sm text-gray-700">¤</div>
                <div className="text-[11px] text-gray-700/60">
                  <NumberFlow value={player.stack} />
                </div>
              </div>
              {button && (
                <div className="h-2 w-2 bg-white mt-1" />
              )}
            </div>
          </div>
          <div className="flex flex-row items-center gap-1">
            {player.cards.map((card) => (
              <Card key={card} value={card} className="w-7 h-10" />
            ))}
          </div>
        </div>

        <div className="flex flex-col mt-auto p-3 pt-0">
          {player.lastAction ? (
            <div className="flex flex-row items-center gap-2">
              <div className="text-[11px] text-gray-700 font-mono uppercase font-bold tracking-wider">
                {player.lastAction}
              </div>
              {player.lastAmount > 0 && (
                <div className="flex flex-row items-center gap-1">
                  <div className="text-sm text-gray-700/60">¤</div>
                  <div className="text-[11px] text-gray-700/60">
                    <NumberFlow value={player.lastAmount} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-gray-700/30 font-mono uppercase">
              Waiting...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Table = ({ cards, pot, stakes = "5/10" }: { cards: string[]; pot: number; stakes?: string }) => {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      {/* Stakes */}
      <div className="text-xs font-bold uppercase tracking-widest text-gray-500 bg-white/80 px-3 py-1 border border-gray-300">
        ¤{stakes}
      </div>

      {/* Pot - Brutalist style */}
      {pot > 0 && (
        <div className="flex flex-row items-center gap-2 bg-white p-2 px-4 border-2 border-gray-700">
          <div className="text-xs uppercase tracking-widest text-gray-700/50">POT</div>
          <div className="text-lg text-gray-700 font-bold">
            ¤<NumberFlow value={pot} />
          </div>
        </div>
      )}

      {/* Community cards */}
      <div className="flex gap-2">
        {cards.map((card) => (
          <Card key={card} value={card} className="w-8 h-11" />
        ))}
      </div>
    </div>
  );
};

const RankingItem = ({ player, rank }: { player: MockPlayer; rank: number }) => {
  return (
    <div className="flex flex-row items-center gap-2 p-2 px-3 hover:bg-gray-700/5">
      <span className="text-[10px] text-gray-700/30 w-4 font-bold">{rank}.</span>
      <LLMLogo model={player.name} size={20} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wide truncate">{player.name}</div>
      </div>
      <div className="flex flex-row items-center gap-1">
        {player.winnings > 0 && (
          <>
            <CaretUp size={10} className="text-green-600" weight="bold" />
            <div className="text-[10px] text-green-600 font-bold">
              +{player.winnings}
            </div>
          </>
        )}
        {player.winnings < 0 && (
          <>
            <CaretDown size={10} className="text-[#ff0000]" weight="bold" />
            <div className="text-[10px] text-[#ff0000] font-bold">
              {player.winnings}
            </div>
          </>
        )}
        {player.winnings === 0 && (
          <div className="text-[10px] text-gray-700/30 font-bold">0</div>
        )}
      </div>
    </div>
  );
};

const Rankings = ({ players }: { players: MockPlayer[] }) => {
  const [rankedPlayers, setRankedPlayers] = useState(() => 
    [...players].sort((a, b) => b.winnings - a.winnings)
  );

  return (
    <Reorder.Group 
      as="ol" 
      axis="y" 
      values={rankedPlayers} 
      onReorder={setRankedPlayers} 
      className="flex flex-col divide-y divide-black/10"
    >
      {rankedPlayers.map((player, index) => (
        <Reorder.Item key={player.id} value={player}>
          <RankingItem player={player} rank={index + 1} />
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
};
