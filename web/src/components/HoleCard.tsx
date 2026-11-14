'use client'

import Card, { CardIndex } from "@/components/Card";
import { useState } from "react";
import { motion, useReducedMotion, type TargetAndTransition, type Transition } from "motion/react";
import { landing } from "@/lib/landing";

// Seconds: a card turning over at the hand's end, about its left edge, calm.
export const PEEL = 0.5;
// Seconds: the peek, the whole of it, and when each step ends as a share of it: the two cards squared into one stack,
// its left part lifted, held (0.7 s), laid down, then both turned face up as they part to their places.
export const SHOW = 2.1;
const TIMES = [0, 0.2, 0.37, 0.7, 0.83, 1];
const GAP = 4; // px between the two cards: Player's gap-1
const DROP = 0.22; // in the stack the second card lies this share of the card's height lower than the first,
const HAIR = 2; // and this many px (at the 28px card) to the right: both corners show
const FOLD = 0.75; // the part that lifts, as a share of the card's width from its left edge
const LIFT = 145; // degrees it turns up to at the hold: past upright, its face towards the viewer looking down

// A hole card with both sides mounted: the face (Card, its role="img" and name) and the plain ink back. Dealt face down,
// at its own angle and offset (landing: the same for every viewer and after a reload). It turns face up and stays so,
// straightened: on the seat's turn by the peek (`peek`; owner 2026-11-14, a player's peek: "they put both cards on top of
// each other, then peel BOTH from the side so they can see the suit and the value"): both cards slide into one upright
// stack, the second a little lower and right; the stack's left part lifts as one piece, hinged at its right part, past
// upright so both faces' corners show, the first's rank and suit above the second's; it holds, lays down, and the cards
// turn face up as they part to their places. Otherwise (the hand's end) it just turns over. A card mounted already face
// up (a refresh mid-hand) shows its face at once; with reduced motion the faces switch with no motion.
// Layers: the card's place on the felt (x, y, rotate) holding the flipper (its turn, about the left edge), which holds the
// face and the back; the back's left part is the flap that lifts, its face's corner under it.
// `slot` 0 is the first card dealt, under; 1 the second, on top; `w` the card's width in px; `settle` the seconds until
// its flight lands, when dealt while watching: it lands square, as it flew (TableMotion), and slides to its pose.
export default function HoleCard({ value, faceUp, peek = false, slot = 0, w = 28, hand = 0, seat = 0, settle, className = "" }: { value: string; faceUp: boolean; peek?: boolean; slot?: 0 | 1; w?: number; hand?: number; seat?: number; settle?: number; className?: string }) {
  const reduce = useReducedMotion();
  const [prev, setPrev] = useState(faceUp);
  const [showing, setShowing] = useState(false); // the peek, from the seat's turn on
  const [lifting, setLifting] = useState(false); // until the stack is laid down again: the flap's face is drawn
  if (prev !== faceUp) {
    setPrev(faceUp);
    setShowing(faceUp && peek && !reduce);
    setLifting(faceUp && peek && !reduce);
  }

  const k = w / 28, h = w / 0.7, dealt = landing(hand, seat, slot);
  const lay = { x: dealt.x * k, y: dealt.y * k, rotate: dealt.rotate };
  // Face down is turned over about the left edge and moved back over its own place.
  let placeTo: TargetAndTransition = faceUp ? { x: 0, y: 0, rotate: 0 } : lay, flipTo: TargetAndTransition = faceUp ? { rotateY: 0, x: '0%' } : { rotateY: -180, x: '100%' };
  let placeHow: Transition = faceUp ? { duration: reduce ? 0 : PEEL, ease: 'easeInOut' } : { duration: 0.2, delay: settle, ease: 'easeOut' };
  let flipHow: Transition = { duration: reduce ? 0 : PEEL, ease: 'easeInOut' };
  if (showing) {
    // The stack: both cards over the middle of the two places, the second DROP lower and HAIR right.
    const x = (slot ? -1 : 1) * (w + GAP) / 2 + (slot ? HAIR * k : 0), y = (slot ? 1 : -1) * DROP * h / 2;
    placeTo = { x: [lay.x, x, x, x, x, 0], y: [lay.y, y, y, y, y, 0], rotate: [lay.rotate, 0, 0, 0, 0, 0] };
    placeHow = { duration: SHOW, times: TIMES, ease: 'easeInOut' };
    flipTo = { rotateY: [-180, -180, -180, -180, -180, 0], x: ['100%', '100%', '100%', '100%', '100%', '0%'] };
    flipHow = { duration: SHOW, times: TIMES, ease: 'easeInOut' };
  }
  // The flap: lifted, held and laid down on the same keyframes for both cards, so the stack lifts as one piece.
  const flapTo = lifting ? { rotateY: [0, 0, LIFT, LIFT, 0] } : { rotateY: 0 };
  const flapHow: Transition = { duration: SHOW * TIMES[4], times: TIMES.slice(0, 5).map(t => t / TIMES[4]), ease: 'easeInOut' };
  return (
    <div className={`relative ${className}`}>
      <motion.div data-lay className="absolute inset-0" style={{ perspective: 400 }} initial={settle === undefined ? false : { x: 0, y: 0, rotate: 0 }} animate={placeTo} transition={placeHow}>
      <motion.div
        data-flip
        className="absolute inset-0"
        style={{ transformStyle: 'preserve-3d', originX: 0, originY: 0 }}
        initial={false}
        animate={flipTo}
        transition={flipHow}
      >
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
          <Card value={value} className="w-full h-full" />
        </div>
        {/* The back, turned over with the card (its left is the screen's left while face down): its right part lies
            flat; the flap, its left part, lifts about their seam. Under the flap, the face's corner with its index,
            drawn only while it can lift (face up, it would lie over the face). */}
        <div className="absolute inset-0" style={{ transform: 'rotateY(180deg)', transformStyle: 'preserve-3d' }}>
          <Back at="right" width={1 - FOLD} share={1 - FOLD} />
          <motion.div
            data-flap
            className="absolute inset-y-0 left-0"
            style={{ width: `${FOLD * 100}%`, originX: 1, transformStyle: 'preserve-3d' }}
            initial={false}
            animate={flapTo}
            transition={flapHow}
            onAnimationComplete={() => setLifting(false)}
          >
            <Back at="left" width={1} share={FOLD} />
            {lifting && (
              <div
                data-corner
                className="absolute inset-0 flex justify-end items-start bg-white rounded-r"
                style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', padding: `${0.03 * h}px ${0.06 * w}px`, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.12) 0px 1px 3px' }}
              >
                <CardIndex value={value} size={0.28 * w} />
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>
      </motion.div>
    </div>
  );
}

// A piece of the back: a window `width` of its parent wide at its `at` side, on the whole back (`share` of which it
// shows), so the two pieces meet with no seam.
const Back = ({ at, width, share }: { at: 'left' | 'right'; width: number; share: number }) => (
  <div aria-hidden className="absolute inset-y-0 overflow-hidden" style={{ [at]: 0, width: `${width * 100}%`, backfaceVisibility: 'hidden' }}>
    <div data-back className="absolute inset-y-0 rounded card-back" style={{ [at]: 0, width: `${100 / share}%`, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px' }} />
  </div>
);
