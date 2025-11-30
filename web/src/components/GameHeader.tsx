"use client";

import CornerBorders from "@/components/CornerBorders";
import { Timer, Hash, CurrencyCircleDollar } from "@phosphor-icons/react";

interface GameHeaderProps {
  handNumber: number;
  elapsedTime: string;
  stakes: { smallBlind: number; bigBlind: number };
}

export default function GameHeader({
  handNumber,
  elapsedTime,
  stakes,
}: GameHeaderProps) {
  return (
    <div className="relative border border-gray-300 bg-stone-50 shadow-sm">
      <CornerBorders />
      <div className="flex items-center justify-between px-4 py-2">
        {/* Hand number */}
        <div className="flex items-center gap-2">
          <Hash size={14} className="text-gray-400" weight="bold" />
          <span className="text-xs font-bold text-gray-600">HAND {handNumber}</span>
        </div>

        {/* Stakes */}
        <div className="flex items-center gap-2">
          <CurrencyCircleDollar size={14} className="text-gray-400" weight="bold" />
          <span className="text-xs font-bold text-gray-600">
            ¤{stakes.smallBlind}/{stakes.bigBlind}
          </span>
        </div>

        {/* Timer */}
        <div className="flex items-center gap-2">
          <Timer size={14} className="text-gray-400" weight="bold" />
          <span className="text-xs font-mono text-gray-600">{elapsedTime}</span>
        </div>
      </div>
    </div>
  );
}

