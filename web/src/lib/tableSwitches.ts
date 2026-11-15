import { useSyncExternalStore } from "react";

// Hole card sizes in px, the card's 0.7 ratio: phones' 28x40 (the deck then is the board's 30x42), and desktop's 40x56 (the owner picked it, 2026-11-14; the deck is then the hole cards' size).
export const CARD_SIZES = [{ w: 28, h: 40 }, { w: 40, h: 56 }] as const;
// Literal classes, so Tailwind sees each one.
export const CARD_CLASS = ['w-7 h-10', 'w-10 h-14'] as const;

// Phones keep today's size: the phone table's seats are laid out for it (phoneTable.ts).
const WIDE = '(min-width: 768px)';
export const cardSizeNow = (): number => (window.matchMedia(WIDE).matches ? 1 : 0);
// The deck's size in px: the board's on phones, the hole cards' on desktop.
export function deckSize(size = cardSizeNow()) {
  return size ? CARD_SIZES[size] : { w: 30, h: 42 }; // phones: the board's cards (phoneTable's DECK)
}

const onWidth = (fn: () => void) => { const m = window.matchMedia(WIDE); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); };
export const useCardSize = () => useSyncExternalStore(onWidth, cardSizeNow, () => 0);

// The phone table's drafts, by query (owner 2026-11-15: "let's experiment with both", "some other layouts"): ?pot=pill
// for the round pot (the rectangle, the desktop's, is the default), ?shape=rect or ?shape=stadium for the other table
// shapes (the oval is the default). The prerendered page and the first render have the defaults.
export type PhoneShape = 'oval' | 'rect' | 'stadium';
const query = (k: string) => new URLSearchParams(window.location.search).get(k);
const noSub = () => () => {};
export const usePhoneShape = () => useSyncExternalStore(noSub, () => { const s = query('shape'); return (s === 'rect' || s === 'stadium' ? s : 'oval') as PhoneShape; }, () => 'oval' as PhoneShape);
export const usePillPot = () => useSyncExternalStore(noSub, () => query('pot') === 'pill', () => false);
