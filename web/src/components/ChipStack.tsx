// A pile of chips sized by the amount: 1–9 is one chip, 10–99 one stack of 2–4,
// 100–999 two or three stacks, 1,000 and up four or five.
const PILE = [5, 4, 5, 3, 4]; // stack heights in a pile, so it reads as a heap, not a bar

// Black chips with a white top, like the cards: the owner's pick over casino colours and flat ink.
const CHIP = { face: '#ffffff', edge: '#37352f' };

// The height of each stack, in chips.
export function chipStacks(amount: number): number[] {
  if (amount <= 0) return [];
  const cols = amount < 100 ? 1 : amount < 300 ? 2 : amount < 1000 ? 3 : amount < 3000 ? 4 : 5;
  const height = (i: number) => (amount < 10 ? 1 : amount < 100 ? Math.min(4, 2 + Math.floor(amount / 35)) : PILE[i]);
  return Array.from({ length: cols }, (_, i) => height(i));
}

const R = 7; // chip radius
const T = 3; // chip thickness
const GAP = 12; // stack spacing (stacks overlap a little, like a heap)

export default function ChipStack({ amount }: { amount: number }) {
  const stacks = chipStacks(amount);
  if (!stacks.length) return null;
  const tall = Math.max(...stacks);
  const w = (stacks.length - 1) * GAP + R * 2 + 2;
  const h = tall * T + R + 4;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      {stacks.map((n, i) => {
        const cx = 1 + R + i * GAP;
        return Array.from({ length: n }, (_, j) => {
          const cy = h - R / 2 - 2 - j * T;
          return (
            <g key={`${i}-${j}`}>
              <rect x={cx - R} y={cy} width={R * 2} height={T} fill={CHIP.edge} />
              <ellipse cx={cx} cy={cy + T} rx={R} ry={R / 2} fill={CHIP.edge} />
              <ellipse cx={cx} cy={cy} rx={R} ry={R / 2} fill={CHIP.face} stroke={CHIP.edge} strokeWidth={0.6} />
              <ellipse cx={cx} cy={cy} rx={R - 2.4} ry={R / 2 - 1.2} fill="none" stroke="#37352f" strokeWidth={0.6} />
            </g>
          );
        });
      })}
    </svg>
  );
}

// Dev self-check of the tiers.
if (process.env.NODE_ENV !== 'production') {
  const cols = (a: number) => chipStacks(a).length, top = (a: number) => chipStacks(a)[0];
  console.assert(cols(5) === 1 && top(5) === 1, 'ChipStack: 1–9 is one chip');
  console.assert(cols(10) === 1 && top(10) === 2 && top(70) === 4, 'ChipStack: 10–99 is one stack of 2–4');
  console.assert(cols(150) === 2 && cols(500) === 3 && cols(2000) === 4 && cols(5000) === 5, 'ChipStack: piles grow with the amount');
}
