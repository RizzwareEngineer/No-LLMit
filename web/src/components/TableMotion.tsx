"use client";

import { memo, useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { animate, motion, useReducedMotion } from "motion/react";
import { PlayerState } from "@/lib/api";
import { RIFFLE, playSound } from "@/lib/sound";
import { CARD_SIZES, cardSizeNow, deckSize, useCardSize } from "@/lib/tableSwitches";

// Seconds. A dealer pitching cards (owner 2026-11-09: the old 0.04 s deal "sounds like smacks"): a card leaves the deck
// every DEAL_STAGGER and slides for CARD_FLIGHT, so two rounds to nine seats land in about 2.7 s. Chips fly for FLIGHT.
const DEAL_STAGGER = 0.14;
export const CARD_FLIGHT = 0.28;
const FLIGHT = 0.4;

// Deal order: the seat left of the button gets the first card.
function dealOrder(players: PlayerState[], idx: number) {
  const button = Math.max(0, players.findIndex(p => p.isButton));
  return (idx - button - 1 + players.length) % players.length;
}

// When a seat's card `round` (0 or 1) leaves the deck: one card to each seat, then the second.
export function dealStart(players: PlayerState[], idx: number, round: number) {
  return (round * players.length + dealOrder(players, idx)) * DEAL_STAGGER;
}

// The deck on the felt between hands (TableFelt draws it): riffling, then squared and waiting for the deal.
export type DeckPhase = 'riffle' | 'ready';

type Box = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
const noSubscribe = () => () => {};

interface Snapshot {
  hand: number;
  stacks: Record<string, number>;
  bets: Record<string, number>;
  betAt: Record<string, { x: number; y: number }>; // each bet's centre from the felt's corner, for its flight once it is gone
  board: number;
  winners: string;
}

// The phone and desktop layouts are both in the DOM; use the one that is showing (an empty board row has no width).
function visibleRect(selector: string): DOMRect | null {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return r;
  }
  return null;
}

// Nothing moves or sounds for a table nobody is looking at: a background tab would queue it all up, and the stats
// screens have sounds of their own.
function onScreen() {
  const r = visibleRect('[data-felt]');
  return !document.hidden && !!r && r.bottom > 0 && r.top < window.innerHeight;
}

// Card backs as on Card's face-down side (.card-back, globals.css): the deck, and the cards dealt from it.
const BACK = 'rounded card-back shadow-[0_0_0_1px_rgba(255,255,255,0.85),0_1px_2px_rgba(15,15,15,0.25)]';
const FLIGHT_CLASS = {
  // A hole card (w-7 h-10) that leaves the deck at the board's size (w-11 h-16) and shrinks on the way.
  card: `absolute left-0 top-0 -ml-3.5 -mt-5 w-7 h-10 opacity-0 will-change-transform ${BACK}`,
  // One of ChipStack's chips: white top, dark edge.
  chip: 'absolute left-0 top-0 -ml-[7px] -mt-[4px] w-3.5 h-[7px] rounded-[50%] bg-white opacity-0 will-change-transform shadow-[0_0_0_0.6px_#37352f,0_2px_0_#37352f]',
};

// The stage's fit-to-screen zoom (page.tsx), read off the felt: the flights layer is outside it, in <body>.
function stageZoom() {
  const felt = [...document.querySelectorAll<HTMLElement>('[data-felt]')].find(e => e.offsetWidth > 0);
  return felt ? felt.getBoundingClientRect().width / felt.offsetWidth : 1;
}

// One flight on the layer, in viewport px, drawn at the stage's zoom `z`.
function fly(layer: HTMLElement, kind: 'chip' | 'card', from: Box | null, to: Box | null, delay: number, z: number) {
  if (!from || !to) return;
  const el = document.createElement('div');
  el.className = FLIGHT_CLASS[kind];
  el.dataset.flight = kind;
  layer.appendChild(el);
  const [x0, y0] = [from.left + from.width / 2, from.top + from.height / 2];
  const [x1, y1] = [to.left + to.width / 2, to.top + to.height / 2];
  if (kind === 'card') {
    // Slides flat across the felt; the seat's own card shows as it lands (Player's dealDelays).
    // At the hole cards' size (?cards=), from the deck's size: the board's for the default, the hole cards' for a picked size.
    const card = CARD_SIZES[cardSizeNow()];
    Object.assign(el.style, { width: `${card.w}px`, height: `${card.h}px`, marginLeft: `${-card.w / 2}px`, marginTop: `${-card.h / 2}px` });
    animate(el, { x: [x0, x1], y: [y0, y1], scale: [(deckSize().w / card.w) * z, z], opacity: [1, 1] }, { duration: CARD_FLIGHT, delay, ease: 'easeOut' }).then(() => el.remove());
    return;
  }
  // Chips are tossed in a low arc and fade in the last fifth, once they have reached the pot or seat.
  const lift = Math.min(60 * z, 20 * z + Math.hypot(x1 - x0, y1 - y0) * 0.15);
  animate(el, { x: [x0, x1], y: [y0, (y0 + y1) / 2 - lift, y1], scale: [z, z], opacity: [1, 1, 0] }, {
    x: { duration: FLIGHT, delay, ease: 'easeOut' },
    scale: { duration: FLIGHT, delay },
    y: { duration: FLIGHT, delay, times: [0, 0.4, 1], ease: ['easeOut', 'easeIn'] },
    opacity: { duration: FLIGHT, delay, times: [0, 0.8, 1] },
  }).then(() => el.remove());
}

