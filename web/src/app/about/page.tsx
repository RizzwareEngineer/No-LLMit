'use client';

import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';
import About from '@/components/About';

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b border-[rgba(55,53,47,0.09)]">
        <div className="max-w-[1300px] mx-auto px-6 py-3">
          <Link 
            href="/" 
            className="flex items-center gap-2 text-sm text-[rgb(55,53,47)] opacity-65 hover:opacity-100 transition-opacity"
          >
            <ArrowLeft size={16} />
            Back to game
          </Link>
        </div>
      </nav>

      <main className="max-w-[1300px] mx-auto px-6 py-10">
        <About />
      </main>
    </div>
  );
}
