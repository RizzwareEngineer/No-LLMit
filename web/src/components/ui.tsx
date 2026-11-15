'use client';

// The stats chrome and the switch, apart from Section's paging and motion, so /about loads neither.
import { MUTED, TEXT } from '@/lib/stats';

export const SHADOW = 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px';

// One chrome for every stats card (overview tiles, the zoomed Race panel and the Stats and
// Pairwise cards): same radius, ring, shadow and padding, so paging changes only the content.
// card-chrome (globals.css) dims the card as the next one slides over it.
export const CARD = 'card-chrome flex flex-col min-h-0 min-w-0 bg-white p-4 rounded-lg';
export const CARD_SHADOW = 'rgba(15, 15, 15, 0.08) 0px 0px 0px 1px, rgba(15, 15, 15, 0.06) 0px 4px 16px';
export const HEADER = 'mb-2 min-h-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-1';
export const TITLE = 'text-[20px] leading-8 font-bold';

// A row of mutually exclusive buttons (the Race range, the Pairwise view). One rule everywhere: the track hugs its options
// (fit-content), never a grey band beside them.
export function Segmented<T extends string | number>({ label, options, value, onChange }: {
  label: string;
  options: { label: string; value: T; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} data-seg className="flex shrink-0 w-fit max-w-full rounded p-0.5 text-[14px]" style={{ background: 'rgba(55, 53, 47, 0.06)' }}>
      {options.map(o => (
        <button
          key={o.label}
          onClick={() => onChange(o.value)}
          disabled={o.disabled}
          aria-pressed={value === o.value}
          className="rounded px-3 py-0.5 font-medium disabled:opacity-40"
          style={value === o.value ? { background: 'white', color: TEXT, boxShadow: SHADOW } : { color: MUTED }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
