// Where a hole card lands as it is dealt: its angle (-35 to 35 degrees) and a small offset in px at the 28x40 card, from
// a hash of the hand, the seat and the card (0 the first dealt), so every viewer and every reload sees the same table.
// The offset pulls the card in from its outer side by as far as the turned card reaches past its slot, so it stays
// inside the slot's width (HoleCard; the seat's text is beside the slots).
export function landing(hand: number, seat: number, slot: number) {
  let h = Math.imul(hand | 0, 0x9e3779b1) ^ Math.imul(seat + 1, 0x85ebca6b) ^ Math.imul(slot + 1, 0xc2b2ae35);
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
    return (h >>> 0) / 2 ** 32;
  };
  const rotate = (next() * 2 - 1) * 35, r = Math.abs(rotate) * Math.PI / 180;
  const over = (28 * Math.cos(r) + 40 * Math.sin(r) - 28) / 2;
  return { rotate, x: (slot ? -1 : 1) * (over + next() * 2), y: next() * 2 - 1 };
}
