'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useReducedMotion } from 'motion/react';
import { GLIDE_MS, SHADOW, Segmented } from '@/components/Section';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import { family, openWeights } from '@/lib/families';
import { MUTED, ModelStats, TEXT, chips, ciHalf, netColor, signed } from '@/lib/stats';
import { PLAY_MS, Timeline, playReplay, playedAt, replaySpeed, replayStarted, skipReplay, syncAttrs, useReplay } from '@/lib/timeline';
import { playSound } from '@/lib/sound';

const GRID = 'rgba(55, 53, 47, 0.12)';
const AXIS = 'rgba(55, 53, 47, 0.75)'; // tick marks
// Every line is drawn through this many evenly spaced hands across the x axis, plus its exact ends.
const SAMPLES = 160;
const EASE = [0.22, 1, 0.36, 1] as const; // ease-out, as the tile glide
const GLIDE = { duration: GLIDE_MS / 1000, ease: EASE } as const;
// A filter change moves the axes and the lines to the new range together over this long.
const TWEEN_S = 0.5;
// The Race is laid out at this size, or wider in a wider box (the plot takes the width), and scaled as
// a whole into its box. The overview's Trends tile and the card have the same width and plot height
// (StatsSections sizes them), so they show one picture, filling their width, and nothing ever stretches.
export const W = 1220, H = 470; // History's shape, 2.6:1 at least: tall enough to tell close lines apart
// The race clock's Skip/Replay button (the card's, and the tile's Replay).
const CLOCK_BTN = 'rounded border px-2 py-px font-medium hover:bg-[rgba(55,53,47,0.06)]';
const CLOCK_BTN_STYLE = { borderColor: 'rgba(55, 53, 47, 0.16)', color: TEXT, background: 'white' };
export const LEGEND_H = 68; // the legend under the Race card's plot: up to three rows (every model, and the note)

type Pts = [number, number][];
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// 95% band around the cumulative line after n hands. The per-hand spread implied by the
// bb/100 interval over N hands is h*sqrt(N)/196, so n hands spread by h*sqrt(N*n)/100.
function band(m: ModelStats, n: number) {
  return ((ciHalf(m) ?? 0) * Math.sqrt(m.hands * n)) / 100; // no interval below 2 hands
}

// Evenly spaced round ticks that cover [min, max]; the first and last tick bound the axis,
// so a range that dips below zero always gets a negative label.
function niceTicks(min: number, max: number, count: number, integer = false) {
  const step0 = (max - min) / count || 1;
  const mag = 10 ** Math.floor(Math.log10(step0));
  let step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= step0) ?? step0;
  if (integer) step = Math.max(1, Math.ceil(step));
  const ticks = [];
  for (let t = Math.floor(min / step) * step; t < max + step; t += step) {
    ticks.push(+t.toFixed(6));
    if (t >= max) break;
  }
  return ticks;
}

// The curve's values at the ascending hands `ns`, linearly interpolated and flat past its ends.
export function sampleAt(pts: Pts, ns: number[]) {
  let j = 0;
  return ns.map(n => {
    if (pts.length < 2) return pts[0]?.[1] ?? 0;
    while (j < pts.length - 2 && pts[j + 1][0] < n) j++;
    const [n0, v0] = pts[j], [n1, v1] = pts[j + 1];
    return n1 === n0 ? v1 : v0 + Math.min(1, Math.max(0, (n - n0) / (n1 - n0))) * (v1 - v0);
  });
}

// A line as drawn on an x axis over [x0, x1]: SAMPLES evenly spaced hands across the axis plus the
// line's exact ends, cut at hand `end`. Fixed hands keep its shape still as the race's playhead moves.
// With `to`, each value is k of the way to that curve's (a metric switch morphs one into the other).
function trace(pts: Pts, x0: number, x1: number, end = Infinity, to?: Pts, k = 1): Pts {
  if (!pts.length) return [];
  const b = to?.length ? to : pts;
  const lo = Math.max(x0, lerp(pts[0][0], b[0][0], k));
  const hi = Math.min(x1, lerp(pts.at(-1)![0], b.at(-1)![0], k), end);
  if (!(hi >= lo)) return [];
  // The grid sits on multiples of the step, so a window that slides (the replay's camera) keeps it still.
  const step = (x1 - x0) / (SAMPLES - 1) || 1;
  const ns = [lo];
  for (let i = Math.floor(lo / step) + 1; i * step < hi; i++) ns.push(i * step);
  if (hi > lo) ns.push(hi);
  const va = sampleAt(pts, ns);
  const vb = b === pts ? va : sampleAt(b, ns);
  return ns.map((n, i) => [n, lerp(va[i], vb[i], k)]);
}

// The Race window choices: the last 100 or 1,000 hands, or all of them.
const RANGES = [{ label: 'Last 100', n: 100 }, { label: 'Last 1k', n: 1000 }, { label: 'All', n: 0 }] as const;
// A running bb/100 over a model's first hands is mostly noise. Trends draws each rate line from hand 0 but fits its
// y axis to it only from this many hands on, so those early swings may sit clamped at the plot's edge.
export const RATE_FROM = 20;

type Metric = 'bb100' | 'chips' | 'bb';
type License = 'all' | 'open' | 'closed';

// A model's line in the plotted metric: running bb/100 (break-even at hand 0, where it has no rate yet), or
// cumulative chips (or bb), as [hands played, value], from hand 0.
export function series(m: ModelStats, metric: Metric, bigBlind = 1, ev = false): [number, number][] {
  const curve = ev ? m.cumulative_aiev_bb ?? [] : m.cumulative_bb;
  if (metric === 'bb100') return curve.map(([n, v]) => [n, n ? (v / n) * 100 : 0]);
  const k = metric === 'chips' ? bigBlind : 1;
  return curve.map(([n, v]) => [n, v * k]);
}

// A model's curve over hands played, moved onto table hands (the x axis Arena puts time on): the
// hands it played between two profiles snapshots are spread evenly across them, as playedAt reads
// them back. Flat while it sits out and from its last hand to the scope's last, so every line's tip
// is "now"; empty until it starts. `hands`: its live count, which may run past the last snapshot.
function onTable(tl: Timeline, name: string, curve: Pts, hands: number): Pts {
  const marks: [number, number][] = tl.snaps.map((sn, i) => [sn, tl.profiles[i].get(name)?.hands ?? 0]);
  marks.push([tl.hands, Math.max(hands, marks.at(-1)?.[1] ?? 0)]);
  const out: Pts = [];
  let [s0, h0, j] = [0, 0, 0];
  for (const [s1, h1] of marks) {
    if (h1 > h0) {
      for (; j < curve.length && curve[j][0] <= h1; j++) {
        const [n, v] = curve[j];
        if (n >= h0) out.push([s0 + ((n - h0) / (h1 - h0)) * (s1 - s0), v]);
      }
    } else if (out.length && s1 > out.at(-1)![0]) out.push([s1, out.at(-1)![1]]);
    [s0, h0] = [s1, h1];
  }
  return out;
}

// Labelled y gridlines over [a, b]: the step that gives 6–8 of them, preferring round steps (1, 2,
// 2.5, 5) and falling back to the finer ladder, whose neighbours are at most 4:3 apart, so one always fits.
const ROUND = [1, 2, 2.5, 5], LADDER = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
function gridTicks(a: number, b: number) {
  const mag = 10 ** Math.floor(Math.log10((b - a) / 7 || 1));
  let best: number[] = [], score = Infinity;
  for (const m of [mag / 10, mag, mag * 10]) {
    for (const f of LADDER) {
      const s = f * m, ts: number[] = [];
      for (let i = Math.ceil(a / s - 1e-9); i * s <= b + 1e-9 && ts.length < 40; i++) ts.push(+(i * s).toPrecision(12));
      const sc = (ts.length >= 6 && ts.length <= 8 ? 0 : 10) + Math.abs(ts.length - 7) * 0.1 + (ROUND.includes(f) ? 0 : 1);
      if (sc < score) [best, score] = [ts, sc];
    }
  }
  return best;
}

// The y axis' range for a set of values, Arena style: their 5th to 95th percentile (so one spike
// does not flatten the pack) and every value in `keep` (the lines' tips), plus 8% air each side.
// A tip far outside the pack (more than the pack's own span beyond it) is left out, to sit at the
// edge with an arrow rather than squash everyone. `must`: values
// always inside, however far out (the lines' recent stretch, which is never clipped).
function robustRange(vs: number[], keep: number[] = [], must: number[] = []): [number, number] {
  const s = (vs.some(Number.isFinite) ? vs : keep).filter(Number.isFinite).sort((p, q) => p - q);
  if (!s.length) return [-1, 1];
  const q = (f: number) => s[Math.round(f * (s.length - 1))];
  const [q0, q1] = [q(0.05), q(0.95)], reach = Math.max(q1 - q0, 1e-9);
  const near = keep.filter(v => v >= q0 - reach && v <= q1 + reach);
  let [lo, hi] = [Math.min(q0, ...near, ...must), Math.max(q1, ...near, ...must)];
  if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
  const air = (hi - lo) * 0.08;
  return [lo - air, hi + air];
}

// Where two lines crossed: the last hand among `ns` (ascending) at which a stopped being below b,
// linearly interpolated between samples, with the value there. Null if they never crossed.
function crossing(a: Pts, b: Pts, ns: number[]): [number, number] | null {
  const [va, vb] = [sampleAt(a, ns), sampleAt(b, ns)];
  for (let i = ns.length - 1; i > 0; i--) {
    const [d0, d1] = [va[i - 1] - vb[i - 1], va[i] - vb[i]];
    if (d0 <= 0 && d1 > 0) {
      const f = d0 === d1 ? 1 : -d0 / (d1 - d0);
      return [lerp(ns[i - 1], ns[i], f), lerp(va[i - 1], va[i], f)];
    }
  }
  return null;
}

