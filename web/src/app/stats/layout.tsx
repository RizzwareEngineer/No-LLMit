import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Stats · No-LLMit' };

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b border-[rgba(55,53,47,0.09)]">
        <div className="max-w-[1300px] mx-auto px-4 md:px-6 py-3 flex items-center gap-4 text-sm">
          <Link href="/" className="text-[rgb(55,53,47)] opacity-65 hover:opacity-100 transition-opacity">← Back to game</Link>
          <Link href="/stats" className="text-[rgb(55,53,47)] opacity-65 hover:opacity-100 transition-opacity">All models</Link>
        </div>
      </nav>
      <main className="max-w-[1300px] mx-auto px-4 md:px-6 py-8">{children}</main>
    </div>
  );
}
