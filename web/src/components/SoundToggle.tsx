"use client";

import { useEffect, useSyncExternalStore } from "react";
import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { isSoundOn, setSoundOn, subscribeSound, unlockOnFirstGesture } from "@/lib/sound";
import { isBB, setBB, setBigBlind, subscribeAmounts } from "@/lib/amounts";
import { MUTED, TEXT } from "@/lib/stats";
import { SHADOW } from "@/components/Section";

// Header switch for the site sounds: the table and the Trends overtakes (off by default).
export default function SoundToggle() {
  const on = useSyncExternalStore(subscribeSound, isSoundOn, () => false);
  useEffect(() => {
    if (!isSoundOn()) return;
    const once = unlockOnFirstGesture();
    return () => {
      window.removeEventListener('pointerdown', once);
      window.removeEventListener('keydown', once);
    };
  }, []);
  const Icon = on ? SpeakerHigh : SpeakerSlash;
  return (
    <button
      type="button"
      onClick={() => setSoundOn(!on)}
      aria-pressed={on}
      aria-label="Sounds"
      title={on ? 'Sound on. Browsers start it after your first click or key press on the page.' : 'Sound off'}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[14px] hover:bg-black/5"
      style={{ color: on ? 'rgb(55, 53, 47)' : 'rgba(55, 53, 47, 0.65)' }}
    >
      <Icon size={14} weight="bold" aria-hidden />
      {on ? 'Sound' : 'Muted'}
    </button>
  );
}

// Header switch for the table's amounts: chips, or big blinds of the table's stakes (kept like the sound setting).
// Trends' Chips switch (Segmented) at the status row's height, so the header keeps its size.
export function UnitToggle({ bigBlind }: { bigBlind: number }) {
  const bb = useSyncExternalStore(subscribeAmounts, isBB, () => false);
  useEffect(() => setBigBlind(bigBlind), [bigBlind]);
  return (
    <div role="group" aria-label="Amounts in" className="flex items-center rounded text-[14px]" style={{ background: 'rgba(55, 53, 47, 0.06)' }}>
      {([['Chips', false], ['BB', true]] as const).map(([label, on]) => (
        <button
          key={label}
          type="button"
          onClick={() => setBB(on)}
          aria-pressed={bb === on}
          title={on ? 'Amounts in big blinds' : 'Amounts in chips'}
          className="rounded px-1.5 py-0.5 font-medium"
          style={bb === on ? { background: 'white', color: TEXT, boxShadow: SHADOW } : { color: MUTED }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
