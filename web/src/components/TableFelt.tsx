"use client";

import Card from "@/components/Card";
import NumberFlow from '@number-flow/react';
import { CircleNotch, Moon } from "@phosphor-icons/react";
import ChipStack from "@/components/ChipStack";
import Link from "next/link";
import { type CSSProperties, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Deck, DeckPhase } from "@/components/TableMotion";
import { TableNoticePayload } from "@/lib/api";
import type { ButtonDetermination } from "@/lib/stream";
import { amountParts, formatAmount, useBigBlind } from "@/lib/amounts";
import { BLUE } from "@/lib/stats";
import { formatDuration, formatLocalTime } from "@/lib/time";

interface WinnerDisplay {
  name: string;
  amount: number;
  handDesc: string;
}

// A bet in front of a seat, on the felt's edge facing it. `at` is 0..1 along that edge.
export interface FeltBet {
  seat: number;
  side: 'top' | 'bottom' | 'left' | 'right';
  at: number;
  amount: number;
}

interface TableFeltProps {
  cards: string[];
  pot: number; // the engine's pot, which already includes the bets still in front of the seats
  betsOut?: number; // sum of those bets
  bets?: FeltBet[]; // desktop only: placed on the felt's edges
  winners?: WinnerDisplay[];
  nextHandCountdown?: number | null;
  buttonDetermination?: ButtonDetermination | null;
  notice?: TableNoticePayload | null;
  deck?: DeckPhase | null; // the deck between hands, in the board's place (TableMotion)
  blank?: boolean; // no state yet: the felt at its size with nothing on it
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
      {/* A notice with no reopen time and no headline of its own (saving) says its message once. */}
      {(reopens || headline !== notice.message) && (
        <div className="text-[13px]">
          {reopens
            ? <>Reopens at {formatLocalTime(reopens)} your time (in {formatDuration(reopens.getTime() - now)}).</>
            : notice.message}
        </div>
      )}
      <Link href="/about" className="text-[12px] hover:underline" style={{ color: BLUE }}>
        What is this? About No-LLMit
      </Link>
    </div>
  );
}

// A small chip stack and the amount, like CoinPoker: each street's bets sit in front of the seats.
function BetStack({ seat, amount, style }: { seat: number; amount: number; style: CSSProperties }) {
  const bb = useBigBlind();
  if (amount <= 0) return null;
  return (
    <div data-bet={seat} className="absolute flex items-center gap-1.5" style={style} title={`Bet ${formatAmount(amount, bb)}`}>
      <ChipStack amount={amount} />
      <span data-chips={amount} className="text-[12px] font-bold tabular-nums leading-5" style={{ color: 'rgb(55, 53, 47)' }}>{formatAmount(amount, bb)}</span>
    </div>
  );
}

const EDGE: Record<FeltBet['side'], (at: number) => CSSProperties> = {
  top: at => ({ top: 8, left: `${at * 100}%`, transform: 'translateX(-50%)' }),
  bottom: at => ({ bottom: 8, left: `${at * 100}%`, transform: 'translateX(-50%)' }),
  left: at => ({ left: 10, top: `${at * 100}%`, transform: 'translateY(-50%)' }),
  right: at => ({ right: 10, top: `${at * 100}%`, transform: 'translateY(-50%)' }),
};