// The deck between hands, in the board's place: split in two, riffled together card by card and squared (2D, card
// backs only, on RIFFLE's beat, which its sound shares), then squared until the deal flies from it. data-deck: its phase.
export function Deck({ phase }: { phase: DeckPhase }) {
  const size = useCardSize(), box = deckSize(size);
  return (
    <motion.div
      data-deck={phase}
      className={size ? 'relative' : 'relative w-11 h-16'}
      style={size ? { width: box.w, height: box.h } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {Array.from({ length: RIFFLE.cards }, (_, k) => <RiffleCard key={k} k={k} spread={Math.round((34 * box.w) / 44)} />)}
    </motion.div>
  );
}

// The deck's k-th card to fall: even ones from the left half, odd ones from the right, each landing on the pile.
// Memoized: it animates once, on mount, whatever the deck's phase.
const RiffleCard = memo(function RiffleCard({ k, spread }: { k: number; spread: number }) {
  const side = k % 2 ? 1 : -1;
  const at = (s: number) => s / RIFFLE.length;
  const fall = RIFFLE.start + k * RIFFLE.gap;
  const lean = (((k * 7) % 5) - 2) * 1.5; // the pile is a little untidy until it is squared
  return (
    <motion.div
      className={`absolute inset-0 ${BACK}`}
      style={{ zIndex: k, y: -k * 0.5 }}
      animate={{ x: [0, side * spread, side * spread, 0, 0, 0], rotate: [0, side * 8, side * 8, lean, lean, 0] }}
      transition={{ duration: RIFFLE.length, times: [0, at(RIFFLE.start - 0.04), at(fall), at(fall + 0.08), at(RIFFLE.square), 1], ease: 'easeInOut' }}
    />
  );
});

interface TableMotionProps {
  players: PlayerState[];
  handNumber: number;
  boardCount: number;
  winnerIdxs: number[];
  nextHandCountdown: number | null; // seconds to the next deal while the hand is over (page.tsx counts it down)
  onDeck: (phase: DeckPhase | null) => void; // shows or hides the deck on the felt
}

// Chips and cards flying across the table, the shuffle between hands, and the table sounds. Driven only by the
// difference between consecutive game states and the next-hand countdown; it never holds up the server's timing.
export default function TableMotion({ players, handNumber, boardCount, winnerIdxs, nextHandCountdown, onDeck }: TableMotionProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const prev = useRef<Snapshot | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]); // deal sounds and the deck's steps
  const deck = useRef<DeckPhase | null>(null);
  const reduce = useReducedMotion();
  const winners = winnerIdxs.length ? `${handNumber}:${winnerIdxs.join(',')}` : '';
  const showDeck = useEffectEvent((phase: DeckPhase | null) => {
    deck.current = phase;
    onDeck(phase);
  });

  useEffect(() => {
    const before = prev.current;
    const felt = visibleRect('[data-felt]');
    const bet = (idx: number) => visibleRect(`[data-bet="${idx}"]`);
    const now: Snapshot = {
      hand: handNumber,
      stacks: Object.fromEntries(players.map(p => [p.id, p.stack])),
      bets: Object.fromEntries(players.map(p => [p.id, p.currentBet])),
      betAt: {},
      board: boardCount,
      winners,
    };
    players.forEach((p, idx) => {
      const r = felt && bet(idx);
      if (felt && r) now.betAt[p.id] = { x: r.left + r.width / 2 - felt.left, y: r.top + r.height / 2 - felt.top };
    });
    prev.current = now;
    if (!before || players.length === 0) return;

    const newHand = now.hand !== before.hand;
    if (newHand) {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      if (deck.current === 'riffle') showDeck('ready'); // dealt before the riffle ended
    }
    if (!onScreen()) {
      if (newHand && deck.current) showDeck(null);
      return;
    }
    const layer = reduce ? null : layerRef.current;
    const z = stageZoom();
    const seat = (idx: number) => visibleRect(`[data-seat="${idx}"]`);

    if (newHand) {
      layer?.replaceChildren(); // drop any flight stuck while frames were paused
      // The deal, from the deck (or the middle of the felt). Not the session's first hand: its cards show at once (PokerTable).
      if (before.hand > 0) {
        const from = visibleRect('[data-deck]') ?? visibleRect('[data-felt-cards]');
        let done = 0;
        players.forEach((p, idx) => {
          p.holeCards?.forEach((_, round) => {
            const delay = dealStart(players, idx, round);
            done = Math.max(done, delay + CARD_FLIGHT);
            if (layer) fly(layer, 'card', from, visibleRect(`[data-seat="${idx}"] [data-hole] > :nth-child(${round + 1})`), delay, z);
            // The sound is the card landing on the felt, not leaving the deck.
            timers.current.push(setTimeout(() => playSound('deal'), (delay + CARD_FLIGHT) * 1000));
          });
        });
        if (deck.current) timers.current.push(setTimeout(() => showDeck(null), done * 1000));
      }
    } else if (now.board > before.board) {
      playSound('deal');
    }

    // Chips out: the stack went down (or, on a new hand, the blinds were posted). They land on the seat's bet in
    // front of it. The engine zeroes every currentBet before it broadcasts the action that closes a street, so the
    // closing call flies straight to the pot, and the bets that were in front of the seats fly in from where they were.
    const pot = visibleRect('[data-pot]');
    const betWas = (id: string): Box | null => {
      const at = before.betAt[id];
      return at && felt ? { left: felt.left + at.x, top: felt.top + at.y, width: 0, height: 0 } : null;
    };
    const streetClosed = !newHand && players.every(p => p.currentBet === 0) && Object.values(before.bets).some(b => b > 0);
    let chips = false;
    players.forEach((p, idx) => {
      const put = newHand ? p.currentBet > 0 : p.stack < (before.stacks[p.id] ?? p.stack);
      if (put) {
        chips = true;
        if (layer) fly(layer, 'chip', seat(idx), (p.currentBet > 0 && bet(idx)) || pot, 0, z);
      }
      if (streetClosed && (before.bets[p.id] ?? 0) > 0) {
        chips = true;
        if (layer) fly(layer, 'chip', betWas(p.id), pot, 0, z);
      }
    });
    if (chips) playSound('chip');

    if (winners && winners !== before.winners) {
      // If the last call came in with this state, let it reach the pot first.
      const after = chips ? FLIGHT : 0;
      winnerIdxs.forEach((idx, i) => {
        if (layer) fly(layer, 'chip', visibleRect('[data-pot]'), seat(idx), after + i * 0.06, z);
      });
      playSound('showdown');
    }
    // winnerIdxs is summarised by `winners`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, handNumber, boardCount, winners, reduce]);

  // Between hands, the shuffle. The countdown's first value n puts the next deal more than n - 1 s away: the riffle
  // ends 0.1 s before that, so it never meets the deal, and the deck waits squared. Too little time left: none.
  const pauseOf = nextHandCountdown ? handNumber : 0;
  const shuffle = useEffectEvent(() => {
    const wait = ((nextHandCountdown ?? 0) - 1 - RIFFLE.length) * 1000 - 100;
    if (wait < 0) return;
    const t = setTimeout(() => {
      if (!onScreen()) return;
      playSound('shuffle');
      if (reduce) return;
      showDeck('riffle');
      timers.current.push(
        setTimeout(() => showDeck('ready'), RIFFLE.length * 1000),
        setTimeout(() => showDeck(null), (RIFFLE.length + 3) * 1000), // no deal came (the table paused): put it away
      );
    }, wait);
    return () => clearTimeout(t);
  });
  useEffect(() => {
    if (pauseOf) return shuffle();
  }, [pauseOf]);

  useEffect(() => {
    const pending = timers;
    return () => pending.current.forEach(clearTimeout);
  }, []);

  // The flights' layer covers the window from <body>, outside the zoomed stage and the table screen's layout.
  const body = useSyncExternalStore(noSubscribe, () => document.body, () => null);
  return body && createPortal(<div ref={layerRef} aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden" />, body);
}