// The vertical camera: [lo, hi] follows its target as a critically damped spring, so the y axis eases
// to each new fit with no overshoot, no jump when the target moves and no per-frame jitter.
const CAM_W = 7; // the spring's rate, 1/s: a step settles in about 0.8 s, trailing a moving target by 2/CAM_W
const LOOK_S = 0.6; // while the replay plays, the axis also fits the next this-many seconds of the lines, so the spring is there before a jump
function useCamera(lo: number, hi: number, snap: boolean): [number, number] {
  const [cur, setCur] = useState<[number, number]>([lo, hi]);
  const cam = useRef({ x: [lo, hi], v: [0, 0], tgt: [lo, hi], t: 0, raf: 0 });
  useEffect(() => () => { cancelAnimationFrame(cam.current.raf); cam.current.raf = 0; }, []);
  useEffect(() => {
    const c = cam.current;
    c.tgt = [lo, hi];
    if (snap) { c.x = [lo, hi]; c.v = [0, 0]; return; }
    if (c.raf) return; // the running loop picks up the new target
    c.t = performance.now();
    const step = (t: number) => {
      const dt = Math.min(0.25, Math.max(0, ((t - c.t) / 1000) * replaySpeed())), span = Math.abs(c.tgt[1] - c.tgt[0]) || 1;
      c.t = t;
      let still = true;
      for (let i = 0; i < 2; i++) {
        const e = Math.exp(-CAM_W * dt), d = c.x[i] - c.tgt[i], m = (c.v[i] + CAM_W * d) * dt;
        c.v[i] = (c.v[i] - CAM_W * m) * e;
        c.x[i] = c.tgt[i] + (d + m) * e;
        if (Math.abs(c.x[i] - c.tgt[i]) > span * 1e-4 || Math.abs(c.v[i]) > span * 1e-3) still = false;
      }
      if (still) [c.x, c.v, c.raf] = [[...c.tgt], [0, 0], 0];
      else c.raf = requestAnimationFrame(step);
      setCur([c.x[0], c.x[1]]);
    };
    c.raf = requestAnimationFrame(step);
  }, [lo, hi, snap]);
  return snap ? [lo, hi] : cur;
}

// The nice step for `count` ticks over `range`, and the finer one before it on the ladder (integers).
function steps(range: number, count: number) {
  const s0 = range / count || 1;
  const mag = 10 ** Math.floor(Math.log10(s0));
  const ladder = (mag < 10 ? [0.5, 1, 2, 5, 10] : [0.5, 1, 2, 2.5, 5, 10]).map(f => Math.max(1, Math.round(f * mag)));
  const i = Math.max(1, ladder.findIndex(l => l >= s0));
  return { s0, step: ladder[i], finer: ladder[i - 1] };
}

// What the chart is heading for: its x window (fixed, or the camera's `span` hands up to the leading
// tip) and its lines. A new key starts a tween to it.
type Scene = { key: string; camera: boolean; span: number; x0: number; x1: number; lines: Map<string, Pts>; evs: Map<string, Pts> };

// Arena-style labels: plain text (rank, logo, the name in its line's colour, and the value) just right of each line's
// tip. The code still calls them pills (data-pill), from when each sat in a bordered bubble.
const PILL_ROOM = 250; // the plot's width past the leading edge, for the leader's label
const PILL_H = 22;
const PILL_GAP = 10; // from the tip's dot to its label's text
// A white halo around a label's glyphs (invisible on the blank label column) keeps it readable where it crosses something:
// gridlines early in the replay, while the tips still grow toward the column, and another label as two swap places.
const HALO = '0 0 1px white, 0 0 2px white, 0 0 2px white, 0 0 3px white, 0 0 4px white';
// The opened card's zoom (a pinch, ⌘/ctrl + scroll, or two fingers on a touch screen) shows no fewer hands than this.
const ZOOM_MIN = 20;

// Pill centres, each as near its target as it can be: two pills whose spans overlap across x are
// pushed apart (half each, the bounds taking the rest) until they are `gap` apart; pills apart
// across x never push each other. The push ramps in over the first 16px of overlap, so pills
// meeting across x ease apart instead of jumping. `ps` must be sorted by y ascending.
function stack(ps: { x: number; w: number; y: number }[], gap: number, lo: number, hi: number) {
  const out = ps.map(p => Math.min(Math.max(p.y, lo), hi));
  gap = Math.min(gap, (hi - lo) / Math.max(1, ps.length - 1)); // shortcut: crowds of 13+ pills squeeze every gap
  const near = (a: (typeof ps)[number], b: (typeof ps)[number]) => Math.min(1, Math.max(0, (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + 4) / 16));
  for (let it = 0, moved = true; moved && it < 40; it++) {
    moved = false;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const d = (gap - (out[j] - out[i])) * near(ps[i], ps[j]);
        if (d < 0.05) continue;
        const up = Math.min(d / 2 + Math.max(0, out[j] + d / 2 - hi), out[i] - lo);
        out[i] -= up;
        out[j] = Math.min(hi, out[j] + d - up);
        moved = true;
      }
    }
  }
  return out;
}

if (process.env.NODE_ENV === 'development') {
  const [a, b] = stack([{ x: 0, w: 50, y: 50 }, { x: 10, w: 50, y: 50 }], 20, 0, 100);
  const [c, d] = stack([{ x: 0, w: 50, y: 50 }, { x: 80, w: 50, y: 50 }], 20, 0, 100);
  console.assert(b - a >= 20 && c === 50 && d === 50, 'stack: overlapping pills spread, apart ones stay');
  const tl = { hands: 50, snaps: [25, 50], profiles: [new Map([['A', { hands: 10 }]]), new Map([['A', { hands: 10 }], ['B', { hands: 20 }]])] } as unknown as Timeline;
  console.assert(JSON.stringify(onTable(tl, 'A', [[0, 0], [5, 1], [10, 2]], 10)) === '[[0,0],[12.5,1],[25,2],[50,2]]', 'onTable: spread over a snapshot, flat while sitting out');
  console.assert(JSON.stringify(onTable(tl, 'B', [[0, 0], [20, 4]], 20)) === '[[25,0],[50,4]]', 'onTable: starts at the snapshot before its first');
  for (const [a, b] of [[-446, 557], [0, 37], [-12_000, 9_000], [3, 4]]) {
    const n = gridTicks(a, b).length;
    console.assert(n >= 6 && n <= 8, `gridTicks: 6–8 labels over [${a}, ${b}], got ${n}`);
  }
  const [rl, rh] = robustRange([...Array.from({ length: 98 }, (_, i) => i - 49), 5000, -5000]);
  console.assert(rl > -60 && rh < 60, 'robustRange: one spike each way does not stretch the axis');
  console.assert(robustRange([0, 1, 2], [], [50])[1] > 50, 'robustRange: a must value is always inside');
  const cr = crossing([[0, 0], [10, 10]], [[0, 5], [10, 5]], [0, 10]);
  console.assert(cr !== null && Math.abs(cr[0] - 5) < 1e-9 && Math.abs(cr[1] - 5) < 1e-9, 'crossing: where a rises through b');
}

// An overtake: `a` passed `b` at hand n and value v, `t` seconds into the replay.
type Overtake = { a: string; b: string; n: number; v: number; t: number };
const EMPH_S = 0.6, MARK_S = 2, NEXT_S = 1.5; // the passer's emphasis, the crossing marker's fade, the gap before the next event
const PAIR_S = 6; // a pair that keeps swapping gets one highlight and ring per this long
// LMArena's place change, on every overtake: both pills shake across x (in em, so a few screen px at any scale;
// a new #1 harder and longer) and the passer's tip pops; all replay-time ms.
const SHAKE = { ms: 300, em: 0.23 }, LEAD_SHAKE = { ms: 380, em: 0.46 }, POP_MS = 320;
const SWINGS = [0, -1, 0.8, -0.55, 0.3, -0.1, 0]; // evenly spaced swings, each eased out, dying away
const POP_ORIGIN = { transformBox: 'fill-box', transformOrigin: 'center' } as const; // a tip pops about its own centre
// Splashes start BURST_GAP_MS apart with at most BURST_MAX on screen. A passer whose tip splashed within FRESH_MS is
// splashing already; one still queued after STALE_MS is dropped, as it would mark the wrong moment.
const BURST_GAP_MS = 150, BURST_MAX = 3, FRESH_MS = 200, STALE_MS = 1000;

