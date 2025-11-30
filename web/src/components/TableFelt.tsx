"use client";

import Card from "@/components/Card";
import NumberFlow from '@number-flow/react';

interface WinnerDisplay {
  name: string;
  amount: number;
  handDesc: string;
}

interface TableFeltProps {
  cards: string[];
  pot: number;
  winners?: WinnerDisplay[];
}

export default function TableFelt({ 
  cards, 
  pot, 
  winners = [],
}: TableFeltProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 w-[280px]">
      {/* Winner announcement or Pot */}
      <div className="h-[44px] w-full flex items-center justify-center">
        {winners.length > 0 ? (
          <div className="flex flex-col items-center bg-green-50 p-2 px-3 border border-green-500 max-w-full overflow-hidden">
            {winners.slice(0, 1).map((w, i) => (
              <div key={i} className="text-center">
                <span className="text-green-700 font-bold text-xs">{w.name}</span>
                <span className="text-green-600 text-xs"> +¤{w.amount.toLocaleString()}</span>
                <div className="text-green-600/70 text-[10px] truncate">{w.handDesc}</div>
              </div>
            ))}
            {winners.length > 1 && (
              <span className="text-green-600/70 text-[10px]">+{winners.length - 1} more</span>
            )}
          </div>
        ) : (
          <div className="flex flex-row items-center gap-2 bg-white p-2 px-4 border border-gray-700">
            <div className="text-xs uppercase tracking-widest text-gray-700/50">POT</div>
            <div className="text-lg text-gray-700 font-bold">
              ¤<NumberFlow value={pot} />
            </div>
          </div>
        )}
      </div>

      {/* Community cards - THE MAIN FOCUS */}
      <div className="flex gap-2 min-h-[70px] items-center">
        {cards.length > 0 ? (
          cards.map((card, i) => (
            <Card key={`${card}-${i}`} value={card} className="w-11 h-16" />
          ))
        ) : (
          <div className="text-[10px] text-gray-400 uppercase">No cards dealt</div>
        )}
      </div>
    </div>
  );
}
