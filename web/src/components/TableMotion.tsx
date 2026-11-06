"use client";

import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "motion/react";
import { PlayerState } from "@/lib/api";
import { playSound } from "@/lib/sound";

// Seconds. Two rounds of cards to 9 seats land in about 1.1 s, well inside the thinking phase.
export const DEAL_STAGGER = 0.04;
export const FLIGHT = 0.4;

// Deal order: the seat left of the button gets the first card.
export function dealOrder(players: PlayerState[], idx: number) {
  const button = Math.max(0, players.findIndex(p => p.isButton));
  return (idx - button - 1 + players.length) % players.length;
}

// When a seat's card `round` (0 or 1) leaves the felt: one card to each seat, then the second.
export function dealStart(players: PlayerState[], idx: number, round: number) {
  return (round * players.length + dealOrder(players, idx)) * DEAL_STAGGER;
}

interface Snapshot {
  hand: number;
  stacks: Record<string, number>;
  bets: Record<string, number>;
  board: number;
  winners: string;
}

// The phone and desktop layouts are both in the DOM; use the one that is showing.
function visibleRect(selector: string): DOMRect | null {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0) return r;
  }
  return null;
}

function fly(layer: HTMLElement, kind: 'chip' | 'card', from: DOMRect | null, to: DOMRect | null, delay = 0) {
  if (!from || !to) return;
  const el = document.createElement('div');
  el.className = `flight-${kind}`;
  el.style.opacity = '0';
  layer.appendChild(el);
  // The layer may sit under CSS zoom (.stage-zoom on wide windows): convert viewport px to its px.
  const z = layer.getBoundingClientRect().width / layer.offsetWidth || 1;
  const [x0, y0] = [(from.left + from.width / 2) / z, (from.top + from.height / 2) / z];
  const [x1, y1] = [(to.left + to.width / 2) / z, (to.top + to.height / 2) / z];
  // Chips are tossed in a low arc; cards slide flat across the felt.
  const lift = kind === 'chip' ? Math.min(60, 20 + Math.hypot(x1 - x0, y1 - y0) * 0.15) : 0;
  animate(el, { x: [x0, x1], y: [y0, (y0 + y1) / 2 - lift, y1], opacity: [1, 1, 0] }, {
    x: { duration: FLIGHT, delay, ease: 'easeOut' },
    y: { duration: FLIGHT, delay, times: [0, 0.4, 1], ease: ['easeOut', 'easeIn'] },
    // Fade only in the last fifth, once it has reached the pot or seat.
    opacity: { duration: FLIGHT, delay, times: [0, 0.8, 1] },
  }).then(() => el.remove());
}

interface TableMotionProps {
  players: PlayerState[];
  handNumber: number;
  boardCount: number;
  winnerIdxs: number[];
}

// Chips and cards flying across the table, plus the table sounds. Driven only by the
// difference between consecutive game states; it never holds up the server's timing.
export default function TableMotion({ players, handNumber, boardCount, winnerIdxs }: TableMotionProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const prev = useRef<Snapshot | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduce = useReducedMotion();
  const winners = winnerIdxs.length ? `${handNumber}:${winnerIdxs.join(',')}` : '';

  useEffect(() => {
    const before = prev.current;
    const now: Snapshot = {
      hand: handNumber,
      stacks: Object.fromEntries(players.map(p => [p.id, p.stack])),
      bets: Object.fromEntries(players.map(p => [p.id, p.currentBet])),
      board: boardCount,
      winners,
    };
    prev.current = now;
    if (!before || players.length === 0) return;

    // Nothing in a background tab: flights and sounds would queue up until it is shown again.
    if (document.hidden) return;
    const layer = reduce ? null : layerRef.current;
    const newHand = now.hand !== before.hand;
    const seat = (idx: number) => visibleRect(`[data-seat="${idx}"]`);

    if (newHand) {
      layer?.replaceChildren(); // drop any flight stuck while frames were paused
      timers.current.forEach(clearTimeout);
      timers.current = [];
      players.forEach((p, idx) => {
        p.holeCards?.forEach((_, round) => {
          const delay = dealStart(players, idx, round);
          const target = visibleRect(`[data-seat="${idx}"] [data-hole] > :nth-child(${round + 1})`);
          if (layer) fly(layer, 'card', visibleRect('[data-felt-cards]'), target, delay);
          timers.current.push(setTimeout(() => playSound('deal'), delay * 1000));
        });
      });
    } else if (now.board > before.board) {
      playSound('deal');
    }

    // Chips out: the stack went down (or, on a new hand, the blinds were posted). They land on the
    // seat's bet in front of it. The engine zeroes every currentBet before it broadcasts the action
    // that closes a street, so the closing call flies straight to the pot, and the bets left in front
    // of the seats slide in from their chip icons (BetStack keeps an invisible box, with its last
    // amount, there for this, so the icon has not moved).
    const pot = visibleRect('[data-pot]');
    const bet = (idx: number) => visibleRect(`[data-bet="${idx}"] .chip-stack`);
    const streetClosed = !newHand && players.every(p => p.currentBet === 0) && Object.values(before.bets).some(b => b > 0);
    let chips = false;
    players.forEach((p, idx) => {
      const put = newHand ? p.currentBet > 0 : p.stack < (before.stacks[p.id] ?? p.stack);
      if (put) {
        chips = true;
        if (layer) fly(layer, 'chip', seat(idx), p.currentBet > 0 ? bet(idx) : pot);
      }
      if (streetClosed && (before.bets[p.id] ?? 0) > 0) {
        chips = true;
        if (layer) fly(layer, 'chip', bet(idx), pot);
      }
    });
    if (chips) playSound('chip');

    if (winners && winners !== before.winners) {
      // If the last call came in with this state, let it reach the pot first.
      const after = chips ? FLIGHT : 0;
      winnerIdxs.forEach((idx, i) => {
        if (layer) fly(layer, 'chip', visibleRect('[data-pot]'), seat(idx), after + i * 0.06);
      });
      playSound('showdown');
    }
    // winnerIdxs is summarised by `winners`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, handNumber, boardCount, winners, reduce]);

  useEffect(() => {
    const pending = timers;
    return () => pending.current.forEach(clearTimeout);
  }, []);

  return <div ref={layerRef} aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden" />;
}
