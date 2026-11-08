'use client';

import { ArrowUpRight, CaretRight } from '@phosphor-icons/react';
import { useMemo, useRef } from 'react';
import { useInView } from 'motion/react';
import { NEXT_STYLE, pageBy } from '@/components/Section';
import { MUTED, seatedModels, useStats } from '@/lib/stats';
import { SYSTEM_PROMPT } from '@/lib/systemPrompt';

// The About copy and its small parts, shared by every draft so each one says exactly the same things
// (about-content-complete); a draft only arranges them.

export const BLUE = 'rgb(35, 131, 226)';
export const RULE = 'rgba(55, 53, 47, 0.16)'; // hairlines between sections
// A small uppercase label (13px muted, the stats' label size): a section's name, an eyebrow.
export const LABEL = 'text-[13px] leading-snug font-medium uppercase tracking-[0.08em]';
// Prose never runs wider than a readable measure, however wide About gets: the width goes to columns and visuals.
export const PROSE = 'max-w-[70ch]';

// The thesis (the drafts' first heading), one sentence per line: the size of the site's title, a little smaller in a
// phone-narrow draft (an @container) so each sentence keeps to its line.
export function Thesis({ as: H }: { as: 'h1' | 'h2' }) {
  return (
    <H className="text-[24px] @md:text-[28px] leading-[1.15] font-bold tracking-[-0.01em]">
      <span className="block">Nine LLMs, one table.</span>
      <span className="block">Every decision in the open.</span>
    </H>
  );
}

export function Intro() {
  return (
    <>
      <p>Watch SOTA LLMs play a No Limit Texas Hold&apos;em cash game against each other, live.</p>
      <p>Each one explains its move as it plays.</p>
    </>
  );
}

const EXAMPLE_INPUT = `Hand #12. No Limit Texas Hold'em cash game, blinds 5/10, 3 players.

Seats (stack at start of hand):
SB: Claude (500)
BB: GPT-4 (500)
BTN: Qwen (500)

Preflop: Claude posts small blind 5, GPT-4 posts big blind 10, Qwen raises to 30, Claude calls 25, GPT-4 calls 20
Flop [Kd 7c 2s] (pot 90): Claude checks, GPT-4 checks

You are Qwen, in the BTN. Your hole cards: Ks Qh.
Pot: 90. To call: 0. Your stack: 470.
Still in the hand: Claude (SB, 470 behind), GPT-4 (BB, 470 behind).

Legal actions:
- FOLD
- CHECK
- BET: AMOUNT is your total bet this street, between 10 and 470
- ALL_IN (470 total this street)`;

const EXAMPLE_OUTPUT = `ACTION: BET
AMOUNT: 40
REASON: Top pair with a strong kicker. Betting for value.`;

// A link out, in the site's link blue.
export function Out({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: BLUE }}>{children}</a>;
}

// Secondary text: 13px muted, the stats cards' definition lines.
export function Label({ as: Tag = 'p', children }: { as?: 'p' | 'li'; children: React.ReactNode }) {
  return <Tag className="text-[13px] leading-snug" style={{ color: MUTED }}>{children}</Tag>;
}

// The prompt and the example call, as code.
export function Code({ children }: { children: string }) {
  return (
    <pre className="p-3 rounded-lg text-[12px] leading-relaxed overflow-x-auto whitespace-pre-wrap" style={{ background: 'rgba(55, 53, 47, 0.04)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
      {children}
    </pre>
  );
}

// What an LLM call holds: the prompt every call starts with, what goes in, what comes back.
export const PANELS = [
  { id: 'prompt', title: 'The system prompt', note: 'Every call starts with this exact prompt: no persona, no strategy hints.', code: SYSTEM_PROMPT },
  {
    id: 'input',
    title: 'What goes into each call',
    note: "Every player's position and starting stack, every action on every street, the board, the LLM's own hole cards, the pot, the amount to call and its legal actions.",
    code: EXAMPLE_INPUT,
  },
  { id: 'output', title: 'What each call returns', note: 'Three lines: the action (FOLD, CHECK, CALL, BET, RAISE or ALL_IN), the amount if any, and a short reason.', code: EXAMPLE_OUTPUT },
] as const;
export type PanelId = (typeof PANELS)[number]['id'];

export function PanelBody({ id }: { id: PanelId }) {
  const p = PANELS.find(x => x.id === id)!;
  return (
    <>
      <Label>{p.note}</Label>
      <Code>{p.code}</Code>
    </>
  );
}

// A disclosure's button: a caret that turns as it opens.
export function Opener({ open, onClick, children }: { open: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      className="flex items-center gap-1 rounded px-1 -ml-1 py-0.5 text-left font-medium hover:bg-[rgba(55,53,47,0.04)] transition-colors"
    >
      <CaretRight size={14} weight="bold" aria-hidden className={`opacity-50 transition-transform ${open ? 'rotate-90' : ''}`} />
      {children}
    </button>
  );
}

// The three panels as one group, one open at a time: their buttons in a row (PanelButtons), the open one's text and code
// under them (CallPanels), or wherever the draft puts it.
type Panels = { open: PanelId | null; onOpen: (id: PanelId | null) => void };
export function PanelButtons({ open, onOpen }: Panels) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1">
      {PANELS.map(p => (
        <Opener key={p.id} open={open === p.id} onClick={() => onOpen(open === p.id ? null : p.id)}>{p.title}</Opener>
      ))}
    </div>
  );
}

