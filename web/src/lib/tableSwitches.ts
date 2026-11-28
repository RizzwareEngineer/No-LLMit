import { createContext, useContext, useSyncExternalStore } from "react";
import { DESK, isDraftA, isPhone, onLayoutChange } from "@/lib/layout";

// Card sizes in px, the card's 0.7 ratio: phones' 28x40 and desktop's 40x56. Every card on the table is this size: hole
// cards, the board, the deck and the button draw.
export const CARD_SIZES = [{ w: 28, h: 40 }, { w: 40, h: 56 }] as const;
// Literal classes, so Tailwind sees each one.
export const CARD_CLASS = ['w-7 h-10', 'w-10 h-14'] as const;

// ?cards=bold (a draft): bolder cards on the page's own table (desktop and phones), set apart from the white seat and the
// felt; ?cards=a|b|c each option, for comparing. a: a darker 1px border and a soft shadow at today's size; b: a's border
// with bigger, heavier rank and suit, stacked; c: b on the largest card the seat holds (45x64; phones 31x44), a seat's two
// overlapping. bold is c. Without it, nothing changes. Only where the page provides it (CardLookContext, page.tsx): the
// overview's small tables keep their cards.
export type CardLook = 'a' | 'b' | 'c';
const cardLookOf = (search: string): CardLook | null => { const v = new URLSearchParams(search).get('cards'); return v === 'bold' ? 'c' : v === 'a' || v === 'b' || v === 'c' ? v : null; };
export const useCardLookParam = () => useSyncExternalStore(noSub, () => cardLookOf(location.search), () => null);
export const CardLookContext = createContext<CardLook | null>(null);
export const useCardLook = () => useContext(CardLookContext);
export const CARD_SIZES_C = [{ w: 31, h: 44 }, { w: 45, h: 64 }] as const;
export const CARD_CLASS_C = ['w-[31px] h-[44px]', 'w-[45px] h-[64px]'] as const;
// A seat's second hole card over its first by this much with look c (the hand fits the seat's corner as today's did).
export const HOLE_OVERLAP_C = [6, 12] as const;
export const cardClassOf = (size: number, look: CardLook | null) => (look === 'c' ? CARD_CLASS_C : CARD_CLASS)[size];
// The page's look, for the dealt cards' flights (drawn outside React): set by the page's provider.
let pageLook: CardLook | null = null;
export const setPageCardLook = (l: CardLook | null) => { pageLook = l; };

// Phones keep today's size: the phone table's seats are laid out for it (phoneTable.ts). The layout is lib/layout's.
export const cardSizeNow = (): number => (isPhone() ? 0 : 1);
// The deck's size in px: the hole cards'.
// Draft A (app/a) draws the desktop table, so its deck and dealt cards are the desktop's.
export const deckSize = (size = cardSizeNow(), look: CardLook | null = pageLook) => { const s = look === 'c' ? CARD_SIZES_C : CARD_SIZES; return isDraftA() ? s[1] : s[size]; };

export const useCardSize = () => useSyncExternalStore(onLayoutChange, cardSizeNow, () => 0);