export default function TableFelt({ 
  cards, 
  pot, 
  betsOut = 0,
  bets,
  winners = [],
  nextHandCountdown,
  buttonDetermination,
  notice,
  deck,
  blank = false,
}: TableFeltProps) {
  const bb = useBigBlind();
  const potIn = amountParts(pot, bb);
  const collected = Math.max(0, pot - betsOut);
  // Show button determination if in progress
  const showButtonDetermination = buttonDetermination && buttonDetermination.cards.length > 0;
  return (
    <div 
      data-felt
      className={`relative flex flex-col items-center justify-center gap-3 w-full h-full ${bets ? 'pt-[44px] pb-3' : 'py-2'} ${blank ? '[&>*]:invisible' : ''}`}
      style={{
        backgroundImage: `
          linear-gradient(to right, rgba(0,0,0,0.03) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(0,0,0,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '20px 20px',
      }}
    >
      {bets?.map(b => <BetStack key={b.seat} seat={b.seat} amount={b.amount} style={EDGE[b.side](b.at)} />)}

      {/* Winner announcement or Pot */}
      <div className="h-[74px] w-full flex items-start justify-center">
        {winners.length > 0 ? (
          <div data-pot className="flex flex-col items-center bg-green-50 p-2 px-3 border border-green-500 max-w-full overflow-hidden">
            {winners.slice(0, 1).map((w, i) => (
              <div key={i} className="text-center">
                <span className="text-green-700 font-bold text-xs">{w.name}</span>
                <span data-chips={w.amount} className="text-green-700 text-xs whitespace-nowrap"> +{formatAmount(w.amount, bb)}</span>
                <div className="text-green-700 text-[11px] truncate">{w.handDesc}</div>
              </div>
            ))}
            {winners.length > 1 && (
              <span className="text-green-700 text-[11px]">+{winners.length - 1} more</span>
            )}
          </div>
        ) : (
          // One labelled number, as the big rooms do it: POT is the whole pot, bets out included
          // (the number pot odds need). The chips already collected are drawn under it as a chip
          // stack with a bare amount, like the stacks in front of the seats; no second label.
          <div className="flex flex-col items-center gap-3">
            <div data-chips={pot} className="flex flex-row items-center gap-2 bg-white p-2 px-4 border-2 border-gray-700 shadow-sm" aria-label={`Pot ${formatAmount(pot, bb)}`}>
              <div className="text-xs uppercase tracking-widest text-gray-600">POT</div>
              <div className="text-lg text-gray-700 font-bold tabular-nums">
                <NumberFlow value={potIn.value} format={potIn.format} suffix={potIn.suffix} />
              </div>
            </div>
            {/* data-pot: where TableMotion's chips land */}
            <div data-pot className={`flex items-center gap-1.5 h-[18px] ${collected > 0 ? '' : 'invisible'}`} aria-hidden={collected <= 0} title="Chips collected so far">
              <ChipStack amount={collected} />
              <span data-chips={collected} className="text-[12px] font-bold tabular-nums leading-5" style={{ color: 'rgb(55, 53, 47)' }}>{formatAmount(collected, bb)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Community cards or Button Determination; between hands, the deck being shuffled in the board's place */}
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
              <div className="bg-amber-100 border border-amber-500 px-3 py-1 rounded animate-pulse">
                <span className="text-amber-700 font-bold text-xs">
                  🎯 {buttonDetermination.winnerName} gets the button!
                </span>
              </div>
            )}
          </div>
        ) : (
          <>
            {!deck && cards.map((card, i) => (
              <Card key={`${card}-${i}`} value={card} className="w-11 h-16" />
            ))}
            <AnimatePresence>{deck && <Deck key="deck" phase={deck} />}</AnimatePresence>
          </>
        )}
      </div>

      {/* Next hand countdown. Its slot is always there, so the felt (and the seat rows) never
          change height when it appears: 44+74+12+70+12+32+12 = 256px, two 128px rows. The top
          padding keeps the POT box 16px clear of the top seats' bets; the countdown shares the
          bottom edge with the bottom seats' bets, which are gone by the time it shows. */}
      <div className="h-[32px] flex items-center">
      {nextHandCountdown !== null && nextHandCountdown !== undefined && nextHandCountdown > 0 && (
        <div 
          className="flex items-center gap-2 bg-white px-4 py-1.5 rounded"
          style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
        >
          <CircleNotch size={14} className="animate-spin" style={{ color: BLUE }} />
          <span className="text-[12px]" style={{ color: 'rgb(55, 53, 47)' }}>
            Next hand in <span className="font-bold">{nextHandCountdown}s</span>
          </span>
        </div>
      )}
      </div>
    </div>
  );
}
