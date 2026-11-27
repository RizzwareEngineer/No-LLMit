'use client';

import { useEffect, useRef } from 'react';
import { Club, Diamond, Heart, Spade } from '@phosphor-icons/react';
import LLMLogo from '@/components/LLMLogo';
import type { PlayerState } from '@/lib/api';
import { formatAmount, useBigBlind } from '@/lib/amounts';
import { BLUE } from '@/lib/stats';

// The table seen from far away (the tables overview's semantic zoom): the same seats and felt as the desktop table
// (PokerTable, drawn small through Fit), with only what reads at that size. `k`: layout px per screen px (1 / the
// table's scale), so each size here is set in the px it is seen at, and nothing is drawn under the legibility floor:
// a part that cannot meet it is dropped, never shrunk.
// In the zoom (PokerTable's lod 'morph') this layer lies over the full seat and felt and fades out as they fade in
// (globals.css, --lod-t).

const INK = 'rgb(55, 53, 47)', WIN = 'rgb(15, 123, 108)';
// In screen px: the target and the floor of each part.
const RANK = 16, RANK_MIN = 13, LOGO = 30, LOGO_MIN = 18, DISC = 18, POT = 18, POT_LABEL = 11, BOARD_RANK = 20;
// The desktop seat cell and the felt (PokerTable's 200x128 cells; the felt three cells by two), layout px.
const SEAT_W = 200, SEAT_H = 128, FELT_W = 600, FELT_H = 256, PAD = 6;

const SUITS: Record<string, [typeof Heart, string, string]> = {
  h: [Heart, 'rgb(239, 68, 68)', 'hearts'], d: [Diamond, 'rgb(59, 130, 246)', 'diamonds'],
  c: [Club, 'rgb(34, 197, 94)', 'clubs'], s: [Spade, 'rgb(64, 64, 64)', 'spades'],
};
const RANKS: Record<string, string> = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: '10' };

// A card for far away: the rank and the suit stacked in its left part (so a second card can overlap the first's right
// part), bolder and larger for its box than the desktop card. `f`: the rank's size in layout px.
export function FarCard({ value, f, style }: { value: string; f: number; style?: React.CSSProperties }) {
  const rank = value.slice(0, -1), [Suit, color, name] = SUITS[value.slice(-1)] ?? [null, '', ''];
  return (
    <div data-far-card role="img" aria-label={name ? `${RANKS[rank] ?? rank} of ${name}` : 'hidden card'}
      className="relative bg-white shrink-0 flex flex-col items-start"
      style={{ width: cardW(f), height: cardH(f), borderRadius: f * 0.18, padding: `${f * 0.12}px ${f * 0.14}px`, boxShadow: `0 0 0 ${f * 0.06}px rgba(15, 15, 15, 0.28)`, background: name ? 'white' : 'rgb(240, 239, 236)', ...style }}>
      {name && <span aria-hidden className="font-extrabold" style={{ fontSize: f, lineHeight: 1, color: INK, letterSpacing: '-0.02em' }}>{rank}</span>}
      {Suit && <Suit aria-hidden weight="fill" style={{ width: f * 0.72, height: f * 0.72, marginTop: f * 0.08, color }} />}
    </div>
  );
}
const cardW = (f: number) => f * 1.3, cardH = (f: number) => f * 2.0;
// Two hole cards, the second over the first's right part: what of the first shows is its rank and suit.
const holeW = (f: number) => cardW(f) * 2 - f * 0.32;

// The seat's sizes at `k`, or null cards when they cannot be drawn at the floor beside a logo at its floor.
export function farSeat(k: number) {
  let f = RANK * k, l = LOGO * k;
  const room = () => SEAT_W - 3 * PAD - l - holeW(f);
  if (room() < 0) l = Math.max(LOGO_MIN * k, SEAT_W - 3 * PAD - holeW(f));
  if (room() < 0) f = Math.max(RANK_MIN * k, f * (SEAT_W - 3 * PAD - l) / holeW(f));
  const cards = room() >= 0 && cardH(f) <= SEAT_H - 2 * PAD;
  if (!cards) l = Math.min(LOGO * k * 1.3, SEAT_H - 2 * PAD);
  return { f, l, cards };
}