// Arena's overtake splash: dots in the passer's colour fly out from its tip and fade (8 over 450 ms; a lead change
// 14 bigger ones, further, over 800 ms). They spray back over the plot (the left half-circle), so the pill column
// right of the tips stays clear. Drawn straight into the fx layer, outside React, so a splash never re-renders the
// chart. `done` runs once it has gone.
function burst(layer: HTMLElement, x: number, y: number, name: string, color: string, lead: boolean, n: number, done: () => void) {
  const [count, size, reach, ms] = lead ? [14, 7, 20, 800] : [8, 5, 12, 450];
  const g = document.createElement('span');
  Object.assign(g.dataset, { burst: name, n: String(n), x: x.toFixed(1), y: y.toFixed(1) }, lead ? { lead: '' } : {}); // for checks
  g.style.cssText = `position:absolute;left:${x}px;top:${y}px`;
  layer.appendChild(g);
  for (let i = 0; i < count; i++) {
    const a = Math.PI / 2 + ((i + 0.2 + Math.random() * 0.6) / count) * Math.PI, d = reach + Math.random() * reach * 0.8;
    const dot = document.createElement('span');
    dot.style.cssText = `position:absolute;left:${-size / 2}px;top:${-size / 2}px;width:${size}px;height:${size}px;border-radius:9999px;background:${color}`;
    g.appendChild(dot);
    dot.animate(
      [
        { transform: 'none', opacity: 1, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        { transform: `translate(${Math.cos(a) * d * 0.8}px, ${Math.sin(a) * d * 0.8}px)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(0.4)`, opacity: 0 },
      ],
      { duration: ms / replaySpeed(), id: 'burst' },
    ).onfinish = () => { dot.remove(); if (!g.childElementCount) { g.remove(); done(); } };
  }
}

// The splash queue: every overtake splashes, BURST_GAP_MS apart and at most BURST_MAX on screen, so a crowd of
// place changes stays readable. One entry per passer (`at`: its latest overtake); a lead change goes first. Each
// starts at its passer's tip as it is then (`tips`, updated every frame). `splashed`: when each passer last splashed.
type Fx = { queue: { a: string; lead: boolean; at: number }[]; timer: number; last: number; n: number; tips: Map<string, { tx: number; ty: number }>; splashed: Map<string, number> };
function enqueue(f: Fx, a: string, lead: boolean) {
  const now = performance.now(), q = f.queue.find(e => e.a === a);
  if (q) {
    q.at = now; // it keeps its place in line; a lead change moves it to the front
    if (lead && !q.lead) { q.lead = true; f.queue.splice(f.queue.indexOf(q), 1); f.queue.unshift(q); }
  } else if (lead || now - (f.splashed.get(a) ?? -Infinity) > FRESH_MS / replaySpeed()) { // else its tip is splashing already
    f.queue[lead ? 'unshift' : 'push']({ a, lead, at: now });
  }
}
function pump(f: Fx, layer: HTMLElement | null) {
  clearTimeout(f.timer);
  const sp = replaySpeed(), now = performance.now();
  f.queue = f.queue.filter(e => now - e.at < STALE_MS / sp);
  // Full: the next splash to end pumps again.
  if (!layer || !f.queue.length || layer.childElementCount >= BURST_MAX) return;
  const wait = f.last + BURST_GAP_MS / sp - now;
  if (wait > 0) { f.timer = window.setTimeout(() => pump(f, layer), wait); return; }
  const { a, lead } = f.queue.shift()!, e = f.tips.get(a);
  if (e) {
    burst(layer, e.tx, e.ty, a, modelColor(a), lead, ++f.n, () => pump(f, layer));
    f.last = now;
    f.splashed.set(a, now);
  }
  pump(f, layer);
}

export default function CumulativeChart({
  models,
  everyone,
  selected: fixed,
  race = false,
  mini = false,
  bigBlind,
  timeline,
}: {
  models: ModelStats[];
  everyone?: ModelStats[]; // the Race "All models" lineup; `models` is the seated one
  selected?: string; // the line whose 95% band is shaded (outside the Race; the Race card's click picks its own)
  race?: boolean; // several lines, each labelled at its end, with filters, a legend, a hover readout and a range control
  mini?: boolean; // the overview tile: the same chart scaled down, without controls or interaction
  bigBlind?: number; // the Race's chips metric plots bb × big blind
  timeline?: Timeline | null; // the Race: replays hand by hand, each line at its model's hands then
}) {
  const area = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const fxLayer = useRef<HTMLDivElement>(null);
  const fx = useRef<Fx>({ queue: [], timer: 0, last: -Infinity, n: 0, tips: new Map(), splashed: new Map() });
  const pillEls = useRef(new Map<string, HTMLElement>());
  // The card's zoom gestures: a mouse drag panning it, the touch points on the plot, a two-finger pinch's start, and the
  // latest zoom step (zoomBy) for the native wheel and Safari pinch listeners.
  const drag = useRef<{ x: number; z: [number, number]; moved: boolean } | null>(null);
  const fingers = useRef(new Map<number, [number, number]>());
  const pinch = useRef<{ d: number; n: number; w: number } | null>(null);
  const zoomStep = useRef<(cx: number, f: number) => void>(() => {});
  // Last frame's pill order and slots, for the swap slide.
  const slots = useRef({ order: [] as string[], ys: new Map<string, number>() });
  const clipId = useId();
  const reduce = useReducedMotion();
  // The box the chart fits in. Measured in the same frame as the tile↔card layout change, so the glide
  // starts from and lands on the right scale, and again on any resize.
  const [box, setBox] = useState({ w: 720, h: 300 });
  const measure = useCallback(() => {
    const el = area.current;
    if (el) setBox(b => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
  }, []);
  useLayoutEffect(measure, [mini, measure]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    ro.observe(area.current!);
    return () => ro.disconnect();
  }, [measure]);

  // A race, like Arena's trends chart: every line grows from the first hand to the last over a
  // minute, its label riding the tip and the order changing as it goes. It plays once per page load,
  // from when the tile first scrolls into view; Skip and Replay control it. The clock is shared:
  // Profiles and Matchups show the hand it has reached.
  const clock = useReplay(p => p);
  const progress = race && !reduce ? clock : 1; // 0..1 of the way from the first hand to the last
  const playing = progress < 1;
  useEffect(() => {
    const el = area.current;
    if (!el || !race || reduce || replayStarted()) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (!replayStarted()) playReplay();
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [race, reduce]);

  // The wheel and Safari's pinch over the card's plot, as native listeners: React's wheel listener is passive, so it could
  // not stop the browser's own page zoom. A plain scroll is left to the page (page.tsx pages it); only the tail of a zoom
  // gesture (⌘ let go while it glides on, within 150 ms of its last step) is held, so a zoom never ends in a page turn.
  useEffect(() => {
    const el = plot.current;
    if (!el || !race || mini) return;
    let last = -Infinity, safari = false, scale = 1;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        if (e.timeStamp - last < 150) { last = e.timeStamp; e.preventDefault(); }
        return;
      }
      e.preventDefault();
      last = e.timeStamp;
      if (safari) return; // Safari's own pinch zooms through its gesture events
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // Firefox counts a mouse notch in lines
      zoomStep.current(e.clientX, Math.exp(Math.min(50, Math.max(-50, d)) / 100)); // a pinch sends deltaY = -100 ln(scale)
    };
    const gesture = (e: Event) => {
      e.preventDefault(); // else Safari zooms the page
      const g = e as Event & { scale: number; clientX: number };
      if (e.type === 'gesturestart') [safari, scale] = [true, 1];
      else if (e.type === 'gestureend') safari = false;
      else if (!fingers.current.size) { zoomStep.current(g.clientX, scale / g.scale); scale = g.scale; } // iOS: the fingers zoom (pointer events)
    };
    const types = ['gesturestart', 'gesturechange', 'gestureend'];
    el.addEventListener('wheel', wheel, { passive: false });
    types.forEach(t => el.addEventListener(t, gesture));
    return () => { el.removeEventListener('wheel', wheel); types.forEach(t => el.removeEventListener(t, gesture)); };
  }, [race, mini]);

  // The hand under the pointer (or picked with the arrow keys) and the line nearest it.
  const [hover, setHover] = useState<{ n: number; name: string } | null>(null);
  const [range, setRange] = useState(0); // 0: every hand
  // The Race filters, Arena style. They live here, so the overview tile (the same instance) shows them too.
  const [metricPick, setMetric] = useState<'bb100' | 'chips'>('bb100');
  const [lineup, setLineup] = useState<'seated' | 'all'>('seated');
  const [license, setLicense] = useState<License>('all');
  const [fams, setFams] = useState<string[]>([]); // none picked: every family
  const [top, setTop] = useState(0); // 0: every model
  const [picked, setPicked] = useState(''); // the Race card's clicked end label: that line's 95% band is shaded
  const [highlight, setHighlight] = useState<string | undefined>(); // a line brought forward while the pointer is on its label
  const [luck, setLuck] = useState(false); // all-in EV lines for every model (the highlighted one always shows its own)
  const [hidden, setHidden] = useState<string[]>([]); // lines switched off in the legend
  const [zoomTo, setZoom] = useState<[number, number] | null>(null); // the card's zoom: the hands it shows (see fit)

  const metric: Metric = race ? metricPick : 'bb';
  const rate = metric === 'bb100';
  const unit = rate ? 'bb/100' : metric;
  const fmt = (v: number) => (metric === 'chips' ? chips(Math.round(v)) : signed(v));
  const interactive = race && !mini;
  const selected = race ? picked : fixed;
  const onSelect = interactive ? setPicked : undefined;
  const onHighlight = race ? setHighlight : undefined;
  const byName = new Map([...(everyone ?? []), ...models].map(m => [m.name, m]));
  // The Race plots against the table hand once the timeline is in, so every tip sits at "now";
  // until then (and in the model drawer) against the model's own hands played.
  const table = race && timeline ? timeline : null;
  const curveOf = (m: ModelStats, ev = false) => { const p = series(m, metric, bigBlind, ev); return table ? onTable(table, m.name, p, m.hands) : p; };
  const line$ = new Map([...byName.values()].map(m => [m.name, curveOf(m)]));
  const pts = (m: ModelStats) => line$.get(m.name)!;
  const finalOf = (m: ModelStats) => pts(m).at(-1)?.[1] ?? 0;
  const pool = race && lineup === 'all' && everyone?.length ? everyone : models;
  // Every family in the history, so the bar never rewraps; those not in the lineup are greyed out.
  const families = [...new Set([...(everyone ?? []), ...models].map(m => family(m.name)))].sort();
  const inPool = new Set(pool.map(m => family(m.name)));
  // The legend: every model the filters let through, best first; `top` keeps the leaders.
  const listed = pool
    .filter(m => !race || ((license === 'all' || openWeights(m.name) === (license === 'open')) && (!fams.length || fams.includes(family(m.name)))))
    .filter(m => pts(m).length)
    .sort((a, b) => finalOf(b) - finalOf(a))
    .slice(0, race && top ? top : undefined);
  const lastHand = Math.max(1, ...listed.flatMap(m => pts(m).map(p => p[0])));
  const win = race ? range : 0; // the tile shows the card's window too: one picture
  const whole = !(win && win < lastHand);
  // The x axis starts where the first line does (hand 0), or at the window.
  const from = Math.max(whole ? 0 : lastHand - win, Math.min(lastHand - 1, ...listed.map(m => pts(m)[0][0])));
  // A zoom window of w hands with hand n `at` (0..1) of the way across, kept inside [from, lastHand] and at least
  // ZOOM_MIN hands wide; null once it is every hand. A zoom holds in the card at rest: the replay's camera owns the axis
  // while it plays (a zoom gesture over it ends it, as Skip does), and the tile shows every hand (closing the card drops it).
  const fit = (n: number, at: number, w: number): [number, number] | null => {
    const all = lastHand - from, ww = Math.min(Math.max(w, Math.min(ZOOM_MIN, all)), all);
    if (ww >= all - 1e-9) return null;
    const x0 = Math.min(Math.max(n - at * ww, from), lastHand - ww);
    return [x0, x0 + ww];
  };
  const zoom = interactive && !playing && zoomTo ? fit(zoomTo[0], 0, zoomTo[1] - zoomTo[0]) : null;
  if (zoomTo && !zoom) setZoom(null);
  // The lines in the window (lines switched off or ended before it drop out), and the all-in EV lines.
  const on = listed.filter(m => !hidden.includes(m.name) && trace(pts(m), from, lastHand).length);
  const lines = new Map(on.map(m => [m.name, pts(m)]));
  const evs = new Map(luck ? on.flatMap(m => { const p = curveOf(m, true); return p.length ? [[m.name, p] as const] : []; }) : []);
  // The value at hand n, or null before the line starts.
  const at = (m: ModelStats, n: number) => (n < pts(m)[0][0] ? null : sampleAt(pts(m), [n])[0]);
  // 95% band: bb/100's interval narrows as 1/sqrt(n); a cumulative total's widens as sqrt(n), n the hands it had played.
  const bandAt = (m: ModelStats, x: number) => {
    const n = table ? playedAt(table, m.name, x) : x;
    return rate ? (ciHalf(m) ?? 0) * Math.sqrt(m.hands / Math.max(n, 1)) : band(m, n) * (metric === 'chips' ? bigBlind ?? 1 : 1);
  };
  const sel = on.find(m => m.name === selected);

  // While the race plays, every line stops at the playhead: the replay's table hand (without the
  // timeline, one shared number of hands played).
  const handNow = race && timeline && playing ? progress * timeline.hands : null;
  const head = from + progress * (lastHand - from);
  const nowX = handNow ?? head;
  // The camera, Arena style. While the race plays the window starts at the first hand and the tips
  // grow rightward until they reach the pinned leading edge (`fill`: the first 4 s of the replay).
  // Then the tips stay there and history slides past: at a quarter of the race's pace while the
  // window widens to `span` (40% of the history, or the Hands window), then at its pace. After, it
  // shows the Hands window.
  const span = whole ? Math.max(100, Math.round((lastHand - from) * 0.4)) : win;
  const fill = Math.min(span, Math.max(10, Math.round((lastHand - from) / 15)));
  // Zooming in or out of a zoom is a new scene (an eased tween); a zoom step or a pan moves the window at once (below).
  const scene: Scene = {
    key: [metric, playing ? 'camera' : from, lastHand, span, zoom ? 'zoom' : '', ...lines.keys(), '|', ...evs.keys()].join(),
    camera: playing, span, x0: zoom?.[0] ?? from, x1: zoom?.[1] ?? lastHand, lines, evs,
  };
  // A scene's x window now: fixed, or following the farthest tip of its own lines.
  const windowOf = (sc: Scene): [number, number] => {
    if (!sc.camera) return [sc.x0, sc.x1];
    const lead = Math.max(from, ...[...sc.lines.values()].map(p => Math.min(nowX, p.at(-1)![0])));
    const f = Math.min(fill, sc.span);
    const x1 = Math.max(lead, from + f);
    const w = Math.min(sc.span, f + Math.max(0, x1 - from - f) * 0.75); // pulls back while it slides
    return [x1 - w, x1];
  };

  // A filter, the data or the range changed: the x axis and the lines move to the new scene in one
  // tween (the scale, not just the paths); lines that leave fade out and lines that join fade in.
  const [tr, setTr] = useState({ from: scene, to: scene, s: TWEEN_S });
  const [mix, setMix] = useState(1);
  if (tr.to.key !== scene.key) {
    // Camera to camera (new data, a filter mid-replay): both keep following. Otherwise carry on from where the axis is now.
    const [a, b] = [windowOf(tr.from), windowOf(tr.to)];
    const now = tr.to.camera && scene.camera ? tr.to : { ...tr.to, camera: false, x0: lerp(a[0], b[0], mix), x1: lerp(a[1], b[1], mix) };
    // The replay's start (and a filter changed mid-replay) moves at the replay's speed, so a test run at 4x sees what visitors see.
    setTr({ from: now, to: scene, s: TWEEN_S / (scene.camera ? replaySpeed() : 1) });
    setMix(0);
  } else if (tr.to.x0 !== scene.x0 || tr.to.x1 !== scene.x1) setTr({ ...tr, to: scene }); // a zoom step or a pan: the window follows at once
  useEffect(() => {
    if (reduce) return;
    const c = animate(0, 1, { duration: tr.s, ease: EASE, onUpdate: setMix });
    return () => c.stop();
  }, [tr.from, tr.s, reduce]); // not tr.to: a zoom step swaps it without restarting the tween
  const k = reduce ? 1 : mix;
  const old = tr.from;
  const [wa, wb] = [windowOf(old), windowOf(scene)];
  const [X0, X1] = [lerp(wa[0], wb[0], k), lerp(wa[1], wb[1], k)];

  const fading = (was: Map<string, Pts>, is: Map<string, Pts>) => [...is.keys(), ...(k < 1 ? [...was.keys()].filter(n => !is.has(n)) : [])];
  const fade = (was: Map<string, Pts>, is: Map<string, Pts>, n: string) => (is.has(n) ? (was.has(n) ? 1 : k) : 1 - k);
  const drawnOf = (end: number, a?: Pts, b?: Pts) => (a && b && k < 1 ? trace(a, X0, X1, end, b, k) : trace((b ?? a)!, X0, X1, end));
  const drawn = new Map(fading(old.lines, lines).map(n => [n, drawnOf(nowX, old.lines.get(n), lines.get(n))]));
  // The all-in EV lines, dashed: every model's with the toggle on, else the hovered line's own (below).
  const evDrawn = fading(old.evs, evs).map(n => ({ n, p: drawnOf(nowX, old.evs.get(n), evs.get(n)), o: fade(old.evs, evs, n) }));

  // A dynamic y axis, as Exa's and Arena's animated charts: the Race fits it to the lines in view (their
  // values inside the x window, robustly, and every tip; see robustRange), so the pack fills the plot and
  // the gaps between models read large. It follows them as the replay plays and settles at rest, easing
  // both ways (useCamera). A tip far from the pack is pinned to the edge with an arrow. The model
  // drawer fits its one line and band whole.
  // Each rate line's first RATE_FROM hands (to the table hand its model reached them): left out of the y fit and drawn
  // clamped to the plot's edge (see path), as a tip beyond the axis is.
  const fitAt = new Map(race && rate ? [...byName.keys()].map(n => [n, table ? onTable(table, n, [[RATE_FROM, 0]], byName.get(n)!.hands)[0]?.[0] ?? Infinity : RATE_FROM]) : []);
  const fitted = (n: string, p: Pts) => (fitAt.size ? p.filter(q => q[0] >= (fitAt.get(n) ?? Infinity)) : p);
  let want: [number, number];
  if (race) {
    // While the replay plays, the lines (and all-in EV lines) over the recent quarter of the window's
    // drawn part (a rate's early hands are noise that would flatten the pack); at rest, the whole
    // window; before any line is in view, the whole race's.
    // Either way the recent quarter itself and every tip are always inside: the leader's latest run is never clipped.
    const inView = [...[...lines.keys()].map(n => fitted(n, drawn.get(n) ?? [])), ...evDrawn.filter(e => evs.has(e.n)).map(e => fitted(e.n, e.p))].filter(p => p.length);
    const cut = lerp(X0, Math.min(X1, nowX), 0.75);
    const recent = inView.flatMap(p => p.filter(q => q[0] >= cut).map(q => q[1]));
    const tips = [...lines.keys()].flatMap(n => fitted(n, drawn.get(n)?.slice(-1) ?? []).map(q => q[1]));
    // The replay is known ahead: the next LOOK_S of each line, so the eased axis is never caught out by a jump.
    const ahead = handNow === null ? [] : [...lines].flatMap(([n, p]) => fitted(n, trace(p, nowX, nowX + (LOOK_S * 1000 / PLAY_MS) * timeline!.hands, Infinity)).map(q => q[1]));
    want = inView.length
      ? robustRange(playing ? recent : inView.flatMap(p => p.map(q => q[1])), tips, [...recent, ...tips, ...ahead])
      : robustRange([...lines].flatMap(([n, p]) => fitted(n, trace(p, from, lastHand)).map(q => q[1])));
  } else {
    const ys = [...drawn.values()].flatMap(p => p.map(q => q[1]));
    if (sel) trace(pts(sel), X0, X1, nowX).forEach(([n, v]) => ys.push(v + bandAt(sel, n), v - bandAt(sel, n)));
    let [lo, hi] = [Math.min(0, ...ys), Math.max(0, ...ys)];
    if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
    want = [lo - (hi - lo) * 0.06, hi + (hi - lo) * 0.06];
  }
  const [Y0, Y1] = useCamera(want[0], want[1], !!reduce);

  // The one scale that fits the design size in its box, and the design size the chart is laid out at: H tall, and
  // W wide or, in a box wider than that shape, the box's width at that scale (the plot takes the extra width).
  // Outside the Race (the model drawer) it simply fills its box.
  // The legend's rows are set aside, so a filter that changes its length never rescales the plot.
  const s = race ? Math.min(box.w / W, (box.h - (interactive ? LEGEND_H : 0)) / H) : 1;
  const [lw, lh] = race ? [s > 0 ? Math.max(W, box.w / s) : W, H] : [Math.max(box.w, 200), box.h];
  // Text keeps the site's on-screen sizes (numbers at 14px, as the Profiles cells) however the chart
  // is scaled: design units are screen px times u.
  const u = race ? Math.min(1.5, 1 / s) : 1;
  const fs = 14 * u; // the hover readout, as the Profiles cells
  const ts = 13 * u; // everything else in the chart: ticks, axis titles, pills, the clock
  const [pillH, pillRoom] = [PILL_H * u, PILL_ROOM * u];
  const right = 12;
  const left = 10 + ts * 0.62 * 8; // room for the widest y label ("−100,000"), so the plot never moves
  const padTop = ts + 14; // the y axis title sits above the plot
  const padBottom = ts + 10 + ts + 8; // tick labels, then the x axis title
  const plotW = lw - left - right;
  const plotH = lh - padTop - padBottom;
  // The leading edge sits this far in from the right; the leader's pill rides just past it.
  const leadW = plotW - (race ? pillRoom : 0);
  const plotR = left + leadW; // the plot's right edge: gridlines, ticks and lines stop here; past it is the pill column
  const x = (n: number) => left + ((n - X0) / (X1 - X0 || 1)) * leadW;
  const y = (v: number) => padTop + ((Y1 - v) / (Y1 - Y0 || 1)) * plotH;
  const line = (p: [number, number][]) => p.map(([n, v], i) => `${i ? 'L' : 'M'}${x(n)},${y(v)}`).join('');
  // A line's path, its early swings (before fitAt) held at the plot's edge.
  const path = (n: string, p: Pts) => line(fitAt.size ? p.map(([h, v]) => [h, h < (fitAt.get(n) ?? Infinity) ? Math.min(Math.max(v, Math.min(Y0, Y1)), Math.max(Y0, Y1)) : v]) : p);

  const shown = [...drawn.keys()].flatMap(n => (drawn.get(n)!.length && byName.has(n) ? [byName.get(n)!] : []));
  const hot = shown.find(m => m.name === (hover?.name ?? highlight)); // the hovered line
  const ordered = [...shown.filter(m => m !== sel && m !== hot), ...(sel && sel !== hot && shown.includes(sel) ? [sel] : []), ...(hot ? [hot] : [])]; // selected, then hovered on top
  if (race && hot && !evDrawn.some(e => e.n === hot.name)) {
    const p = curveOf(hot, true);
    if (p.length) evDrawn.push({ n: hot.name, p: trace(p, X0, X1, nowX), o: 1 });
  }
  // The selected line's 95% band, from where the y fit takes the line (a rate's band over its first hands is boundless).
  const selPts = sel ? fitted(sel.name, drawn.get(sel.name) ?? []) : [];
  const bandPath = sel && selPts.length
    ? line(selPts.map(([n, v]) => [n, v + bandAt(sel, n)])) +
      [...selPts].reverse().map(([n, v]) => `L${x(n)},${y(v - bandAt(sel, n))}`).join('') + 'Z'
    : '';
  // x ticks of the old and the new window, each fading as the window tweens; a tick in both stays put.
  const blend = (was: number[], is: number[], a: number, b: number, kk: number) =>
    [...new Set([...was, ...is])]
      .map(t => ({ t, o: is.includes(t) ? (was.includes(t) ? 1 : kk) : 1 - kk }))
      .filter(d => d.o > 0 && d.t >= Math.min(a, b) - 1e-6 && d.t <= Math.max(a, b) + 1e-6);
  // x ticks never sit left of where the data starts.
  const xTicksOf = (a: number, b: number) => niceTicks(a, b, 10, true).filter(t => t >= Math.max(a, from) && t <= b);
  // Gridlines on the moving axis: their step holds while it gives 6–8 labels (so they slide with the
  // axis rather than relabel), then gridTicks picks again. A label joins with a fade in (CSS
  // @starting-style), leaves with a fade out (it stays, transparent, until the step changes or it
  // leaves the plot), and fades at the plot's edges. Derived state, updated during render as `rk` is.
  const [ya, setYa] = useState({ step: 0, shown: [] as number[], gone: [] as number[] });
  const between = (st: number) => Math.floor(Y1 / st + 1e-9) - Math.ceil(Y0 / st - 1e-9) + 1;
  const g0 = between(ya.step) >= 6 && between(ya.step) <= 8 ? null : gridTicks(Y0, Y1);
  const yStep = g0 ? (g0.length > 1 ? +(g0[1] - g0[0]).toPrecision(12) : 1) : ya.step;
  const yTicks = Array.from({ length: Math.max(0, between(yStep)) }, (_, i) => +((Math.ceil(Y0 / yStep - 1e-9) + i) * yStep).toPrecision(12));
  // A label on its way out goes at once when it would touch one that stays (or one leaving that is kept before it), so
  // labels never overlap while a step change crossfades them; it does not come back.
  const near = (a: number, b: number) => Math.abs(y(a) - y(b)) < ts * 1.3;
  const yGone = [...new Set([...(yStep === ya.step ? ya.gone : []), ...ya.shown])]
    .filter(t => !yTicks.includes(t) && t >= Y0 && t <= Y1)
    .reduce<number[]>((kept, t) => (yTicks.some(u => near(u, t)) || kept.some(u => near(u, t)) ? kept : [...kept, t]), []);
  if (yStep !== ya.step || yTicks.join() !== ya.shown.join() || yGone.join() !== ya.gone.join()) setYa({ step: yStep, shown: yTicks, gone: yGone });
  const edge = (t: number) => Math.max(0, Math.min(1, (t - Y0) / ((Y1 - Y0) * 0.02 || 1), (Y1 - t) / ((Y1 - Y0) * 0.02 || 1)));
  // Under the camera (and while zoomed) the ticks slide with history, fading in at the leading edge and out at the left.
  // While the replay's window widens, the finer step's ticks fade out as the coarser step takes over: no label pops. A
  // zoom, which rests where the gesture leaves it, shows the round step alone.
  const st = steps(X1 - X0, 10);
  const fadeW = st.step * 0.35;
  const xTicks = race && (playing || zoom)
    ? Array.from({ length: Math.floor(X1 / st.finer) - Math.ceil(Math.max(X0, from) / st.finer) + 1 }, (_, i) => (Math.ceil(Math.max(X0, from) / st.finer) + i) * st.finer)
        .map(t => ({ t, o: Math.min(t % st.step ? (playing ? (st.step - st.s0) / (st.step - st.finer) : 0) : 1, (X1 - t) / fadeW, X0 > from ? (t - X0) / fadeW : 1) }))
        .filter(d => d.o > 0.01)
    : blend(xTicksOf(wa[0], wa[1]), xTicksOf(wb[0], wb[1]), X0, X1, k);
  const tick = (t: number) => (metric === 'chips' ? t.toLocaleString() : String(t)).replace('-', '−');
  // Every line ends in a dot and a pill (rank, logo, name, value) just past it, Arena style. A tip
  // beyond the steady axis is pinned to its edge (an arrow instead of the dot). Pills that would
  // overlap stack apart in rank order and slide with their lines; a pill fades in as its line starts
  // and out as the camera carries its tip off the left edge.
  const ends0 = shown.map(m => {
    const p = drawn.get(m.name)!;
    const [n, v] = p.at(-1)!;
    const tx = x(n), raw = y(v);
    const ty = Math.min(Math.max(raw, padTop), padTop + plotH);
    const grown = Math.min(1, Math.max(0, (tx - Math.max(left, x(pts(m)[0][0]))) / 24), Math.max(0, (tx - left) / 48));
    const val = rate ? signed(Math.round(v), 0) : fmt(v); // whole bb/100 in the pills, as Arena's scores
    return { m, n, v, val, tx, ty, off: Math.sign(raw - ty), w: Math.min(pillRoom - 12 * u, (38 + (m.name.length + val.length) * 7.2) * u), o: fade(old.lines, lines, m.name) * grown };
  });
  // The rank order, with a hair of hysteresis: a line passes another once it is half a pixel clear of
  // it, so two lines touching do not flicker the order, yet a pill's rank never disagrees with the
  // values the pills show by more than that. New lines join at their place, without an event.
  // It lives in state (updated during render, as React allows for derived state) so the pills show it.
  const tNow = progress * (PLAY_MS / 1000); // the replay's clock, in seconds
  // `swaps`: the latest frame's overtakes (passer, passed; `lead` when the passer became #1; `vis` when either pill shows).
  const [rk, setRk] = useState<{ order: string[]; ev: Overtake | null; pairs: Record<string, number>; swaps: { a: string; b: string; lead: boolean; vis: boolean }[] }>({ order: [], ev: null, pairs: {}, swaps: [] });
  const byN = new Map(ends0.map(e => [e.m.name, e]));
  const order = [...rk.order.filter(n => byN.has(n)), ...ends0.filter(e => !rk.order.includes(e.m.name)).sort((a, b) => b.v - a.v).map(e => e.m.name)];
  const hyst = (0.5 * (Y1 - Y0)) / (plotH || 1);
  const passes: [string, string, boolean][] = []; // passer, passed, and whether the passer took first place then
  for (let i = 1; i < order.length; i++) {
    for (let j = i; j > 0 && byN.get(order[j])!.v > byN.get(order[j - 1])!.v + (rk.order.includes(order[j]) ? hyst : 0); j--) {
      if (rk.order.includes(order[j]) && rk.order.includes(order[j - 1])) passes.push([order[j], order[j - 1], j === 1]);
      [order[j - 1], order[j]] = [order[j], order[j - 1]];
    }
  }
  // An overtake while the race plays: the passer's pill and line are emphasised for EMPH_S, a marker
  // shows where the lines crossed and fades over MARK_S. One at a time; a pair that keeps swapping, once.
  const live = race && playing && !reduce && k === 1;
  let ev = rk.ev && live && tNow >= rk.ev.t && tNow - rk.ev.t < MARK_S ? rk.ev : null;
  const pairs = { ...rk.pairs };
  for (const [a, b] of live ? passes : []) {
    const pair = [a, b].sort().join('|');
    if ((ev && tNow - ev.t < NEXT_S) || tNow - (pairs[pair] ?? -Infinity) < PAIR_S || byN.get(a)!.o < 0.5 || byN.get(b)!.o < 0.5) continue;
    const pa = drawn.get(a)!, pb = drawn.get(b)!;
    const c = crossing(pa, pb, pa.slice(-24).map(q => q[0])) ?? [byN.get(a)!.n, byN.get(a)!.v];
    ev = { a, b, n: c[0], v: c[1], t: tNow };
    pairs[pair] = tNow;
  }
  const was1 = rk.order.find(n => byN.has(n));
  const swaps = live && passes.length
    ? passes.map(([a, b, top]) => ({ a, b, lead: top && a === order[0] && a !== was1, vis: byN.get(a)!.o >= 0.5 || byN.get(b)!.o >= 0.5 }))
    : rk.swaps;
  if (order.join('|') !== rk.order.join('|') || ev !== rk.ev || swaps !== rk.swaps) setRk({ order, ev, pairs, swaps });
  const rank = new Map(order.map((n, i) => [n, i + 1]));
  const ends = [...ends0].sort((a, b) => rank.get(a.m.name)! - rank.get(b.m.name)!); // rank order: ascending y
  const pillYs = stack(ends.map(e => ({ x: e.tx + PILL_GAP, w: e.w, y: e.ty })), pillH + 3, padTop + pillH / 2, padTop + plotH - pillH / 2);
  // The passer's emphasis, 0..1: in over 0.1 s, held, out over the last 0.2 s.
  const age = ev ? tNow - ev.t : Infinity;
  const emph = age < EMPH_S ? Math.min(1, age / 0.1, (EMPH_S - age) / 0.2) : 0;
  const emphOn = emph > 0 ? ev!.a : null;
  // Every overtake, in the commit that swaps the pills (so in step with the slide, the emphasis and the ring):
  // both pills shake, the passer's tip pops, the passer splashes (queued; one per passer per frame), and it sounds.
  useEffect(() => {
    if (!rk.swaps.length) return;
    const sp = replaySpeed(), f = fx.current;
    const shake = (n: string, lead: boolean) => {
      const el = pillEls.current.get(n);
      if (!el) return;
      el.getAnimations().forEach(a => /shake/.test(a.id) && a.cancel()); // a pill passed again shakes again
      const { ms, em } = lead ? LEAD_SHAKE : SHAKE;
      el.animate(SWINGS.map(k => ({ translate: `${k * em}em 0`, easing: 'ease-out' })), { duration: ms / sp, id: lead ? 'pill-shake-lead' : 'pill-shake' });
    };
    const splash = new Map<string, boolean>();
    for (const { a, b, lead, vis } of rk.swaps) {
      shake(a, lead);
      shake(b, false);
      plot.current?.querySelector(`[data-tip="${CSS.escape(a)}"]`)?.animate(
        [{ transform: 'none' }, { transform: 'scale(1.6)', offset: 0.35 }, { transform: 'none' }], // 1.6: the popped dot stays clear of its pill
        { duration: POP_MS / sp, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', id: 'tip-pop' },
      );
      if (vis) splash.set(a, splash.get(a) || lead);
    }
    for (const [a, lead] of splash) enqueue(f, a, lead);
    pump(f, fxLayer.current);
    // One sound per frame of overtakes (a chime if one took first place), when sound is on; never in a sped-up test replay.
    if (splash.size && sp === 1) playSound([...splash.values()].some(Boolean) ? 'lead' : 'overtake');
  }, [rk.swaps]);
  // A splash never outlives its replay: Skip, the end, a restart or a filter change clears any in flight or queued.
  useEffect(() => {
    const f = fx.current;
    if (!live) { f.queue = []; clearTimeout(f.timer); fxLayer.current?.replaceChildren(); }
  }, [live]);
  useEffect(() => () => clearTimeout(fx.current.timer), []);
  // Two pills that swap places slide there over 300 ms (FLIP: they jump to their new slots, then
  // ease from where they were), rather than jumping a slot in one frame.
  useLayoutEffect(() => {
    const sl = slots.current;
    ends.forEach((e, i) => {
      const was = sl.ys.get(e.m.name), el = pillEls.current.get(e.m.name);
      if (el && was != null && sl.order.indexOf(e.m.name) !== i && sl.order.includes(e.m.name) && Math.abs(was - pillYs[i]) > pillH / 2 && !reduce) {
        // A label being passed (it slides down) dims as its passer crosses it, so two labels' text never reads as one.
        const at = { transform: `translateY(${was - pillYs[i]}px)` };
        el.animate(was < pillYs[i] ? [at, { opacity: 0.2, offset: 0.5 }, { transform: 'none' }] : [at, { transform: 'none' }], { duration: 300 / replaySpeed(), easing: 'cubic-bezier(0.22, 1, 0.36, 1)', id: 'pill-swap' });
      }
    });
    sl.order = ends.map(e => e.m.name);
    sl.ys = new Map(ends.map((e, i) => [e.m.name, pillYs[i]]));
  });
  // The pills' tips in page pixels, for checks: the plot is scaled (and glides) as a whole.
  useLayoutEffect(() => {
    const p = plot.current;
    if (!p) return;
    const r = p.getBoundingClientRect();
    p.querySelectorAll<HTMLElement>('[data-pill]').forEach(e => { e.dataset.tipX = (r.left + +e.dataset.tx! * (r.width / lw)).toFixed(1); });
    // A splash rides its passer's tip (early in the replay the tips still move right); queued ones start there.
    fx.current.tips = byN;
    fxLayer.current?.querySelectorAll<HTMLElement>('[data-burst]').forEach(g => {
      const e = byN.get(g.dataset.burst!);
      if (!e) return;
      Object.assign(g.dataset, { x: e.tx.toFixed(1), y: e.ty.toFixed(1) });
      Object.assign(g.style, { left: `${e.tx}px`, top: `${e.ty}px` });
    });
  });
  const readout = hover
    ? shown.flatMap(m => { const v = at(m, hover.n); return v === null ? [] : [{ m, v }]; }).sort((a, b) => b.v - a.v)
    : [];

  // Pointer to design units: the plot is scaled as a whole, so its box maps onto lw × lh.
  const pick = (clientX: number, clientY: number) => {
    const r = plot.current!.getBoundingClientRect();
    const [px, py] = [((clientX - r.left) / r.width) * lw, ((clientY - r.top) / r.height) * lh];
    const n = Math.round(Math.min(Math.max(X0 + ((px - left) / leadW) * (X1 - X0), from, X0), lastHand, X1));
    const near = shown.reduce<{ name: string; d: number }>((best, m) => {
      const v = at(m, n);
      const d = v === null ? Infinity : Math.abs(y(v) - py);
      return d < best.d ? { name: m.name, d } : best;
    }, { name: '', d: Infinity });
    setHover({ n, name: near.name });
  };
  const yTitle = rate ? 'bb/100' : metric === 'chips' ? 'Chips won' : 'Big blinds won';
  const summary = shown.map(m => `${m.name} ${fmt(finalOf(m))} ${unit} after ${m.hands} hands`).join('; ');
  const label = `${yTitle} over hands played. ${summary}.${sel ? ` Shaded: 95% band for ${sel.name}.` : ''}`;
  const lead = readout[0];
  const said = hover && lead
    ? `Hand ${hover.n}: ${lead.m.name} leads at ${fmt(lead.v)} ${unit}` + (hot && hot !== lead.m ? `; ${hot.name} ${fmt(readout.find(r => r.m === hot)?.v ?? 0)} ${unit}.` : '.')
    : '';

  // The readout sits beside the crosshair on whichever side it fits, clamped inside the plot.
  const crossX = hover ? x(hover.n) : 0;
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip) return;
    const tw = tip.offsetWidth;
    const want = crossX + 12 + tw <= lw - right ? crossX + 12 : crossX - 12 - tw;
    tip.style.left = `${Math.max(left, Math.min(want, lw - tw - 4))}px`;
  });

  // The arrows step through the hands in view (every hand, or the zoom's).
  const [k0, k1] = [Math.ceil(Math.max(from, X0)), Math.floor(Math.min(lastHand, X1))];
  const step = Math.max(1, Math.round((k1 - k0) / 40));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setHover(null);
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const n0 = hover?.n ?? (e.key === 'ArrowLeft' ? k1 + step : k0 - step);
    setHover({ n: Math.min(Math.max(n0 + (e.key === 'ArrowRight' ? step : -step), k0), k1), name: hover?.name || sel?.name || '' });
  };

  // Zoom. Where clientX falls across the plot's hands, 0..1 (the label column counts as the right end).
  const across = (cx: number) => {
    const r = plot.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (((cx - r.left) / r.width) * lw - left) / leadW));
  };
  // A wheel step (a trackpad pinch in Chrome and Firefox, or ⌘/ctrl + scroll) or Safari's pinch: the window scales by f
  // about the hand under the pointer, compounding on the zoom so quick notches add up. Over the replay it ends the replay
  // instead (as Skip does) and the rest of the gesture zooms the resting chart.
  const zoomBy = (cx: number, f: number) => {
    if (playing) return skipReplay();
    const at = across(cx);
    setZoom(z => { const [a, b] = z ?? [X0, X1]; return fit(a + at * (b - a), at, (b - a) * f); });
  };
  useLayoutEffect(() => { zoomStep.current = zoomBy; });
  // Two fingers on a touch screen: the hand between them stays between them while their spread scales the window.
  const pinchTo = () => {
    setHover(null);
    if (playing) return skipReplay();
    const [[ax, ay], [bx, by]] = [...fingers.current.values()];
    const d = Math.max(24, Math.hypot(bx - ax, by - ay)), at = across((ax + bx) / 2);
    const p = (pinch.current ??= { d, n: X0 + at * (X1 - X0), w: X1 - X0 });
    setZoom(fit(p.n, at, (p.w * p.d) / d));
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      fingers.current.set(e.pointerId, [e.clientX, e.clientY]);
      if (fingers.current.size > 1) return setHover(null);
    } else if (zoom && e.button === 0 && !(e.target as Element).closest('button')) {
      drag.current = { x: e.clientX, z: zoom, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    pick(e.clientX, e.clientY);
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (!fingers.current.has(e.pointerId)) return;
      fingers.current.set(e.pointerId, [e.clientX, e.clientY]);
      if (fingers.current.size === 2) pinchTo();
      return;
    }
    // Zoomed, a drag pans: the hands under the pointer stay under it.
    if (!(e.buttons & 1)) drag.current = null; // its release was missed (outside the window)
    const d = drag.current;
    if (d && (d.moved ||= Math.abs(e.clientX - d.x) > 3)) {
      setHover(null);
      const w = d.z[1] - d.z[0], px = (leadW / lw) * plot.current!.getBoundingClientRect().width;
      return setZoom(fit(d.z[0] - ((e.clientX - d.x) / px) * w, 0, w));
    }
    pick(e.clientX, e.clientY);
  };
  const onUp = (e: React.PointerEvent) => {
    fingers.current.delete(e.pointerId);
    if (fingers.current.size < 2) pinch.current = null;
    drag.current = null;
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter(s => s !== v) : [...list, v]);
  // The filters that are not at their defaults, in words, for the overview tile (the axis title says the unit).
  const filters = [
    lineup === 'all' && 'All models',
    license !== 'all' && (license === 'open' ? 'Open weights' : 'Proprietary'),
    fams.length && fams.join(', '),
    top && `Top ${top}`,
    !whole && RANGES.find(r => r.n === win)?.label,
  ].filter(Boolean).join(' · ');
  // The bar and legend appear with the card: corrected for the panel's glide (no stretch), faded in.
  const appear = { layout: 'position', transition: GLIDE, initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.3, delay: 0.08 } } } as const;

  return (
    <div className="flex-1 min-h-0 flex flex-col" {...syncAttrs(race ? timeline ?? null : null, handNow === null ? null : Math.floor(handNow))}>
      {interactive && (
        // One bar for every control, 24px between groups (16px on a phone, where it is tall already), wrapping on narrow
        // widths: what is plotted first (metric, hands, all-in EV), then which models, Family on a row of its own. Every
        // control is 29px tall: one-of-a-kind choices sit in a tray, on/off toggles are chips, so a long row of chips
        // wraps into rows of the same height.
        <motion.div {...appear} className="mb-2 flex flex-wrap items-start gap-x-4 gap-y-1.5 md:gap-x-6 md:gap-y-2.5 text-[14px]" style={{ color: MUTED }}>
          <Field label="Metric">
            <Segmented label="Metric" options={[{ label: 'bb/100', value: 'bb100' as const }, { label: 'Chips', value: 'chips' as const }]} value={metricPick} onChange={setMetric} />
          </Field>
          <Field label="Hands">
            <Segmented
              label="Hands shown"
              options={RANGES.map(r => ({ label: r.label, value: r.n, disabled: r.n > 0 && r.n >= lastHand }))}
              value={range && range < lastHand ? range : 0}
              onChange={n => { setRange(n); setZoom(null); }}
            />
          </Field>
          <Toggles
            label="All-in EV"
            title="Dashed lines: what each model would have won if every all-in were paid out by its odds at that moment. Solid above dashed means it ran lucky."
            items={[{ label: 'All-in EV', on: luck, toggle: () => setLuck(l => !l) }]}
          />
          <Field label="Lineup">
            <Segmented label="Lineup" options={[{ label: 'Seated now', value: 'seated' as const }, { label: 'All models', value: 'all' as const, disabled: !everyone?.length }]} value={lineup} onChange={setLineup} />
          </Field>
          <Field label="License">
            <Segmented label="License" options={[{ label: 'All', value: 'all' as const }, { label: 'Open weights', value: 'open' as const }, { label: 'Proprietary', value: 'closed' as const }]} value={license} onChange={setLicense} />
          </Field>
          <Field label="Show">
            <Segmented label="Top models" options={[{ label: 'All', value: 0 }, { label: 'Top 5', value: 5 }]} value={top} onChange={setTop} />
          </Field>
          <Field label="Family" full>
            <Toggles label="Family" items={families.map(f => ({ label: f, on: fams.includes(f), disabled: !inPool.has(f) && !fams.includes(f), toggle: () => setFams(toggle(fams, f)) }))}>
              {fams.length > 0 && <button onClick={() => setFams([])} className="py-1 text-[13px] underline">Clear</button>}
            </Toggles>
          </Field>
        </motion.div>
      )}
      {race && mini && filters && <div className="-mt-1 mb-1 text-[12px] truncate" style={{ color: MUTED }}>{filters}</div>}
      {/* The chart's box: its size comes from the panel, never the other way round. */}
      <div ref={area} className={`relative w-full flex-1 flex flex-col ${mini ? 'min-h-[100px]' : 'min-h-[160px]'}`}>
        <div className="relative shrink-0" style={{ height: lh * s }}>
        {/* The plot at one aspect ratio, centred across the box and at its top, so a legend that wraps
            differently never moves it. `layout` keeps it unstretched while the panel around it glides:
            both of its boxes have the same shape, so the glide scales it evenly. */}
        <motion.div
          ref={plot}
          // For checks: the plot's band, the y axis' range now and its target, in design units (pills carry data-ty).
          data-plot={`${padTop.toFixed(1)},${plotH.toFixed(1)}`}
          data-y-range={`${Y0},${Y1}`}
          data-y-fit={`${want[0]},${want[1]}`}
          data-live={live ? '' : undefined} // overtakes count (no scene tween running)
          layout={race}
          layoutDependency={`${mini}:${s}:${box.w}:${box.h}`}
          transition={GLIDE}
          // Zoomed, the plot pans by dragging. On a touch screen its own pinch replaces the browser's; one finger still scrolls.
          className={`absolute outline-offset-2 ${zoom ? 'cursor-grab active:cursor-grabbing select-none' : ''}`}
          style={{ left: (box.w - lw * s) / 2, top: 0, width: lw * s, height: lh * s, touchAction: interactive ? 'pan-y' : undefined }}
          onPointerMove={interactive ? onMove : undefined}
          onPointerDown={interactive ? onDown : undefined}
          onPointerUp={interactive ? onUp : undefined}
          onPointerCancel={interactive ? onUp : undefined}
          onPointerLeave={interactive ? e => e.pointerType !== 'touch' && setHover(null) : undefined} // a tap keeps its readout
          onDoubleClick={interactive ? e => { if (!(e.target as Element).closest('button')) setZoom(null); } : undefined}
          // Focusable only where the chart is interactive (the Race screen).
          tabIndex={interactive && onSelect ? 0 : undefined}
          onKeyDown={interactive && onSelect ? onKey : undefined}
          onBlur={interactive ? () => setHover(null) : undefined}
          role="img"
          aria-label={interactive && onSelect ? `${label} Left and right arrows step through the hands.` : label}
        >
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: lw, height: lh, transform: s === 1 ? undefined : `scale(${s})` }}>
            <svg className="absolute inset-0" width={lw} height={lh} viewBox={`0 0 ${lw} ${lh}`} aria-hidden>
              <defs><clipPath id={clipId}><rect x={left} y={padTop - 2} width={leadW} height={plotH + 4} /></clipPath></defs>
              {/* Axis titles: the unit above the y labels, the hands under the x labels. */}
              {/* One type for the chart's furniture: x and y ticks alike, both titles alike (13px, muted). */}
              <text x={4} y={ts} fontSize={ts} fontWeight={500} fill={MUTED} className="tabular-nums" data-axis-title="y">{yTitle}</text>
              <text x={left + leadW / 2} y={lh - 4} textAnchor="middle" fontSize={ts} fontWeight={500} fill={MUTED} className="tabular-nums" data-axis-title="x">Hands played</text>
              {[...yTicks, ...yGone].map(t => (
                <g key={t} opacity={edge(t)}>
                  <g className={`transition-opacity duration-300 starting:opacity-0 ${yTicks.includes(t) ? '' : 'opacity-0'}`}>
                    <line x1={left} x2={plotR} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(55, 53, 47, 0.5)' : GRID} />
                    <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={ts} fontWeight={400} fill={MUTED} className="tabular-nums" data-y-tick={yTicks.includes(t) ? '' : undefined}>{tick(t)}</text>
                  </g>
                </g>
              ))}
              <line x1={left} x2={left} y1={padTop} y2={padTop + plotH} stroke={GRID} />
              {xTicks.map(({ t, o }) => ({ t, o: o * Math.min(1, Math.max(0, (plotR - x(t) - t.toLocaleString().length * ts * 0.31) / 12)) })).filter(d => d.o > 0.01).map(({ t, o }) => (
                // A label fades out before it would reach past the plot into the pill column.
                <g key={t} opacity={o}>
                  <line x1={x(t)} x2={x(t)} y1={padTop + plotH} y2={padTop + plotH + 4} stroke={AXIS} />
                  <text x={x(t)} y={padTop + plotH + ts + 6} textAnchor="middle" fontSize={ts} fontWeight={400} fill={MUTED} className="tabular-nums" data-x-tick>{t.toLocaleString()}</text>
                </g>
              ))}
              <g clipPath={`url(#${clipId})`}>
                {bandPath && <path d={bandPath} fill={modelColor(sel!.name)} opacity={0.14} />}
                {evDrawn.map(({ n, p, o }) => (luck || n === hot?.name) && p.length ? (
                  <path key={`ev:${n}`} d={path(n, p)} fill="none" stroke={modelColor(n)} strokeWidth={1.5} strokeDasharray="5 4" opacity={(!hot || n === hot.name ? 0.7 : 0.2) * o} />
                ) : null)}
                {[...ordered.filter(m => m.name !== emphOn), ...ordered.filter(m => m.name === emphOn)].map(m => (
                  <path
                    key={m.name}
                    d={path(m.name, drawn.get(m.name)!)}
                    fill="none"
                    stroke={modelColor(m.name)}
                    strokeWidth={m === hot || m === sel ? 3 : m.name === emphOn ? 2 + 1.5 * emph : 2}
                    strokeLinejoin="round"
                    data-emph={m.name === emphOn ? '' : undefined}
                    opacity={(hot ? (m === hot || m === sel ? 1 : 0.25) : emphOn && m.name !== emphOn ? 1 - 0.3 * emph : 1) * fade(old.lines, lines, m.name)}
                  />
                ))}
                {/* Where the passer crossed the line it passed: a ring in its colour, fading over MARK_S. */}
                {ev && (
                  <circle data-overtake-marker={`${ev.a}|${ev.b}`} cx={x(ev.n)} cy={y(ev.v)} r={6} fill="white" stroke={modelColor(ev.a)} strokeWidth={2.5} opacity={Math.max(0, 1 - age / MARK_S)} />
                )}
              </g>
              {race && ends.map((e, i) => (
                // The tip's dot (an arrow at the edge for a tip beyond the axis), and a dotted leader to
                // its pill when stacking moved the pill off the line.
                <g key={e.m.name} opacity={(hot && hot !== e.m ? 0.3 : 1) * e.o}>
                  {Math.abs(pillYs[i] - e.ty) > pillH / 2 && <path data-leader d={`M${e.tx},${e.ty}L${e.tx + PILL_GAP},${pillYs[i]}`} stroke={modelColor(e.m.name)} strokeWidth={1} strokeDasharray="2 2" fill="none" opacity={0.7} />}
                  {e.off
                    ? <path data-tip={e.m.name} data-off-axis={e.off < 0 ? 'up' : 'down'} d={`M${e.tx},${e.ty + e.off * 6}l-5,${-e.off * 9}h10z`} fill={modelColor(e.m.name)} stroke="white" strokeWidth={1.5} strokeLinejoin="round" style={POP_ORIGIN} />
                    : <circle data-tip={e.m.name} cx={e.tx} cy={e.ty} r={3.5} fill={modelColor(e.m.name)} stroke="white" strokeWidth={1.5} style={POP_ORIGIN} />}
                </g>
              ))}
              {hover && (
                <g pointerEvents="none">
                  <line x1={x(hover.n)} x2={x(hover.n)} y1={padTop} y2={padTop + plotH} stroke="rgba(55, 53, 47, 0.55)" strokeDasharray="3 3" />
                  {readout.map(({ m, v }) => (
                    <circle key={m.name} cx={x(hover.n)} cy={y(v)} r={m === hot ? 4.5 : 3} fill={modelColor(m.name)} stroke="white" strokeWidth={1} />
                  ))}
                </g>
              )}
            </svg>
            {race && !shown.length && (
              <p className="absolute inset-0 flex items-center justify-center text-[14px]" style={{ color: MUTED }}>
                {listed.length ? 'Every line is switched off in the legend.' : 'No model matches these filters.'}
              </p>
            )}
            {race && ends.map((e, i) => (
              // A label at each line's tip: rank, logo, the name in the line's colour and the value; a click shades its
              // 95% band (the name is underlined while it does). In the tile the same labels, clicks passing through.
              <button
                key={e.m.name}
                data-pill
                data-tx={e.tx.toFixed(1)}
                onClick={() => onSelect?.(selected === e.m.name ? '' : e.m.name)}
                onPointerMove={ev => ev.stopPropagation()}
                onPointerEnter={() => { setHover(null); onHighlight?.(e.m.name); }}
                onPointerLeave={() => onHighlight?.(undefined)}
                onFocus={() => onHighlight?.(e.m.name)}
                onBlur={() => onHighlight?.(undefined)}
                aria-pressed={selected === e.m.name}
                tabIndex={interactive ? undefined : -1}
                aria-hidden={interactive ? undefined : true}
                data-ty={e.ty.toFixed(1)}
                data-rank={i + 1}
                data-emph={e.m.name === emphOn ? '' : undefined}
                ref={el => { if (el) pillEls.current.set(e.m.name, el); else pillEls.current.delete(e.m.name); }}
                className={`absolute flex items-center leading-none text-left tabular-nums ${interactive ? '' : 'pointer-events-none'}`}
                style={{
                  left: e.tx + PILL_GAP, top: pillYs[i] - pillH / 2, height: pillH, maxWidth: pillRoom - 12 * u, fontSize: ts, textShadow: HALO,
                  color: modelColor(e.m.name), // the name's; the rank and the value set their own
                  opacity: (hot ? (hot !== e.m ? 0.45 : 1) : emphOn && e.m.name !== emphOn ? 1 - 0.3 * emph : 1) * e.o,
                }}
              >
                <span className="flex min-w-0 items-center gap-1">
                  <span data-pill-rank className="font-medium" style={{ color: MUTED }}>{i + 1}</span>
                  <LLMLogo model={e.m.name} size={Math.round(15 * u)} />
                  <span data-pill-name className={`min-w-0 truncate py-0.5 font-medium ${selected === e.m.name ? 'underline underline-offset-2' : ''}`}>{e.m.name}</span>
                  <span data-pill-value className="ml-1 shrink-0 font-medium" style={{ color: netColor(e.v) }}>{e.val}</span>
                </span>
              </button>
            ))}
            {/* The race clock: the hand the lines have reached, with Skip while it plays and Replay after. */}
            {race && (playing || interactive) && (
              <div className="absolute flex items-center gap-2 tabular-nums" style={{ right, top: 0, height: padTop - 4, fontSize: ts, color: MUTED }}>
                {playing && (
                  <span data-race-clock>
                    Hand <b style={{ color: TEXT }}>{(handNow === null ? Math.round(head) : Math.floor(handNow)).toLocaleString()}</b> of {(handNow === null ? lastHand : timeline!.hands).toLocaleString()}
                  </span>
                )}
                {zoom && (
                  <button data-zoom-reset onPointerMove={ev => ev.stopPropagation()} onPointerDown={ev => ev.stopPropagation()} onDoubleClick={ev => ev.stopPropagation()} onClick={() => setZoom(null)} className={CLOCK_BTN} style={CLOCK_BTN_STYLE}>
                    Reset zoom
                  </button>
                )}
                {interactive && (
                  <button onPointerMove={ev => ev.stopPropagation()} onPointerDown={ev => ev.stopPropagation()} onClick={playing ? skipReplay : playReplay} className={CLOCK_BTN} style={CLOCK_BTN_STYLE}>
                    {playing ? 'Skip' : 'Replay'}
                  </button>
                )}
              </div>
            )}
            {/* Overtake splashes are drawn here, outside React (see burst). */}
            <div ref={fxLayer} aria-hidden className="absolute inset-0 pointer-events-none" />
            {/* Always mounted, so the first arrow press is announced too; it says the leader and the highlighted line. */}
            {race && <div role="status" className="sr-only">{said}</div>}
            {/* The readout floats over the plot (no layout shift), on the side away from the cursor. */}
            {hover && readout.length > 0 && (
              <div
                ref={tipRef}
                aria-hidden
                data-readout
                className="absolute z-10 pointer-events-none rounded bg-white tabular-nums"
                style={{
                  fontSize: fs, padding: `${8 * u}px ${10 * u}px`,
                  top: padTop,
                  left: Math.min(crossX + 12, lw - 4),
                  boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px',
                }}
              >
                <div className="font-bold mb-1" style={{ color: TEXT }}>Hand {hover.n.toLocaleString()}</div>
                {readout.map(({ m, v }) => (
                  <div key={m.name} className={`flex items-center gap-2 whitespace-nowrap ${m === hot ? 'font-bold' : ''}`} style={{ color: TEXT, lineHeight: `${20 * u}px` }}>
                    <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: modelColor(m.name) }} />
                    <span className="flex-1 min-w-0">{m.name}</span>
                    <span data-readout-value className="pl-4" style={{ color: netColor(v) }}>{fmt(v)} {unit}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
        {/* The tile's Replay, once the race has run (ended or skipped): over the clock's place at the plot's
            scale, but outside the plot, whose role="img" hides its children from screen readers. It
            restarts the shared replay and never opens the card. */}
        {race && mini && !playing && replayStarted() && (
          <div className="absolute pointer-events-none" style={{ left: (box.w - lw * s) / 2, top: 0, width: lw * s, height: lh * s }}>
            <div className="absolute left-0 top-0 origin-top-left" style={{ width: lw, height: lh, transform: s === 1 ? undefined : `scale(${s})` }}>
              <div className="absolute flex items-center" style={{ right, top: 0, height: padTop - 4, fontSize: ts }}>
                <motion.button
                  data-tile-replay
                  aria-label="Replay the Trends race"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.6, duration: 0.3 } }}
                  onClick={ev => { ev.stopPropagation(); playReplay(); }}
                  onKeyDown={ev => ev.stopPropagation()}
                  className={`pointer-events-auto ${CLOCK_BTN}`}
                  style={CLOCK_BTN_STYLE}
                >
                  Replay
                </motion.button>
              </div>
            </div>
          </div>
        )}
        </div>
        {/* The legend, Arena style: a click switches a line off or on, hovering brings it forward. */}
        {interactive && listed.length > 0 && (
          // It fills the room set aside under the plot (LEGEND_H, 4px of it the margin), its rows centred, so a short legend
          // leaves no band under it; never shorter than its rows (shrink-0: a flex item's set min-height would let it shrink).
          <motion.div {...appear} role="group" aria-label="Lines shown" className="mt-1 flex shrink-0 flex-wrap content-center items-center gap-x-3 gap-y-0.5 text-[13px]" style={{ minHeight: LEGEND_H - 4 }}>
            {listed.map(m => {
              const shownNow = !hidden.includes(m.name);
              const inView = shown.includes(m); // the legend follows the lines in view: one out of the camera's window dims
              return (
                <button
                  key={m.name}
                  onClick={() => setHidden(toggle(hidden, m.name))}
                  onPointerEnter={() => shownNow && onHighlight?.(m.name)}
                  onPointerLeave={() => onHighlight?.(undefined)}
                  aria-pressed={shownNow}
                  className="flex items-center gap-1.5 rounded px-1 transition-opacity duration-300 hover:bg-[rgba(55,53,47,0.06)]"
                  style={{ color: shownNow ? TEXT : MUTED, textDecoration: shownNow ? undefined : 'line-through', opacity: shownNow && !inView ? 0.4 : 1 }}
                >
                  <span aria-hidden className="inline-block w-3 h-[3px] rounded-full" style={{ background: shownNow ? modelColor(m.name) : 'rgba(55, 53, 47, 0.25)' }} />
                  {m.name}
                </button>
              );
            })}
          </motion.div>
        )}
      </div>
      {!race && <p className="mt-2 text-[13px]" style={{ color: MUTED }}>Shaded: 95% band</p>}

      {/* The chart's numbers for screen readers; tables ignore sr-only's 1px box, so a div clips it. */}
      {sel && (
        <div className="sr-only"><table>
          <caption>{sel.name}: {yTitle} with 95% band</caption>
          <thead>
            <tr style={{ color: MUTED }}>
              <th scope="col" className="text-right font-medium px-2">Hand</th>
              <th scope="col" className="text-right font-medium px-2">{unit}</th>
              <th scope="col" className="text-right font-medium px-2">Low</th>
              <th scope="col" className="text-right font-medium px-2">High</th>
            </tr>
          </thead>
          <tbody>
            {pts(sel).map(([n, v]) => (
              <tr key={n} className="border-t border-notion">
                <th scope="row" className="text-right font-normal px-2">{n}</th>
                <td className="text-right px-2">{fmt(v)}</td>
                <td className="text-right px-2">{fmt(v - bandAt(sel, n))}</td>
                <td className="text-right px-2">{fmt(v + bandAt(sel, n))}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

// A control in the bar: its name, then the control. The name is as tall as a control (29px), so it lines up with the
// control's first row. `full`: a row of its own.
function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className={`flex min-w-0 items-start gap-2 ${full ? 'basis-full' : ''}`}><span className="shrink-0 py-1">{label}</span>{children}</div>;
}

// On/off toggles as chips (Family, All-in EV), each pressed on its own: the tray's colours (grey off, white on), 29px
// tall as a tray, 4px apart; a long row wraps chip by chip. `children` follow the chips (Family's Clear).
function Toggles({ label, items, title, children }: { label: string; items: { label: string; on: boolean; disabled?: boolean; toggle: () => void }[]; title?: string; children?: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-wrap items-start gap-1 text-[14px]">
      {items.map(o => (
        <button
          key={o.label}
          onClick={o.toggle}
          disabled={o.disabled}
          aria-pressed={o.on}
          title={title}
          data-chip
          className="rounded px-2 py-1 font-medium disabled:opacity-40"
          style={o.on ? { background: 'white', color: TEXT, boxShadow: SHADOW } : { background: 'rgba(55, 53, 47, 0.06)', color: MUTED }}
        >
          {o.label}
        </button>
      ))}
      {children}
    </div>
  );
}
