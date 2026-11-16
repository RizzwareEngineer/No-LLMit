"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { nameForms } from "@/lib/names";

// A model's name in a fixed room (the desktop seat beside its logo and badge, a Profits & Losses row): whole where it
// fits, else the longest of its shorter forms that fits (lib/names), measured before the paint (the audit: names were cut
// to about nine letters with an ellipsis). The full name is the title either way; a name too long even then is cut.

// The width the name may take: its parent's, plus the free space of the row it sits in (a flex row that spreads its items,
// such as the desktop seat's logo-and-name group and its badge). The parent there is sized by its content, so once the
// name is short the parent is short too: without the row's free space a shortened name would never come back when the
// badge beside it narrows.
function roomWidth(parent: HTMLElement) {
  let w = parent.clientWidth, el: HTMLElement | null = parent;
  for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
    const row = el.parentElement;
    if (!row) break;
    const cs = getComputedStyle(row);
    if (!cs.display.endsWith('flex') || cs.flexDirection !== 'row' || cs.justifyContent !== 'space-between') continue;
    const kids = [...row.children] as HTMLElement[];
    const used = kids.reduce((s, k) => s + k.offsetWidth, 0) + (parseFloat(cs.columnGap) || 0) * Math.max(0, kids.length - 1);
    w += Math.max(0, row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - used);
    break;
  }
  return w;
}

export default function FitName({ name, className = '', style }: { name: string; className?: string; style?: CSSProperties }) {
  const box = useRef<HTMLDivElement>(null), forms = useRef<HTMLSpanElement>(null);
  const all = nameForms(name);
  const [pick, setPick] = useState(0);
  useLayoutEffect(() => {
    const parent = box.current?.parentElement, measured = forms.current;
    if (!parent || !measured) return;
    const fit = () => {
      const room = roomWidth(parent) + 0.5, widths = [...measured.children].map(e => (e as HTMLElement).scrollWidth);
      const i = widths.findIndex(w => w <= room);
      setPick(i < 0 ? widths.length - 1 : i);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    // The row's other items (a badge whose text changes with the seat's position) change the room too, and React may
    // replace them (a new badge element the observer above never saw): any change in the row outside the name refits.
    let row: HTMLElement = parent;
    for (let el: HTMLElement | null = parent, i = 0; el?.parentElement && i < 3; el = el.parentElement, i++) {
      for (const k of el.parentElement.children) if (k !== el) ro.observe(k);
      row = el.parentElement;
    }
    const mo = new MutationObserver(ms => { if (ms.some(m => !box.current?.contains(m.target))) fit(); });
    mo.observe(row, { childList: true, subtree: true, characterData: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [name]);
  return (
    <div ref={box} className={`relative truncate ${className}`} style={style} title={name}>
      {all[Math.min(pick, all.length - 1)]}
      {/* Every form, unseen and of no width (so they never widen what holds them), their scroll widths measured against
          the room. */}
      <span ref={forms} aria-hidden className="invisible absolute left-0 top-0 w-0 overflow-hidden whitespace-nowrap">
        {all.map(f => <span key={f} className="absolute left-0 top-0">{f}</span>)}
      </span>
    </div>
  );
}
