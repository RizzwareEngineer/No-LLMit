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
// it is 8px under the pot (owner 2026-11-15: "the shuffle deck should not be in front of the pot count"; the audit found
// it over the pot's label at 375, and the top seat's cards leave no room over the pot on a short table). Its top from the
// felt's middle (px): the board's row starts 2px over it.
export const DECK = { w: 30, h: 42, top: 2 } as const;

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
  text?: TextAt; // where the stack and the label sit (default: under the logo)
  chipTop?: boolean; // the position chip on the logo's top edge, not its lower one (tucked cards cover the lower one)
  bubble?: Bubble; // a draft seat's action bubble where bubbleAt's rule would cover a neighbour (the review, 2026-11-16)
}
export type Bubble = { x: number; top: number; align: 'center' | 'left' | 'right' };
// The stack and the label: under the logo, `dx` across and `dy` down from the usual place (a tucked top seat's sit just
// under its cards), or beside it, on the side with room, `dy` down from level with its centre.
export type TextAt = { under: readonly [dx: number, dy: number] } | { beside: 'left' | 'right'; dy?: number };
// The phone seat's drafts (?seat=, tableSwitches; the owner has not picked one): today's (the stack and label under the
// logo, the cards under them up top), 'beside' (the stack and label beside the logo, so the seat is short and its cards
// and bet sit on its line to the middle) and 'tucked' (the cards against the logo, over its inner edge, as phone poker
// apps tuck them at the avatar; the stack and label under the logo).
export type SeatDraft = 'today' | 'beside' | 'tucked';
export const TEXT_W = 48; // the stack's and label's column beside the logo (the widest label, "Maverick", is 46px at 11px)

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

// The drafts' seats 1 to 5 (the left half mirrors them, as NINE), worked out on the tables of 360x640 to 430x932 and
// 844x390 against the audit's rules (phone-table-ownership): each pair and bet nearer its own logo than any other, off
// the board's row, on the felt, 8px clear of other logos and bets. On the oval the beside and tucked seats sit at their
// own angles (seat 1 at the top), so the board's row has room between the side seats.
type DraftSeat = { cards: readonly [number, number]; bet: readonly [number, number]; text: TextAt; chipTop?: boolean; bubble?: Bubble };
const D = (cards: readonly [number, number], bet: readonly [number, number], text: TextAt, chipTop = false, bubble?: Bubble): DraftSeat => ({ cards, bet, text, chipTop, bubble });
const ANGLES: Record<Exclude<SeatDraft, 'today'>, readonly number[]> = { beside: [34.86, 68.84, 118.63, 153.87], tucked: [39.31, 86.33, 119.28, 156.1] };
const U: TextAt = { under: [0, 0] };
const DRAFTS: Record<Exclude<SeatDraft, 'today'>, Record<Shape, DraftSeat[]>> = {
  // The stack and label beside the logo, on the side with room (outward up top and at the foot, inward on the side
  // seats, whose outer side is off the table); at the widest part of the oval neither side has room under the seat
  // below, so that seat keeps them under its logo. Three action bubbles placed by hand (the review, 2026-11-16: at
  // 360x640 and 375x667 bubbleAt's rule put them over a neighbour; phone-table-places plays all nine): seat 2's leans
  // out, clear of the top seat's stack and label; seat 3's sits left of its logo over its own label, clear of seat 2's
  // cards; seat 4's 2px lower and 6px out, clear of seat 5's logo.
  beside: {
    oval: [
      D([0, 47], [-1, 81], { beside: 'left', dy: -14 }),
      D([-14, 48], [-52, 78], { beside: 'right', dy: -14 }, false, { x: 4, top: -50, align: 'left' }),
      D([-27, 47], [-90, 24], { beside: 'left' }, false, { x: -62, top: 2, align: 'right' }),
      D([-33, -18], [-92, -23], { under: [4, 0] }, false, { x: 6, top: 44, align: 'center' }),
      D([-28, -26], [-6, -61], { beside: 'right', dy: 8 }),
    ],
    rect: [], stadium: [],
  },
  // The top seats' cards cover the logo's lower edge, so their chip sits on its top edge and their stack and label under
  // the cards (or beside them); lower down the cards sit over the logo's inner upper edge. Seat 3's action bubble placed
  // by hand over its own logo, level with it, its right edge 22px right of the logo's centre so it reaches in over its own
  // cards (the review, 2026-11-16: centred under the logo, it covered seat 4's cards on short tables; under the logo's
  // inner half, review 3: the river card, and seat 8's the first flop card; up and in, review 4: its own bet, and seat
  // 2's stack and label on the landscape tables). phoneTable.test.mjs finds it clear of every seat's logo, cards, stack,
  // label and bet (its own bet too), the pot and the board, at the portrait and the landscape tables.
  tucked: {
    oval: [
      D([2, 27], [1, 67], { under: [0, 54] }, true),
      D([-26, 32], [-32, 68], { under: [24, 30] }, true),
      D([-41, -10], [-100, -29], U, false, { x: 22, top: -10, align: 'right' }),
      D([-33, -19], [-90, -22], U),
      D([-23, -28], [-19, -62], U),
    ],
    rect: [], stadium: [],
  },
};

