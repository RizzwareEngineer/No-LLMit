'use client'

import Card from "@/components/Card";
import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { landing } from "@/lib/landing";
import { FADE, GAP, REST, SHOWS, TURN, between, css, down, peekPose, variantNow, type Pose, type Variant } from "@/lib/peel";

// A hole card with both sides mounted: the face (Card, its role="img" and name: rank and suit in the middle) and the plain
// ink back. Dealt face down, at its own angle and offset (landing: the same for every viewer and after a reload). It turns
// face up and stays so, upright: on the seat's turn by the peek (`peek`, lib/peel: route A or B, ?peel=), otherwise (the
// hand's end) it just turns over in place. A card mounted face up (a reload mid-hand) shows its face at once; with reduced
// motion the faces switch with no motion. On phones (`fade`) nothing moves: the card stays where it landed and its face
// fades in over the back.
// One element carries the whole pose (lib/peel's css), so the card moves only as a rigid piece. Both cards of a seat are
// seen through one perspective, from the middle of the two slots.
// `slot` 0 is the first card dealt, under; 1 the second, on top; `w` and `h` the card's size in px; `settle` the seconds until
// its flight lands, when dealt while watching: it lands square, as it flew (TableMotion), and slides to its pose;
// `onLanded` is called once it lies there. The peek lab (PeelLab) also passes `variant`, `at` (a still of the peek at that
// second) and `slow` (the peek's length times this).
export default function HoleCard({ value, faceUp, peek = false, fade = false, slot = 0, w = 28, h = w / 0.7, hand = 0, seat = 0, settle, onLanded, variant, at, slow = 1, className = "" }: { value: string; faceUp: boolean; peek?: boolean; fade?: boolean; slot?: 0 | 1; w?: number; h?: number; hand?: number; seat?: number; settle?: number; onLanded?: () => void; variant?: Variant; at?: number; slow?: number; className?: string }) {
  const reduce = useReducedMotion();
  const k = w / 28, dealt = landing(hand, seat, slot), lay = { x: dealt.x * k, y: dealt.y * k, rotate: dealt.rotate };
  // Face up: upright in its slot; on a phone, where it landed.
  const up: Pose = fade ? { ...down(lay), flip: 0 } : REST;
  const first: Pose = at !== undefined ? peekPose(at, slot, w, lay, h, variant) : faceUp ? up : settle !== undefined ? down({ x: 0, y: 0, rotate: 0 }) : down(lay);
  const pose = useRef(first);
  const transform = useMotionValue(css(first, w, h)), z = useMotionValue<number | 'auto'>(above(first)), cover = useMotionValue(0);
  const was = useRef<boolean | null>(null);
  // Face down the second card lies on top; once the stack shows its faces (turned over) the first, until it rests in its
  // slot (no z-index at rest: the seat's layers, and so its text's pixels, stay as they were).
  function above(p: Pose) { return slot === 0 && (p.x || p.y || p.r || p.lift) && Math.cos(p.lift * Math.PI / 180) * Math.cos(p.flip * Math.PI / 180) > 0 ? 1 : 'auto'; }
  const show = (p: Pose) => { pose.current = p; transform.set(css(p, w, h)); z.set(above(p)); };

  useEffect(() => {
    if (at !== undefined) { show(peekPose(at, slot, w, lay, h, variant)); return; }
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
      const from = pose.current, v = variant ?? variantNow(), long = SHOWS[v];
      if (reduce) show(up);
      else if (fade) { show(up); cover.set(1); move = animate(cover, 0, { duration: FADE, ease: 'easeOut' }); }
      else if (peek) move = animate(0, long * slow, { duration: long * slow, ease: 'linear', onUpdate: t => show(peekPose(t / slow, slot, w, lay, h, v)) });
      else move = animate(0, 1, { duration: TURN, ease: 'easeInOut', onUpdate: u => show(between(from, REST, u)) });
    } else if (!faceUp && before) { cover.set(0); show(down(lay)); }
    return () => move?.stop();
    // Moves start on a change of face (or the lab's still); the rest is fixed for the card's life (keyed by hand).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceUp, at, variant]);

  // The layout changed under a card at rest (a phone turned to landscape crosses 768px mid-hand): it takes the new
  // layout's pose for its face, as if it had been dealt there.
  const sized = useRef({ fade, w });
  useEffect(() => {
    if (sized.current.fade === fade && sized.current.w === w) return;
    sized.current = { fade, w };
    if (at !== undefined) return;
    cover.set(0);
    show(faceUp ? up : down(lay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fade, w]);

  return (
    <motion.div className={`relative ${className}`} style={{ zIndex: z, perspective: 1000, perspectiveOrigin: `${slot ? -GAP / 2 : w + GAP / 2}px 50%` }}>
      <motion.div data-lay className="absolute inset-0" style={{ transform, transformStyle: 'preserve-3d' }}>
        <div data-face className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
          <Card value={value} className="w-full h-full" />
          {/* A phone's card turning up: the back, over the face, fading out. */}
          {fade && <motion.div data-cover aria-hidden className="absolute inset-0 rounded card-back" style={{ opacity: cover }} />}
        </div>
        <div data-back aria-hidden className="absolute inset-0 rounded card-back" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px' }} />
      </motion.div>
    </motion.div>
  );
}
