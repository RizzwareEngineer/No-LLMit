'use client';

import { Cards, ChartLine, Info } from '@phosphor-icons/react';
import { BLUE, MUTED } from '@/lib/stats';

export type Tab = 'table' | 'stats' | 'about';
const TABS = [['table', 'Table', Cards], ['stats', 'Stats', ChartLine], ['about', 'About', Info]] as const;

// Phones: the bottom tab bar over the home page's three parts (the iOS and Android pattern for three top-level sections),
// above the home indicator. `tab` is where the page is; a tap takes it to that part's top (page.tsx).
export default function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav aria-label="Sections" className="md:hidden fixed bottom-0 inset-x-0 z-40 flex border-t border-notion bg-white/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
      {TABS.map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          onClick={() => onTab(id)}
          aria-current={tab === id ? 'page' : undefined}
          className="flex-1 h-[52px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium"
          style={{ color: tab === id ? BLUE : MUTED }}
        >
          <Icon size={22} weight={tab === id ? 'fill' : 'regular'} aria-hidden />
          {label}
        </button>
      ))}
    </nav>
  );
}