export function seatSpots(n: number, shape: Shape = 'oval', draft: SeatDraft = 'today'): Spot[] {
  if (draft !== 'today' && n === 9) {
    const where = shape === 'oval' ? [0, ...ANGLES[draft]].map(onRim) : NINE[shape].map(([p]) => p);
    return Array.from({ length: 9 }, (_, i) => {
      // Not tuned for the other shapes yet: the oval's seats at their places (phone-table-ownership measures how they fare).
      const m = MIRROR[i], p = where[(m ?? i) - 1], d = (DRAFTS[draft][shape].length ? DRAFTS[draft][shape] : DRAFTS[draft].oval)[(m ?? i) - 1];
      if (m === undefined) return { ...p, cards: d.cards, bet: d.bet, text: d.text, chipTop: d.chipTop, bubble: d.bubble };
      const text: TextAt = 'beside' in d.text ? { beside: d.text.beside === 'left' ? 'right' : 'left', dy: d.text.dy } : { under: [-d.text.under[0], d.text.under[1]] };
      const b = d.bubble, bubble: Bubble | undefined = b && { x: -b.x, top: b.top, align: b.align === 'left' ? 'right' : b.align === 'right' ? 'left' : 'center' };
      return { ...flip(p), cards: [-d.cards[0], d.cards[1]], bet: [-d.bet[0], d.bet[1]], text, chipTop: d.chipTop, bubble };
    });
  }
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
  const c = spot.cards, half = LOGO / 2, x = textBox(spot);
  const l = Math.min(-36, c[0] - 33, x[0]), r = Math.max(36, c[0] + 33, x[2]), t = Math.min(-half - 4, c[1] - 27, x[1]), b = Math.max(half + 4, c[1] + 27, x[3]);
  return { left: l, top: t, width: r - l, height: b - t };
}
// The stack and label's box (px from the logo's centre: left, top, right, bottom), and the position chip's.
export function textBox(spot: Spot): [number, number, number, number] {
  const t = spot.text ?? { under: [0, 0] };
  if ('beside' in t) {
    const y = (t.dy ?? 0) - TEXT_H / 2;
    return t.beside === 'right' ? [LOGO / 2 + 4, y, LOGO / 2 + 4 + TEXT_W, y + TEXT_H] : [-LOGO / 2 - 4 - TEXT_W, y, -LOGO / 2 - 4, y + TEXT_H];
  }
  const [dx, dy] = t.under;
  return [-28 + dx, LOGO / 2 + 4 + dy, 28 + dx, LOGO / 2 + 4 + TEXT_H + dy];
}
export const CHIP = { w: 44, h: 16 } as const;
export const chipTop = (spot: Spot) => (spot.chipTop ? -LOGO / 2 - 3 : LOGO / 2 - 13);
// The action's bubble (20px tall), px from the logo's centre: its top and its horizontal anchor. On the logo's side away
// from its cards, which are toward the middle: over the logo (and a chip on its top edge) when the cards are under it,
// under the logo and its stack (over the label) when they are over it. The top seat's would leave the table (under the
// page's top bar), so it sits beside its logo's upper half, on the side without its stack and label.
export function bubbleAt(spot: Spot): Bubble {
  if (spot.bubble) return spot.bubble;
  const x = textBox(spot), beside = 'beside' in (spot.text ?? {});
  if (spot.y[0] === 0 && spot.y[1] < LOGO) return beside && x[0] > 0 ? { x: -LOGO / 2 - 6, top: -20, align: 'right' } : { x: LOGO / 2 + 6, top: -20, align: 'left' };
  if (spot.cards[1] >= 0) return { x: 0, top: (spot.chipTop ? -LOGO / 2 - 3 : -LOGO / 2) - 24, align: 'center' };
  return { x: 0, top: beside ? LOGO / 2 + 6 : LOGO / 2 + 18, align: 'center' };
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
