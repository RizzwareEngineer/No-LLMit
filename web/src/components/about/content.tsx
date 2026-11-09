'use client';

import { ArrowUpRight, Heart, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import { RATE_FROM, series } from '@/components/CumulativeChart';
import { CARD, CARD_SHADOW, Segmented, TITLE } from '@/components/Section';
import { MIN_HANDS, MUTED, ModelStats, TEXT, netColor, seatedModels, signed, useStats } from '@/lib/stats';
import { EXAMPLE_REPLY, EXAMPLE_USER_PROMPT, SYSTEM_PROMPT } from '@/lib/systemPrompt';

// The About copy and its parts, shared by both drafts so each says exactly the same things (about-content-complete);
// a draft only arranges them. Every line is one sentence that fits its line at the drafts' widths (one sentence per line).

const BLUE = 'rgb(35, 131, 226)';
export const RULE = 'rgba(55, 53, 47, 0.16)'; // hairlines between sections
// A small uppercase label (13px muted, the stats' label size): a section's name, an eyebrow.
export const LABEL = 'text-[13px] leading-snug font-medium uppercase tracking-[0.08em]';

// The day the open dataset ships: one constant, so moving it is a one-word change.
const DATASET_DATE = 'Wednesday, Nov 18';

type Heading = 'h1' | 'h2' | 'h3';

// Secondary text: 13px muted, the stats cards' definition lines.
function Label({ as: Tag = 'p', className = '', children }: { as?: 'p' | 'li'; className?: string; children: React.ReactNode }) {
  return <Tag className={`text-[13px] leading-snug ${className}`} style={{ color: MUTED }}>{children}</Tag>;
}

export function Eyebrow() {
  return <p className={LABEL} style={{ color: MUTED }}>About No-LLMit</p>;
}

// The thesis: the drafts' first heading, at the site title's size (a little smaller in a phone-narrow draft, so it keeps to
// its line).
export function Thesis({ as: H }: { as: Heading }) {
  return <H className="text-[24px] @md:text-[28px] leading-[1.15] font-bold tracking-[-0.01em]">A pseudo benchmark for LLMs.</H>;
}

export function Intro() {
  return (
    <div className="flex flex-col gap-0.5">
      <p>Models play No-Limit Hold&apos;em against each other, live.</p>
      <p>You can watch every decision and the reasoning behind it.</p>
    </div>
  );
}

// The hours and the volume.
export const HOURS = '9am–9pm ET';
export const HANDS_A_DAY = 150;

// How a turn works: the same system prompt, one fresh call with the hand so far, a three-part reply.
const CALL = ['Seats', 'Stacks', 'The action', 'The board', 'Its cards', 'The pot', 'To call', 'Legal moves'];
export function How() {
  return (
    <div className="flex flex-col gap-2.5">
      <p>Every model gets the same system prompt.</p>
      <div className="flex flex-col gap-1.5">
        <p>Each turn is one fresh call with the hand so far:</p>
        <ul aria-label="What the call holds" className="flex flex-wrap gap-1">
          {CALL.map(c => (
            <li key={c} className="rounded px-1.5 text-[13px] leading-5" style={{ color: MUTED, background: 'rgba(55, 53, 47, 0.06)' }}>{c}</li>
          ))}
        </ul>
      </div>
      <p>It replies with an action, an amount and a short reason.</p>
      <PromptLinks />
    </div>
  );
}

// The caveats: each headline, then why.
const CAVEATS: [string, string][] = [
  ['No memory between calls.', 'No earlier hands, no notes: it can’t tag a nit or a fish.'],
  ['An illegal or unreadable reply gets one retry.', 'If that fails too, it checks if it can, otherwise folds.'],
  ['Poker is noisy.', `Under ${MIN_HANDS} hands, a win rate is mostly luck.`],
];

const NEXT: [string, string[]][] = [
  ['Playing against the LLMs.', ['The open-source models playing now are bad at poker.', 'So today it would be a weak game.']],
  [`An open-source dataset by ${DATASET_DATE}.`, ['Every hand, every decision and its reason.']],
];

// A headline in the body's weight, then its lines in muted 13px.
function Fact({ head, lines }: { head: string; lines: string[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="font-semibold">{head}</p>
      {lines.map(l => <Label key={l}>{l}</Label>)}
    </div>
  );
}

export function Caveats() {
  return <div className="flex flex-col gap-2.5">{CAVEATS.map(([h, l]) => <Fact key={h} head={h} lines={[l]} />)}</div>;
}

export function Next() {
  return <div className="flex flex-col gap-2.5">{NEXT.map(([h, l]) => <Fact key={h} head={h} lines={l} />)}</div>;
}

// The main ask: a stats card with the screen's only filled button (about-support-prominent).
const SPONSORS = 'https://github.com/sponsors/RizzwareEngineer';
export function Support({ as: H, className = '' }: { as: Heading; className?: string }) {
  return (
    <section data-support className={`${CARD} relative gap-3 ${className}`} style={{ boxShadow: CARD_SHADOW }}>
      <H className={TITLE}>Keep the table running</H>
      <div className="flex flex-col gap-0.5">
        <p>Donations pay for the OpenRouter model calls and the servers.</p>
        <Label>$5 is a huge help.</Label>
      </div>
      <a
        data-donate
        href={SPONSORS}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start flex items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-semibold text-white shadow-sm hover:brightness-110 transition-[filter]"
        style={{ background: BLUE }}
      >
        <Heart size={16} weight="fill" aria-hidden />
        Sponsor on GitHub
        <ArrowUpRight size={14} weight="bold" aria-hidden />
      </a>
    </section>
  );
}

// A link out, in the site's link blue.
function Out({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: BLUE }}>{children}</a>;
}

// The last row: the repo and the handle, centred; the draft switcher (About.tsx) sits at its right end, so the row is at
// least as tall as the switcher.
export function Footer({ className = '' }: { className?: string }) {
  return (
    <footer className={`text-[13px] ${className}`} style={{ color: MUTED }}>
      <p className="min-h-[29px] flex items-center justify-center text-center">
        <span>
          <Out href="https://github.com/RizzwareEngineer/No-LLMit">Open source on GitHub</Out>
          {' · '}
          <Out href="https://github.com/RizzwareEngineer">@RizzwareEngineer</Out>
        </span>
      </p>
    </footer>
  );
}

// The prompts, as code.
function Code({ children }: { children: string }) {
  return (
    <pre className="p-3 rounded-lg text-[12px] leading-relaxed overflow-x-auto whitespace-pre-wrap" style={{ background: 'rgba(55, 53, 47, 0.04)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
      {children}
    </pre>
  );
}

// "Read the system prompt" and "See one turn": the real prompt text (lib/systemPrompt.ts, never copied here) in a modal
// <dialog> over the page, so opening it never changes About's size (the page leaves wheel and keys inside a dialog alone).
type View = 'prompt' | 'turn';
const VIEWS: { label: string; value: View }[] = [{ label: 'System prompt', value: 'prompt' }, { label: 'One turn', value: 'turn' }];

export function PromptLinks() {
  const [view, setView] = useState<View | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (view && !d?.open) d?.showModal();
    if (!view && d?.open) d.close();
  }, [view]);
  const close = () => setView(null);
  return (
    <>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {VIEWS.map(v => (
          <button
            key={v.value}
            onClick={() => setView(v.value)}
            aria-haspopup="dialog"
            aria-expanded={view === v.value}
            className="font-medium hover:underline"
            style={{ color: BLUE }}
          >
            {v.value === 'prompt' ? 'Read the system prompt' : 'See one turn'}
          </button>
        ))}
      </div>
      <dialog
        ref={ref}
        aria-labelledby="about-prompt-title"
        onClose={close}
        onClick={e => e.target === e.currentTarget && close()} // the backdrop
        className="m-auto p-0 border-0 w-[min(760px,calc(100vw-32px))] max-w-none max-h-[min(86dvh,960px)] rounded-lg bg-white backdrop:bg-[rgba(15,15,15,0.3)] max-md:mb-0 max-md:w-screen max-md:rounded-b-none"
        style={{ color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0 0 0 1px, rgba(15, 15, 15, 0.2) 0 8px 24px' }}
      >
        <div className="flex flex-col max-h-[inherit] text-[14px] leading-snug">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3 border-b" style={{ borderColor: RULE }}>
            <h2 id="about-prompt-title" className={TITLE}>{view === 'turn' ? 'One turn' : 'The system prompt'}</h2>
            <div className="flex items-center gap-3">
              <Segmented label="Show" options={VIEWS} value={view ?? 'prompt'} onChange={setView} />
              <button onClick={close} aria-label="Close" className="p-1.5 -m-1 rounded hover:bg-[rgba(55,53,47,0.06)]">
                <X size={18} aria-hidden />
              </button>
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4 flex flex-col gap-2">
            {view === 'turn' ? (
              <>
                <p className="font-semibold">The call</p>
                <Label>The hand so far, sent after the system prompt.</Label>
                <Code>{EXAMPLE_USER_PROMPT}</Code>
                <p className="mt-2 font-semibold">The reply</p>
                <Label>An action, an amount and a short reason.</Label>
                <Code>{EXAMPLE_REPLY}</Code>
              </>
            ) : (
              <>
                <Label>Every model gets this exact system prompt at the start of every call.</Label>
                <Code>{SYSTEM_PROMPT}</Code>
              </>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}

// The LLMs at the table now with their all-time stats, ranked by bb/100: those with MIN_HANDS or more first (below that a
// win rate is mostly luck, so they never lead). Fetched once About first comes near the window (the home page loads it
// under the overview, which has its own copy). `ref` goes on the element that waits for it.
const ranked = (ms: ModelStats[]) =>
  [...ms].sort((a, b) => Number(b.hands >= MIN_HANDS) - Number(a.hands >= MIN_HANDS) || b.bb100 - a.bb100);

function useField() {
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref, { once: true, margin: '0px 0px 300px 0px' });
  const { data, error } = useStats(undefined, seen);
  const field = useMemo(() => (data ? ranked(seatedModels(data.models, data.seated).filter(m => m.hands > 0)) : []), [data]);
  return { ref, field, failed: !data && !!error };
}

// The drawing box (stretched to the figure), and the ridges' shape: a swing as big as the field's 90th percentile is about
// one row tall, and none goes past SWING rows (a tanh: linear while small, so a line ends smoothly on its row); a moving
// average over SMOOTH points each side; PAD units clear at the top and bottom.
const W = 600, H = 300, SWING = 1.6, SMOOTH = 2, PAD = 3;

// One ridge per LLM: its running bb/100 over its own hands (from RATE_FROM, as Profiles' sparkline), each spanning the
// art, drawn about its latest value so it ends on its row, where its logo sits: the leader on the top row. One scale for
// all, so a calm line stays calm beside a wild one; the rows' extent fills the box (no empty band above or below). Each
// ridge's fill (the page's colour, faintly tinted) hides the rows behind it.
function ridges(field: ModelStats[]) {
  const traces = field.map(m => {
    const pts = series(m, 'bb100').filter(([h]) => h >= RATE_FROM);
    if (pts.length < 2) return [];
    const [h0] = pts[0], [h1, now] = pts.at(-1)!;
    return pts.map(([h], j) => {
      const near = pts.slice(Math.max(0, j - SMOOTH), j + SMOOTH + 1);
      return [(h - h0) / (h1 - h0), j === pts.length - 1 ? 0 : near.reduce((a, p) => a + p[1], 0) / near.length - now] as const;
    });
  });
  const swings = traces.flat().map(p => Math.abs(p[1])).sort((a, b) => a - b);
  const s = swings[Math.floor(swings.length * 0.9)] || 1;
  // In rows (row i's line ends at i), then fitted to the box.
  const rows = traces.map((tr, i) => tr.map(([t, d]) => [t * W, i - SWING * Math.tanh((0.75 * d) / s)] as const));
  const ys = rows.flat().map(p => p[1]).concat(field.map((_, i) => i));
  const lo = Math.min(...ys), k = (H - 2 * PAD) / (Math.max(...ys) - lo || 1), at = (y: number) => PAD + (y - lo) * k;
  return field.map((m, i) => {
    const line = rows[i].map(([x, y], j) => `${j ? 'L' : 'M'}${x.toFixed(1)},${at(y).toFixed(1)}`).join('');
    return { m, y: at(i) / H, color: modelColor(m.name), line, area: line && `${line}L${W},${H}L0,${H}Z` };
  });
}

// The race: live art from the stats, drawn in from the left once they arrive, and a caption naming the leader in bb/100
// among the LLMs with MIN_HANDS or more. `art` sizes the drawing (its height); the logos sit in a gutter at its right.
export function Race({ art, className = '' }: { art: string; className?: string }) {
  const { ref, field, failed } = useField();
  const reduce = useReducedMotion();
  const rows = useMemo(() => ridges(field), [field]);
  const leader = field[0]?.hands >= MIN_HANDS ? field[0] : undefined;
  return (
    <figure ref={ref} data-race className={`flex flex-col gap-2.5 min-w-0 ${className}`}>
      <div className={`relative ${art}`}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute top-0 left-0 h-full w-[calc(100%-28px)]"
          role="img"
          aria-label={`Running bb/100 of each LLM at the table${leader ? `; ${leader.name} leads with ${signed(leader.bb100, 0)} bb/100` : ''}`}
        >
          {rows.length > 0 && (
            <>
              <clipPath id="about-race-reveal">
                <motion.rect x={0} y={0} height={H} initial={{ width: reduce ? W : 0 }} animate={{ width: W }} transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }} />
              </clipPath>
              <g clipPath="url(#about-race-reveal)">
                {rows.map(r => (
                  <g key={r.m.name} data-model={r.m.name}>
                    <title>{`${r.m.name}: ${signed(r.m.bb100, 0)} bb/100 over ${r.m.hands.toLocaleString()} hands`}</title>
                    <path d={r.area} style={{ fill: `color-mix(in srgb, ${r.color} 4%, var(--page))` }} />
                    <path d={r.line} fill="none" stroke={r.color} strokeWidth={r.m === leader ? 2 : 1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </g>
                ))}
              </g>
            </>
          )}
        </svg>
        {/* Each row's logo where its ridge ends, top to bottom in rank order (about-bb100). */}
        {rows.map((r, i) => (
          <motion.div
            key={r.m.name}
            data-race-row={r.m.name}
            title={`${r.m.name}: ${signed(r.m.bb100, 0)} bb/100 over ${r.m.hands.toLocaleString()} hands`}
            initial={{ opacity: reduce ? 1 : 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduce ? 0 : 0.6 + i * 0.05, duration: 0.3 }}
            className="absolute right-0 -translate-y-1/2"
            style={{ top: `${r.y * 100}%` }}
          >
            <LLMLogo model={r.m.name} size={20} />
          </motion.div>
        ))}
      </div>
      <figcaption className="flex flex-col gap-1">
        <Label>{failed ? 'The race is not available right now.' : 'Running bb/100 of each LLM at the table, best on top.'}</Label>
        {/* LLMLogo is a div: no <p> around it. Empty until the stats arrive, at the same height. */}
        <div className="flex items-center gap-1.5 min-w-0 min-h-[22px] whitespace-nowrap">
          {leader ? (
            <>
              <LLMLogo model={leader.name} size={18} />
              <b translate="no" className="truncate">{leader.name}</b>
              <span className="shrink-0">leads with <b style={{ color: netColor(leader.bb100) }}>{signed(leader.bb100, 0)}</b> bb/100 over {leader.hands.toLocaleString()} hands.</span>
            </>
          ) : field.length > 0 && <span>No LLM has played {MIN_HANDS} hands yet.</span>}
        </div>
        {leader && field.some(m => m.hands < MIN_HANDS) && <Label>LLMs with fewer than {MIN_HANDS} hands rank below the rest.</Label>}
      </figcaption>
    </figure>
  );
}
