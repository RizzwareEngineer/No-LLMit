'use client';

import { useLayoutEffect, useRef, useState } from 'react';

// While the page loads, each box whose size comes from its data (a card hugging its rows, a phone's tiles, API usage's
// lines) stands in blank at the size it last had with its data in a window of this size: a refresh's placeholders are
// the boxes the data fills, so nothing moves when it arrives. Per viewer (localStorage), for the current window size only.
// shortcut: a first visit (or a new window size) has nothing remembered and takes the boxes' empty size; upgrade by
// sending the lineup with the page if that first load matters.
const KEY = 'nollmit:boxes'; // also spelled out in holdBoxes, which must stand alone

// The boxes remembered for this window size: name -> [width, height] (the overview's measured widths under their CSS
// variable's name). With `apply`, also puts them on the page: every [data-box] at least its size, the variables on the
// stats room. Self-contained (nothing from outside its body): page.tsx runs its source inline, so the prerendered page
// has them before its first paint, before React hydrates.
export function holdBoxes(apply = false): Record<string, [number, number]> {
  let boxes: Record<string, [number, number]> = {};
  try {
    const s = JSON.parse(localStorage.getItem('nollmit:boxes') || 'null');
    if (s && s.size === innerWidth + 'x' + innerHeight) boxes = s.boxes;
  } catch {}
  if (apply) {
    document.querySelectorAll<HTMLElement>('[data-box]').forEach(e => {
      const b = boxes[e.dataset.box!];
      if (!b) return;
      e.style.minHeight = b[1] + 'px';
      if (e.hasAttribute('data-box-w')) e.style.minWidth = b[0] + 'px';
    });
    const room = document.querySelector<HTMLElement>('.stats-room');
    for (const k in boxes) if (k.startsWith('--') && room) room.style.setProperty(k, boxes[k][0] + 'px');
  }
  return boxes;
}
export const remembered = (name: string) => holdBoxes()[name];
export function remember(name: string, w: number, h: number) {
  const boxes = { ...holdBoxes(), [name]: [w, h] };
  try { localStorage.setItem(KEY, JSON.stringify({ size: `${innerWidth}x${innerHeight}`, boxes })); } catch {}
}

// `ref` and `attrs` go on the box. `loaded`: it has its data (its size is recorded as it changes); until then `style` holds
// it at least at the remembered size (`dims`: its height, or both; a minimum, so it holds in a flex or grid parent too).
// Layout sizes (offsetWidth/Height): a transform or zoom above the box does not change them.
export function useRememberedBox<T extends HTMLElement>(name: string, loaded: boolean, dims: 'h' | 'wh' = 'h') {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<React.CSSProperties>();
  useLayoutEffect(() => {
    const s = loaded ? undefined : remembered(name);
    // localStorage is read once hydrated (the prerender has none; holdBoxes ran inline before it), before the next paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSize(s && (dims === 'h' ? { minHeight: s[1] } : { minWidth: s[0], minHeight: s[1] }));
    const el = ref.current;
    if (!loaded || !el) return;
    const ro = new ResizeObserver(() => remember(name, el.offsetWidth, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [name, loaded, dims]);
  // holdBoxes changes the prerendered style before React hydrates it.
  const attrs = { 'data-box': name, 'data-box-w': dims === 'wh' || undefined, suppressHydrationWarning: true };
  return [ref, loaded ? undefined : size, attrs] as const;
}
