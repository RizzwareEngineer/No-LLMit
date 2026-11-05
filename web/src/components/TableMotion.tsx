"use client";

import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "motion/react";
import { PlayerState } from "@/lib/api";
import { playSound } from "@/lib/sound";

// Seconds. A whole deal (9 seats) lands in under a second, well inside the thinking phase.
export const DEAL_STAGGER = 0.06;
export const FLIGHT = 0.4;

// Deal order: the seat left of the button gets the first card.
export function dealOrder(players: PlayerState[], idx: number) {
  const button = Math.max(0, players.findIndex(p => p.isButton));
  return (idx - button - 1 + players.length) % players.length;
}

interface Snapshot {
  hand: number;
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
  const x = [from.left + from.width / 2, to.left + to.width / 2];
  const y = [from.top + from.height / 2, to.top + to.height / 2];
  // Fade only in the last fifth, once it has reached the pot or seat.
  animate(el, { x, y, opacity: [1, 1, 0] }, { duration: FLIGHT, delay, ease: 'easeOut', opacity: { duration: FLIGHT, delay, times: [0, 0.8, 1] } }).then(() => el.remove());
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
  const reduce = useReducedMotion();
  const winners = winnerIdxs.length ? `${handNumber}:${winnerIdxs.join(',')}` : '';

  useEffect(() => {
    const before = prev.current;
    const now: Snapshot = {
      hand: handNumber,
      bets: Object.fromEntries(players.map(p => [p.id, p.currentBet])),
      board: boardCount,
      winners,
    };
    prev.current = now;
    if (!before || players.length === 0) return;

    // No flights in a background tab: they would queue up until it is shown again.
    const layer = reduce || document.hidden ? null : layerRef.current;
    const newHand = now.hand !== before.hand;
    const seat = (idx: number) => visibleRect(`[data-seat="${idx}"]`);

    if (newHand) {
      layer?.replaceChildren(); // drop any flight stuck while frames were paused
      players.forEach((p, idx) => {
        if (!p.holeCards?.length) return;
        const delay = dealOrder(players, idx) * DEAL_STAGGER;
        if (layer) fly(layer, 'card', visibleRect('[data-felt-cards]'), visibleRect(`[data-seat="${idx}"] [data-hole]`), delay);
        setTimeout(() => playSound('deal'), delay * 1000);
      });
    } else if (now.board > before.board) {
      playSound('deal');
    }

    let chips = false;
    players.forEach((p, idx) => {
      const was = newHand ? 0 : before.bets[p.id] ?? 0;
      if (p.currentBet > was) {
        chips = true;
        if (layer) fly(layer, 'chip', seat(idx), visibleRect('[data-pot]'));
      }
    });
    if (chips) playSound('chip');

    if (winners && winners !== before.winners) {
      winnerIdxs.forEach((idx, i) => {
        if (layer) fly(layer, 'chip', visibleRect('[data-pot]'), seat(idx), i * DEAL_STAGGER);
      });
      playSound('showdown');
    }
    // winnerIdxs is summarised by `winners`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, handNumber, boardCount, winners, reduce]);

  return <div ref={layerRef} aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden" />;
}
