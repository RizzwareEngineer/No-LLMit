// The phone table's geometry (PokerTable's oval, Player's compact seat): the seats' logos on the rim of a tall oval,
// each seat's two hole cards and its bet beside it, the pot and the board in the middle. Every place is linear in the table's box (W x H): a fraction of
// that side plus px, so it is CSS (calc(% + px)) and is right before React has measured anything (the prerendered page).
// phoneTable.test.mjs checks that nothing overlaps at the tables of 375x667 and 390x844, and around them.

export type Lin = readonly [frac: number, px: number];
export const at = (l: Lin, size: number) => l[0] * size + l[1];
export const css = (l: Lin) => `calc(${+(l[0] * 100).toFixed(4)}% + ${+l[1].toFixed(2)}px)`;

// The felt: an ellipse inset this far into the table's box. The logos' centres lie on its rim; the bottom inset leaves
// room for the lowest seats' stack and label.
export const FELT = { side: 30, top: 40, bottom: 60 } as const;
export const LOGO = 48;
// The pot's top from the felt's middle (px): the pot (30px), then the board (42px cards) from 2px over the middle.
export const POT_TOP = -36;
// The deck between hands (TableMotion's shuffle), board-card size, in the board's place as on the desktop, 4px lower so
// it is 8px under the pot, clear of the pot's label (the top seat's cards leave no room over the pot on a short table). Its top from the
// felt's middle (px): the board's row starts 2px over it.
export const DECK = { w: 28, h: 40, top: 2 } as const; // the hole cards' size (tableSwitches' CARD_SIZES)

export interface Spot {
  x: Lin; y: Lin; // the logo's centre
  cards: readonly [number, number]; bet: readonly [number, number]; // centres, px from the logo's centre
  bubble?: Bubble; // the action's bubble, where bubbleAt's rule would cover a neighbour
}
export type Bubble = { x: number; top: number; align: 'center' | 'left' };

// A seat at `deg` degrees from the top, clockwise, on the oval's rim.
function onRim(deg: number): Pick<Spot, 'x' | 'y'> {
  const s = Math.sin((deg * Math.PI) / 180), c = Math.cos((deg * Math.PI) / 180);
  // x: the middle plus s times the half width less the side inset; y: the top inset plus (1 - c) / 2 of the rim's height.
  return { x: [0.5 + s / 2, -FELT.side * s], y: [(1 - c) / 2, FELT.top - ((1 - c) / 2) * (FELT.top + FELT.bottom)] };
}
// Seats 1 to 5 clockwise from the top's middle (seat 1, as the desktop's top row 0 1 2), and from each logo's centre the
// centre of its two hole cards (under the stack and label up top, beside or over the logo lower down: toward the middle)
// and of its bet; the left half mirrors them (0/2, 8/3, 7/4, 6/5). Tuned for nine so no two crowd each other and nothing
// meets the pot, the board or the deck (phoneTable.test.mjs at 375x667, 390x844, 430x932 and around them).
type Hands = Pick<Spot, 'cards' | 'bet' | 'bubble'>;
const H = (cards: readonly [number, number], bet: readonly [number, number], bubble?: Bubble): Hands => ({ cards, bet, ...(bubble && { bubble }) });
const NINE: [Pick<Spot, 'x' | 'y'>, Hands][] = [
  [onRim(0), H([0, 86], [0, 133])],
  [onRim(37.94), H([-14, 82], [-9, 112])],
  // Seats 3 and 4: the action under the logo, over the label, a little inward (seat 3: over the logo it covers seat 2's
  // stack and cards; seat 4: centred it touches seat 5's logo on a short table).
  [onRim(72.56), H([-24, 83], [-60, 48], { x: 5, top: LOGO / 2 + 18, align: 'center' })],
  [onRim(126.92), H([-18, -34], [-86, -45], { x: 12, top: LOGO / 2 + 18, align: 'center' })],
  [onRim(158.9), H([-18, -36], [-21, -80])],
];
const MIRROR: Record<number, number> = { 0: 2, 8: 3, 7: 4, 6: 5 };
const flip = (p: Pick<Spot, 'x' | 'y'>): Pick<Spot, 'x' | 'y'> => ({ x: [1 - p.x[0], -p.x[1]], y: p.y });

