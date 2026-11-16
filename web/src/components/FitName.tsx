"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

// A model's name in a fixed room (the desktop seat beside its logo and badge, a Profits & Losses row): whole where it
// fits; where it does not, without its version numbers ("Nemotron 3.5 Super" → "Nemotron Super", "DeepSeek V4 Flash"
// → "DeepSeek Flash"), measured before the paint (the audit: names were cut to about nine letters with an ellipsis).
// The full name is the title either way; a name still too long is cut as before.
export const shortName = (name: string) => name.split(' ').filter((w, i) => i === 0 || !/^V?\d+(\.\d+)*$/.test(w)).join(' ');

export default function FitName({ name, className = '', style }: { name: string; className?: string; style?: CSSProperties }) {
  const box = useRef<HTMLDivElement>(null), full = useRef<HTMLSpanElement>(null);
  const [short, setShort] = useState(false);
  useLayoutEffect(() => {
    const room = box.current?.parentElement, whole = full.current;
    if (!room || !whole) return;
    const fit = () => setShort(whole.scrollWidth > room.clientWidth + 0.5);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(room);
    return () => ro.disconnect();
  }, [name]);
  return (
    <div ref={box} className={`relative truncate ${className}`} style={style} title={name}>
      {short ? shortName(name) : name}
      {/* The whole name, unseen and of no width (so it never widens what holds it), its scroll width measured against the
          room (the name's parent). */}
      <span ref={full} aria-hidden className="invisible absolute left-0 top-0 w-0 overflow-hidden whitespace-nowrap">{name}</span>
    </div>
  );
}