const query = (k: string) => new URLSearchParams(window.location.search).get(k);
const noSub = () => () => {};
// ?table=tall on draft A (/a): the tall table, the desktop's seat cards round a felt drawn tilted away (PokerTable).
export const useTallTable = () => useSyncExternalStore(noSub, () => query('table') === 'tall', () => false);
// ?tables=1: the tables overview is the landing (a draft, not yet the default), with the way back to it and the
// neighbouring tables at the stage's edges. Desktop only. Promoting it is this one line (return true).
function tablesOverview(search: string) { return new URLSearchParams(search).get('tables') === '1'; }
export const useTablesOverview = () => useSyncExternalStore(noSub, () => tablesOverview(location.search), () => false);
// ?tables=1&stacks=1|2 (a draft): the overview's seats show their stacks as a glyph, no numbers (StackGlyph).
const stacksDraft = (): 1 | 2 | null => { if (!tablesOverview(location.search)) return null; const v = query('stacks'); return v === '1' ? 1 : v === '2' ? 2 : null; };
export const useStacksDraft = () => useSyncExternalStore(noSub, stacksDraft, () => null);
// Run as the page is parsed: landing on the overview, the stage is hidden until the overview is drawn over it (page.tsx),
// so the first paint is not the single table.
export const OVERVIEW_FIRST = `(${tablesOverview})(location.search)&&!new URLSearchParams(location.search).get('t')&&matchMedia(${JSON.stringify(DESK)}).matches&&document.documentElement.setAttribute('data-overview','')`;
// How a table's neighbours show round it: by default an arrow button per neighbour (TableNav); ?edges=live their live
// tables faded at the stage's edges, ?edges=outline only their outlines (TablesOverview's Edge).
export type EdgesMode = 'buttons' | 'live' | 'outline';
const edgesMode = (): EdgesMode => { const e = query('edges'); return e === 'live' || e === 'outline' ? e : 'buttons'; };
export const useEdges = () => useSyncExternalStore(noSub, edgesMode, () => 'buttons' as const);
// ?t=KEY: the table in focus (the stream's key, e.g. 5-10-200bb), so Back, a reload or a shared link finds it.
const onUrl = (cb: () => void) => { addEventListener('popstate', cb); addEventListener('focuschange', cb); return () => { removeEventListener('popstate', cb); removeEventListener('focuschange', cb); }; };
export const useFocusParam = () => useSyncExternalStore(onUrl, () => query('t'), () => null);
// Each table opened from the overview is a history entry of its own, which counts how many such entries lead back to
// the overview (tablesDepth), so "All tables" goes back to it however many tables were visited, and Back walks them.
const depth = () => (history.state as { tablesDepth?: number } | null)?.tablesDepth ?? 0;
const setFocus = (key: string | null, push: boolean) => {
  const u = new URL(location.href);
  if (key) u.searchParams.set('t', key); else u.searchParams.delete('t');
  if (push) history.pushState({ tablesDepth: depth() + 1 }, '', u); else history.replaceState(history.state, '', u);
  dispatchEvent(new Event('focuschange'));
};
// history.go is asynchronous: a table opened before the traversal back lands would be undone by it, so the push waits
// for it (the latest one asked for wins).
let traversing: { key: string | null; timer: ReturnType<typeof setTimeout> } | null = null;
const landed = () => {
  if (!traversing) return;
  const { key, timer } = traversing;
  clearTimeout(timer);
  traversing = null;
  removeEventListener('popstate', landed);
  if (key) setFocus(key, true);
};
export const pushFocus = (key: string) => { if (traversing) traversing.key = key; else if (query('t') !== key) setFocus(key, true); };
// Drop ?t without a history entry (a key no table has, or one that has gone).
export const clearFocus = () => setFocus(null, false);
// Back to the overview: back through the tables opened since it, or (a page opened on a table) ?t dropped in place.
export const backToTables = () => {
  const d = depth();
  if (d <= 0) { if (traversing) traversing.key = null; else clearFocus(); return; }
  if (traversing) { traversing.key = null; return; }
  traversing = { key: null, timer: setTimeout(landed, 1000) }; // a traversal that never fires popstate frees the queue
  addEventListener('popstate', landed);
  history.go(-d);
};

// Which layout's tree to mount (lib/layout's switch): 'phone' or 'desk' once the page runs; null in the prerendered page
// and while it hydrates, where both trees are in the HTML and CSS shows one (md:hidden, max-md:hidden), so the first
// paint is right before any script. After that only the shown one is mounted: the other (half the page's elements on a
// phone) was laid out and updated with every state for nothing.
export const useLayout = () => useSyncExternalStore(onLayoutChange, () => (isPhone() ? 'phone' : 'desk'), () => null);
