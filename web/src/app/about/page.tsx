'use client';

import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';
import About from '@/components/About';
import { BLUE } from '@/lib/stats';
import AboutDrafts from '@/components/about/drafts';
import { useAboutDraft } from '@/components/about/live';

// About on the page's background (data-page), as wide as the home page's About screen on a large window (its block's
// 1264px when no table stage sets it), so About lays out as it does there.
// ?about=a, b or c: a draft of a shorter About (about/drafts.tsx); without one, About as it is.
export default function AboutPage() {
  const draft = useAboutDraft();
  return (
    <div data-page className="min-h-screen">
      <nav className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-[rgba(55,53,47,0.09)]">
        <div className="max-w-[1264px] mx-auto px-3 lg:px-4 h-11 flex items-center">
          <Link href="/" className="flex items-center gap-1 rounded px-2 py-1 -ml-2 text-[13px] font-medium hover:bg-[rgba(55,53,47,0.06)]" style={{ color: BLUE }}>
            <ArrowLeft size={13} weight="bold" aria-hidden />
            Back to table
          </Link>
        </div>
      </nav>

      {draft ? (
        <main className="max-w-[1264px] mx-auto px-3 lg:px-4 py-5 md:py-6">
          <AboutDrafts draft={draft} />
        </main>
      ) : (
        <main className="max-w-[1264px] mx-auto px-3 lg:px-4 py-6 md:py-10">
          <About />
        </main>
      )}
    </div>
  );
}
