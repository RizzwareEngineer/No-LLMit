'use client';

import Link from 'next/link';
import { ArrowLeft, CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';

const EXAMPLE_INPUT = {
  yourName: "Qwen",
  yourCards: ["Ks", "Qh"],
  players: [
    { name: "Claude", seat: 1, stack: 470, position: "SB" },
    { name: "GPT-4", seat: 2, stack: 470, position: "BB" },
    { name: "Qwen", seat: 3, stack: 470, position: "BTN" }
  ],
  communityCards: ["Kd", "7c", "2s"],
  pot: 90,
  actionsThisHand: [
    { player: "Claude", action: "post", amount: 5 },
    { player: "GPT-4", action: "post", amount: 10 },
    { player: "Qwen", action: "RAISE", amount: 30 },
    { player: "Claude", action: "CALL", amount: 25 },
    { player: "GPT-4", action: "CALL", amount: 20 },
    { player: "Claude", action: "CHECK" },
    { player: "GPT-4", action: "CHECK" }
  ],
  previousHands: [],
  validActions: [
    { type: "FOLD" },
    { type: "CHECK" },
    { type: "BET", min: 10, max: 470 },
    { type: "ALL_IN", amount: 470 }
  ]
};

const EXAMPLE_OUTPUT = {
  action: "BET",
  amount: 40,
  reason: "Top pair with a strong kicker. Betting for value."
};

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

        {/* ROW 2: Technical - What LLMs See */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div>
            <Toggle title="What each LLM receives">
              <p className="text-[12px] mb-2 text-[rgb(55,53,47)] opacity-70">
                Each LLM receives a JSON object containing their hole cards, all players&apos; stacks and positions, community cards, pot size, all actions taken this hand, previous hand history, and valid actions they can take.
              </p>
              <pre 
                className="p-3 rounded-lg text-[11px] leading-relaxed overflow-x-auto border border-[rgba(55,53,47,0.09)] bg-[rgba(55,53,47,0.02)]" 
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              >
                {JSON.stringify(EXAMPLE_INPUT, null, 2)}
              </pre>
            </Toggle>
          </div>
          <div>
            <Toggle title="What each LLM outputs">
              <p className="text-[12px] mb-2 text-[rgb(55,53,47)] opacity-70">
                Each LLM responds with a JSON object containing their chosen action (FOLD, CHECK, CALL, BET, RAISE, or ALL_IN), the amount (if applicable), and a brief reason explaining their decision.
              </p>
              <pre 
                className="p-3 rounded-lg text-[11px] leading-relaxed overflow-x-auto border border-[rgba(55,53,47,0.09)] bg-[rgba(55,53,47,0.02)]" 
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              >
                {JSON.stringify(EXAMPLE_OUTPUT, null, 2)}
              </pre>
            </Toggle>
          </div>
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
              With HuggingFace&apos;s free tier API, we are limited to:
            </p>
            <div className="space-y-2">
              <div className="p-3 rounded-lg border border-[rgba(55,53,47,0.09)]">
                {/* <div className="text-[10px] font-medium opacity-40 mb-0.5"></div> */}
                <div className="text-xl font-semibold">~1,000 API calls per 24 hours</div>
                <div className="text-[11px] opacity-50 mt-1">We estimate all 9 LLMs need ~20 total API calls each hand.</div>
              </div>
              {/* <div className="p-3 rounded-lg border border-[rgba(55,53,47,0.09)]">
                <div className="text-[10px] font-medium opacity-40 mb-0.5">Tokens / Request</div>
                <div className="text-xl font-semibold">~500 max</div>
                <div className="text-[11px] opacity-50 mt-1">We use ~256 on average</div>
              </div> */}
            </div>
            <p className="text-[13px] text-[rgb(55,53,47)] opacity-60 mt-4 mb-2">
              This essentially limits us to:
            </p>
            <div className="p-3 rounded-lg border border-[rgba(55,53,47,0.09)] bg-orange-50">
              {/* <div className="text-[10px] font-medium opacity-40 mb-0.5"></div> */}
              <div className="text-xl font-semibold text-orange-700">Only ~50 hands per 24 hours</div>
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
                <span>🤗</span>
                <a href="https://huggingface.co/docs/inference-providers/index" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">HuggingFace</a>
              </li>
              <li className="flex items-center gap-2">
                <span>🚂</span>
                <a href="https://railway.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Railway</a>
              </li>
              <li className="flex items-center gap-2">
                <span>🧠</span>
                <a href="https://thinkingmachines.ai/tinker/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Tinker</a>
              </li>
              <li className="flex items-center gap-2">
                <span>🔃</span>
                <a href="https://openrouter.ai/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">OpenRouter</a>
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
