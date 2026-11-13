'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { API_URL } from '@/lib/api';
import type { ModelStats } from '@/lib/stats';

// The History replay's clock, one per page load: History draws from it and Profiles and Matchups
// follow it. It runs a minute from the first hand to the last, from when History first scrolls into
// view; Skip ends it, Replay restarts it. `progress` is 0..1 of the way (1: not started or done, the
// cards show now). Its own frame loop, so every card reads the same value in the same frame.
export const PLAY_MS = 60_000;
// Test-only: a check sets window.__replaySpeed before it starts a replay to watch the same replay that many times
// faster; the chart's real-time effects (camera spring, splash timing, pill slide) scale with replaySpeed(). Visitors: 1.
let speed = 1;
export const replaySpeed = () => speed;
let start: number | null = null;
let progress = 1;
let frame = 0;
const subs = new Set<() => void>();
function tick(t: number) {
  progress = start === null ? 1 : Math.min(1, Math.max(0, ((t - start) * speed) / PLAY_MS));
  subs.forEach(f => f());
  cancelAnimationFrame(frame);
  if (progress < 1) frame = requestAnimationFrame(tick);
}
export const playReplay = () => { speed = (window as { __replaySpeed?: number }).__replaySpeed || 1; start = performance.now(); tick(start); };
export const skipReplay = () => { start = -Infinity; tick(0); };
export const replayStarted = () => start !== null;
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
// `select` should return a primitive, so a component re-renders only when what it shows changes.
export const useReplay = <T,>(select: (p: number) => T): T => useSyncExternalStore(subscribe, () => select(progress), () => select(1));

// GET /api/stats/timeline (docs/stats.md, Timeline), indexed for lookups at any hand.
type Profile = Pick<ModelStats, 'hands' | 'bb100' | 'vpip' | 'pfr' | 'af'>;
export interface Timeline {
  hands: number;
  step: number; // profile_step: hands between profiles snapshots
  snaps: number[]; // the hands with a profiles snapshot, ascending
  profiles: Map<string, Profile>[]; // per snapshot: each model seated by then, with its figures then
  pairs: { a: string; b: string; at: number[]; sum: number[] }[]; // per pair: what a had taken from b by each change point
  lineups: { from: number; to: number; seated: Set<string> }[]; // who was dealt in over each run of hands (to: inclusive)
}

