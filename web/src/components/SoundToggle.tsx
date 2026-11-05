"use client";

import { useSyncExternalStore } from "react";
import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { isSoundOn, setSoundOn, subscribeSound } from "@/lib/sound";

// Header switch for the table sounds (off by default).
export default function SoundToggle() {
  const on = useSyncExternalStore(subscribeSound, isSoundOn, () => false);
  const Icon = on ? SpeakerHigh : SpeakerSlash;
  return (
    <button
      type="button"
      onClick={() => setSoundOn(!on)}
      aria-pressed={on}
      aria-label="Table sounds"
      title={on ? 'Sound on' : 'Sound off'}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] hover:bg-black/5"
      style={{ color: on ? 'rgb(55, 53, 47)' : 'rgba(55, 53, 47, 0.65)' }}
    >
      <Icon size={14} weight="bold" aria-hidden />
      {on ? 'Sound' : 'Muted'}
    </button>
  );
}