// The far seat: the model's logo, large (it names the seat), its two cards, the dealer button, a chip when it has bet.
// The seat on the clock has a thick blue ring; a folded seat's logo is dimmed and its cards gone; the winner flashes green.
export function FarSeat({ player, active, winner, button, k }: { player: PlayerState; active: boolean; winner: boolean; button: boolean; k: number }) {
  const { f, l, cards } = farSeat(k), folded = player.status === 'folded' && !winner, out = player.status === 'eliminated';
  const hole = player.holeCards || [];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!winner || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    ref.current?.animate([{ backgroundColor: 'rgba(15, 123, 108, 0.35)' }, { backgroundColor: 'rgba(15, 123, 108, 0.10)' }], { duration: 1200, easing: 'ease-out', fill: 'forwards' });
  }, [winner]);
  const ring = active ? BLUE : winner ? WIN : null;
  return (
    <div ref={ref} data-far data-far-seat role="img" aria-label={`${player.name}${folded ? ', folded' : out ? ', out' : ''}`}
      className="absolute inset-0 flex items-center rounded"
      style={{ padding: PAD, gap: PAD, background: winner ? 'rgba(15, 123, 108, 0.10)' : 'white', boxShadow: ring ? `inset 0 0 0 ${3 * k}px ${ring}` : undefined }}>
      <div aria-hidden className="relative shrink-0" style={{ width: l, height: l, marginLeft: cards ? 0 : 'auto', marginRight: cards ? 0 : 'auto', opacity: folded || out ? 0.3 : 1, filter: folded || out ? 'grayscale(1)' : undefined }}>
        <LLMLogo model={player.name} size={l} />
        {button && <span data-far-button className="absolute flex items-center justify-center rounded-full bg-white font-bold"
          style={{ width: DISC * k, height: DISC * k, right: -DISC * k * 0.35, bottom: -DISC * k * 0.35, fontSize: 11 * k, lineHeight: 1, color: INK, boxShadow: `0 0 0 ${1.5 * k}px ${INK}` }}>D</span>}
        {/* Chips in front of the seat this street: one chip, no number (the pot has the amount). */}
        {player.currentBet > 0 && <span data-far-bet className="absolute rounded-full"
          style={{ width: 12 * k, height: 12 * k, right: -5 * k, top: -5 * k, background: INK, border: `${2 * k}px dashed white`, boxShadow: `0 0 0 ${1 * k}px ${INK}` }} />}
      </div>
      {cards && <div aria-hidden={folded || undefined} className="relative ml-auto" style={{ width: holeW(f), height: cardH(f), opacity: folded ? 0 : 1 }}>
        {(hole.length ? hole : ['', '']).slice(0, 2).map((c, i) => <FarCard key={i} value={c} f={f} style={{ position: 'absolute', top: 0, left: i ? cardW(f) - f * 0.32 : 0 }} />)}
      </div>}
    </div>
  );
}

// The far felt: the pot, large, and the board under it. No bets' amounts, no winner banner, no countdown.
export function FarFelt({ cards, pot, k }: { cards: string[]; pot: number; k: number }) {
  const bb = useBigBlind();
  const potH = (POT + 10) * k, gap = 8 * k;
  const f = Math.min(BOARD_RANK * k, (FELT_W - 40 - 4 * 6 * k) / 5 / 1.3, (FELT_H - 24 - potH - gap) / 2.0);
  const board = f >= RANK_MIN * k;
  const ref = useRef<HTMLSpanElement>(null), was = useRef(pot);
  useEffect(() => {
    if (was.current === pot) return;
    const up = pot > was.current;
    was.current = pot;
    if (up) ref.current?.animate([{ backgroundColor: 'rgba(31, 111, 196, 0.16)' }, { backgroundColor: 'rgba(0, 0, 0, 0)' }], { duration: 700, easing: 'ease-out' });
  }, [pot]);
  return (
    <div data-far data-far-felt aria-hidden className="absolute inset-0 flex flex-col items-center justify-center" style={{ gap }}>
      <span ref={ref} data-far-pot className="flex items-baseline bg-white rounded whitespace-nowrap tabular-nums"
        style={{ gap: 6 * k, padding: `${2 * k}px ${8 * k}px`, height: potH, alignItems: 'center', boxShadow: `0 0 0 ${2 * k}px rgb(55, 65, 81)`, visibility: pot > 0 ? undefined : 'hidden' }}>
        <span className="uppercase font-medium tracking-wider" style={{ fontSize: POT_LABEL * k, color: 'rgb(75, 85, 99)' }}>Pot</span>
        <span className="font-bold" style={{ fontSize: POT * k, lineHeight: 1, color: INK }}>{formatAmount(pot, bb)}</span>
      </span>
      {board && <div className="flex" style={{ gap: 6 * k, height: cardH(f) }}>
        {cards.map((c, i) => <FarCard key={`${c}-${i}`} value={c} f={f} />)}
      </div>}
    </div>
  );
}