// The table these offsets are worked out on (px); phoneTable.test.mjs checks the tables around it.
const REF = { w: 374, h: 600 };
const meets = (a: number[], b: number[], gap = 0) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > -gap && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > -gap;
const around = (x: number, y: number, hw: number, hh: number) => [x - hw, y - hh, x + hw, y + hh];
// A seat's hole cards and bet: straight toward the felt's middle, the cards as close as they go clear of the seat's
// stack and label (askew, 64x52) and logo, the bet just past the cards and clear of the whole seat.
function toward(x: number, y: number): Pick<Spot, 'cards' | 'bet'> {
  const mx = REF.w / 2, my = at(MIDDLE, REF.h), d = Math.hypot(mx - x, my - y), ux = (mx - x) / d, uy = (my - y) / d;
  const logo = around(0, 0, LOGO / 2 + 2, LOGO / 2 + 2), text = [-28, LOGO / 2 + 4, 28, LOGO / 2 + 4 + TEXT_H];
  let t = 30;
  while (meets(around(ux * t, uy * t, 32, 26), text, 2) || meets(around(ux * t, uy * t, 30, 20), logo)) t++;
  const cards = around(ux * t, uy * t, 30, 20);
  let u = t;
  while (meets(around(ux * u, uy * u, 24, 9), cards, 4) || meets(around(ux * u, uy * u, 24, 9), text, 4) || meets(around(ux * u, uy * u, 24, 9), logo, 4)) u++;
  return { cards: [Math.round(ux * t), Math.round(uy * t)], bet: [Math.round(ux * u), Math.round(uy * u)] };
}
const withHands = (p: Pick<Spot, 'x' | 'y'>): Spot => ({ ...p, ...toward(at(p.x, REF.w), at(p.y, REF.h)) });

export function seatSpots(n: number): Spot[] {
  if (n !== 9) {
    // shortcut: other table sizes space the seats evenly round the oval; tune a table like NINE if the engine ever seats
    // other than nine.
    return Array.from({ length: n }, (_, i) => withHands(onRim((360 / n) * i - (n % 2 ? 0 : 180 / n))));
  }
  return Array.from({ length: 9 }, (_, i) => {
    const m = MIRROR[i], [p, h] = NINE[(m ?? i) - 1];
    return m === undefined ? { ...p, ...h } : { ...flip(p), cards: [-h.cards[0], h.cards[1]], bet: [-h.bet[0], h.bet[1]], ...(h.bubble && { bubble: { ...h.bubble, x: -h.bubble.x } }) };
  });
}

// The felt's middle (y): the board sits just under it, the pot over the board.
export const MIDDLE: Lin = [0.5, (FELT.top - FELT.bottom) / 2 + 6];

// The seat's box around its logo's centre: the logo and its position chip, the stack and label under it, the cards with
// a margin round them. The hole cards' flights and the checks treat it as the seat.
export const TEXT_H = 28; // the stack's line and the label's, from 4px under the logo
export function seatBox(spot: Spot) {
  const c = spot.cards, half = LOGO / 2, x = TEXT_BOX;
  const l = Math.min(-36, c[0] - 33, x[0]), r = Math.max(36, c[0] + 33, x[2]), t = Math.min(-half - 4, c[1] - 27, x[1]), b = Math.max(half + 4, c[1] + 27, x[3]);
  return { left: l, top: t, width: r - l, height: b - t };
}
// The stack and label's box under the logo (px from the logo's centre: left, top, right, bottom), and the position chip's.
export const TEXT_BOX = [-28, LOGO / 2 + 4, 28, LOGO / 2 + 4 + TEXT_H] as const;
export const CHIP = { w: 44, h: 16 } as const;
export const CHIP_TOP = LOGO / 2 - 13; // the chip on the logo's lower edge
// The action's bubble (20px tall), px from the logo's centre: its top and its horizontal anchor. On the logo's side away
// from its cards, which are toward the middle: over the logo when the cards are under it, under the logo and its stack
// (over the label) when they are over it. The top seat's would leave the table (under the page's top bar), so it sits
// beside its logo's upper half.
export function bubbleAt(spot: Spot): Bubble {
  if (spot.bubble) return spot.bubble;
  if (spot.y[0] === 0 && spot.y[1] < LOGO) return { x: LOGO / 2 + 6, top: -20, align: 'left' };
  if (spot.cards[1] >= 0) return { x: 0, top: -LOGO / 2 - 24, align: 'center' };
  return { x: 0, top: LOGO / 2 + 18, align: 'center' };
}

// One short label per seat, from the model's name: families share logos, so it is what tells two Gemmas apart. A size
// ("27B", "R7B") if the name has one, else the name without its family's word and version numbers ("Haiku", "V3.2",
// "Maverick"), else the name ("Phi-4").
export function seatLabel(name: string): string {
  const words = name.split(' ');
  const size = words.find(w => /^[A-Z]?\d+(\.\d+)?B$/.test(w));
  if (size) return size;
  const rest = words.slice(1).filter(w => !/^\d+(\.\d+)*$/.test(w));
  return rest.length ? rest.join(' ') : name;
}

// The seat's box placed on the table (CSS), and its logo's centre inside it (px).
export function seatPlace(spot: Spot) {
  const b = seatBox(spot);
  return {
    style: { left: css([spot.x[0], spot.x[1] + b.left]), top: css([spot.y[0], spot.y[1] + b.top]), width: b.width, height: b.height },
    logo: [-b.left, -b.top] as const,
  };
}
