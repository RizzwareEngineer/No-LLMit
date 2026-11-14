'use client'

import { useEffect, useState } from "react";
import HoleCard from "@/components/HoleCard";
import { SHOW, STEPS } from "@/lib/peel";

// The peek lab, on /?peellab only: one seat's two hole cards at four times desktop's 40x56, the real HoleCard, playing the
// peek on a loop; or the five stills side by side. For the owner and for whoever tunes lib/peel.
const CARDS = ['Ac', 'Kd'];
const POSES: [string, number][] = [['landed', 0], ['stacked', STEPS[0]], ['turned sideways', STEPS[1]], ['peeking, held', (STEPS[2] + STEPS[3]) / 2], ['face up', SHOW]];

const Pair = ({ hand, faceUp, at, slow }: { hand: number; faceUp: boolean; at?: number; slow?: number }) => (
  <div className="flex flex-row items-center gap-1 outline outline-1 outline-dashed outline-neutral-300">
    {CARDS.map((c, i) => <HoleCard key={`${hand}-${i}`} value={c} faceUp={faceUp} peek slot={i ? 1 : 0} w={40} h={56} hand={hand} seat={3} at={at} slow={slow} className="w-10 h-14" />)}
  </div>
);

export default function PeelLab() {
  const [slow, setSlow] = useState(1);
  const [poses, setPoses] = useState(false);
  const [hand, setHand] = useState(1);
  const [up, setUp] = useState(false);

  // Landed for 0.8 s, the peek, 1.2 s face up, then the next hand (new angles).
  useEffect(() => {
    if (poses) return;
    const a = setTimeout(() => setUp(true), 800 * slow);
    const b = setTimeout(() => { setUp(false); setHand(n => n + 1); }, (800 + SHOW * 1000 + 1200) * slow);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [hand, poses, slow]);

  const button = (on: boolean) => `px-2 py-1 rounded text-xs ${on ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-700'}`;
  return (
    <main data-peellab className="min-h-screen bg-white flex flex-col items-center gap-6 p-4">
      <div className="flex flex-wrap gap-2 items-center text-xs text-neutral-600">
        {[1, 0.5, 0.25].map(s => <button key={s} className={button(!poses && slow === 1 / s)} onClick={() => { setPoses(false); setSlow(1 / s); setUp(false); setHand(n => n + 1); }}>{s}x</button>)}
        <button className={button(poses)} onClick={() => setPoses(p => !p)}>poses</button>
        <button className={button(false)} onClick={() => { setPoses(false); setUp(false); setHand(n => n + 1); }}>replay</button>
      </div>
      {poses ? (
        <div data-poses className="flex flex-row gap-4 items-start">
          {POSES.map(([name, t]) => (
            <figure key={name} className="flex flex-col items-center gap-2">
              <div style={{ zoom: 3, padding: '30px 10px' }}><Pair hand={hand} faceUp at={t} /></div>
              <figcaption className="text-xs text-neutral-600">{name}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div data-loop style={{ zoom: 4, padding: '20px 10px' }}><Pair hand={hand} faceUp={up} slow={slow} /></div>
      )}
    </main>
  );
}
