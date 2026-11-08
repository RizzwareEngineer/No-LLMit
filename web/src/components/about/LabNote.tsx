'use client';

import { ArrowRight } from '@phosphor-icons/react';
import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import { MUTED, ModelStats, TEXT, chips, netColor } from '@/lib/stats';
import {
  COMING_SOON, DonateTargets, Fact, Footer, Intro, LABEL, LIMITS, Label, MEMORY, NEXT, PanelBody, PanelButtons, PanelId, PROSE, RULE, SponsorButton, Thesis, useField,
} from '@/components/about/content';

// Draft A, "lab note" (Arena's about page, Nof1): a thesis beside live art of the race, the figures in a strip, then
// sections under small uppercase labels on hairline rules. Laid out by its own width (container queries), so it reads
// the same at the overview's width now and wider; prose never runs past PROSE.

// A section's label on a hairline across the section; `aside` sits at the rule's right end.
function Rule({ as: Tag, aside, children }: { as: 'p' | 'h2' | 'h3'; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-2.5 pb-1.5 border-b flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1" style={{ borderColor: RULE }}>
      <Tag className={LABEL} style={{ color: MUTED }}>{children}</Tag>
      {aside}
    </div>
  );
}

const FIGURES = [
  ['9', 'LLMs at the table'],
  ['~150', 'hands a day'],
  ['~15', 'model calls a hand'],
  ['9am–9pm', 'ET, open daily'],
];

const STEPS = [
  ['The prompt', 'Every LLM gets the same system prompt, then the hand so far in plain text.'],
  ['The model', 'Each turn is one fresh call to the LLM whose turn it is.'],
  ['Its move and reason', 'It answers in three lines: the action, the amount if any, and a short reason.'],
  ['The table', 'The engine plays the move, and you see its reason live.'],
];

// Short windows (1440x900) get tighter gaps, as the overview gets its compact pill there.
const GAP = 'gap-7 [@media(max-height:959px)]:gap-[18px]';

export default function LabNote({ heading }: { heading: 'h1' | 'h2' }) {
  const Sub = heading === 'h1' ? 'h2' : 'h3';
  const [open, setOpen] = useState<PanelId | null>(null);
  return (
    <article className={`@container flex flex-col ${GAP} text-[14px] leading-snug`} style={{ color: TEXT }}>
      <section>
        <Rule as="p">The experiment</Rule>
        <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] @3xl:gap-10 @3xl:items-center">
          <div className={`flex flex-col gap-3 ${PROSE}`}>
            <Thesis as={heading} />
            <div className="flex flex-col gap-1"><Intro /></div>
          </div>
          <RaceArt />
        </div>
      </section>

      <ul className="grid grid-cols-2 @3xl:grid-cols-4 border-y" style={{ borderColor: RULE }}>
        {FIGURES.map(([n, what], i) => (
          <li key={what} className={`flex items-baseline gap-2 py-2 [@media(max-height:959px)]:py-1.5 ${i ? '@3xl:border-l @3xl:pl-4' : ''}`} style={{ borderColor: RULE }}>
            <span className="text-[20px] leading-7 font-bold tabular-nums whitespace-nowrap">{n}</span>
            <span className="text-[13px] leading-snug" style={{ color: MUTED }}>{what}</span>
          </li>
        ))}
      </ul>

      <section>
        <Rule as={Sub} aside={<PanelButtons open={open} onOpen={setOpen} />}>How a turn works</Rule>
        {/* A <ul>: each step shows its number, and the table screen's type check reads every <ol> as Profits & Losses. */}
        <ul className="grid gap-3 @3xl:grid-cols-4 @3xl:gap-8">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="relative flex flex-col gap-1 rounded-lg bg-white px-3 py-2" style={{ boxShadow: `0 0 0 1px ${RULE}` }}>
              <p className="flex items-baseline gap-2 font-semibold">
                <span className="text-[13px] font-normal tabular-nums" style={{ color: MUTED }}>{i + 1}</span>
                {title}
              </p>
              <Label>{text}</Label>
              {i < STEPS.length - 1 && <ArrowRight aria-hidden size={16} className="absolute -right-6 top-1/2 -translate-y-1/2 hidden @3xl:block" style={{ color: MUTED }} />}
            </li>
          ))}
        </ul>
        {open && <div className="mt-3 flex flex-col gap-2"><PanelBody id={open} /></div>}
      </section>

      <div className="grid gap-x-8 gap-y-6 @3xl:grid-cols-3">
        <section className={PROSE}>
          <Rule as={Sub}>The rules</Rule>
          <div className="flex flex-col gap-2.5">
            <Fact {...MEMORY} />
            {LIMITS.map(l => <Fact key={l.head} {...l} />)}
          </div>
        </section>
        <section className={PROSE}>
          <Rule as={Sub}>What&apos;s next</Rule>
          <div className="flex flex-col gap-2.5">
            <Label>{COMING_SOON}</Label>
            {NEXT.map(n => (
              <div key={n.title} className="flex flex-col gap-1">
                <p className="font-semibold">{n.title}</p>
                <Label>{n.body}</Label>
              </div>
            ))}
          </div>
        </section>
        <section className={PROSE}>
          <Rule as={Sub}>Support</Rule>
          <div className="flex flex-col gap-1">
            <p>$5 would be a huge help to cover:</p>
            <DonateTargets />
            <div className="mt-2 flex"><SponsorButton /></div>
          </div>
        </section>
      </div>

      <Footer className="border-t pt-2" />
    </article>
  );
}

