"use client";

import Card from "@/components/Card";
import NumberFlow from '@number-flow/react';
import { CircleNotch, Moon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TableNoticePayload } from "@/lib/api";
import { formatDuration, formatLocalTime } from "@/lib/time";
import type { ButtonDetermination } from "@/hooks/useGameState";

interface WinnerDisplay {
  name: string;
  amount: number;
  handDesc: string;
}

interface TableFeltProps {
  cards: string[];
  pot: number;
  winners?: WinnerDisplay[];
  nextHandCountdown?: number | null;
  buttonDetermination?: ButtonDetermination | null;
  notice?: TableNoticePayload | null;
  hudSlot?: React.ReactNode; // under the board, above the countdown
}

// Shown on the felt while the table is closed or at its daily call cap.
function TableNoticeCard({ notice }: { notice: TableNoticePayload }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const reopens = notice.reopensAt ? new Date(notice.reopensAt) : null;
  const headline = notice.kind === 'closed' ? 'Table closed.' : notice.message;
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-1 bg-white px-4 py-3 rounded text-center max-w-[360px]"
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px', color: 'rgb(55, 53, 47)' }}
    >
      <div className="flex items-center gap-2 text-[13px] font-bold">
        <Moon size={14} weight="bold" aria-hidden />
        {headline}
      </div>
      <div className="text-[13px]">
        {reopens
          ? <>Reopens at {formatLocalTime(reopens)} your time (in {formatDuration(reopens.getTime() - now)}).</>
          : notice.message}
      </div>
      <Link href="/about" className="text-[12px] hover:underline" style={{ color: 'rgb(35, 131, 226)' }}>
        What is this? About No-LLMit
      </Link>
    </div>
  );
}

export default function TableFelt({ 
  cards, 
  pot, 
  winners = [],
  nextHandCountdown,
  buttonDetermination,
  notice,
  hudSlot,
}: TableFeltProps) {
  // Show button determination if in progress
  const showButtonDetermination = buttonDetermination && buttonDetermination.cards.length > 0;
  return (
    <div 
      className="flex flex-col items-center justify-center gap-3 w-full h-full py-2"
      style={{
        backgroundImage: `
          linear-gradient(to right, rgba(0,0,0,0.03) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(0,0,0,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '20px 20px',
      }}
    >
      {/* Winner announcement or Pot */}
      <div data-pot className="h-[44px] w-full flex items-center justify-center">
        {winners.length > 0 ? (
          <div className="flex flex-col items-center bg-green-50 p-2 px-3 border border-green-500 max-w-full overflow-hidden">
            {winners.slice(0, 1).map((w, i) => (
              <div key={i} className="text-center">
                <span className="text-green-700 font-bold text-xs">{w.name}</span>
                <span className="text-green-700 text-xs"> +{w.amount.toLocaleString()}</span>
                <div className="text-green-700 text-[11px] truncate">{w.handDesc}</div>
              </div>
            ))}
            {winners.length > 1 && (
              <span className="text-green-700 text-[11px]">+{winners.length - 1} more</span>
            )}
          </div>
        ) : (
          <div className="flex flex-row items-center gap-2 bg-white p-2 px-4 border-2 border-gray-700 shadow-sm">
            <div className="text-xs uppercase tracking-widest text-gray-600">POT</div>
            <div className="text-lg text-gray-700 font-bold tabular-nums">
              <NumberFlow value={pot} />
            </div>
          </div>
        )}
      </div>

      {/* Community cards or Button Determination */}
      <div data-felt-cards className="flex gap-2 min-h-[70px] items-center">
        {notice ? (
          <TableNoticeCard notice={notice} />
        ) : showButtonDetermination ? (
          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-1 justify-center">
              {buttonDetermination.cards.map((bc, i) => (
                <div key={i} className="flex flex-col items-center gap-0.5">
                  <Card value={bc.card} className="w-7 h-10" />
                  <span className="text-[11px] text-gray-600 truncate max-w-[40px]">{bc.playerName.split(' ')[0]}</span>
                </div>
              ))}
            </div>
            {buttonDetermination.isComplete && buttonDetermination.winnerName && (
              <div className="bg-amber-100 border border-amber-500 px-3 py-1 rounded">
                <span className="text-amber-700 font-bold text-xs">
                  🎯 {buttonDetermination.winnerName} gets the button!
                </span>
              </div>
            )}
          </div>
        ) : cards.length > 0 ? (
          cards.map((card, i) => (
            <Card key={`${card}-${i}`} value={card} className="w-11 h-16" flip delay={i < 3 ? i * 0.08 : 0} />
          ))
        ) : (
          <div className="text-[11px] text-gray-600 uppercase">No cards dealt</div>
        )}
      </div>

      {hudSlot}

      {/* Next hand countdown. Its height is always reserved so the board never moves when it shows. */}
      <div className="h-[34px] flex items-center">
      {nextHandCountdown !== null && nextHandCountdown !== undefined && nextHandCountdown > 0 && (
        <div 
          className="flex items-center gap-2 bg-white px-4 py-2 rounded"
          style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
        >
          <CircleNotch size={14} className="animate-spin" style={{ color: 'rgb(35, 131, 226)' }} />
          <span className="text-[12px]" style={{ color: 'rgb(55, 53, 47)' }}>
            Next hand in <span className="font-bold">{nextHandCountdown}s</span>
          </span>
        </div>
      )}
      </div>
    </div>
  );
}
