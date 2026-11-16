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

// The last resort of a matrix cell too narrow for the grouped figure (+1.3k), so a value never goes blank.
export const signedCompact = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(n)).toLowerCase()}`;

