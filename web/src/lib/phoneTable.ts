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
// The deck between hands (TableMotion's shuffle), board-card size: over the pot, never over it or the board (owner
// 2026-11-15: "the shuffle deck should not be in front of the pot count"). Its top from the felt's middle (px).
export const DECK = { w: 30, h: 42, top: POT_TOP - 2 - 42 } as const;

// The table's shape (?shape=, tableSwitches; drafts besides the oval, owner 2026-11-15: "some other layouts that we should
// consider such that it still feels like it fits with the no-limit version"): the oval (the default), a rounded rectangle
// like the desktop table with its seats on the edges (3 on top, 2 a side, 2 at the foot, the desktop's nine), or a
// stadium (straight sides, round ends of STADIUM_R). The logos' centres lie on the felt's edge; RADIUS draws the felt.
export type Shape = 'oval' | 'rect' | 'stadium';
export const RADIUS: Record<Shape, string> = { oval: '50%', rect: '16px', stadium: '120px' };
const STADIUM_R = 120;

export interface Spot {
  x: Lin; y: Lin; // the logo's centre
  cards: readonly [number, number]; bet: readonly [number, number]; // centres, px from the logo's centre
}

// A seat at `deg` degrees from the top, clockwise, on the oval's rim.
function onRim(deg: number): Pick<Spot, 'x' | 'y'> {
  const s = Math.sin((deg * Math.PI) / 180), c = Math.cos((deg * Math.PI) / 180);
  // x: the middle plus s times the half width less the side inset; y: the top inset plus (1 - c) / 2 of the rim's height.
  return { x: [0.5 + s / 2, -FELT.side * s], y: [(1 - c) / 2, FELT.top - ((1 - c) / 2) * (FELT.top + FELT.bottom)] };
}
// The stadium's right round ends at `deg` from the top (0..90 the top one, 90..180 the foot's; their centres are
// STADIUM_R in from the felt's corners).
function onStadiumEnd(deg: number): Pick<Spot, 'x' | 'y'> {
  const s = Math.sin((deg * Math.PI) / 180), c = Math.cos((deg * Math.PI) / 180), foot = deg > 90;
  return { x: [1, -FELT.side - STADIUM_R + STADIUM_R * s], y: foot ? [1, -FELT.bottom - STADIUM_R - STADIUM_R * c] : [0, FELT.top + STADIUM_R - STADIUM_R * c] };
}
// The felt's right side `f` of the way down, its top edge and its foot `f` of the way across (straight edges: the
// rectangle's, and the stadium's sides and top).
const onSide = (f: number): Pick<Spot, 'x' | 'y'> => ({ x: [1, -FELT.side], y: [f, FELT.top - f * (FELT.top + FELT.bottom)] });
const onTop = (f: number): Pick<Spot, 'x' | 'y'> => ({ x: [f, FELT.side * (1 - 2 * f)], y: [0, FELT.top] });
const onFoot = (f: number): Pick<Spot, 'x' | 'y'> => ({ x: [f, FELT.side * (1 - 2 * f)], y: [1, -FELT.bottom] });

// Seats 1 to 5 clockwise from the top's middle (seat 1, as the desktop's top row 0 1 2), and from each logo's centre the
// centre of its two hole cards (under the stack and label up top, beside or over the logo lower down: toward the middle)
// and of its bet; the left half mirrors them (0/2, 8/3, 7/4, 6/5). Tuned for nine so no two crowd each other and nothing
// meets the pot, the board or the deck (phoneTable.test.mjs at 375x667, 390x844, 430x932 and around them).
type Hands = Pick<Spot, 'cards' | 'bet'>;
const H = (cards: readonly [number, number], bet: readonly [number, number]): Hands => ({ cards, bet });
const NINE: Record<Shape, [Pick<Spot, 'x' | 'y'>, Hands][]> = {
  oval: [
    [onRim(0), H([0, 86], [0, 133])],
    [onRim(37.94), H([-14, 82], [-9, 112])],
    [onRim(72.56), H([-24, 83], [-60, 48])],
    [onRim(126.92), H([-18, -34], [-86, -45])],
    [onRim(158.9), H([-18, -36], [-21, -80])],
  ],
  stadium: [
    [onTop(0.5), H([0, 86], [0, 133])],
    [onStadiumEnd(31), H([-14, 82], [-9, 112])],
    [onSide(0.296), H([-14, 82], [-61, 47])],
    [onSide(0.75), H([-30, -35], [-96, -33])],
    [onStadiumEnd(152.5), H([-19, -45], [-45, -84])],
  ],
  // The oval's seats moved out to the rectangle's edges, so the oval's cards and bets fit.
  rect: [
    [onTop(0.5), H([0, 86], [0, 133])],
    [onTop(0.765), H([1, 87], [5, 119])],
    [onSide(0.345), H([-10, 84], [-54, 47])],
    [onSide(0.773), H([-50, -27], [-106, -32])],
    [onFoot(0.638), H([-3, -52], [-14, -85])],
  ],
};
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

export function seatSpots(n: number, shape: Shape = 'oval'): Spot[] {
  if (n !== 9) {
    // shortcut: other table sizes space the seats evenly round the oval; tune a table like NINE if the engine ever seats
    // other than nine.
    return Array.from({ length: n }, (_, i) => withHands(onRim((360 / n) * i - (n % 2 ? 0 : 180 / n))));
  }
  return Array.from({ length: 9 }, (_, i) => {
    const m = MIRROR[i], [p, h] = NINE[shape][(m ?? i) - 1];
    return m === undefined ? { ...p, ...h } : { ...flip(p), cards: [-h.cards[0], h.cards[1]], bet: [-h.bet[0], h.bet[1]] };
  });
}

// The felt's middle (y): the board sits just under it, the pot over the board.
export const MIDDLE: Lin = [0.5, (FELT.top - FELT.bottom) / 2 + 6];

// The seat's box around its logo's centre: the logo and its position chip, the stack and label under it, the cards with
// room to land askew (35 degrees) and to be peeked. The hole cards' flights and peek checks treat it as the seat.
export const TEXT_H = 28; // the stack's line and the label's, from 4px under the logo
export function seatBox(spot: Spot) {
  const c = spot.cards, half = LOGO / 2;
  const l = Math.min(-36, c[0] - 33), r = Math.max(36, c[0] + 33), t = Math.min(-half - 2, c[1] - 27), b = Math.max(half + 4 + TEXT_H, c[1] + 27);
  return { left: l, top: t, width: r - l, height: b - t };
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
