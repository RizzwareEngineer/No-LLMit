import { useEffect, useSyncExternalStore } from "react";

// The owner's preview switches, read from the page's query on the client after hydration (no control on the page):
// ?cards=1|2|3 picks a hole card size, ?type=2 the second type scale (the html[data-type="2"]
// block in globals.css), ?m=1 the old phone layout (the felt over a grid of seats) to compare. Without them the table is as it was.

// Hole card sizes in px, the card's 0.7 ratio; 0 is today's w-7 h-10 (the deck then stays the board's w-11 h-16).
export const CARD_SIZES = [{ w: 28, h: 40 }, { w: 32, h: 45 }, { w: 36, h: 50 }, { w: 40, h: 56 }] as const;
// Literal classes, so Tailwind sees each one.
export const CARD_CLASS = ['w-7 h-10', 'w-8 h-[45px]', 'w-9 h-[50px]', 'w-10 h-14'] as const;

const param = (k: string) => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(k));
// Phones keep today's size: their seats are about 116px wide and a bigger card crowds the name and the action text.
const WIDE = '(min-width: 768px)';
export function cardSizeNow(): number {
  const n = Number(param('cards'));
  return n >= 1 && n < CARD_SIZES.length && Number.isInteger(n) && window.matchMedia(WIDE).matches ? n : 0;
}
// The deck's size in px: the board's for the default, the hole cards' for a picked size.
export function deckSize(size = cardSizeNow()) {
  return size ? CARD_SIZES[size] : { w: 44, h: 64 };
}

const noSubscribe = () => () => {};
const onWidth = (fn: () => void) => { const m = window.matchMedia(WIDE); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); };
export const useCardSize = () => useSyncExternalStore(onWidth, cardSizeNow, () => 0);
export const useOldPhone = () => useSyncExternalStore(noSubscribe, () => param('m') === '1', () => false);
// ?type=2 sets data-type="2" on <html>, which switches on the type scale's layout edits (globals.css).
export function useTypeSwitch() {
  useEffect(() => { if (param('type') === '2') document.documentElement.dataset.type = '2'; }, []);
}
