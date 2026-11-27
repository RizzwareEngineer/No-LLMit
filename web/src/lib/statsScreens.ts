// The stats' screens, shared by the stats (StatsSections) and their stand-in before they load (StatsScreens).
// The wide layout's snap screens, top to bottom: the overview, About, then the cards' loop (History, Profiles, Matchups).
export const SCREENS = ['stats', 'about', 'race', 'stats-table', 'pairwise'] as const;
// A phone's stats window: the full screen (at least --win-min on a short window), under the top bar, over the tab bar.
export const WINDOW = `relative h-[max(100svh,var(--win-min,0px))] snap-start snap-always flex flex-col px-0 pt-[calc(var(--top-h)+8px)] pb-[calc(var(--bar-h,0px)+8px)]`;
// A phone's About window.
const ABOUT_BASE = 'relative snap-start snap-always -mx-3 bg-(--page)';
export const ABOUT_WINDOW = `${ABOUT_BASE} h-svh`;
// About at ?about=split (About.tsx's PhoneAbout): two windows, each at least the screen, its content centred between the
// bars; one taller than a short window grows and the page scrolls through it (never a scroll inside it).
export const ABOUT_PART = `${ABOUT_BASE} min-h-svh flex flex-col justify-center px-3 pt-[calc(var(--top-h)+8px)] pb-[calc(var(--bar-h,0px)+8px)]`;
// Phone About's draft (?about=1, 2, 3, desk or split; 1 by default): About.tsx and the stats' windows (StatsSections, and
// StatsHold, which must not load About).
export type AboutLayout = '1' | '2' | '3' | 'desk' | 'split';
export const aboutLayout = (): AboutLayout => { const v = new URLSearchParams(location.search).get('about'); return v === '2' || v === '3' || v === 'desk' || v === 'split' ? v : '1'; };
