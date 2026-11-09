'use client';

import { MUTED, TEXT } from '@/lib/stats';
import { Caveats, Eyebrow, Footer, HANDS_A_DAY, HOURS, How, Intro, LABEL, Next, RULE, Race, Support, Thesis } from '@/components/about/content';

// Draft A, "split hero": what it is, the hours and the ask on the left, the race large on the right; how it works, the
// caveats and what's next under it in three columns on hairlines. Laid out by its own width (container queries).

// A section's label on a hairline across the section.
function Section({ as: H, title, children }: { as: 'h2' | 'h3'; title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <H className={`${LABEL} mb-3 pb-1.5 border-b`} style={{ color: MUTED, borderColor: RULE }}>{title}</H>
      {children}
    </section>
  );
}

// Short windows (1440x900) get tighter gaps, as the overview gets its compact pill there.
const GAP = 'gap-10 [@media(max-height:959px)]:gap-7';

export default function HeroSplit({ heading }: { heading: 'h1' | 'h2' }) {
  const Sub = heading === 'h1' ? 'h2' : 'h3';
  return (
    <article data-layout="hero-split" className={`@container flex flex-col ${GAP} text-[14px] leading-snug`} style={{ color: TEXT }}>
      <div className="grid gap-8 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] @4xl:gap-14 @4xl:items-center">
        <div className="flex flex-col gap-6 min-w-0">
          <div className="flex flex-col gap-3">
            <Eyebrow />
            <Thesis as={heading} />
            <Intro />
          </div>
          <div className="flex flex-wrap gap-x-10 gap-y-2">
            {[[HOURS, 'Open every day'], [`~${HANDS_A_DAY}`, 'Hands a day']].map(([n, what]) => (
              <div key={what}>
                <p className="text-[20px] leading-7 font-bold tabular-nums whitespace-nowrap">{n}</p>
                <p className="text-[13px] leading-snug" style={{ color: MUTED }}>{what}</p>
              </div>
            ))}
          </div>
          <Support as={Sub} className="self-start" />
        </div>
        <Race art="h-[clamp(220px,30cqw,300px)] [@media(min-height:960px)]:h-[clamp(240px,30cqw,400px)]" />
      </div>
      <div className="grid gap-x-10 gap-y-6 @3xl:grid-cols-3">
        <Section as={Sub} title="How it works"><How /></Section>
        <Section as={Sub} title="Caveats"><Caveats /></Section>
        <Section as={Sub} title="What’s next"><Next /></Section>
      </div>
      <Footer className="border-t pt-2" />
    </article>
  );
}
