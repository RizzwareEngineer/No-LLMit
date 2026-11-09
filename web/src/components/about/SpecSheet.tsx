'use client';

import { MUTED, TEXT } from '@/lib/stats';
import { Caveats, Eyebrow, Footer, HANDS_A_DAY, HOURS, How, Intro, LABEL, Next, RULE, Race, Support, Thesis } from '@/components/about/content';

// Draft B, "spec sheet": the thesis, then one row per topic, its name in a gutter on the left (Arena's labelled rules);
// the ask and the race in a column of their own on the right. On a phone: the thesis, the ask, the race, then the rows.
// Laid out by its own width (container queries).

function Row({ as: H, title, children }: { as: 'h2' | 'h3'; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-6 gap-y-2 @2xl:grid-cols-[112px_minmax(0,1fr)] py-3.5 [@media(min-height:960px)]:py-5 border-t" style={{ borderColor: RULE }}>
      <H className={`${LABEL} @2xl:pt-px`} style={{ color: MUTED }}>{title}</H>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default function SpecSheet({ heading }: { heading: 'h1' | 'h2' }) {
  const Sub = heading === 'h1' ? 'h2' : 'h3';
  return (
    <article data-layout="spec-sheet" className="@container flex flex-col gap-6 text-[14px] leading-snug" style={{ color: TEXT }}>
      <div className="flex flex-col gap-6 @4xl:grid @4xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] @4xl:gap-x-14">
        {/* Each column's parts join one stack on a phone (display: contents), in reading order there. */}
        <div className="contents @4xl:flex @4xl:flex-col @4xl:min-w-0">
          <header className="flex flex-col gap-3 @4xl:pb-6">
            <Eyebrow />
            <Thesis as={heading} />
            <Intro />
          </header>
          <div className="order-3 @4xl:order-none border-b" style={{ borderColor: RULE }}>
            <Row as={Sub} title="How it works"><How /></Row>
            <Row as={Sub} title="Caveats"><Caveats /></Row>
            <Row as={Sub} title="Hours">
              <p>Open {HOURS}, every day.</p>
              <p>About {HANDS_A_DAY} hands a day.</p>
            </Row>
            <Row as={Sub} title="What’s next"><Next /></Row>
          </div>
        </div>
        <div className="contents @4xl:flex @4xl:flex-col @4xl:gap-8 @4xl:min-w-0">
          <Support as={Sub} className="order-1 @4xl:order-none" />
          <Race className="order-2 @4xl:order-none @4xl:flex-1" art="h-[clamp(200px,40cqw,300px)] @4xl:h-auto @4xl:flex-1 @4xl:min-h-[200px]" />
        </div>
      </div>
      <Footer />
    </article>
  );
}
