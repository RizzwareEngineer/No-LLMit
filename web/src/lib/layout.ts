// The one switch between the desktop table and the phone layout (owner 2026-11-15, on browser zoom: "Only mobile views
// when we change things"). The desktop layout shows only where its table fits whole: the locked 1000px table and its
// 240px Profits & Losses column at the stage's 75% floor (page.tsx's fitStage) with the page's gutters and a scrollbar,
// with no sideways scroll (from DESK_MIN_W across), on a window taller than SHORT_H (a phone held sideways is not).
// Everywhere else (a phone, a phone held sideways, a laptop zoomed past about 145%) gets the phone layout.
// CSS takes the same numbers from globals.css's md and max-md variants (Tailwind's md, redefined); layout.test.mjs
// checks the two agree. Never test the window's width against a number of your own: use PHONE.
export const DESK_MIN_W = 992;
export const SHORT_H = 500;
export const DESK = `(min-width: ${DESK_MIN_W}px) and (min-height: ${SHORT_H + 1}px)`;
export const PHONE = `not all and ${DESK}`;
export const isPhone = () => window.matchMedia(PHONE).matches;
export const onLayoutChange = (cb: () => void) => { const m = window.matchMedia(PHONE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); };
