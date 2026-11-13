'use client'

import Card from "@/components/Card";
import { useLayoutEffect, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { Peel } from "@/lib/tableSwitches";

// Seconds: the peel, calm (owner 2026-11-11: "like a pro checking them").
export const PEEL = 0.5;
// Motion 2's curl, as a share of the card's width.
const CURL = 0.35;

// A hole card with both faces mounted: the face (Card, its role="img" and name) and the plain ink back (.card-back).
// Face down until faceUp; then it turns face up and stays so. A card mounted already face up (a refresh mid-hand) shows
// its face at once; with reduced motion the faces switch with no motion. Two motions for the owner to pick (?peel=):
// 1 turns the card over about its left edge, with perspective; 2 keeps it flat while its right edge lifts and the back
// curls away like paper, right to left, the face showing under it. One structure for both, so a switch never remounts.
export default function HoleCard({ value, faceUp, motion: how = 1, className = "" }: { value: string; faceUp: boolean; motion?: Peel; className?: string }) {
  const reduce = useReducedMotion();
  // Motion 2's progress: 1 is no paper on the face. When the card turns up by motion 2, the flipper below turns at once
  // and the paper (a copy of the back on the face) is whole in that same paint, then curls away.
  const p = useMotionValue(1);
  const [prev, setPrev] = useState(faceUp);
  const [peeling, setPeeling] = useState(false);
  if (prev !== faceUp) {
    setPrev(faceUp);
    setPeeling(faceUp && how === 2 && !reduce);
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
  return (
    <div className={`relative ${className}`} style={{ perspective: 300 }}>
      <motion.div
        className="absolute inset-0"
        style={{ transformStyle: 'preserve-3d', originX: 0 }}
        initial={false}
        // Face down: turned over about the left edge and moved back over its own place (x 100%).
        animate={faceUp ? { rotateY: 0, x: '0%' } : { rotateY: -180, x: '100%' }}
        transition={{ duration: reduce || peeling ? 0 : PEEL, ease: 'easeInOut' }}
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
    </div>
  );
}

const Back = ({ style }: { style?: React.ComponentProps<typeof motion.div>['style'] }) => (
  <motion.div aria-hidden data-back className="absolute inset-0 rounded card-back" style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px', ...style }} />
);
