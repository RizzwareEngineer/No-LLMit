'use client'

import Card, { CardIndex } from "@/components/Card";
import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { landing } from "@/lib/landing";
import { GAP, INDEX_TURN, REST, SHOW, TURN, between, css, down, peekPose, type Pose } from "@/lib/peel";

// A hole card with both sides mounted: the face (Card, its role="img" and name) and the plain ink back. Dealt face down,
// at its own angle and offset (landing: the same for every viewer and after a reload). It turns face up and stays so,
// upright: on the seat's turn by the peek (`peek`, lib/peel: stacked, turned sideways, lifted from the near edge, held,
// turned over and righted), otherwise (the hand's end) it just turns over in place. A card mounted face up (a reload
// mid-hand) shows its face at once; with reduced motion the faces switch with no motion.
// One element carries the whole pose (lib/peel's css), so the card moves only as a rigid piece. Both cards of a seat are
// seen through one perspective, from the middle of the two slots.
// `slot` 0 is the first card dealt, under; 1 the second, on top; `w` the card's width in px; `settle` the seconds until
// its flight lands, when dealt while watching: it lands square, as it flew (TableMotion), and slides to its pose;
// `onLanded` is called once it lies there. The peek lab (PeelLab) also passes `at` (a still of the peek at that second)
// and `slow` (the peek's length times this).
export default function HoleCard({ value, faceUp, peek = false, slot = 0, w = 28, hand = 0, seat = 0, settle, onLanded, at, slow = 1, className = "" }: { value: string; faceUp: boolean; peek?: boolean; slot?: 0 | 1; w?: number; hand?: number; seat?: number; settle?: number; onLanded?: () => void; at?: number; slow?: number; className?: string }) {
  const reduce = useReducedMotion();
  const k = w / 28, dealt = landing(hand, seat, slot), lay = { x: dealt.x * k, y: dealt.y * k, rotate: dealt.rotate };
  const first: Pose = at !== undefined ? peekPose(at, slot, w, lay) : faceUp ? REST : settle !== undefined ? down({ x: 0, y: 0, rotate: 0 }) : down(lay);
  const pose = useRef(first);
  const transform = useMotionValue(css(first, w)), index = useMotionValue(first.index);
  const was = useRef<boolean | null>(null);
  const show = (p: Pose) => { pose.current = p; transform.set(css(p, w)); index.set(p.index); };

  useEffect(() => {
    if (at !== undefined) { show(peekPose(at, slot, w, lay)); return; }
    const before = was.current;
    was.current = faceUp;
    let move: ReturnType<typeof animate> | undefined;
    if (before === null) {
      // Mounted: dealt while watching, it slides from where its flight landed to its pose.
      if (!faceUp && settle !== undefined) {
        const from = pose.current, to = down(lay);
        move = animate(0, 1, { duration: 0.2, delay: settle, ease: 'easeOut', onUpdate: u => show(between(from, to, u)) });
        move.then(() => onLanded?.());
      }
    } else if (faceUp && !before) {
      const from = pose.current;
      if (reduce) show(REST);
      else if (peek) move = animate(0, SHOW * slow, { duration: SHOW * slow, ease: 'linear', onUpdate: t => show(peekPose(t / slow, slot, w, lay)) });
      else move = animate(0, 1, { duration: TURN, ease: 'easeInOut', onUpdate: u => show(between(from, REST, u)) });
    } else if (!faceUp && before) show(down(lay));
    return () => move?.stop();
    // Moves start on a change of face (or the lab's still); the rest is fixed for the card's life (keyed by hand).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceUp, at]);

  return (
    <div className={`relative ${className}`} style={{ perspective: 1000, perspectiveOrigin: `${slot ? -GAP / 2 : w + GAP / 2}px 50%` }}>
      <motion.div data-lay className="absolute inset-0" style={{ transform, transformStyle: 'preserve-3d' }}>
        <div data-face className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
          <Card value={value} className="w-full h-full" />
          {/* While peeked, the face shows only the corner the peek lifts (top-right on the face, top-left on the back), its
              index turned to read upright while the cards are held; the middle comes back as they are righted. */}
          <motion.div aria-hidden className="absolute inset-0 rounded bg-white" style={{ opacity: index }}>
            <div className="absolute top-0 right-0 flex items-center justify-center" style={{ width: 0.4 * w, height: 0.4 * w, rotate: `${INDEX_TURN}deg` }}>
              <CardIndex value={value} size={0.3 * w} />
            </div>
          </motion.div>
        </div>
        <div data-back aria-hidden className="absolute inset-0 rounded card-back" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px' }} />
      </motion.div>
    </div>
  );
}
