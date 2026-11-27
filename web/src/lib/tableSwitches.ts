import { useSyncExternalStore } from "react";
import { DESK, isDraftA, isPhone, onLayoutChange } from "@/lib/layout";

// Card sizes in px, the card's 0.7 ratio: phones' 28x40 and desktop's 40x56 (the owner picked it, 2026-11-14). Every card on
// the table is this size: hole cards, the board, the deck and the button draw (owner, 2026-11-21: "the dealer cards and the
// community cards need to be same size as the cards the players get").
export const CARD_SIZES = [{ w: 28, h: 40 }, { w: 40, h: 56 }] as const;
// Literal classes, so Tailwind sees each one.
export const CARD_CLASS = ['w-7 h-10', 'w-10 h-14'] as const;

// Phones keep today's size: the phone table's seats are laid out for it (phoneTable.ts). The layout is lib/layout's.
export const cardSizeNow = (): number => (isPhone() ? 0 : 1);
// The deck's size in px: the hole cards'.
// Draft A (app/a) draws the desktop table, so its deck and dealt cards are the desktop's.
export const deckSize = (size = cardSizeNow()) => (isDraftA() ? CARD_SIZES[1] : CARD_SIZES[size]);

export const useCardSize = () => useSyncExternalStore(onLayoutChange, cardSizeNow, () => 0);

const query = (k: string) => new URLSearchParams(window.location.search).get(k);
const noSub = () => () => {};
// ?table=tall on draft A (/a): the tall table, the desktop's seat cards round a felt drawn tilted away (PokerTable).
export const useTallTable = () => useSyncExternalStore(noSub, () => query('table') === 'tall', () => false);
// ?tables=1: the tables overview is the landing (a draft for the owner's review), with the way back to it and the
// neighbouring tables at the stage's edges. Desktop only. Promoting it is this one line (return true).
function tablesOverview(search: string) { return new URLSearchParams(search).get('tables') === '1'; }
export const useTablesOverview = () => useSyncExternalStore(noSub, () => tablesOverview(location.search), () => false);
// Run as the page is parsed: landing on the overview, the stage is hidden until the overview is drawn over it (page.tsx),
// so the first paint is not the single table.
export const OVERVIEW_FIRST = `(${tablesOverview})(location.search)&&!new URLSearchParams(location.search).get('t')&&matchMedia(${JSON.stringify(DESK)}).matches&&document.documentElement.setAttribute('data-overview','')`;
// ?edges=outline: the neighbours at the stage's edges as an outline and a label; without it, their live tables.
export const useEdges = () => useSyncExternalStore(noSub, (): 'live' | 'outline' => (query('edges') === 'outline' ? 'outline' : 'live'), () => 'live' as const);
// ?t=KEY: the table in focus (the stream's key, e.g. 5-10-200bb), so Back, a reload or a shared link finds it.
const onUrl = (cb: () => void) => { addEventListener('popstate', cb); addEventListener('focuschange', cb); return () => { removeEventListener('popstate', cb); removeEventListener('focuschange', cb); }; };
export const useFocusParam = () => useSyncExternalStore(onUrl, () => query('t'), () => null);
export const pushFocus = (key: string | null) => {
  const u = new URL(location.href);
  if (key) u.searchParams.set('t', key); else u.searchParams.delete('t');
  history.pushState(null, '', u);
  dispatchEvent(new Event('focuschange'));
};

// Which layout's tree to mount (lib/layout's switch): 'phone' or 'desk' once the page runs; null in the prerendered page
// and while it hydrates, where both trees are in the HTML and CSS shows one (md:hidden, max-md:hidden), so the first
// paint is right before any script. After that only the shown one is mounted: the other (half the page's elements on a
// phone) was laid out and updated with every state for nothing.
export const useLayout = () => useSyncExternalStore(onLayoutChange, () => (isPhone() ? 'phone' : 'desk'), () => null);
