'use client';

import { ArrowUpRight, CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';
import { CARD, CARD_SHADOW, HEADER, NEXT_STYLE, TITLE } from '@/components/Section';
import { MUTED, TEXT } from '@/lib/stats';
import { SYSTEM_PROMPT } from '@/lib/systemPrompt';

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

const BLUE = 'rgb(35, 131, 226)';

// A link out, in the site's link blue.
function Out({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: BLUE }}>{children}</a>;
}

// Secondary text: 13px muted, the stats cards' definition lines.
function Label({ as: Tag = 'p', children }: { as?: 'p' | 'li'; children: React.ReactNode }) {
  return <Tag className="text-[13px] leading-snug" style={{ color: MUTED }}>{children}</Tag>;
}

// The prompt and the example call, as code.
function Code({ children }: { children: string }) {
  return (
    <pre className="p-3 rounded-lg text-[12px] leading-relaxed overflow-x-auto whitespace-pre-wrap" style={{ background: 'rgba(55, 53, 47, 0.04)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
      {children}
    </pre>
  );
}

function Toggle({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1 w-full rounded px-1 -ml-1 py-0.5 text-left font-medium hover:bg-[rgba(55,53,47,0.04)] transition-colors"
      >
        <CaretRight size={14} weight="bold" aria-hidden className={`opacity-50 transition-transform ${open ? 'rotate-90' : ''}`} />
        {title}
      </button>
      {open && <div className="mt-1 mb-2 ml-[18px] flex flex-col gap-2">{children}</div>}
    </div>
  );
}

// One card: the stats cards' chrome and title, body text at 14px.
function Card({ title, as: H = 'h2', className = '', children }: { title: string; as?: 'h1' | 'h2'; className?: string; children: React.ReactNode }) {
  return (
    <div className={`${CARD} relative ${className}`} style={{ boxShadow: CARD_SHADOW }}>
      <div className={HEADER}>
        <H className={TITLE} style={{ color: TEXT }}>{title}</H>
      </div>
      <div className="flex flex-col gap-1 text-[14px] leading-snug" style={{ color: TEXT }}>{children}</div>
    </div>
  );
}

// The About content: the /about page, and the home page's last screen (where the page's own h1 is the title, so the
// first card's title is an h2). Its parent sets the width (the stats overview's block on the home page). Two columns
// of about equal height, so every card hugs its text (no row stretching a short card), then Coming next across both.
export default function About({ heading = 'h1' }: { heading?: 'h1' | 'h2' }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 md:items-start">
      <div className="flex flex-col gap-3">
        <Card title="About No-LLMit" as={heading}>
          <p>Watch SOTA LLMs play a No Limit Texas Hold&apos;em cash game against each other, live.</p>
          <p>Each one explains its move as it plays.</p>
          <Label>Playing against them, and tournaments, are coming soon.</Label>
        </Card>

        <Card title="Every LLM call">
          <p>Each turn is one fresh call, with the hand so far in plain text.</p>
          <p>Every LLM gets the same system prompt.</p>
          <div className="my-1">
            <Toggle title="The system prompt">
              <Label>Every call starts with this exact prompt: no persona, no strategy hints.</Label>
              <Code>{SYSTEM_PROMPT}</Code>
            </Toggle>
            <Toggle title="What goes into each call">
              <Label>
                Every player&apos;s position and starting stack, every action on every street, the board, the LLM&apos;s own hole
                cards, the pot, the amount to call and its legal actions.
              </Label>
              <Code>{EXAMPLE_INPUT}</Code>
            </Toggle>
            <Toggle title="What each call returns">
              <Label>Three lines: the action (FOLD, CHECK, CALL, BET, RAISE or ALL_IN), the amount if any, and a short reason.</Label>
              <Code>{EXAMPLE_OUTPUT}</Code>
            </Toggle>
          </div>
          <p className="font-semibold">No memory between calls.</p>
          <Label>An LLM never sees earlier hands, how its opponents played, or its own earlier decisions in the hand.</Label>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <Card title="Limitations">
          <p className="font-semibold">Open 9am to 9pm ET, daily.</p>
          <Label>Outside those hours the table is closed and no LLMs are called.</Label>
          <p className="mt-2 font-semibold">About 150 hands per day.</p>
          <Label>The table runs on a fixed monthly budget.</Label>
          <Label>A hand takes about 15 API calls across all 9 LLMs.</Label>
          <Label>A 5-hour live cash game session has about 125 hands.</Label>
        </Card>

        <Card title="Donate">
          <p>$5 would be a huge help to cover:</p>
          <ul className="flex flex-col gap-1">
            <Label as="li"><Out href="https://openrouter.ai/">OpenRouter</Out>, the LLM calls</Label>
            <Label as="li"><Out href="https://railway.com">Railway</Out>, the servers</Label>
            <Label as="li"><Out href="https://thinkingmachines.ai/tinker/">Tinker</Out>, training LLMs to play like you</Label>
          </ul>
          <a
            href="https://github.com/sponsors/RizzwareEngineer"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 self-start flex items-center gap-1.5 rounded-full border px-4 py-1.5 font-medium bg-white hover:bg-[rgba(55,53,47,0.04)] shadow-sm"
            style={{ borderColor: NEXT_STYLE.borderColor, color: BLUE }}
          >
            Donate on GitHub Sponsors <ArrowUpRight size={14} weight="bold" aria-hidden />
          </a>
        </Card>
      </div>

      <Card title="Coming next" className="md:col-span-2">
        <ul className="grid gap-x-6 gap-y-3 md:grid-cols-3">
          <li className="flex flex-col gap-1">
            <p className="font-semibold">Open source datasets</p>
            <Label>Every action and reason each LLM gave, with what seasoned players weigh: hole cards, position, stacks and earlier actions.</Label>
          </li>
          <li className="flex flex-col gap-1">
            <p className="font-semibold">Train an LLM to play like you</p>
            <Label>
              Using <Out href="https://github.com/thinking-machines-lab/tinker-cookbook">Tinker</Out> by Thinking Machines Lab and
              your hands against the LLMs, without leaving the site.
            </Label>
          </li>
          <li className="flex flex-col gap-1">
            <p className="font-semibold">LLM Council</p>
            <Label>
              Andrej Karpathy&apos;s <Out href="https://github.com/karpathy/llm-council">LLM Council</Out> will analyze how each LLM plays.
            </Label>
          </li>
        </ul>
      </Card>

      <footer className="md:col-span-2 pt-1 text-center text-[13px]" style={{ color: MUTED }}>
        <Out href="https://github.com/RizzwareEngineer/No-LLMit">Open source on GitHub</Out>
        {' · '}
        <Out href="https://github.com/RizzwareEngineer">@RizzwareEngineer</Out>
      </footer>
    </div>
  );
}
