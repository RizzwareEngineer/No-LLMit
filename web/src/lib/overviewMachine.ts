// The tables overview's transitions (page.tsx): the URL's ?t names the table to show (none: the overview), and the stage
// moves toward it one animation at a time. An input never cancels an animation: it changes the URL, and when the running
// animation ends the next step is planned from the URL as it is then, so whatever the order of clicks, keys and history
// moves, the page ends where the URL says.

// What runs: a zoom from the overview into a table ('in'), from a table back into its cell ('out'), or a slide from one
// table to another (its table leaving, 'slideOut', then the new one arriving, 'slideIn'). `v`: the slide's direction.
export type Anim = { id: number; kind: 'in' | 'out' | 'slideOut' | 'slideIn'; from: string | null; to: string | null; v: readonly [number, number] };

// The table the URL asks for: its ?t when that is one of the tables (or while none are known yet), else none.
export const targetOf = (param: string | null, keys: readonly string[]) => (param && (!keys.length || keys.includes(param)) ? param : null);

// The next animation from what the stage shows (`shown`; null: the overview) toward `target`; null when it is there.
// `cols`: the overview's columns, for a slide's direction (the way the target lies on the overview's grid).
export function nextAnim(id: number, shown: string | null, target: string | null, keys: readonly string[], cols: number): Anim | null {
  if (shown === target) return null;
  if (shown === null) return { id, kind: 'in', from: null, to: target, v: [0, 0] };
  if (target === null) return { id, kind: 'out', from: shown, to: null, v: [0, 0] };
  const a = keys.indexOf(shown), b = keys.indexOf(target), c = Math.max(1, cols);
  const v = a < 0 || b < 0 ? [1, 0] as const : [Math.sign((b % c) - (a % c)), Math.sign(Math.floor(b / c) - Math.floor(a / c))] as const;
  return { id, kind: 'slideOut', from: shown, to: target, v };
}

// The table the stage draws: the one the animation leaves until it has left, then the one it goes to; at rest, the one
// shown (none, under the overview: the last one, so a zoom out ends on the table it started from).
export const stageKeyOf = (shown: string | null | undefined, anim: Anim | null) =>
  anim ? (anim.kind === 'in' || anim.kind === 'slideIn' ? anim.to : anim.from) : shown ?? null;
