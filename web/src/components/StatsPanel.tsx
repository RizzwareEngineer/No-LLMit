import CornerBorders from '@/components/CornerBorders';

// Card in the same style as the main page's Profits & Losses panel.
export default function StatsPanel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`relative bg-white rounded ${className}`}
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <CornerBorders />
      <h2 className="text-xs font-bold uppercase tracking-wider p-3 border-b border-notion" style={{ color: 'rgb(55, 53, 47)' }}>{title}</h2>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function SampleBadge() {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium align-middle"
      style={{ background: 'rgba(203, 145, 47, 0.15)', color: 'rgb(140, 95, 20)' }}
      title="The engine's /api/stats did not answer, so this page shows bundled sample data."
    >
      sample data
    </span>
  );
}
