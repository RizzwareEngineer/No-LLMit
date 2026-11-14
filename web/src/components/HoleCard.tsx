'use client'

import Card from "@/components/Card";
import { useLayoutEffect, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type TargetAndTransition, type Transition } from "motion/react";
import { DEALT, askew, usePeel, type Peel } from "@/lib/tableSwitches";

// Seconds: the peel, calm (owner 2026-11-11: "like a pro checking them").
export const PEEL = 0.5;
// Motion 2's curl, as a share of the card's width.
const CURL = 0.35;
// Seconds: motions 3 and 4, the whole sequence, and when each step ends as a share of it: squared, on its side (3; a
// beat for 4), the top card lifted, held, then both shown.
export const SHOW = 1.8;
const STEPS = { 3: [0, 0.18, 0.32, 0.5, 0.64, 1], 4: [0, 0.24, 0.32, 0.5, 0.64, 1] };
const GAP = 4; // px between the two cards: Player's gap-1
const LIFT = 2 / 3; // the top card held at a third of its turn: 60 degrees up

// A hole card with both faces mounted: the face (Card, its role="img" and name) and the plain ink back (.card-back).
// Face down until faceUp; then it turns face up and stays so. A card mounted already face up (a refresh mid-hand) shows
// its face at once; with reduced motion the faces switch with no motion. Motions for the owner to pick (?peel=):
// 1 turns the card over about its left edge, with perspective; 2 keeps it flat while its right edge lifts and the back
// curls away like paper, right to left, the face showing under it. 3 and 4 (owner 2026-11-13: "they put both cards on
// top of each other, and then they peel from the side"): the two cards, dealt askew (DEALT), slide into one squared
// stack, 3 turns it on its side, the top card's left edge lifts (hinged at its right edge) over the bottom card's face,
// holds, then turns over as both slide apart, face up and upright, to their places. One structure for all, so a switch
// never remounts: a layer for the card's place on the felt (x, y, rotate) holding the flipper (its turn).
// `slot` 0 is the first card dealt, under; 1 the second, on top; `w` the card's width in px; `settle` the seconds until
// its flight lands, when dealt while watching: it lands square, as it flew (TableMotion), and slides askew.
export default function HoleCard({ value, faceUp, motion: how = 1, slot = 0, w = 28, settle, className = "" }: { value: string; faceUp: boolean; motion?: Peel; slot?: 0 | 1; w?: number; settle?: number; className?: string }) {
  const reduce = useReducedMotion();
  const tilted = askew(usePeel()); // the page's pick deals askew, whichever motion this card turns up by
  // Motion 2's progress: 1 is no paper on the face. When the card turns up by motion 2, the flipper below turns at once
  // and the paper (a copy of the back on the face) is whole in that same paint, then curls away.
  const p = useMotionValue(1);
  const [prev, setPrev] = useState(faceUp);
  const [peeling, setPeeling] = useState(false);
  const [showing, setShowing] = useState(false); // motions 3 and 4, from the turn on: their sequence
  if (prev !== faceUp) {
    setPrev(faceUp);
    setPeeling(faceUp && how === 2 && !reduce);
    setShowing(faceUp && how >= 3 && !reduce);
  }
  useLayoutEffect(() => {
    if (!peeling) return;
    p.set(0); // before the paint, so the face never shows bare
    const a = animate(p, 1, { duration: PEEL + 0.1, ease: 'easeInOut', onComplete: () => setPeeling(false) });
    return () => a.stop();
  }, [peeling, p]);
  const x = useTransform(p, v => 1 - v * (1 + CURL)); // the curl's left edge, in card widths
  const clipPath = useTransform(x, v => `inset(0 ${Math.min(100, Math.max(0, (1 - v) * 100))}% 0 0)`);
  const left = useTransform(x, v => `${Math.max(0, v) * 100}%`);
  const width = useTransform(x, v => `${Math.max(0, Math.min(CURL, 1 - v, v + CURL)) * 100}%`);

  // The place: dealt askew (3, 4) until face up, then square in the slot.
  const k = w / 28, dealt = DEALT[slot];
  const place = tilted && !faceUp ? { x: dealt.x * k, y: dealt.y * k, rotate: dealt.rotate } : { x: 0, y: 0, rotate: 0 };
  // The turn. Face down is turned over about one edge and moved back over its own place: about the left edge (rotateY,
  // x 100%) for 1, 2 and 4; about the top edge (rotateX, y 100%) for 3, whose stack lies on its side (rotated -90deg),
  // so its left edge on screen is the card's top. Either way the edge that lifts is the one on screen at the left.
  const [turn, shift, otherTurn, otherShift, down] = how === 3 ? ['rotateX', 'y', 'rotateY', 'x', 180] as const : ['rotateY', 'x', 'rotateX', 'y', -180] as const;
  const flip = faceUp ? { [turn]: 0, [shift]: '0%' } : { [turn]: down, [shift]: '100%' };
  let placeTo: TargetAndTransition = place, flipTo: TargetAndTransition = { ...flip, [otherTurn]: 0, [otherShift]: '0%' };
  let placeHow: Transition = faceUp ? { duration: reduce ? 0 : PEEL, ease: 'easeInOut' } : { duration: 0.2, delay: settle, ease: 'easeOut' };
  let flipHow: Transition = { duration: reduce || peeling ? 0 : PEEL, ease: 'easeInOut' };
  if (showing) {
    const times = STEPS[how as 3 | 4], mid = (slot ? -1 : 1) * (w + GAP) / 2, side = how === 3 ? -90 : 0;
    placeTo = { x: [dealt.x * k, mid, mid, mid, mid, 0], y: [dealt.y * k, 0, 0, 0, 0, 0], rotate: [dealt.rotate, 0, side, side, side, 0] };
    placeHow = { duration: SHOW, times, ease: 'easeInOut' };
    // Every value of the turn on the same keyframes, so no frame mixes two of them: until the lift, at the hold, at the end.
    const keys = <T,>(a: T, b: T, c: T) => [a, a, a, b, b, c];
    if (slot) {
      // On top: lifts at the left, holds, then turns over the rest of the way as the cards part. It was dealt face down
      // about its left edge (motion 1's); for 3 it is about its top edge from the first frame: the same back, in place.
      flipTo = { [turn]: keys(down, down * LIFT, 0), [shift]: keys('100%', '100%', '0%'), [otherTurn]: keys(0, 0, 0), [otherShift]: keys('0%', '0%', '0%') };
      flipHow = { duration: SHOW, times, ease: 'easeInOut' };
    } else {
      // Under: face up at once the moment the top card starts to lift, while it still covers it.
      flipTo = { rotateY: keys(-180, 0, 0), x: keys('100%', '0%', '0%'), rotateX: keys(0, 0, 0), y: keys('0%', '0%', '0%') };
      flipHow = { duration: SHOW, times, ease: ['easeInOut', 'easeInOut', (v: number) => (v > 0 ? 1 : 0), 'easeInOut', 'easeInOut'] };
    }
  }
  return (
    <div className={`relative ${className}`}>
      <motion.div data-lay className="absolute inset-0" style={{ perspective: 300 }} initial={settle === undefined ? false : { x: 0, y: 0, rotate: 0 }} animate={placeTo} transition={placeHow}>
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
          {/* Motion 2: the back over the face, cut at the curl; the curl (the back rolled up, lit on its turn, its
              shadow on the face) travels from the right edge to the left one and is gone. */}
          {peeling && <div aria-hidden className="absolute inset-0">
            <Back style={{ clipPath }} />
            <motion.div
              className="absolute -top-px -bottom-px"
              style={{
                left, width,
                background: 'linear-gradient(to right, #37352f 0%, #4a4843 40%, #8f8d87 75%, #d9d8d4 100%)',
                borderRadius: '0 45% 45% 0 / 0 8% 8% 0',
                boxShadow: '3px 0 4px rgba(15, 15, 15, 0.25)',
              }}
            />
          </div>}
        </div>
        <Back style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden' }} />
      </motion.div>
      </motion.div>
    </div>
  );
}

const Back = ({ style }: { style?: React.ComponentProps<typeof motion.div>['style'] }) => (
  <motion.div aria-hidden data-back className="absolute inset-0 rounded card-back" style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px', ...style }} />
);
