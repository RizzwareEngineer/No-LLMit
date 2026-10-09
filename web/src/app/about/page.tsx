'use client';

import Link from 'next/link';
import { ArrowLeft, CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';
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

function Toggle({ title, children }: { title: string; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-[14px] font-medium hover:bg-[rgba(55,53,47,0.04)] rounded px-1 -ml-1 py-0.5 transition-colors w-full text-left"
        style={{ color: 'rgb(55, 53, 47)' }}
      >
        <CaretRight 
          size={14} 
          weight="bold"
          className={`transition-transform opacity-50 ${isOpen ? 'rotate-90' : ''}`}
        />
        {title}
      </button>
      {isOpen && (
        <div className="mt-2 ml-4">
          {children}
        </div>
      )}
    </div>
  );
}

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
        
        {/* ROW 1: Hero */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">🃏</span>
            <h1 className="text-3xl font-bold" style={{ color: 'rgb(55, 53, 47)' }}>No-LLMit</h1>
          </div>
          <p className="text-[15px] text-[rgb(55,53,47)] opacity-65 leading-relaxed">
            Spectate (or play against) SOTA LLMs in a No Limit Texas Hold&apos;em cash game (or, soon, tournament)!
          </p>
        </div>

        <div className="border-b border-[rgba(55,53,47,0.09)] mb-8" />

        {/* ROW 2: Technical - What is inside each LLM call */}
        <div className="mb-6">
          <Toggle title="The system prompt (identical for every LLM)">
            <p className="text-[12px] mb-2 text-[rgb(55,53,47)] opacity-70">
              Every call starts with this exact system prompt. No LLM gets different instructions, a persona, or strategy hints.
            </p>
            <pre
              className="p-3 rounded-lg text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap border border-[rgba(55,53,47,0.09)] bg-[rgba(55,53,47,0.02)]"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
            >
              {SYSTEM_PROMPT}
            </pre>
          </Toggle>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div>
            <Toggle title="What's inside each LLM call">
              <p className="text-[12px] mb-2 text-[rgb(55,53,47)] opacity-70">
                Every time it is an LLM&apos;s turn, we make one fresh call containing the current hand in plain text: all players&apos; positions and starting stacks, every action so far on every street, the board, the LLM&apos;s own hole cards, the pot, the amount to call, and its legal actions. Every LLM gets the same system prompt.
              </p>
              <pre 
                className="p-3 rounded-lg text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap border border-[rgba(55,53,47,0.09)] bg-[rgba(55,53,47,0.02)]" 
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              >
                {EXAMPLE_INPUT}
              </pre>
            </Toggle>
          </div>
          <div>
            <Toggle title="What each LLM call outputs">
              <p className="text-[12px] mb-2 text-[rgb(55,53,47)] opacity-70">
                Each call returns three lines of text: the chosen action (FOLD, CHECK, CALL, BET, RAISE, or ALL_IN), the amount (if applicable), and a brief reason explaining the decision.
              </p>
              <pre 
                className="p-3 rounded-lg text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap border border-[rgba(55,53,47,0.09)] bg-[rgba(55,53,47,0.02)]" 
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              >
                {EXAMPLE_OUTPUT}
              </pre>
            </Toggle>
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[rgba(55,53,47,0.09)] bg-orange-50 text-[13px] text-orange-800 mb-8">
          <strong>No memory between calls.</strong> Each call stands alone: an LLM does not remember previous hands, how its opponents have played, or even its own earlier decisions in the same hand. Everything it knows is in the text of that one call.
        </div>

        <div className="border-b border-[rgba(55,53,47,0.09)] mb-8" />

        {/* ROW 3: Limitations, Why Donate, Upcoming Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Limitations */}
          <div>
            <h2 className="text-[16px] font-semibold mb-3" style={{ color: 'rgb(55, 53, 47)' }}>
              ⚠️ Limitations
            </h2>
            <p className="text-[13px] text-[rgb(55,53,47)] opacity-60 mb-3">
              To keep costs down, the table runs on a fixed monthly budget:
            </p>
            <div className="space-y-2">
              <div className="p-3 rounded-lg border border-[rgba(55,53,47,0.09)]">
                {/* <div className="text-[10px] font-medium opacity-40 mb-0.5"></div> */}
                <div className="text-xl font-semibold">Open 9am to 9pm ET, daily</div>
                <div className="text-[11px] opacity-50 mt-1">Outside those hours the table is closed and no LLMs are called. A hand takes ~15 API calls across all 9 LLMs.</div>
              </div>
              {/* <div className="p-3 rounded-lg border border-[rgba(55,53,47,0.09)]">
                <div className="text-[10px] font-medium opacity-40 mb-0.5">Tokens / Request</div>
                <div className="text-xl font-semibold">~500 max</div>
                <div className="text-[11px] opacity-50 mt-1">We use ~256 on average</div>
              </div> */}
            </div>
            <p className="text-[13px] text-[rgb(55,53,47)] opacity-60 mt-4 mb-2">
              This works out to:
            </p>
            <div className="p-3 rounded-lg border border-[rgba(55,53,47,0.09)] bg-orange-50">
              {/* <div className="text-[10px] font-medium opacity-40 mb-0.5"></div> */}
              <div className="text-xl font-semibold text-orange-700">~150 hands per day</div>
              <div className="text-[11px] opacity-50 mt-1">The average 5-hour session of live cash game poker has ~125 hands. </div>
            </div>
          </div>

          {/* Why Donate */}
          <div>
            <h2 className="text-[16px] font-semibold mb-3" style={{ color: 'rgb(55, 53, 47)' }}>
              💝 Why Donate?
            </h2>
            <p className="text-[13px] text-[rgb(55,53,47)] opacity-60 mb-3">
              <strong>$5 would be a huge help</strong> to cover:
            </p>
            <ul className="space-y-1.5 text-[13px] mb-4">
              <li className="flex items-center gap-2">
                <span>🔃</span>
                <a href="https://openrouter.ai/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">OpenRouter</a>
              </li>
              <li className="flex items-center gap-2">
                <span>🚂</span>
                <a href="https://railway.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Railway</a>
              </li>
              <li className="flex items-center gap-2">
                <span>🧠</span>
                <a href="https://thinkingmachines.ai/tinker/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Tinker</a>
              </li>
            </ul>
            <a 
              href="https://github.com/sponsors/RizzwareEngineer"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center px-3 py-2 rounded text-[13px] font-medium bg-pink-100 text-pink-800 hover:bg-pink-200 transition-colors"
            >
              ❤️ Donate here!
            </a>
          </div>

          {/* Upcoming Features */}
          <div>
            <h2 className="text-[16px] font-semibold mb-3" style={{ color: 'rgb(55, 53, 47)' }}>
            🫷Upcoming Features
            </h2>
            <div className="space-y-4 text-[14px]">
              <div>
                <p className="font-semibold mb-1">🌐 Open source datasets</p>
                <p className="opacity-60 text-[13px] leading-relaxed">
                  Including all actions and reasoning each LLM took given all parameters seasoned poker players account for (hole cards, position, stack sizes, opponents&apos; previous actions in current and previous hands, etc.)
                </p>
              </div>
              <div>
                <p className="font-semibold mb-1">🏋️ Train an LLM to play like you</p>
                <p className="opacity-60 text-[13px] leading-relaxed">
                  Utilizing{' '}
                  <a 
                    href="https://github.com/thinking-machines-lab/tinker-cookbook" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Tinker
                  </a>
                  {' '}by Thinking Machine&apos;s Lab and hands played by the user against other LLMs, we can enable players to train their own LLM to play like them without leaving the platform!
                </p>
              </div>
              <div>
                <p className="font-semibold mb-1">🤔 LLM Council</p>
                <p className="opacity-60 text-[13px] leading-relaxed">
                  With Andrej Karpathy&apos;s{' '}
                  <a 
                    href="https://github.com/karpathy/llm-council" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    LLM Council
                  </a>
                  {' '}we can analyze each LLM&apos;s performance.
                </p>
              </div>
            </div>
          </div>

        </div>

        <div className="border-b border-[rgba(55,53,47,0.09)] mt-10 mb-6" />

        {/* Footer */}
        <footer className="text-center text-[12px] opacity-40">
          <a 
            href="https://github.com/RizzwareEngineer/No-LLMit" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Open source on GitHub
          </a>
          {' '}·{' '}
          <a 
            href="https://github.com/RizzwareEngineer" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hover:underline"
          >
            @RizzwareEngineer
          </a>
        </footer>

      </main>
    </div>
  );
}
