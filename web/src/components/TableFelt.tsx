"use client";

import Card from "@/components/Card";
import NumberFlow from '@number-flow/react';
import { CircleNotch, Moon } from "@phosphor-icons/react";
import ChipStack from "@/components/ChipStack";
import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence } from "motion/react";
import { Deck, DeckPhase } from "@/components/TableMotion";
import { TableNoticePayload } from "@/lib/api";
import type { ButtonDetermination } from "@/lib/stream";
import { useSecondsDraw } from "@/hooks/useSecondsDraw";
import { amountParts, formatAmount, useBigBlind } from "@/lib/amounts";
import { BLUE } from "@/lib/stats";
import { formatDuration, formatLocalTime } from "@/lib/time";
import { useFillIn } from "@/lib/boxes";
import { DECK } from "@/lib/phoneTable";
import { cardClassOf, useCardLook, useCardSize } from "@/lib/tableSwitches";
import { isDraftA } from "@/lib/layout";
const noSub = () => () => {};
import { arrivedDealAt } from "@/lib/stream";

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
  bets?: FeltBet[]; // placed on the felt's edges (desktop; the phone table places its own, BetStack)
  winners?: WinnerDisplay[];
  nextDealAt?: number | null; // Date.now() of the next deal while the next-hand countdown shows; null: none
  buttonDetermination?: ButtonDetermination | null;
  notice?: TableNoticePayload | null;
  deck?: DeckPhase | null; // the deck between hands, in the board's place (TableMotion)
  blank?: boolean; // no state yet: the felt at its size with nothing on it
  compact?: boolean; // the phone table's middle (PokerTable): only the pot and the board, no grid
  plain?: boolean; // draft A's tall table (PokerTable): no grid of its own, the drawn felt under it shows through
  fillIn?: boolean; // fade in as it fills; false for a felt mounted by a layout switch mid-hand (it shows the hand as it stands)
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

// A small chip stack and the amount, like CoinPoker: each street's bets sit in front of the seats. Desktop: on the felt's
// edges (EDGE); the phone table places each between its seat and the pot, as one chip (compact).
export function BetStack({ seat, amount, style, compact }: { seat: number; amount: number; style: CSSProperties; compact?: boolean }) {
  const bb = useBigBlind();
  if (amount <= 0) return null;
  return (
    <div data-bet={seat} className={`absolute flex items-center ${compact ? 'gap-1' : 'gap-1.5 max-md:hidden'}`} style={style} title={`Bet ${formatAmount(amount, bb)}`}>
      <ChipStack amount={compact ? Math.min(amount, 9) : amount} />
      <span data-chips={amount} className="text-[12px] font-bold tabular-nums leading-5" style={{ color: 'rgb(55, 53, 47)' }}>{formatAmount(amount, bb)}</span>
    </div>
  );
}

