'use client';

import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

// Drafts of the donation ask for the owner to pick from ('' is today's). Once he picks, this file goes and the pick stays.
// ?donate=a|b|c in the URL, or the switcher (development only), which remembers the pick in this browser.
export type Draft = '' | 'a' | 'b' | 'c';
const DRAFTS: [Draft, string][] = [['', 'Today'], ['a', 'A · table card'], ['b', 'B · bar pill'], ['c', 'C · About leads']];
const KEY = 'donate-draft';
const listeners = new Set<() => void>();
const read = (): Draft => {
  try {
    const d = new URLSearchParams(location.search).get('donate') ?? localStorage.getItem(KEY) ?? '';
    return DRAFTS.some(([v]) => v === d) ? (d as Draft) : '';
  } catch { return ''; }
};
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useDraft = () => useSyncExternalStore(subscribe, read, () => '' as Draft);

function pick(d: Draft) {
  try {
    localStorage.setItem(KEY, d);
    const u = new URL(location.href); u.searchParams.delete('donate'); history.replaceState(history.state, '', u);
  } catch {}
  listeners.forEach(l => l());
}

// A small fixed control at the bottom right, in development only.
export function DraftSwitcher() {
  const draft = useDraft();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (process.env.NODE_ENV !== 'development' || !mounted) return null;
  return createPortal(
    <div role="group" aria-label="Donation draft" className="fixed bottom-3 right-3 z-[60] flex gap-0.5 rounded-md bg-white p-0.5 text-[12px] shadow-[rgba(15,15,15,0.1)_0_0_0_1px,rgba(15,15,15,0.15)_0_3px_8px]">
      {DRAFTS.map(([v, label]) => (
        <button key={v} onClick={() => pick(v)} aria-pressed={draft === v} className={`rounded px-2 py-1 font-medium ${draft === v ? 'bg-[rgb(55,53,47)] text-white' : 'text-[rgba(55,53,47,0.65)] hover:bg-[rgba(55,53,47,0.06)]'}`}>
          {label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
