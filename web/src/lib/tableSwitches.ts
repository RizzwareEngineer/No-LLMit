import { useEffect, useSyncExternalStore } from "react";

// The owner's preview switches, read from the page's query on the client after hydration (no control on the page):
// ?type=2 switches on the second type scale (the html[data-type="2"] block in globals.css). Without it the table is as
// it was.

// Hole card sizes in px, the card's 0.7 ratio: phones' 28x40 (their seats are about 116px wide; the deck then stays the
// board's w-11 h-16), and desktop's 40x56 (the owner picked it, 2026-11-14; the deck is then the hole cards' size).
export const CARD_SIZES = [{ w: 28, h: 40 }, { w: 40, h: 56 }] as const;
// Literal classes, so Tailwind sees each one.
export const CARD_CLASS = ['w-7 h-10', 'w-10 h-14'] as const;

const param = (k: string) => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(k));
// Phones keep today's size: the phone table's seats are laid out for it (phoneTable.ts).
const WIDE = '(min-width: 768px)';
export const cardSizeNow = (): number => (window.matchMedia(WIDE).matches ? 1 : 0);
// The deck's size in px: the board's on phones, the hole cards' on desktop.
export function deckSize(size = cardSizeNow()) {
  return size ? CARD_SIZES[size] : { w: 44, h: 64 };
}

const onWidth = (fn: () => void) => { const m = window.matchMedia(WIDE); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); };
export const useCardSize = () => useSyncExternalStore(onWidth, cardSizeNow, () => 0);
// ?type=2 sets data-type="2" on <html>, which switches on the type scale's layout edits (globals.css).
export function useTypeSwitch() {
  useEffect(() => { if (param('type') === '2') document.documentElement.dataset.type = '2'; }, []);
}
