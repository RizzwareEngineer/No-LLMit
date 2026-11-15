'use client'

import { useEffect, useState } from "react";
import HoleCard from "@/components/HoleCard";
import { SHOWS, STEPS, variantNow, type Variant } from "@/lib/peel";

// The peek lab, on /?peellab only: one seat's two hole cards at four times desktop's 40x56, the real HoleCard, playing the
// peek on a loop; or its stills side by side. Both routes (lib/peel): A, peeled from the corner all the way over; B,
// stacked and flipped (on the table each seat takes one at random per hand; here the buttons or ?peel= pick). For the owner and for whoever tunes lib/peel.
const CARDS = ['Ac', 'Kd'];
const POSES: Record<Variant, [string, number][]> = {
  a: [['landed', 0], ['stacked', STEPS.a[0]], ['sideways', STEPS.a[1]], ['peeling', STEPS.a[1] + 0.4 * (STEPS.a[2] - STEPS.a[1])], ['held', (STEPS.a[2] + STEPS.a[3]) / 2], ['face up', SHOWS.a]],
  b: [['landed', 0], ['stacked', STEPS.b[0]], ['flipping', STEPS.b[0] + 0.4 * (STEPS.b[1] - STEPS.b[0])], ['flipped', (STEPS.b[1] + STEPS.b[2]) / 2], ['face up', SHOWS.b]],
};
const NAMES: Record<Variant, string> = { a: 'A: peel from the corner', b: 'B: stack and flip' };

const Pair = ({ hand, faceUp, at, slow, variant }: { hand: number; faceUp: boolean; at?: number; slow?: number; variant: Variant }) => (
  <div className="flex flex-row items-center gap-1 outline outline-1 outline-dashed outline-neutral-300">
    {CARDS.map((c, i) => <HoleCard key={`${variant}-${hand}-${i}`} value={c} faceUp={faceUp} peek slot={i ? 1 : 0} w={40} h={56} hand={hand} seat={3} variant={variant} at={at} slow={slow} className="w-10 h-14" />)}
  </div>
);

export default function PeelLab() {
  const [variant, setVariant] = useState<Variant>(() => variantNow() ?? 'a');
  const [slow, setSlow] = useState(1);
  const [poses, setPoses] = useState(false);
  const [hand, setHand] = useState(1);
  const [up, setUp] = useState(false);

  // Landed for 0.8 s, the peek, 1.2 s face up, then the next hand (new angles).
  useEffect(() => {
    if (poses) return;
    const a = setTimeout(() => setUp(true), 800 * slow);
    const b = setTimeout(() => { setUp(false); setHand(n => n + 1); }, (800 + SHOWS[variant] * 1000 + 1200) * slow);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [hand, poses, slow, variant]);

  const button = (on: boolean) => `px-2 py-1 rounded text-xs ${on ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-700'}`;
  const restart = () => { setUp(false); setHand(n => n + 1); };
  return (
    <main data-peellab className="min-h-screen bg-white flex flex-col items-center gap-6 p-4">
      <div className="flex flex-wrap gap-2 items-center text-xs text-neutral-600">
        {(['a', 'b'] as const).map(v => <button key={v} data-variant={v} className={button(variant === v)} onClick={() => { setVariant(v); restart(); }}>{NAMES[v]}</button>)}
        <span className="w-2" />
        {[1, 0.5, 0.25].map(s => <button key={s} className={button(!poses && slow === 1 / s)} onClick={() => { setPoses(false); setSlow(1 / s); restart(); }}>{s}x</button>)}
        <button className={button(poses)} onClick={() => setPoses(p => !p)}>poses</button>
        <button className={button(false)} onClick={() => { setPoses(false); restart(); }}>replay</button>
      </div>
      {poses ? (
        <div data-poses className="flex flex-row flex-wrap justify-center gap-4 items-start">
          {POSES[variant].map(([name, t]) => (
            <figure key={name} className="flex flex-col items-center gap-2">
              <div style={{ zoom: 3, padding: '30px 14px' }}><Pair hand={hand} faceUp at={t} variant={variant} /></div>
              <figcaption className="text-xs text-neutral-600">{name}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div data-loop style={{ zoom: 4, padding: '20px 10px' }}><Pair hand={hand} faceUp={up} slow={slow} variant={variant} /></div>
      )}
    </main>
  );
}
