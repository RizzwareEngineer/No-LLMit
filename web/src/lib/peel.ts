// A hole card's pose on the felt, as one rigid transform (HoleCard). Owner, 2026-11-14, on how a player peeks: the cards
// land in front of the player at random angles, "the player will then stack the cards on top of each other so they line
// up", "they then turn the cards horizontally, and then, from the side that's closest to the player, they'll peel the
// cards up", "diagonally left and up"; "once we've seen that, you can flip them on their backs, continuing the peel-up
// motion after you pause for a bit"; "stop distorting the cards. They need to be proportional."
// So: stacked, turned a quarter counterclockwise (the card's left long side is then the near, bottom, edge and its top-left
// corner the near-left one), lifted as a whole about a hinge through the far-right corner, tilted so the near-left
// corner rises most, the second sliding out from under the first so both corners show, held, then turned on over the same hinge to lie
// face up, and righted into their slots. Only rotations and translations of whole cards: no scale, skew or bend.

export type Pose = {
  x: number; y: number; // px from the card's slot
  r: number; // degrees in the felt's plane, clockwise
  lift: number; // degrees about the hinge, up off the felt (180: turned over)
  slide: number; // px along the card's long side, in its own plane (the second card's spread)
  side: number; // px along the card's short side, in its own plane (the second card's spread)
  flip: number; // degrees about the card's upright middle line: 180 face down, 0 face up
  index: number; // the corner index's opacity (drawn only for the peek)
};
export type Lay = { x: number; y: number; rotate: number };

export const GAP = 4; // px between the two slots: Player's gap-1
export const TILT = 12; // degrees the hinge leans from the card's long side, so the near-left corner rises most
export const HOLD_LIFT = 135; // degrees lifted at the hold: past upright, the faces towards a viewer above
// As the stack lifts, the second card slides from under the first in their shared plane (never turning apart: one
// rotation for both), by these shares of the card's width: along the long side past the first's corner, and a little along
// the short side, so at the hold its index shows beside and below the first's (the owner's photo: the A above the K).
export const SLIDE = -0.45, SIDE = 0.55;
// As it lifts, the stack moves toward the player by this share of the card's width at a half turn, so the faces, which rise
// past the hinge, stay inside the seat (the hinge's lean already carries the lifted corner to the left; on the phone ring
// the seat's text is just left of the cards, so nothing more leftward).
export const SINK = 1;
// Degrees the corner index is turned on the face so it reads upright at the hold (the peel lab's poses show it).
export const INDEX_TURN = 60;
// Seconds: the steps' ends. Stacked, turned, lifted, held, turned over, righted.
export const STEPS = [0.35, 0.75, 1.15, 1.95, 2.25, 2.6] as const;
export const SHOW = STEPS[5];
export const TURN = 0.5; // seconds: a card turning over at the hand's end

const rad = (d: number) => (d * Math.PI) / 180;
const ease = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (2 - 2 * u) ** 3 / 2);
const step = (t: number, a: number, b: number) => ease(Math.min(1, Math.max(0, (t - a) / (b - a))));
const mix = (a: number, b: number, u: number) => a + (b - a) * u;

export const REST: Pose = { x: 0, y: 0, r: 0, lift: 0, slide: 0, side: 0, flip: 0, index: 0 };
export const down = (lay: Lay): Pose => ({ x: lay.x, y: lay.y, r: lay.rotate, lift: 0, slide: 0, side: 0, flip: 180, index: 0 });
export const between = (a: Pose, b: Pose, u: number): Pose => ({
  x: mix(a.x, b.x, u), y: mix(a.y, b.y, u), r: mix(a.r, b.r, u), lift: mix(a.lift, b.lift, u), slide: mix(a.slide, b.slide, u), side: mix(a.side, b.side, u), flip: mix(a.flip, b.flip, u), index: mix(a.index, b.index, u),
});

// The peek at `t` seconds, for the card in `slot` (0 the first dealt, 1 the second, on top) `w` px wide, landed at `lay`.
export function peekPose(t: number, slot: 0 | 1, w: number, lay: Lay, h = w / 0.7): Pose {
  const cx = (slot ? -1 : 1) * (w + GAP) / 2; // the middle of the two slots, from this one
  const [a, b, c, d, e] = STEPS;
  const stacked = step(t, 0, a), turned = step(t, a, b), lifted = step(t, b, c), over = step(t, d, e);
  // Righted: first turned upright where the stack lies, then each card slid into its slot, so no corner swings out of the
  // two slots' space as it turns.
  const upright = step(t, e, e + 0.6 * (SHOW - e)), home = step(t, e + 0.4 * (SHOW - e), SHOW);
  const spread = slot ? lifted - over : 0, lift = HOLD_LIFT * lifted + (180 - HOLD_LIFT) * over;
  const p: Pose = {
    x: mix(lay.x, cx, stacked), y: mix(lay.y, 0, stacked) + SINK * w * (1 - Math.cos(rad(lift))) / 2, r: mix(lay.rotate, 0, stacked) - 90 * turned,
    lift, slide: SLIDE * w * spread, side: SIDE * w * spread, flip: 180, index: 1 - step(t, d, e),
  };
  // While it turns over, the stack also moves so that, face up, it lies on the middle of the two slots.
  const to = flatOf({ ...p, x: cx, y: SINK * w, r: -90, lift: 180, slide: 0, side: 0 }, w, h);
  p.x += over * (cx - to.x); p.y -= over * to.y;
  if (t <= e) return p;
  // Turned over, the card lies face up: the same place as a flat pose (two half turns about lines in the felt's plane make
  // one turn in it), from which it is righted into its slot.
  const flat = flatOf(p, w, h);
  return { x: mix(flat.x, 0, home), y: mix(flat.y, 0, home), r: mix(flat.r, 0, upright), lift: 0, slide: 0, side: 0, flip: 0, index: p.index };
}

// A pose turned over (lift 180, flip 180, no spread) as the flat face-up pose it equals: the half turn about the card's middle
// line then the half turn about the hinge are one turn of 2 x TILT about the point where the two lines cross.
export function flatOf(p: Pose, w: number, h: number): Pose {
  const s = rad(TILT), cross = h / 2 + (w / 2) / Math.tan(s); // on the middle line, below the card
  const turn = (deg: number, x: number, y: number) => [x * Math.cos(rad(deg)) - y * Math.sin(rad(deg)), x * Math.sin(rad(deg)) + y * Math.cos(rad(deg))];
  const r = p.r + 2 * TILT, [ax, ay] = turn(p.r, 0, cross), [bx, by] = turn(r, 0, cross);
  return { x: p.x + ax - bx, y: p.y + ay - by, r, lift: 0, slide: 0, side: 0, flip: 0, index: 0 };
}

// The CSS transform, about the card's middle, for a card `w` x `h` px. The hinge runs through the card's bottom-right
// corner (the far-right one once it is turned), leaning TILT from its long side.
export function css(p: Pose, w: number, h = w / 0.7) {
  const s = rad(TILT), f = (n: number) => +n.toFixed(3);
  return `translate(${f(p.x)}px, ${f(p.y)}px) rotate(${f(p.r)}deg) translate(${f(w / 2)}px, ${f(h / 2)}px) rotate3d(${f(-Math.sin(s))}, ${f(Math.cos(s))}, 0, ${f(p.lift)}deg) translate(${f(p.side - w / 2)}px, ${f(p.slide - h / 2)}px) rotateY(${f(p.flip)}deg)`;
}