// Index of the last of the ascending `xs` at or before x (-1: none).
export function lastAtOrBefore(xs: number[], x: number) {
  let lo = 0, hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

type Table = { fields: string[]; rows: (number | null)[][] };
function parse(j: { hands?: unknown; profile_step?: unknown; models?: unknown; profiles?: Table; matchups?: Table; lineups?: number[][] }): Timeline {
  if (typeof j?.hands !== 'number' || !Array.isArray(j.models) || !Array.isArray(j.profiles?.rows) || !Array.isArray(j.matchups?.rows)) {
    throw new Error('timeline: unexpected shape');
  }
  const names = j.models as string[];
  const col = (t: Table) => Object.fromEntries(t.fields.map((f, i) => [f, i]));
  const byHand = (t: Table, h: number) => [...t.rows].sort((x, y) => x[h]! - y[h]!);
  const p = col(j.profiles!), m = col(j.matchups!);
  const snaps: number[] = [], profiles: Map<string, Profile>[] = [];
  for (const r of byHand(j.profiles!, p.hand)) {
    if (snaps.at(-1) !== r[p.hand]) { snaps.push(r[p.hand]!); profiles.push(new Map()); }
    profiles.at(-1)!.set(names[r[p.model]!], { hands: r[p.hands]!, bb100: r[p.bb100]!, vpip: r[p.vpip]!, pfr: r[p.pfr]!, af: r[p.af] });
  }
  const pairs = new Map<number, Timeline['pairs'][number]>();
  for (const r of byHand(j.matchups!, m.hand)) {
    const [a, b] = [r[m.a]!, r[m.b]!];
    let pair = pairs.get(a * names.length + b);
    if (!pair) pairs.set(a * names.length + b, (pair = { a: names[a], b: names[b], at: [], sum: [] }));
    pair.at.push(r[m.hand]!);
    pair.sum.push((pair.sum.at(-1) ?? 0) + r[m.chips]!);
  }
  // Lineups (absent from an older engine: no hands together, so no pair bb/100 while replaying).
  const runs = [...(j.lineups ?? [])].sort((x, y) => x[0] - y[0]);
  const lineups = runs.map(([from, ...ms], i) => ({ from, to: i + 1 < runs.length ? runs[i + 1][0] - 1 : Infinity, seated: new Set(ms.map(m => names[m])) }));
  return { hands: j.hands, step: Number(j.profile_step) || 0, snaps, profiles, pairs: [...pairs.values()], lineups };
}

// Hands up to `hand` that a and b were both dealt in.
export function handsTogetherAt(tl: Timeline, a: string, b: string, hand: number) {
  let n = 0;
  for (const r of tl.lineups) {
    if (r.from > hand) break;
    if (r.seated.has(a) && r.seated.has(b)) n += Math.min(r.to, hand) - r.from + 1;
  }
  return n;
}

// The all-time timeline, refetched when `refreshKey` changes. null until it loads, and if it fails: the cards then
// show now, unsynced.
export function useTimeline(refreshKey?: number): Timeline | null {
  const [tl, setTl] = useState<Timeline | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/stats/timeline`)
      .then(res => { if (!res.ok) throw new Error(`timeline ${res.status}`); return res.json(); })
      .then(j => { if (!cancelled) setTl(parse(j)); })
      .catch(() => {}); // keeps the last good timeline, if any
    return () => { cancelled = true; };
  }, [refreshKey]);
  return tl;
}

// The hand the replay has reached, or null while it is not replaying `tl` (the cards show now).
export const useReplayHand = (tl: Timeline | null) => useReplay(p => (tl && p < 1 ? Math.floor(p * tl.hands) : null));

// The profiles snapshot the replay shows (the latest at or before its hand): an index into
// tl.snaps (-1 before the first), or null while not replaying. Changes every profile_step hands only.
export const useReplaySnap = (tl: Timeline | null) => useReplay(p => (tl && p < 1 ? lastAtOrBefore(tl.snaps, Math.floor(p * tl.hands)) : null));

// The hand a synced card shows, as data attributes for checks (the scope's last hand when not
// replaying); none until the timeline loads. `step` adds profile_step (Profiles).
export const syncAttrs = (tl: Timeline | null, hand: number | null, step = false) =>
  tl ? { 'data-sync-hand': hand ?? tl.hands, ...(step ? { 'data-sync-step': tl.step } : {}) } : {};

// Hands `name` had played by hand `hand` (fractional): exact on a snapshot, linear between two.
export function playedAt(tl: Timeline, name: string, hand: number) {
  const i = lastAtOrBefore(tl.snaps, hand);
  const [s0, h0] = i < 0 ? [0, 0] : [tl.snaps[i], tl.profiles[i].get(name)?.hands ?? 0];
  if (i === tl.snaps.length - 1) return h0;
  const [s1, h1] = [tl.snaps[i + 1], tl.profiles[i + 1].get(name)?.hands ?? 0];
  return h0 + ((h1 - h0) * (hand - s0)) / (s1 - s0);
}

// Profiles at snapshot i: each model seated by then with that snapshot's figures, its curve cut at
// its hands then (the Last 50 hands line); the 95% range stays the live one. `pending`: no hands yet.
export function profilesAt(tl: Timeline, models: ModelStats[], i: number) {
  const snap = tl.profiles[i];
  const shown = models.flatMap(m => {
    const r = snap?.get(m.name);
    return r ? [{ ...m, ...r, cumulative_bb: m.cumulative_bb.filter(([n]) => n <= r.hands) }] : [];
  });
  return { shown, pending: models.filter(m => !snap?.has(m.name)).map(m => m.name) };
}

// Matchups at hand `hand`: each model's head-to-head then, for every pair dealt in together by then (the
// running pair net and their hands together; pots are not in the timeline: 0), and its hands played then.
// net_chips and bb100 stay live, so the grid keeps its order.
export function matchupsAt(tl: Timeline, models: ModelStats[], hand: number): ModelStats[] {
  const vs = new Map<string, Record<string, { pots: number; net_chips: number; hands: number }>>(models.map(m => [m.name, {}]));
  for (const [i, a] of models.entries()) for (const b of models.slice(i + 1)) {
    const hands = handsTogetherAt(tl, a.name, b.name, hand);
    if (!hands) continue;
    vs.get(a.name)![b.name] = { pots: 0, net_chips: 0, hands };
    vs.get(b.name)![a.name] = { pots: 0, net_chips: 0, hands };
  }
  for (const p of tl.pairs) {
    const i = lastAtOrBefore(p.at, hand);
    if (i < 0) continue;
    const [ra, rb] = [vs.get(p.a)?.[p.b], vs.get(p.b)?.[p.a]];
    if (ra) ra.net_chips = p.sum[i];
    if (rb) rb.net_chips = -p.sum[i];
  }
  return models.map(m => ({ ...m, hands: Math.floor(playedAt(tl, m.name, hand)), vs: vs.get(m.name)! }));
}

if (process.env.NODE_ENV === 'development') {
  console.assert(lastAtOrBefore([25, 50, 75], 24) === -1 && lastAtOrBefore([25, 50, 75], 50) === 1 && lastAtOrBefore([25, 50, 75], 99) === 2, 'lastAtOrBefore');
  const tl = parse({
    hands: 50, models: ['A', 'B'],
    profiles: { fields: ['hand', 'model', 'hands', 'bb100', 'vpip', 'pfr', 'af'], rows: [[25, 0, 25, 10, 0.5, 0.2, 1], [50, 0, 50, 20, 0.5, 0.2, 1], [50, 1, 10, -5, 0.3, 0.1, null]] },
    matchups: { fields: ['hand', 'a', 'b', 'chips'], rows: [[3, 0, 1, 40], [40, 0, 1, -15]] },
    lineups: [[1, 0], [3, 0, 1], [10, 0], [41, 0, 1]], // B dealt in over hands 3-9 and from 41
  });
  console.assert(playedAt(tl, 'A', 25) === 25 && playedAt(tl, 'B', 25) === 0 && playedAt(tl, 'B', 45) === 8, 'playedAt: exact on snapshots, linear between');
  console.assert(handsTogetherAt(tl, 'A', 'B', 2) === 0 && handsTogetherAt(tl, 'A', 'B', 5) === 3 && handsTogetherAt(tl, 'A', 'B', 20) === 7 && handsTogetherAt(tl, 'A', 'B', 50) === 17, 'handsTogetherAt: the runs both were dealt in, cut at the hand');
  const at = (h: number) => matchupsAt(tl, [{ name: 'A' }, { name: 'B' }] as ModelStats[], h);
  console.assert(!('B' in at(2)[0].vs) && at(39)[0].vs.B.net_chips === 40 && at(39)[0].vs.B.hands === 7 && at(40)[1].vs.A.net_chips === -25, 'matchupsAt: running pair sums both ways, with hands together');
}
