'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useReducedMotion } from 'motion/react';
import { GLIDE_MS, SHADOW, Segmented } from '@/components/Section';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import { family, openWeights } from '@/lib/families';
import { MUTED, ModelStats, TEXT, chips, ciHalf, netColor, signed } from '@/lib/stats';
import { Timeline, playReplay, playedAt, replayStarted, skipReplay, syncAttrs, useReplay } from '@/lib/timeline';

const GRID = 'rgba(55, 53, 47, 0.12)';
const AXIS = 'rgba(55, 53, 47, 0.75)';
// Every line is drawn through this many evenly spaced hands across the x axis, plus its exact ends.
const SAMPLES = 160;
const EASE = [0.22, 1, 0.36, 1] as const; // ease-out, as the tile glide
const GLIDE = { duration: GLIDE_MS / 1000, ease: EASE } as const;
// A filter change moves the axes and the lines to the new range together over this long.
const TWEEN_S = 0.5;
// The Race is laid out once at this size (the Race card's width at 1440×900, about 3.6:1) and scaled as
// a whole into its box. The overview's History tile has the same shape (StatsSections sizes its row),
// so the tile and the card show one picture, filling their width, and nothing ever stretches.
export const W = 1220, H = 470; // History's shape, 2.6:1: tall enough to tell close lines apart
const LEGEND_H = 68; // the legend under the Race card's plot: up to three rows (every model, and the note)

type Pts = [number, number][];
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// The value of a cumulative curve at hand n, linearly interpolated (0 before its first point,
// flat after its last).
export function valueAt(pts: [number, number][], n: number) {
  if (!pts.length || n < pts[0][0]) return 0;
  const i = pts.findIndex(p => p[0] >= n);
  if (i <= 0) return pts.at(i)![1]; // past the last point, or exactly on the first
  const [n0, v0] = pts[i - 1], [n1, v1] = pts[i];
  return n1 === n0 ? v1 : v0 + ((n - n0) / (n1 - n0)) * (v1 - v0);
}

// Spreads label centres at least `gap` apart inside [lo, hi], each as close to its target as
// that allows. `ys` must be sorted ascending.
export function spread(ys: number[], gap: number, lo: number, hi: number) {
  const out = ys.map(v => Math.min(Math.max(v, lo), hi));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  for (let i = out.length - 1; i >= 0; i--) out[i] = Math.min(out[i], i === out.length - 1 ? hi : out[i + 1] - gap);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], i ? out[i - 1] + gap : lo);
  return out;
}

// 95% band around the cumulative line after n hands. The per-hand spread implied by the
// bb/100 interval over N hands is h*sqrt(N)/196, so n hands spread by h*sqrt(N*n)/100.
function band(m: ModelStats, n: number) {
  return ((ciHalf(m) ?? 0) * Math.sqrt(m.hands * n)) / 100; // no interval below 2 hands
}

