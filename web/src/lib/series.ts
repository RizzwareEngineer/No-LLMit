// The Trends lines' data, apart from the chart, so a page that draws its own (About's race) does not load the chart.
import type { ModelStats } from '@/lib/stats';

// A running bb/100 over a model's first hands is mostly noise. Trends draws each rate line from hand 0 but fits its
// y axis to it only from this many hands on, so those early swings may sit clamped at the plot's edge.
export const RATE_FROM = 20;

export type Metric = 'bb100' | 'chips' | 'bb';

// A model's line in the plotted metric: running bb/100 (break-even at hand 0, where it has no rate yet), or
// cumulative chips (or bb), as [hands played, value], from hand 0.
export function series(m: ModelStats, metric: Metric, bigBlind = 1, ev = false): [number, number][] {
  const curve = ev ? m.cumulative_aiev_bb ?? [] : m.cumulative_bb;
  if (metric === 'bb100') return curve.map(([n, v]) => [n, n ? (v / n) * 100 : 0]);
  const k = metric === 'chips' ? bigBlind : 1;
  return curve.map(([n, v]) => [n, v * k]);
}
