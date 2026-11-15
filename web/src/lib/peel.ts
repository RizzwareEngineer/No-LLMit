// A hole card's pose on the felt, as one rigid transform (HoleCard). Owner, 2026-11-14: the cards land in front of the
// player at random angles, are stacked, "turn the cards horizontally", and peeled up; "stop distorting the cards". Owner,
// 2026-11-15, on the peel lab: "we peel from the bottom-right corners and then we peel all the way up. Pause the moment we
// can see what's in the middle"; "the cards are still sideways, and they're still a bit slanted, but the text itself
// shouldn't be able to distort anymore"; and a second route: "we just get the cards, then we stack them on top of each
// other vertically, and then we flip them over". Owner, 2026-11-15, on both: "I like both A and B. Let's randomize which players do what, and let's speed it up too".
// So each seat takes A or B at random for each hand (routeOf: a hash of the hand and the seat, the same for every viewer and
// after a reload); ?peel=a or ?peel=b forces one route at every seat, for the peel lab and the checks only:
// A: stacked, turned a quarter counterclockwise, lifted as a whole about a hinge through the far-left corner (leaning so
// the near-right corner rises first) and turned on all the way over, the second card sliding out from under the first so
// both middles show, held flat towards the viewer (sideways, a little slanted), then righted into their slots.
// B: stacked upright, the stack turned over about its upright middle line (one rigid turn), held a moment, then slid into
// the slots. The card's face is always the plain one (Card): rank and suit in the middle. Only rotations and translations
// of whole cards: no scale, skew or bend.

export type Variant = 'a' | 'b';
export type Pose = {
  x: number; y: number; // px from the card's slot
  r: number; // degrees in the felt's plane, clockwise
  lift: number; // degrees about the hinge, up off the felt (180: turned over)
  slide: number; // px along the card's long side, in its own plane (the second card's spread)
  side: number; // px along the card's short side, in its own plane (the second card's spread)
  flip: number; // degrees about the card's upright middle line: 180 face down, 0 face up
};
export type Lay = { x: number; y: number; rotate: number };

export const GAP = 4; // px between the two slots: Player's gap-1
// Degrees the hinge leans from the card's long side: the far end of the near side (the bottom-right corner, sideways)
// rises first, so the peel starts at that corner.
export const TILT = 14;
const AX = -1, AY = -1; // the axis's sense: the card rises towards the viewer
// At the hold the second card lies this share of the card's width along its long side and its short side from the first
// (in their shared plane, never turning apart): sideways, to the right of and below the first, so both middles show.
export const SLIDE = -0.95, SIDE = -0.2;
// Seconds: the steps' ends. A: stacked, turned, lifted all the way over, held (0.45 s, both middles readable), righted.
// B: stacked, turned over, held, slid. Sped up from 2.9 s and 1.8 s (owner, 2026-11-15: "the flow is a little bit too
// slow as of right now for users to tolerate").
export const STEPS = { a: [0.2, 0.42, 0.85, 1.3, 1.7], b: [0.22, 0.58, 0.78, 1.1] } as const;
export const SHOWS = { a: STEPS.a[4], b: STEPS.b[3] } as const;
export const TURN = 0.5; // seconds: a card turning over at the hand's end
export const FADE = 0.25; // seconds: a phone's cards fading face up
export const LINE = 0.2; // seconds: a phone's cards settling from where they landed into their upright slots as they fade up

// The route the page forces (?peel=a or ?peel=b: an override for the peel lab and the checks only), else null: the plain
// URL viewers load takes each seat's own route (routeOf).
export const variantNow = (): Variant | null => {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('peel');
  return v === 'a' || v === 'b' ? v : null;
};
// The seat's route for the hand, A or B at random: a hash of the hand and the seat (as landing's angles), so every viewer
// and every reload sees the same route at that seat.
export function routeOf(hand: number, seat: number): Variant {
  let h = Math.imul(hand | 0, 0x27d4eb2f) ^ Math.imul(seat + 1, 0x165667b1) ^ 0x5bd1e995;
  for (let k = 0; k < 2; k++) { h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16; }
  return (h >>> 0) / 2 ** 32 < 0.5 ? 'a' : 'b';
}

const rad = (d: number) => (d * Math.PI) / 180;
const ease = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (2 - 2 * u) ** 3 / 2);
const step = (t: number, a: number, b: number) => ease(Math.min(1, Math.max(0, (t - a) / (b - a))));
const mix = (a: number, b: number, u: number) => a + (b - a) * u;

export const REST: Pose = { x: 0, y: 0, r: 0, lift: 0, slide: 0, side: 0, flip: 0 };
export const down = (lay: Lay): Pose => ({ x: lay.x, y: lay.y, r: lay.rotate, lift: 0, slide: 0, side: 0, flip: 180 });
export const between = (a: Pose, b: Pose, u: number): Pose => ({
  x: mix(a.x, b.x, u), y: mix(a.y, b.y, u), r: mix(a.r, b.r, u), lift: mix(a.lift, b.lift, u), slide: mix(a.slide, b.slide, u), side: mix(a.side, b.side, u), flip: mix(a.flip, b.flip, u),
});