// The felt's grid: the desktop's, and the phone table's felt (PokerTable).
export const GRID: CSSProperties = {
  backgroundImage: 'linear-gradient(to right, rgba(0,0,0,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.03) 1px, transparent 1px)',
  backgroundSize: '20px 20px',
};

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
  nextDealAt = null,
  buttonDetermination,
  notice,
  deck,
  blank = false,
  compact = false,
  plain = false,
  fillIn = true,
}: TableFeltProps) {
  const bb = useBigBlind(), size = useCardSize(), look = useCardLook(), still = useSyncExternalStore(noSub, isDraftA, () => false);
  const potIn = amountParts(pot, bb);
  const collected = Math.max(0, pot - betsOut);
  // Show button determination if in progress
  const showButtonDetermination = buttonDetermination && buttonDetermination.cards.length > 0;
  const ref = useRef<HTMLDivElement>(null);
  const [fill] = useState(fillIn); // as it mounted: a switched felt never fades, however the hand goes on
  useFillIn(ref, fill && !blank);
  // Cards dealt while watching rise into place; the ones already out when the felt fills fade in with it.
  const [live, setLive] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- after the commit that filled the felt
  useEffect(() => { if (!blank) setLive(true); }, [blank]);
  // "Next hand in Ns": its seconds drawn on each whole-second edge from the deal's time (useSecondsDraw), not rendered
  // each second; the line goes at 0, before page.tsx's render that ends the countdown.
  const countBox = useRef<HTMLElement>(null), countText = useRef<HTMLSpanElement>(null);
  useSecondsDraw(nextDealAt ? now => arrivedDealAt(nextDealAt) - now : null, s => {
    if (s === null || !countText.current || !countBox.current) return;
    countText.current.textContent = `${s}s`;
    countBox.current.style.visibility = s > 0 ? '' : 'hidden';
  });
  return (
    <div 
      ref={ref}
      data-felt
      className={`relative flex flex-col items-center w-full h-full ${compact ? 'justify-start' : `justify-center gap-3 ${bets ? 'pt-[44px] pb-3' : 'py-2'}`} ${blank ? '[&>*]:invisible' : ''}`}
      style={compact || plain ? undefined : GRID}
    >
      {bets?.map(b => <BetStack key={b.seat} seat={b.seat} amount={b.amount} style={EDGE[b.side](b.at)} />)}


      {/* Winner announcement or Pot */}
      <div className={`${compact ? 'h-[30px]' : 'h-[74px]'} w-full flex items-start justify-center`}>
        {winners.length > 0 && compact ? (
          // The phone: who won and how much in the pot's place; the hand under the board.
          <div data-pot className={`h-[30px] max-w-[220px] px-3 flex items-center gap-1 bg-green-50 border border-green-500 text-xs whitespace-nowrap`}>
            <span className="text-green-700 font-bold truncate">{winners[0].name}</span>
            <span data-chips={winners[0].amount} className="text-green-700 tabular-nums">+{formatAmount(winners[0].amount, bb)}</span>
            {winners.length > 1 && <span className="text-green-700">+{winners.length - 1}</span>}
          </div>
        ) : winners.length > 0 ? (
          <div data-pot className="flex flex-col items-center bg-green-50 border border-green-500 overflow-hidden p-2 px-3 max-w-full">
            {winners.slice(0, 1).map((w, i) => (
              <div key={i} className="text-center">
                <span className="text-green-700 font-bold text-xs">{w.name}</span>
                <span data-chips={w.amount} className="text-green-700 text-xs whitespace-nowrap tabular-nums"> +{formatAmount(w.amount, bb)}</span>
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
          <div data-pot={compact || undefined} className={`flex flex-col items-center ${compact ? '' : 'gap-3'}`}>
            <div data-chips={pot} className={`flex flex-row items-center gap-2 bg-white border-2 border-gray-700 shadow-sm ${compact ? 'h-[30px] px-3' : 'p-2 px-4'}`} aria-label={`Pot ${formatAmount(pot, bb)}`}>
              <div className={`${compact ? 'text-[11px]' : 'text-xs'} uppercase tracking-wider text-gray-600`}>POT</div>
              <div className={`${compact ? 'text-[15px] leading-5' : 'text-[20px] leading-7'} text-gray-700 font-bold tabular-nums`}>
                <NumberFlow animated={!still} value={potIn.value} format={potIn.format} suffix={potIn.suffix} locales="en-US" />
              </div>
            </div>
            {/* data-pot: where TableMotion's chips land (the phone's: the pot itself; only the board is under it) */}
            {!compact && <div data-pot className={`flex items-center gap-1.5 h-[18px] ${collected > 0 ? '' : 'invisible'}`} aria-hidden={collected <= 0} title="Chips collected so far">
              <ChipStack amount={collected} />
              <span data-chips={collected} className="text-[12px] font-bold tabular-nums leading-5" style={{ color: 'rgb(55, 53, 47)' }}>{formatAmount(collected, bb)}</span>
            </div>}
          </div>
        )}
      </div>

      {/* Community cards or Button Determination; between hands, the deck being shuffled in the board's place */}
      {/* Compact: above the seats, which a notice or the button draw may reach past the board's row. */}
      <div data-felt-cards className={`flex items-center ${compact ? 'relative z-10 mt-1 h-[42px] gap-1' : 'gap-2 min-h-[70px]'}`}>
        {notice ? (
          <TableNoticeCard notice={notice} />
        ) : showButtonDetermination ? (
          <div className="flex flex-col items-center gap-2">
            {/* The tall table's middle (plain) is narrower than nine cards: two rows there, not under the side seats. */}
            <div className={`flex gap-1 justify-center${plain ? ' flex-wrap' : ''}`}>
              {buttonDetermination.cards.map((bc, i) => (
                <div key={i} className="flex flex-col items-center gap-0.5">
                  <Card value={bc.card} className={cardClassOf(size, look)} rise={live} />
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
              <Card key={`${card}-${i}`} value={card} className={cardClassOf(size, look)} rise={live} />
            ))}
            {/* The phone's deck between hands takes the board's place too, as the desktop's does, 8px under the pot so
                it never covers the pot's label (phoneTable's DECK). */}
            {compact ? <AnimatePresence initial={false}>{deck && <div key="deck" className="relative" style={{ top: DECK.top + 2, width: DECK.w, height: DECK.h }}><Deck phase={deck} /></div>}</AnimatePresence>
              : <AnimatePresence initial={false}>{deck && <Deck key="deck" phase={deck} />}</AnimatePresence>}
          </>
        )}
      </div>

      {/* Next hand countdown. Its slot is always there, so the felt (and the seat rows) never
          change height when it appears: 44+74+12+70+12+32+12 = 256px, two 128px rows. The top
          padding keeps the POT box 16px clear of the top seats' bets; the countdown shares the
          bottom edge with the bottom seats' bets, which are gone by the time it shows. */}
      {compact ? (
        // The phone: two quiet lines under the board, clear of the seats around it: the winning hand, the next hand's time.
        <div className="h-[36px] mt-1 flex flex-col items-center text-[12px] leading-[18px] whitespace-nowrap" style={{ color: 'rgb(55, 53, 47)' }}>
          {winners[0]?.handDesc && <span className="max-w-[240px] truncate text-green-700">{winners[0].handDesc}</span>}
          {nextDealAt !== null && <span ref={countBox}>Next hand in <span ref={countText} className="font-bold tabular-nums" /></span>}
        </div>
      ) : (
      <div className="h-[32px] flex items-center">
      {nextDealAt !== null && (
        <div ref={el => { countBox.current = el; }}
          className="flex items-center gap-2 bg-white px-4 py-1.5 rounded"
          style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
        >
          <CircleNotch size={14} className="animate-spin" style={{ color: BLUE }} />
          <span className="text-[12px]" style={{ color: 'rgb(55, 53, 47)' }}>
            Next hand in <span ref={countText} className="font-bold tabular-nums" />
          </span>
        </div>
      )}
      </div>
      )}
    </div>
  );
}
