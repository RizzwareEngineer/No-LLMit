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

// Seats 1 to 5 clockwise from the top: their angle from the top (degrees, about 40 apart), and from the logo's centre
// the centre of the two hole cards (under the stack and label up top, beside or over the logo lower down: toward the
// middle) and of the bet. The left half mirrors them (0/2, 8/3, 7/4, 6/5). Tuned for nine seats (phoneTable.test.mjs).
const RIGHT = [
  { deg: 0, cards: [0, 88], bet: [0, 135] },
  { deg: 32, cards: [1, 87], bet: [5, 119] },
  { deg: 72, cards: [-10, 84], bet: [-54, 47] },
  { deg: 123, cards: [-38, -27], bet: [-94, -32] },
  { deg: 164, cards: [-3, -52], bet: [-14, -85] },
] as const;
const MIRROR: Record<number, number> = { 0: 2, 8: 3, 7: 4, 6: 5 };

export interface Spot {
  x: Lin; y: Lin; // the logo's centre
  cards: readonly [number, number]; bet: readonly [number, number]; // centres, px from the logo's centre
}

// A seat at `deg` degrees from the top, clockwise, on the felt's rim.
function onRim(deg: number): Pick<Spot, 'x' | 'y'> {
  const s = Math.sin((deg * Math.PI) / 180), c = Math.cos((deg * Math.PI) / 180);
  // x: the middle plus s times the half width less the side inset; y: the top inset plus (1 - c) / 2 of the rim's height.
  return { x: [0.5 + s / 2, -FELT.side * s], y: [(1 - c) / 2, FELT.top - ((1 - c) / 2) * (FELT.top + FELT.bottom)] };
}

export function seatSpots(n: number): Spot[] {
  if (n !== 9) {
    // shortcut: other table sizes space the seats evenly and put the cards and the bet straight toward the middle; tune a
    // table like RIGHT if the engine ever seats other than nine.
    return Array.from({ length: n }, (_, i) => {
      const deg = (360 / n) * i - (n % 2 ? 0 : 180 / n), r = (deg * Math.PI) / 180, s = Math.sin(r), c = Math.cos(r);
      return { ...onRim(deg), cards: [-s * 62, c * 62], bet: [-s * 100, c * 100] };
    });
  }
  return Array.from({ length: 9 }, (_, i) => {
    const m = MIRROR[i], r = RIGHT[(m ?? i) - 1], sign = m === undefined ? 1 : -1;
    return { ...onRim(sign * r.deg), cards: [sign * r.cards[0], r.cards[1]], bet: [sign * r.bet[0], r.bet[1]] };
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
