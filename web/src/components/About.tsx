'use client';

import { memo, useSyncExternalStore } from 'react';
import { Segmented } from '@/components/Section';
import HeroSplit from '@/components/about/HeroSplit';
import SpecSheet from '@/components/about/SpecSheet';

// Two layouts of the About screen, on the real page until the owner picks one: ?about=a|b (DEFAULT otherwise), or the
// switcher at the right end of About's last row, which keeps the choice in the URL's query (never a hash: the URL
// never names a screen). shortcut: the losing draft and this switcher go once one is picked.
const DRAFTS = [
  { label: 'Draft A', value: 'a' },
  { label: 'Draft B', value: 'b' },
] as const;
type Draft = (typeof DRAFTS)[number]['value'];
const VIEWS = { a: HeroSplit, b: SpecSheet };
const DEFAULT: Draft = 'b'; // B (spec sheet): one labelled row per topic, the ask beside the thesis

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener('popstate', l);
  return () => { listeners.delete(l); window.removeEventListener('popstate', l); };
};
const read = (): Draft => DRAFTS.find(d => d.value === new URLSearchParams(window.location.search).get('about'))?.value ?? DEFAULT;
const choose = (d: Draft) => {
  const url = new URL(window.location.href);
  url.searchParams.set('about', d);
  history.replaceState(null, '', url);
  listeners.forEach(l => l());
};

// The About content: the /about page, and the home page's last screen (where the page's own h1 is the table's title, so
// About's first heading is an h2). Its parent sets the width (the stats overview's block on the home page). Memoized: the
// stats re-render as each hand lands and as screens change, and nothing About shows depends on them.
export default memo(function About({ heading = 'h1' }: { heading?: 'h1' | 'h2' }) {
  const draft = useSyncExternalStore(subscribe, read, () => DEFAULT);
  const View = VIEWS[draft];
  return (
    <div data-about-draft={draft} className="relative">
      <View heading={heading} />
      {/* Kept out of the drafts, so it stays put (and keeps focus) as they swap. */}
      <div data-draft-switcher className="mt-3 flex justify-center md:mt-0 md:absolute md:right-0 md:bottom-0">
        <Segmented label="About draft" options={[...DRAFTS]} value={draft} onChange={choose} />
      </div>
    </div>
  );
});
