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
  stakes?: string;
  winners?: WinnerDisplay[];
}

export default function TableFelt({ cards, pot, stakes = "5/10", winners = [] }: TableFeltProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 w-[280px]">
      {/* Stakes */}
      <div className="text-xs font-bold uppercase tracking-widest text-gray-500 bg-white/80 px-3 py-1 border border-gray-300">
        ¤{stakes}
      </div>

      {/* Winner announcement or Pot - fixed size container */}
      <div className="h-[48px] w-full flex items-center justify-center">
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

      {/* Community cards */}
      <div className="flex gap-2 min-h-[44px]">
        {cards.length > 0 ? (
          cards.map((card, i) => (
            <Card key={`${card}-${i}`} value={card} className="w-8 h-11" />
          ))
        ) : (
          <div className="text-[10px] text-gray-400 uppercase">No cards dealt</div>
        )}
      </div>
    </div>
  );
}