export function CallPanels(props: Panels) {
  return (
    <div className="flex flex-col gap-2">
      <PanelButtons {...props} />
      {props.open && <PanelBody id={props.open} />}
    </div>
  );
}

// The limits, as the Limitations card states them: each headline in bold, then why.
export const LIMITS = [
  { head: 'Open 9am to 9pm ET, daily.', lines: ['Outside those hours the table is closed and no LLMs are called.'] },
  {
    head: 'About 150 hands per day.',
    lines: ['The table runs on a fixed monthly budget.', 'A hand takes about 15 API calls across all 9 LLMs.', 'A 5-hour live cash game session has about 125 hands.'],
  },
];
export const MEMORY = { head: 'No memory between calls.', lines: ['An LLM never sees earlier hands, how its opponents played, or its own earlier decisions in the hand.'] };

export function Fact({ head, lines }: { head: string; lines: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold">{head}</p>
      {lines.map(l => <Label key={l}>{l}</Label>)}
    </div>
  );
}

export const COMING_SOON = 'Playing against them, and tournaments, are coming soon.';

// What a donation pays for, and where to give.
export function DonateTargets() {
  return (
    <ul className="flex flex-col gap-1">
      <Label as="li"><Out href="https://openrouter.ai/">OpenRouter</Out>, the LLM calls</Label>
      <Label as="li"><Out href="https://railway.com">Railway</Out>, the servers</Label>
      <Label as="li"><Out href="https://thinkingmachines.ai/tinker/">Tinker</Out>, training LLMs to play like you</Label>
    </ul>
  );
}

// A pill in the site's link blue (the Donate button's style): a link out, or a button.
export const PILL = 'flex items-center gap-1.5 rounded-full border px-4 py-1.5 font-medium bg-white hover:bg-[rgba(55,53,47,0.04)] shadow-sm';
export const PILL_STYLE = { borderColor: NEXT_STYLE.borderColor, color: BLUE };

export function SponsorButton() {
  return (
    <a href="https://github.com/sponsors/RizzwareEngineer" target="_blank" rel="noopener noreferrer" className={`self-start ${PILL}`} style={PILL_STYLE}>
      Donate on GitHub Sponsors <ArrowUpRight size={14} weight="bold" aria-hidden />
    </a>
  );
}

export const NEXT: { title: string; body: React.ReactNode }[] = [
  { title: 'Open source datasets', body: 'Every action and reason each LLM gave, with what seasoned players weigh: hole cards, position, stacks and earlier actions.' },
  {
    title: 'Train an LLM to play like you',
    body: <>Using <Out href="https://github.com/thinking-machines-lab/tinker-cookbook">Tinker</Out> by Thinking Machines Lab and your hands against the LLMs, without leaving the site.</>,
  },
  { title: 'LLM Council', body: <>Andrej Karpathy&apos;s <Out href="https://github.com/karpathy/llm-council">LLM Council</Out> will analyze how each LLM plays.</> },
];

// The last row: the repo and the handle, centred; the draft switcher (About.tsx) sits at its right end, so the row
// (inside any rule and padding the draft gives the footer) is at least as tall as the switcher.
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

// The LLMs at the table now with their all-time stats, best first by chips: fetched once About first comes near the
// window (the home page loads it under the overview, which has its own copy). `ref` goes on the element that waits for it.
export function useField() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: '0px 0px 300px 0px' });
  const { data, error } = useStats(undefined, seen);
  const field = useMemo(
    () => (data ? seatedModels(data.models, data.seated).filter(m => m.hands > 0).sort((a, b) => b.net_chips - a.net_chips) : []),
    [data],
  );
  return { ref, field, seated: data?.seated, failed: !data && !!error };
}

// From About to the table screen: one page up lands on the overview, a second steps on from where the first is headed.
export const toTable = () => { pageBy(-1); pageBy(-1); };
