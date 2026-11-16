// The site's one number format (owner: thousands separators, as Profits & Losses): en-US grouping for every figure,
// whatever the visitor's browser locale.
// A figure with thousands separators, a true minus, `digits` decimals.
export const grouped = (n: number, digits = 0) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const signed = (n: number, digits = 1) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${grouped(n, digits)}`;

// A figure for a narrow column: one decimal under 100, whole from 100 up, grouped (+12.3, +485, −1,306). The
// decimals follow the rounded figure, so 99.96 reads +100, not +100.0.
export const signedBrief = (n: number) => signed(n, Math.abs(n) < 99.95 ? 1 : 0);

// The last resort of a matrix cell too narrow for the grouped figure (+1.3k, or +19k with `digits` 0), so a value
// never goes blank.
export const signedCompact = (n: number, digits = 1) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: digits }).format(Math.abs(n)).toLowerCase()}`;

// A matrix cell's figure (HeadToHead) at one font size `px` in `room` px: in full (+1,234.5: a pair with few hands
// together reaches four or five digits) where it fits, else rounded to a whole, else shortened (+1.2k), else shortened
// to whole thousands (+19k); where none fits, the narrowest of them all, never a wider one the cell clips (+18.5k in a
// 34px cell cut to "+18.5", the engine's +18,500).
// Its width in em, tabular figures (calibrated in the browser: a figure or sign 0.62em, a comma or point 0.29, k 0.53).
export const figureEms = (t: string) => [...t].reduce((w, c) => w + (c === ',' || c === '.' ? 0.29 : c === 'k' ? 0.53 : 0.62), 0);
export function fitFigure(n: number, room: number, px: number) {
  const forms = [signed(n), signed(n, 0), signedCompact(n), signedCompact(n, 0)];
  return forms.find(t => figureEms(t) * px <= room) ?? forms.reduce((a, b) => (figureEms(b) < figureEms(a) ? b : a));
}