// Evenly spaced round ticks that cover [min, max]; the first and last tick bound the axis,
// so a range that dips below zero always gets a negative label.
export function niceTicks(min: number, max: number, count: number, integer = false) {
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
export function trace(pts: Pts, x0: number, x1: number, end = Infinity, to?: Pts, k = 1): Pts {
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
// A running bb/100 over a handful of hands is noise, so the rate lines start here.
export const RATE_FROM = 20;

type Metric = 'bb100' | 'chips' | 'bb';
type License = 'all' | 'open' | 'closed';

// A model's line in the plotted metric: running bb/100 from RATE_FROM hands, or cumulative chips
// (or bb), as [hands played, value].
export function series(m: ModelStats, metric: Metric, bigBlind = 1, ev = false): [number, number][] {
  const curve = ev ? m.cumulative_aiev_bb ?? [] : m.cumulative_bb;
  if (metric === 'bb100') return curve.filter(([n]) => n >= RATE_FROM).map(([n, v]) => [n, (v / n) * 100]);
  const k = metric === 'chips' ? bigBlind : 1;
  return curve.map(([n, v]) => [n, v * k]);
}

// A model's curve over hands played, moved onto table hands (the x axis Arena puts time on): the
// hands it played between two profiles snapshots are spread evenly across them, as playedAt reads
// them back. Flat while it sits out and from its last hand to the scope's last, so every line's tip
// is "now"; empty until it starts. `hands`: its live count, which may run past the last snapshot.
export function onTable(tl: Timeline, name: string, curve: Pts, hands: number): Pts {
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

// Ticks over [a, b] on a nested ladder of steps (each a multiple of the one before: 1, 5, 10, 50, …),
// each with an opacity: the finer step's ticks fade out as the range grows toward the coarser step,
// and ticks fade out near the ends. So a y axis that zooms never pops a label. `major`: on the coarser step.
export function zoomTicks(a: number, b: number, count: number) {
  const s0 = (b - a) / count || 1;
  const mag = 10 ** Math.floor(Math.log10(s0));
  const [finer, step] = s0 <= 5 * mag ? [mag, 5 * mag] : [5 * mag, 10 * mag];
  const fine = (step - s0) / (step - finer), edge = (b - a) * 0.03;
  const out: { t: number; o: number; major: boolean }[] = [];
  for (let i = Math.ceil(a / finer); i * finer <= b; i++) {
    const t = +(i * finer).toPrecision(12);
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    const o = Math.min(major ? 1 : fine, (b - t) / edge, (t - a) / edge, 1);
    if (o > 0.01) out.push({ t, o, major });
  }
  return out;
}

// The vertical camera: [lo, hi] follows its target as a critically damped spring, so the y axis eases
// to each new fit with no overshoot, no jump when the target moves and no per-frame jitter.
const CAM_W = 7; // the spring's rate, 1/s: a step settles in about 0.8 s, trailing a moving target by 2/CAM_W
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
      const dt = Math.min(0.25, Math.max(0, (t - c.t) / 1000)), span = Math.abs(c.tgt[1] - c.tgt[0]) || 1;
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

// Arena-style labels: a pill (logo and name) just right of each line's tip.
const PILL_ROOM = 190; // the plot's width past the leading edge, for the leader's pill
const PILL_H = 22;
const PILL_GAP = 7; // from the tip's dot to its pill

// Pill centres, each as near its target as it can be: two pills whose spans overlap across x are
// pushed apart (half each, the bounds taking the rest) until they are `gap` apart; pills apart
// across x never push each other. The push ramps in over the first 16px of overlap, so pills
// meeting across x ease apart instead of jumping. `ps` must be sorted by y ascending.
export function stack(ps: { x: number; w: number; y: number }[], gap: number, lo: number, hi: number) {
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
}

const clockMs = () => performance.now(); // for effects only: when each collision effect last played

// About eight dots fly out from (x, y) and fade over 600 ms: a line passing another.
function burst(layer: HTMLElement | null, x: number, y: number, color: string) {
  for (let i = 0; layer && i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI + Math.random() * 0.6, d = 12 + Math.random() * 10;
    const dot = document.createElement('span');
    dot.style.cssText = `position:absolute;left:${x - 2.5}px;top:${y - 2.5}px;width:5px;height:5px;border-radius:9999px;background:${color}`;
    layer.appendChild(dot);
    dot.animate(
      [
        { transform: 'none', opacity: 1, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        { transform: `translate(${Math.cos(a) * d * 0.8}px, ${Math.sin(a) * d * 0.8}px)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(0.4)`, opacity: 0 },
      ],
      { duration: 600, id: 'burst' },
    ).onfinish = () => dot.remove();
  }
}

export default function CumulativeChart({
  models,
  everyone,
  selected,
  onSelect,
  highlight,
  onHighlight,
  race = false,
  mini = false,
  bigBlind,
  timeline,
}: {
  models: ModelStats[];
  everyone?: ModelStats[]; // the Race "All models" lineup; `models` is the seated one
  selected: string;
  onSelect?: (name: string) => void; // the Race screen: a click on an end label shades that line's 95% band
  highlight?: string; // a line to bring forward while the pointer is not on the plot
  onHighlight?: (name: string | undefined) => void;
  race?: boolean; // several lines, each labelled at its end, with filters, a legend, a hover readout and a range control
  mini?: boolean; // the overview tile: the same chart scaled down, without controls or interaction
  bigBlind?: number; // outside the Race: plot chips (bb × big blind) instead of bb
  timeline?: Timeline | null; // the Race: replays hand by hand, each line at its model's hands then
}) {
  const area = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const fxLayer = useRef<HTMLDivElement>(null);
  const pillEls = useRef(new Map<string, HTMLElement>());
  // Last frame's pushed pills and order, and when each effect last played (no repeats, no blinking).
  const fx = useRef({ pushed: new Set<string>(), order: [] as string[], shook: new Map<string, number>(), lastBurst: -Infinity, lastShake: -Infinity, pair: new Map<string, number>() });
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

  // The hand under the pointer (or picked with the arrow keys) and the line nearest it.
  const [hover, setHover] = useState<{ n: number; name: string } | null>(null);
  const [range, setRange] = useState(0); // 0: every hand
  // The Race filters, Arena style. They live here, so the overview tile (the same instance) shows them too.
  const [metricPick, setMetric] = useState<'bb100' | 'chips'>('chips');
  const [lineup, setLineup] = useState<'seated' | 'all'>('seated');
  const [license, setLicense] = useState<License>('all');
  const [fams, setFams] = useState<string[]>([]); // none picked: every family
  const [top, setTop] = useState(0); // 0: every model
  const [luck, setLuck] = useState(false); // all-in EV lines for every model (the highlighted one always shows its own)
  const [hidden, setHidden] = useState<string[]>([]); // lines switched off in the legend

  // A fresh history has no model at RATE_FROM hands yet: race on chips until bb/100 has lines to draw.
  const young = race && metricPick === 'bb100' && ![...(everyone ?? []), ...models].some(m => m.hands >= RATE_FROM);
  const metric: Metric = race ? (young ? 'chips' : metricPick) : bigBlind ? 'chips' : 'bb';
  const rate = metric === 'bb100';
  const unit = rate ? 'bb/100' : metric;
  const fmt = (v: number) => (metric === 'chips' ? chips(Math.round(v)) : signed(v));
  const interactive = race && !mini;
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
  // The x axis starts where the first line does (RATE_FROM hands for bb/100), or at the window.
  const from = Math.max(whole ? 0 : lastHand - win, Math.min(lastHand - 1, ...listed.map(m => pts(m)[0][0])));
  // The lines in the window (lines switched off or ended before it drop out), and the all-in EV lines.
  const on = listed.filter(m => !hidden.includes(m.name) && trace(pts(m), from, lastHand).length);
  const lines = new Map(on.map(m => [m.name, pts(m)]));
  const evs = new Map(luck ? on.flatMap(m => { const p = curveOf(m, true); return p.length ? [[m.name, p] as const] : []; }) : []);
  // The value at hand n, or null before the line starts.
  const at = (m: ModelStats, n: number) => (n < pts(m)[0][0] ? null : valueAt(pts(m), n));
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
  const scene: Scene = {
    key: [metric, playing ? 'camera' : from, lastHand, span, ...lines.keys(), '|', ...evs.keys()].join(),
    camera: playing, span, x0: from, x1: lastHand, lines, evs,
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
  const [tr, setTr] = useState({ from: scene, to: scene });
  const [mix, setMix] = useState(1);
  if (tr.to.key !== scene.key) {
    // Camera to camera (new data, a filter mid-replay): both keep following. Otherwise carry on from where the axis is now.
    const [a, b] = [windowOf(tr.from), windowOf(tr.to)];
    const now = tr.to.camera && scene.camera ? tr.to : { ...tr.to, camera: false, x0: lerp(a[0], b[0], mix), x1: lerp(a[1], b[1], mix) };
    setTr({ from: now, to: scene });
    setMix(0);
  }
  useEffect(() => {
    if (reduce) return;
    const c = animate(0, 1, { duration: TWEEN_S, ease: EASE, onUpdate: setMix });
    return () => c.stop();
  }, [tr, reduce]);
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

  // The vertical camera: the y axis fits the lines as drawn in the x window (not the whole history),
  // with a little air, and eases there as a spring. Spikes that have scrolled off no longer flatten
  // the pack, and two lines swapping places show their gap. Zero joins the static view of every hand.
  const ys = [...drawn.values(), ...(luck ? evDrawn.map(e => e.p) : [])].flatMap(p => p.map(q => q[1]));
  // While the race plays the camera looks 0.5 s ahead (the replay is recorded; the spring trails by
  // about 0.3 s), so it starts widening before a line breaks out instead of chasing it.
  const ahead = (lastHand - from) * (0.5 / 60);
  if (playing) for (const p of lines.values()) ys.push(...sampleAt(p, Array.from({ length: 9 }, (_, i) => nowX + (ahead * i) / 8)).filter((_, i) => p[0][0] <= nowX + (ahead * i) / 8));
  if (sel) trace(pts(sel), X0, X1, nowX).forEach(([n, v]) => ys.push(v + bandAt(sel, n), v - bandAt(sel, n)));
  if (whole && !playing) ys.push(0);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
  if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
  const air = (hi - lo) * 0.06;
  const cam = useCamera(lo - air, hi + air, !!reduce);
  const [Y0, Y1] = [Math.min(cam[0], lo), Math.max(cam[1], hi)]; // a lagging camera never cuts off a tip

  // The design size the chart is laid out at, and the one scale that fits it in its box. Outside
  // the Race (the model drawer) it simply fills its box.
  const [lw, lh] = race ? [W, H] : [Math.max(box.w, 200), box.h];
  // The legend's rows are set aside, so a filter that changes its length never rescales the plot.
  const s = race ? Math.min(box.w / W, (box.h - (interactive ? LEGEND_H : 0)) / H) : 1;
  // Text keeps the site's on-screen sizes (numbers at 14px, as the Profiles cells) however the chart
  // is scaled: design units are screen px times u.
  const u = race ? Math.min(1.5, Math.max(1, 1 / s)) : 1;
  const fs = 14 * u;
  const [pillH, pillRoom] = [PILL_H * u, PILL_ROOM * u];
  const right = 12;
  const left = 10 + fs * 0.62 * 8; // room for the widest y label ("−100,000"), so the plot never moves
  const padTop = fs + 14; // the y axis title sits above the plot
  const padBottom = fs + 10 + fs + 8; // tick labels, then the x axis title
  const plotW = lw - left - right;
  const plotH = lh - padTop - padBottom;
  // The leading edge sits this far in from the right; the leader's pill rides just past it.
  const leadW = plotW - (race ? pillRoom : 0);
  const x = (n: number) => left + ((n - X0) / (X1 - X0 || 1)) * leadW;
  const y = (v: number) => padTop + ((Y1 - v) / (Y1 - Y0 || 1)) * plotH;
  const line = (p: [number, number][]) => p.map(([n, v], i) => `${i ? 'L' : 'M'}${x(n)},${y(v)}`).join('');

  const shown = [...drawn.keys()].flatMap(n => (drawn.get(n)!.length && byName.has(n) ? [byName.get(n)!] : []));
  const hot = shown.find(m => m.name === (hover?.name ?? highlight)); // the hovered line
  const ordered = [...shown.filter(m => m !== sel && m !== hot), ...(sel && sel !== hot && shown.includes(sel) ? [sel] : []), ...(hot ? [hot] : [])]; // selected, then hovered on top
  if (race && hot && !evDrawn.some(e => e.n === hot.name)) {
    const p = curveOf(hot, true);
    if (p.length) evDrawn.push({ n: hot.name, p: trace(p, X0, X1, nowX), o: 1 });
  }
  const selPts = sel ? drawn.get(sel.name) ?? [] : [];
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
  const yTicks = zoomTicks(Y0, Y1, 6); // they move with the camera's zoom
  // A finer tick's label also fades out as the labels close up, so two never overlap.
  const fineGap = Math.min(1, Math.max(0, ((yTicks.find(d => !d.major) ? Math.min(...yTicks.slice(1).map((d, i) => d.t - yTicks[i].t)) : Infinity) / (Y1 - Y0 || 1) * plotH - 1.6 * fs) / fs));
  // Under the camera the ticks slide with history, fading in at the leading edge and out at the left.
  // While the window widens, the finer step's ticks fade out as the coarser step takes over: no label pops.
  const st = steps(X1 - X0, 10);
  const fadeW = st.step * 0.35;
  const xTicks = race && playing
    ? Array.from({ length: Math.floor(X1 / st.finer) - Math.ceil(Math.max(X0, from) / st.finer) + 1 }, (_, i) => (Math.ceil(Math.max(X0, from) / st.finer) + i) * st.finer)
        .map(t => ({ t, o: Math.min(t % st.step ? (st.step - st.s0) / (st.step - st.finer) : 1, (X1 - t) / fadeW, X0 > from ? (t - X0) / fadeW : 1) }))
        .filter(d => d.o > 0.01)
    : blend(xTicksOf(wa[0], wa[1]), xTicksOf(wb[0], wb[1]), X0, X1, k);
  const tick = (t: number) => (metric === 'chips' ? t.toLocaleString() : String(t)).replace('-', '−');
  // Every line ends in a dot and a pill (logo and name) just past it, Arena style. Pills that would
  // overlap stack apart and slide with their lines; a pill fades in as its line starts and out as
  // the camera carries its tip off the left edge.
  const ends = shown
    .map(m => {
      const p = drawn.get(m.name)!;
      const [n, v] = p.at(-1)!;
      const tx = x(n);
      const grown = Math.min(1, Math.max(0, (tx - Math.max(left, x(pts(m)[0][0]))) / 24), Math.max(0, (tx - left) / 48));
      return { m, n, v, tx, ty: y(v), w: Math.min(pillRoom - 12 * u, (36 + m.name.length * 8) * u), o: fade(old.lines, lines, m.name) * grown };
    })
    .sort((a, b) => b.v - a.v); // best first: ascending y
  const pillYs = stack(ends.map(e => ({ x: e.tx + PILL_GAP, w: e.w, y: e.ty })), pillH + 3, padTop + pillH / 2, padTop + plotH - pillH / 2);
  // The collision effects play while the race does: a pill newly pushed by another shakes once, and
  // a line that passes another bursts in its colour at its tip. Each plays once per event.
  const live = race && playing && !reduce && k === 1;
  const pushed = ends.filter((e, i) => Math.abs(pillYs[i] - e.ty) > 4).map(e => e.m.name);
  useEffect(() => {
    const f = fx.current, now = clockMs();
    // The order, with a little hysteresis: a line passes another once it is 6px clear of it, so
    // two lines touching never flicker the order. New lines join at their place, without an event.
    const byN = new Map(ends.map(e => [e.m.name, e]));
    const order = [...f.order.filter(n => byN.has(n)), ...ends.filter(e => !f.order.includes(e.m.name)).map(e => e.m.name)];
    const passes: [string, string][] = [];
    for (let i = 1; i < order.length; i++) {
      for (let j = i; j > 0 && byN.get(order[j])!.ty < byN.get(order[j - 1])!.ty - (f.order.includes(order[j]) ? 6 : 0); j--) {
        if (f.order.includes(order[j])) passes.push([order[j], order[j - 1]]);
        [order[j - 1], order[j]] = [order[j], order[j - 1]];
      }
    }
    if (live) {
      for (const n of pushed) {
        if (f.pushed.has(n) || now - (f.shook.get(n) ?? -Infinity) < 5000 || now - f.lastShake < 1000) continue;
        f.shook.set(n, now);
        f.lastShake = now;
        pillEls.current.get(n)?.animate(
          [{ transform: 'none' }, { transform: 'translateX(-2.5px)' }, { transform: 'translateX(2.5px)' }, { transform: 'translateX(-1.5px)' }, { transform: 'none' }],
          { duration: 320, easing: 'ease-out', id: 'pill-shake' },
        );
      }
      for (const [a, b] of passes) {
        const e = byN.get(a)!;
        const pair = [a, b].sort().join('|');
        // One burst at a time, and a pair that keeps swapping bursts once.
        if (e.o < 0.5 || byN.get(b)!.o < 0.5 || now - f.lastBurst < 2000 || now - (f.pair.get(pair) ?? -Infinity) < 15_000) continue;
        f.lastBurst = now;
        f.pair.set(pair, now);
        burst(fxLayer.current, e.tx, e.ty, modelColor(a));
      }
    }
    f.pushed = new Set(pushed);
    f.order = order;
  });
  // The pills' tips in page pixels, for checks: the plot is scaled (and glides) as a whole.
  useLayoutEffect(() => {
    const p = plot.current;
    if (!p) return;
    const r = p.getBoundingClientRect();
    p.querySelectorAll<HTMLElement>('[data-pill]').forEach(e => { e.dataset.tipX = (r.left + +e.dataset.tx! * (r.width / lw)).toFixed(1); });
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

  const step = Math.max(1, Math.round((lastHand - from) / 40));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setHover(null);
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const n0 = hover?.n ?? (e.key === 'ArrowLeft' ? lastHand + step : from - step);
    setHover({ n: Math.min(Math.max(n0 + (e.key === 'ArrowRight' ? step : -step), from), lastHand), name: hover?.name || sel?.name || '' });
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
        // One bar for every control; it wraps on narrow widths.
        <motion.div {...appear} className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px]" style={{ color: MUTED }}>
          <Field label="Metric">
            <Segmented label="Metric" options={[{ label: 'Chips', value: 'chips' as const }, { label: 'bb/100', value: 'bb100' as const }]} value={metricPick} onChange={setMetric} />
          </Field>
          <Field label="Lineup">
            <Segmented label="Lineup" options={[{ label: 'Seated now', value: 'seated' as const }, { label: 'All models', value: 'all' as const, disabled: !everyone?.length }]} value={lineup} onChange={setLineup} />
          </Field>
          <Field label="License">
            <Segmented label="License" options={[{ label: 'All', value: 'all' as const }, { label: 'Open weights', value: 'open' as const }, { label: 'Proprietary', value: 'closed' as const }]} value={license} onChange={setLicense} />
          </Field>
          <Field label="Show">
            <Segmented label="Top models" options={[{ label: 'All', value: 0 }, { label: 'Top 5', value: 5 }]} value={top} onChange={setTop} />
          </Field>
          <Toggles
            label="All-in EV"
            title="Dashed lines: what each model would have won if every all-in were paid out by its odds at that moment. Solid above dashed means it ran lucky."
            items={[{ label: 'All-in EV', on: luck, toggle: () => setLuck(l => !l) }]}
          />
          <Field label="Family">
            <Toggles label="Family" items={families.map(f => ({ label: f, on: fams.includes(f), disabled: !inPool.has(f) && !fams.includes(f), toggle: () => setFams(toggle(fams, f)) }))} />
            {fams.length > 0 && <button onClick={() => setFams([])} className="text-[13px] underline">Clear</button>}
          </Field>
          <Field label="Hands">
            <Segmented
              label="Hands shown"
              options={RANGES.map(r => ({ label: r.label, value: r.n, disabled: r.n > 0 && r.n >= lastHand }))}
              value={range && range < lastHand ? range : 0}
              onChange={setRange}
            />
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
          // For checks: the plot's band and the y axis' range now, in design units (pills carry data-ty).
          data-plot={`${padTop.toFixed(1)},${plotH.toFixed(1)}`}
          data-y-range={`${Y0},${Y1}`}
          layout={race}
          layoutDependency={`${mini}:${s}:${box.w}:${box.h}`}
          transition={GLIDE}
          className="absolute outline-offset-2"
          style={{ left: (box.w - lw * s) / 2, top: 0, width: lw * s, height: lh * s }}
          onPointerMove={interactive ? e => e.pointerType !== 'touch' && pick(e.clientX, e.clientY) : undefined}
          onPointerDown={interactive ? e => pick(e.clientX, e.clientY) : undefined}
          onPointerLeave={interactive ? e => e.pointerType !== 'touch' && setHover(null) : undefined} // a tap keeps its readout
          // Focusable only where the chart is interactive (the Race screen).
          tabIndex={interactive && onSelect ? 0 : undefined}
          onKeyDown={interactive && onSelect ? onKey : undefined}
          onBlur={interactive ? () => setHover(null) : undefined}
          role="img"
          aria-label={interactive && onSelect ? `${label} Left and right arrows step through the hands.` : label}
        >
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: lw, height: lh, transform: s === 1 ? undefined : `scale(${s})` }}>
            <svg className="absolute inset-0" width={lw} height={lh} viewBox={`0 0 ${lw} ${lh}`} aria-hidden>
              <defs><clipPath id={clipId}><rect x={left} y={padTop - 2} width={plotW} height={plotH + 4} /></clipPath></defs>
              {/* Axis titles: the unit above the y labels, the hands under the x labels. */}
              <text x={4} y={fs} fontSize={fs} fontWeight={600} fill={AXIS}>{yTitle}</text>
              <text x={left + plotW / 2} y={lh - 4} textAnchor="middle" fontSize={fs} fontWeight={600} fill={AXIS}>Hands played</text>
              {yTicks.map(({ t, o, major }) => (
                <g key={t}>
                  <line x1={left} x2={lw - right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(55, 53, 47, 0.5)' : GRID} opacity={o} />
                  <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={fs} fill={AXIS} opacity={major ? o : o * fineGap} className="tabular-nums" data-y-tick>{tick(t)}</text>
                </g>
              ))}
              <line x1={left} x2={left} y1={padTop} y2={padTop + plotH} stroke={GRID} />
              {xTicks.map(({ t, o }) => (
                <g key={t} opacity={o}>
                  <line x1={x(t)} x2={x(t)} y1={padTop + plotH} y2={padTop + plotH + 4} stroke={AXIS} />
                  <text x={x(t)} y={padTop + plotH + fs + 6} textAnchor="middle" fontSize={fs} fill={AXIS} className="tabular-nums" data-x-tick>{t.toLocaleString()}</text>
                </g>
              ))}
              <g clipPath={`url(#${clipId})`}>
                {bandPath && <path d={bandPath} fill={modelColor(sel!.name)} opacity={0.14} />}
                {evDrawn.map(({ n, p, o }) => (luck || n === hot?.name) && p.length ? (
                  <path key={`ev:${n}`} d={line(p)} fill="none" stroke={modelColor(n)} strokeWidth={1.5} strokeDasharray="5 4" opacity={(!hot || n === hot.name ? 0.7 : 0.2) * o} />
                ) : null)}
                {ordered.map(m => (
                  <path
                    key={m.name}
                    d={line(drawn.get(m.name)!)}
                    fill="none"
                    stroke={modelColor(m.name)}
                    strokeWidth={m === hot || m === sel ? 3 : 2}
                    strokeLinejoin="round"
                    opacity={(!hot || m === hot || m === sel ? 1 : 0.25) * fade(old.lines, lines, m.name)}
                  />
                ))}
              </g>
              {race && ends.map((e, i) => (
                // The tip's dot, and a dotted leader to its pill when stacking moved the pill off the line.
                <g key={e.m.name} opacity={(hot && hot !== e.m ? 0.3 : 1) * e.o}>
                  {Math.abs(pillYs[i] - e.ty) > pillH / 2 && <path d={`M${e.tx},${e.ty}L${e.tx + PILL_GAP},${pillYs[i]}`} stroke={modelColor(e.m.name)} strokeWidth={1} strokeDasharray="2 2" fill="none" opacity={0.7} />}
                  <circle cx={e.tx} cy={e.ty} r={3.5} fill={modelColor(e.m.name)} stroke="white" strokeWidth={1.5} />
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
                {listed.length ? 'Every line is switched off in the legend.' : rate ? `No model here has played ${RATE_FROM} hands yet.` : 'No model matches these filters.'}
              </p>
            )}
            {race && ends.map((e, i) => (
              // A pill at each line's tip: logo and name in the line's colour; a click shades its 95% band.
              // In the tile the same pills, with clicks passing through to open the card.
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
                className={`absolute flex items-center rounded-full border-[1.5px] leading-none text-left tabular-nums ${interactive ? '' : 'pointer-events-none'}`}
                style={{
                  left: e.tx + PILL_GAP, top: pillYs[i] - pillH / 2, height: pillH, maxWidth: pillRoom - 12 * u, color: TEXT, fontSize: fs, paddingInline: 6 * u,
                  borderColor: modelColor(e.m.name), opacity: (hot && hot !== e.m ? 0.45 : 1) * e.o,
                  background: selected === e.m.name ? `color-mix(in srgb, ${modelColor(e.m.name)} 16%, white)` : 'white',
                }}
              >
                <span ref={el => { if (el) pillEls.current.set(e.m.name, el); else pillEls.current.delete(e.m.name); }} className="flex min-w-0 items-center gap-1">
                  <LLMLogo model={e.m.name} size={Math.round(15 * u)} />
                  <span className={`min-w-0 truncate ${e.m === hot || i === 0 ? 'font-bold' : 'font-medium'}`}>{e.m.name}</span>
                </span>
              </button>
            ))}
            {/* The race clock: the hand the lines have reached, with Skip while it plays and Replay after. */}
            {race && (playing || interactive) && (
              <div className="absolute flex items-center gap-2 tabular-nums" style={{ right, top: 0, height: padTop - 4, fontSize: fs, color: MUTED }}>
                {playing && (
                  <span data-race-clock>
                    Hand <b style={{ color: TEXT }}>{(handNow === null ? Math.round(head) : Math.floor(handNow)).toLocaleString()}</b> of {(handNow === null ? lastHand : timeline!.hands).toLocaleString()}
                  </span>
                )}
                {interactive && (
                  <button onPointerMove={ev => ev.stopPropagation()} onPointerDown={ev => ev.stopPropagation()} onClick={playing ? skipReplay : playReplay} className="rounded border px-2 py-px font-medium hover:bg-[rgba(55,53,47,0.06)]" style={{ borderColor: 'rgba(55, 53, 47, 0.16)', color: TEXT, background: 'white' }}>
                    {playing ? 'Skip' : 'Replay'}
                  </button>
                )}
              </div>
            )}
            {/* Overtake bursts are drawn here, outside React (see burst). */}
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
        </div>
        {/* The legend, Arena style: a click switches a line off or on, hovering brings it forward. */}
        {interactive && listed.length > 0 && (
          <motion.div {...appear} role="group" aria-label="Lines shown" className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px]">
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
            {rate && <span className="ml-auto" style={{ color: MUTED }}>Lines start at {RATE_FROM} hands · hover for every model · click a label for its 95% band</span>}
            {young && <span className="ml-auto" style={{ color: MUTED }}>Showing chips: bb/100 starts once a model has played {RATE_FROM} hands.</span>}
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

// A control in the bar: its name, then the control.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span>{label}</span>{children}</div>;
}

// Buttons in the same tray as Segmented, each pressed on its own (Family, All-in EV).
function Toggles({ label, items, title }: { label: string; items: { label: string; on: boolean; disabled?: boolean; toggle: () => void }[]; title?: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap rounded p-0.5 text-[14px]" style={{ background: 'rgba(55, 53, 47, 0.06)' }}>
      {items.map(o => (
        <button
          key={o.label}
          onClick={o.toggle}
          disabled={o.disabled}
          aria-pressed={o.on}
          title={title}
          className="rounded px-3 py-0.5 font-medium disabled:opacity-40"
          style={o.on ? { background: 'white', color: TEXT, boxShadow: SHADOW } : { color: MUTED }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
