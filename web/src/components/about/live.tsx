'use client';

import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useReducedMotion } from 'motion/react';
import PokerTable from '@/components/PokerTable';
import { Caption } from '@/components/ReasoningPanel';
import Fit from '@/components/Fit';
import { useGameState } from '@/hooks/useGameState';
import { useLayout } from '@/lib/tableSwitches';
import { BLUE } from '@/lib/stats';

// The About drafts (?about=a, b or c on /about): the live table, the same stream and the same PokerTable as the home page,
// and what the drafts point at on it. One stream for the page (LiveProvider); the table is the real component at its
// locked desktop geometry (1000px across, 200x128 seats), drawn smaller as one picture (Fit) where its column is narrower.

export type Draft = 'a' | 'b' | 'c';
const noSub = () => () => {};
const readDraft = (): Draft | null => { const v = new URLSearchParams(location.search).get('about'); return v === 'a' || v === 'b' || v === 'c' ? v : null; };
// null on the server and at hydration, so /about without a switch renders exactly as before.
export const useAboutDraft = () => useSyncExternalStore(noSub, readDraft, () => null);

type Game = ReturnType<typeof useGameState>;
type LiveValue = Game & { actor: number; step: Step };
const LiveCtx = createContext<LiveValue | null>(null);
export const useLive = () => useContext(LiveCtx)!;

// The four steps of a turn, as the table shows them: 1 the engine deals, 2 the model on the clock gets the prompts (it is
// thinking), 3 it answers (its reason is out), 4 the engine checks the move and applies it (the action is on the seat).
export type Step = 1 | 2 | 3 | 4;
const stepOf = (g: Game): Step => {
  const d = g.displayState;
  if (!d || g.gameState?.street === 'complete') return 1;
  return d.phase === 'thinking' ? 2 : d.phase === 'reasoning' ? 3 : 4;
};

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const g = useGameState(null);
  const d = g.displayState;
  const actor = d?.playerIdx ?? g.gameState?.currentPlayerIdx ?? -1;
  const step = stepOf(g);
  const value = useMemo(() => ({ ...g, actor, step }), [g, actor, step]);
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

// A mark on the live table: a ring round the part, and its number in a badge at the ring's top-left corner ('' for none).
// `sel`: selectors tried in turn, joined by ' || ' (the first that finds a part wins).
export type Mark = { n: number | string; sel: string };

// The table, its live caption (the turn's model, action and reason: the real ReasoningPanel caption) and the marks.
export function LiveTable({ marks = [], caption = true, className = '' }: { marks?: Mark[]; caption?: boolean; className?: string }) {
  const g = useLive();
  const mounted = useLayout();
  const gs = g.gameState;
  const players = gs?.players ?? [];
  const street = gs?.street ?? 'preflop';
  const handNumber = gs?.handNumber ?? 0;
  const d = g.displayState;
  const winners = gs?.winners ?? [];
  const winnersByIdx = street === 'complete' ? winners.reduce((acc, w) => {
    acc[w.playerIdx] ??= { amount: 0, handDesc: w.handDesc || w.handType };
    acc[w.playerIdx].amount += w.amount;
    return acc;
  }, {} as Record<number, { amount: number; handDesc: string }>) : {};
  const seatStats = useMemo(() => (g.stats ? Object.fromEntries(g.stats.models.map(m => [m.name, m])) : undefined), [g.stats]);
  const onClock = d?.phase === 'thinking' || d?.phase === 'reasoning';
  const table = (
    <PokerTable
      players={players}
      currentPlayerIdx={g.actor}
      communityCards={gs?.communityCards ?? []}
      pot={gs?.pot ?? 0}
      winnersByIdx={winnersByIdx}
      nextDealAt={street === 'complete' ? g.dealAt : null}
      thinkingPlayerIdx={onClock ? d.playerIdx : undefined}
      buttonDetermination={g.buttonDetermination}
      notice={g.tableNotice}
      street={street}
      handNumber={handNumber}
      stats={seatStats}
      display={d}
      clock={onClock ? g.clock : null}
    />
  );
  const box = useRef<HTMLDivElement>(null);
  return (
    // The phone's oval at the height its seats are laid out for (phoneTable's 460px), not the home page's whole first screen.
    <div ref={box} data-live-table className={`relative ${className}`} style={{ '--oval-h': '460px', '--phone-slack': '0px' } as React.CSSProperties}>
      {mounted === 'desk' ? <Fit w={1000}>{table}</Fit> : mounted === 'phone' ? table : <div className="aspect-[1000/642] max-md:h-[460px]" />}
      {caption && <div className="mt-3"><Caption displayState={d} blank={players.length === 0} turnKey={d ? `${handNumber}:${d.turn}` : ''} /></div>}
      <Marks box={box} marks={marks} />
    </div>
  );
}

// The marks, placed over what they point at (found by selector inside the table's box) and following it as the table
// plays: measured on every animation frame while any mark shows (a seat's ring moves on as the turn does).
function Marks({ box, marks }: { box: React.RefObject<HTMLDivElement | null>; marks: Mark[] }) {
  const reduce = useReducedMotion();
  const [at, setAt] = useState<{ n: Mark['n']; x: number; y: number; w: number; h: number }[]>([]);
  const key = marks.map(m => `${m.n}:${m.sel}`).join('|');
  useLayoutEffect(() => {
    if (!marks.length) return;
    let raf = 0;
    const tick = () => {
      const b = box.current?.getBoundingClientRect();
      if (b) {
        const next = marks.flatMap(m => {
          const el = m.sel.split(' || ').map(q => box.current!.querySelector(q)).find(Boolean);
          const r = el?.getBoundingClientRect();
          return r && r.width ? [{ n: m.n, x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height }] : [];
        });
        setAt(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30">
      {(marks.length ? at : []).map((m, i) => (
        <div
          key={i}
          data-mark={m.n}
          className={`absolute rounded-md ${reduce ? '' : 'transition-[left,top,width,height] duration-300'}`}
          style={{ left: m.x - 4, top: m.y - 4, width: m.w + 8, height: m.h + 8, boxShadow: `0 0 0 2px ${BLUE}, 0 0 0 6px rgba(35, 131, 226, 0.15)`, transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
        >
          {m.n !== '' && <span className="absolute -left-3 -top-3 grid place-items-center h-6 min-w-6 px-1.5 rounded-full text-[13px] font-bold tabular-nums text-white whitespace-nowrap" style={{ background: BLUE }}>{m.n}</span>}
        </div>
      ))}
    </div>
  );
}

// Where each step of a turn is on the table: the board for the deal, the seat on the clock for the prompt, the caption
// for the answer, the seat's action for the check (the seat itself until its action shows).
export function stepMark(step: Step, actor: number): Mark {
  const seat = actor >= 0 ? `[data-seat="${actor}"]` : '[data-felt]';
  if (step === 1) return { n: 1, sel: '[data-felt-cards]' };
  if (step === 2) return { n: 2, sel: seat };
  if (step === 3) return { n: 3, sel: '[data-caption]' };
  return { n: 4, sel: actor >= 0 ? `[data-seat="${actor}"] [data-action] || ${seat}` : seat };
}

// The step the reader picked (pinned), else the step the live hand is on.
export function useStep() {
  const { step } = useLive();
  const [pinned, setPinned] = useState<Step | null>(null);
  return { step: pinned ?? step, live: step, pinned, setPinned };
}
