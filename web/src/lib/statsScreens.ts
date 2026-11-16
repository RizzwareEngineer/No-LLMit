// The stats' screens, shared by the stats (StatsSections) and their stand-in before they load (StatsScreens).
// The wide layout's snap screens, top to bottom: the overview, About, then the cards' loop (History, Profiles, Matchups).
export const SCREENS = ['stats', 'about', 'race', 'stats-table', 'pairwise'] as const;
// A phone's stats window: the full screen (at least --win-min on a short window), under the top bar, over the tab bar.
export const WINDOW = `relative h-[max(100svh,var(--win-min,0px))] snap-start snap-always flex flex-col px-0 pt-[calc(var(--top-h)+8px)] pb-[calc(var(--bar-h,0px)+8px)]`;
// A phone's About window.
export const ABOUT_WINDOW = 'relative h-svh snap-start snap-always -mx-3 bg-(--page)';