// The peek at `t` seconds, for the card in `slot` (0 the first dealt, 1 the second, on top) `w` x `h` px, landed at `lay`.
export function peekPose(t: number, slot: 0 | 1, w: number, lay: Lay, h = w / 0.7, variant: Variant = 'a'): Pose {
  const cx = (slot ? -1 : 1) * (w + GAP) / 2; // the middle of the two slots, from this one
  if (variant === 'b') {
    const [a, b, c, d] = STEPS.b, stacked = step(t, 0, a), over = step(t, a, b), home = step(t, c, d);
    return { x: mix(mix(lay.x, cx, stacked), 0, home), y: mix(lay.y, 0, stacked), r: mix(lay.rotate, 0, stacked), lift: 0, slide: 0, side: 0, flip: 180 * (1 - over) };
  }
  const [a, b, c, d, e] = STEPS.a;
  const stacked = step(t, 0, a), turned = step(t, a, b), lifted = step(t, b, c);
  const lift = 180 * lifted, spread = slot ? lifted : 0;
  const p: Pose = { x: mix(lay.x, cx, stacked), y: mix(lay.y, 0, stacked), r: mix(lay.rotate, 0, stacked) + 90 * turned, lift, slide: SLIDE * w * spread, side: SIDE * w * spread, flip: 180 };
  // As it turns over, the stack moves so that, face up, the pair lies on the middle of the two slots (the turn about the
  // hinge carries it past the hinge): by the share of that move the turn has made.
  const to = overMiddle(w, h);
  const share = (1 - Math.cos(rad(lift))) / 2;
  p.x -= share * to.x; p.y -= share * to.y;
  if (t <= d) return p;
  // Turned over, the card lies face up: the same place as a flat pose, from which it is righted (turned upright where it
  // lies, then slid into its slot, the two overlapping).
  const flat = flatOf(p, w, h), upright = step(t, d, d + 0.6 * (e - d)), home = step(t, d + 0.35 * (e - d), e);
  return { x: mix(flat.x, 0, home), y: mix(flat.y, 0, home), r: mix(flat.r, 0, upright), lift: 0, slide: 0, side: 0, flip: 0 };
}

// Where the pair's middle (both cards' middles' mean, from the slots' middle) would lie turned over, stacked on the slots'
// middle: the turned-over pair is moved back by this, both cards alike.
function overMiddle(w: number, h: number) {
  const g = (w + GAP) / 2, one = (slot: 0 | 1) => flatOf({ x: slot ? -g : g, y: 0, r: 90, lift: 180, slide: slot ? SLIDE * w : 0, side: slot ? SIDE * w : 0, flip: 180 }, w, h);
  const a = one(0), b = one(1);
  return { x: (a.x - g + b.x + g) / 2, y: (a.y + b.y) / 2 };
}

// 4x4 matrices, column vectors, as CSS composes a transform list.
type M = number[][];
const mul = (a: M, b: M): M => a.map((row, i) => row.map((_, j) => row.reduce((s, _, k) => s + a[i][k] * b[k][j], 0)));
const tr = (x: number, y: number): M => [[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, 0], [0, 0, 0, 1]];
const rz = (d: number): M => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]; };
const rot = (x: number, y: number, d: number): M => { // about the in-plane unit axis (x, y)
  const c = Math.cos(rad(d)), s = Math.sin(rad(d)), t = 1 - c;
  return [[t * x * x + c, t * x * y, s * y, 0], [t * x * y, t * y * y + c, -s * x, 0], [-s * y, s * x, c, 0], [0, 0, 0, 1]];
};
// The hinge: through the card's top-right corner (the far-left one once turned), its axis the long side leant TILT.
const hinge = (w: number, h: number) => ({ hx: -w / 2, hy: h / 2, ax: AX * Math.sin(rad(TILT)), ay: AY * Math.cos(rad(TILT)) });
export function matrixOf(p: Pose, w: number, h = w / 0.7): M {
  const { hx, hy, ax, ay } = hinge(w, h);
  return [tr(p.x, p.y), rz(p.r), tr(hx, hy), rot(ax, ay, p.lift), tr(p.side - hx, p.slide - hy), rot(0, 1, p.flip)].reduce(mul);
}

// A pose that lies flat face up (lift and flip both 0 or both 180: two half turns about lines in the felt's plane make one
// turn in it) as the plain flat pose it equals.
export function flatOf(p: Pose, w: number, h: number): Pose {
  const m = matrixOf(p, w, h);
  return { x: m[0][3], y: m[1][3], r: (Math.atan2(m[1][0], m[0][0]) * 180) / Math.PI, lift: 0, slide: 0, side: 0, flip: 0 };
}

// The CSS transform, about the card's middle, for a card `w` x `h` px.
export function css(p: Pose, w: number, h = w / 0.7) {
  const { hx, hy, ax, ay } = hinge(w, h), f = (n: number) => +n.toFixed(3);
  return `translate(${f(p.x)}px, ${f(p.y)}px) rotate(${f(p.r)}deg) translate(${f(hx)}px, ${f(hy)}px) rotate3d(${f(ax)}, ${f(ay)}, 0, ${f(p.lift)}deg) translate(${f(p.side - hx)}px, ${f(p.slide - hy)}px) rotateY(${f(p.flip)}deg)`;
}
