// The Trends lines' data, apart from the chart, so a page that draws its own (About's race) does not load the chart.
import type { ModelStats } from '@/lib/stats';

// A running bb/100 over a model's first hands is mostly noise. Trends draws each rate line from hand 0 but fits its
// y axis to it only from this many hands on, so those early swings may sit clamped at the plot's edge.
export const RATE_FROM = 20;

// Trends' design shape (CumulativeChart's layout), 2.6:1 at least: tall enough to tell close lines apart; a box the
// chart is drawn in never stretches it past that (phone draft A's landing tile keeps it, LandingFill).
export const W = 1220, H = 470;

export type Metric = 'bb100' | 'chips' | 'bb';

// A model's line in the plotted metric: running bb/100 (break-even at hand 0, where it has no rate yet), or
// cumulative chips (or bb), as [hands played, value], from hand 0.
export function series(m: ModelStats, metric: Metric, bigBlind = 1, ev = false): [number, number][] {
  const curve = ev ? m.cumulative_aiev_bb ?? [] : m.cumulative_bb;
  if (metric === 'bb100') return curve.map(([n, v]) => [n, n ? (v / n) * 100 : 0]);
  const k = metric === 'chips' ? bigBlind : 1;
  return curve.map(([n, v]) => [n, v * k]);
}

// The y axis' range for a set of values, Arena style: their 5th to 95th percentile (so one spike
// does not flatten the pack) and every value in `keep` (the lines' tips), plus 8% air each side.
// A tip far outside the pack (more than the pack's own span beyond it) is left out, to sit at the
// edge with an arrow rather than squash everyone. `must`: values
// always inside, however far out (the lines' recent stretch, which is never clipped).
export function robustRange(vs: number[], keep: number[] = [], must: number[] = []): [number, number] {
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

// Where Trends' y fit starts, as a share of the x window from its left end (to its drawn end), for a window that is
// `share` of every hand (1 at rest, unzoomed): the lines from 0.75 of it at rest (their recent quarter) to its left end
// as a zoom narrows, and every line's all-in EV line (drawn dashed for the hovered line) from none at rest (1) to the
// whole window, at share^2: under the lines' 0.75 share once it is under 0.75, so a narrow zoom fits both whole, and near
// 1 at a slight zoom, so one pinch notch moves the fit by little.
export function fitFrom(share: number): { lines: number; evs: number } {
  const f = Math.min(1, Math.max(0, share));
  return { lines: 0.75 * f, evs: f * f };
}