// The art's drawing box (stretched to its place: a band that grows with About's width, and taller on a tall window),
// and a ridge's tallest swing in rows.
const W = 600, H = 160, PAD = 3, SWING = 2, SMOOTH = 3;

// One ridge per LLM at the table: its running chips over its own hands (cumulative_bb; each ridge spans the art), the
// leader on the top row, the rest down by chips. One square-root scale for all, so the small swings still show while a
// bigger lead still rises higher, and a moving average over SMOOTH points each side, so a ridge reads as its trend.
// Each ridge's fill hides the rows behind it.
function ridges(field: ModelStats[]) {
  const max = Math.max(1, ...field.flatMap(m => m.cumulative_bb.map(([, v]) => Math.abs(v))));
  const rows = field.map((m, i) => {
    const pts = m.cumulative_bb, last = pts.at(-1)?.[0] || 1;
    const ys = pts.map(([, v]) => i - Math.sign(v) * Math.sqrt(Math.abs(v) / max) * SWING);
    return pts.map(([h], j) => {
      const near = ys.slice(Math.max(0, j - SMOOTH), j + SMOOTH + 1);
      return [h / last, near.reduce((a, b) => a + b, 0) / near.length] as const;
    });
  });
  const ys = rows.flat().map(p => p[1]);
  const lo = Math.min(...ys), k = (H - 2 * PAD) / (Math.max(...ys) - lo || 1);
  return field.map((m, i) => {
    const line = rows[i].map(([t, y], j) => `${j ? 'L' : 'M'}${(t * W).toFixed(1)},${(PAD + (y - lo) * k).toFixed(1)}`).join('');
    return { name: m.name, color: modelColor(m.name), line, area: `${line}L${W},${H}L0,${H}Z` };
  });
}

// The race as data art, live from the stats: it draws in from the left once, when they arrive.
function RaceArt() {
  const { ref, field, failed } = useField();
  const reduce = useReducedMotion();
  const leader = field[0];
  return (
    <figure ref={ref} className="flex flex-col gap-2 min-w-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-[clamp(96px,11.5cqw,190px)] [@media(min-height:960px)]:h-[clamp(120px,14cqw,210px)]"
        role="img"
        aria-label={leader ? `The race so far: ${field.length} LLMs, ${leader.name} leading` : 'The race so far'}
      >
        {field.length > 0 && (
          <>
            <clipPath id="about-race-reveal">
              <motion.rect x={0} y={0} height={H} initial={{ width: reduce ? W : 0 }} animate={{ width: W }} transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }} />
            </clipPath>
            <g clipPath="url(#about-race-reveal)">
              {ridges(field).map(r => (
                <g key={r.name}>
                  <path d={r.area} style={{ fill: `color-mix(in srgb, ${r.color} 12%, white)` }} />
                  <path d={r.line} fill="none" stroke={r.color} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </g>
              ))}
            </g>
          </>
        )}
      </svg>
      <figcaption className="flex flex-col gap-0.5">
        <Label>{failed ? 'The race is not available right now.' : 'The race so far: each LLM’s running chips, the leader on top.'}</Label>
        {/* LLMLogo is a div: no <p> around it. Empty until the stats arrive, at the same height. */}
        <div className="flex items-center gap-1.5 min-w-0 min-h-[22px] whitespace-nowrap">
          {leader && (
            <>
              <LLMLogo model={leader.name} size={18} />
              <b translate="no" className="truncate">{leader.name}</b>
              <span className="shrink-0">leads with <b style={{ color: netColor(leader.net_chips) }}>{chips(leader.net_chips)}</b> chips, all time.</span>
            </>
          )}
        </div>
      </figcaption>
    </figure>
  );
}
