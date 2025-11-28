"use client";

import Card from "@/components/Card";
import NumberFlow from '@number-flow/react';

interface TableFeltProps {
  cards: string[];
  pot: number;
  stakes?: string;
}

export default function TableFelt({ cards, pot, stakes = "5/10" }: TableFeltProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      {/* Stakes */}
      <div className="text-xs font-bold uppercase tracking-widest text-gray-500 bg-white/80 px-3 py-1 border border-gray-300">
        ¤{stakes}
      </div>

      {/* Pot */}
      {pot > 0 && (
        <div className="flex flex-row items-center gap-2 bg-white p-2 px-4 border-2 border-gray-700">
          <div className="text-xs uppercase tracking-widest text-gray-700/50">POT</div>
          <div className="text-lg text-gray-700 font-bold">
            ¤<NumberFlow value={pot} />
          </div>
        </div>
      )}

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

