'use client';

import { ArrowUp, CaretDown } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import { CARD, CARD_SHADOW, HEADER, TITLE, pageBy } from '@/components/Section';
import { MUTED, ModelStats, TEXT, chips, netColor, signed } from '@/lib/stats';
import {
  BLUE, COMING_SOON, CallPanels, DonateTargets, Fact, Footer, Intro, LABEL, LIMITS, Label, MEMORY, NEXT, PILL, PILL_STYLE, PROSE, PanelId, RULE, SponsorButton,
  Thesis, toTable, useField,
} from '@/components/about/content';

// Draft B, "arena page" (Kaggle's Game Arena): a hero band with the thesis, two buttons and the table as an
// illustration, then a live leaderboard beside the questions people ask, each opening its answer.

const QUESTIONS = [
  { id: 'turn', q: 'How does a turn work?' },
  { id: 'memory', q: 'Do the LLMs remember earlier hands?' },
  { id: 'hours', q: 'Why only 9am–9pm?' },
  { id: 'donate', q: 'What does a donation pay for?' },
  { id: 'next', q: 'What’s next?' },
] as const;
type Question = (typeof QUESTIONS)[number]['id'];

const TOP = 5; // leaderboard rows
const plain = (e: React.MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export default function ArenaPage({ heading }: { heading: 'h1' | 'h2' }) {
  const home = heading === 'h2'; // the home page's last screen (whose page title is the table's), not /about
  const Sub = home ? 'h3' : 'h2';
  const [open, setOpen] = useState<Question | null>(null);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [jump, setJump] = useState(0);
  const turn = useRef<HTMLLIElement>(null);
  const { ref, field, seated, failed } = useField();
  const top = Array.from({ length: TOP }, (_, i) => field[i]); // empty rows hold the card's height until the stats arrive

  // "Read the system prompt" opens it under its question and brings it into view (inside About's own scroll on the home page).
  useEffect(() => {
    if (jump) turn.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [jump]);

  const answer = (id: Question) => {
    switch (id) {
      case 'turn':
        return (
          <>
            <p>Each turn is one fresh call, with the hand so far in plain text.</p>
            <p>Every LLM gets the same system prompt.</p>
            <div className="mt-1"><CallPanels open={panel} onOpen={setPanel} /></div>
          </>
        );
      case 'memory':
        return <Fact {...MEMORY} />;
      case 'hours':
        return <div className="flex flex-col gap-3">{LIMITS.map(l => <Fact key={l.head} {...l} />)}</div>;
      case 'donate':
        return (
          <>
            <p>$5 would be a huge help to cover:</p>
            <DonateTargets />
            <div className="mt-2 flex"><SponsorButton /></div>
          </>
        );
      case 'next':
        return (
          <div className="flex flex-col gap-3">
            <Label>{COMING_SOON}</Label>
            {NEXT.map(n => (
              <div key={n.title} className="flex flex-col gap-1">
                <p className="font-semibold">{n.title}</p>
                <Label>{n.body}</Label>
              </div>
            ))}
          </div>
        );
    }
  };

  return (
    <div className="@container flex flex-col gap-3 text-[14px] leading-snug" style={{ color: TEXT }}>
      <section ref={ref} className={`${CARD} md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:gap-4`} style={{ boxShadow: CARD_SHADOW }}>
        <div className={`flex flex-col gap-3 p-2 md:py-3 ${PROSE}`}>
          <p className={LABEL} style={{ color: MUTED }}>About No-LLMit</p>
          <Thesis as={heading} />
          <div className="flex flex-col gap-1">
            <Intro />
            <Label>{COMING_SOON}</Label>
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <Link href="/" onClick={e => { if (home && plain(e)) { e.preventDefault(); toTable(); } }} className={PILL} style={PILL_STYLE}>
              Watch the table <ArrowUp size={14} weight="bold" aria-hidden />
            </Link>
            <button onClick={() => { setOpen('turn'); setPanel('prompt'); setJump(j => j + 1); }} className={PILL} style={PILL_STYLE}>
              Read the system prompt
            </button>
          </div>
        </div>
        <Seats names={seated ?? field.map(m => m.name)} failed={failed} />
      </section>

      <div className="grid gap-3 md:grid-cols-2 md:items-start">
        <section className={`${CARD} @container`} style={{ boxShadow: CARD_SHADOW }}>
          <div className={HEADER}>
            <Sub className={TITLE}>Leaderboard</Sub>
            {home && <button onClick={() => pageBy(-1)} className="text-[14px] font-medium hover:underline" style={{ color: BLUE }}>Open the stats ↑</button>}
          </div>
          <table className="w-full tabular-nums">
            <thead>
              <tr className="text-[13px] text-right" style={{ color: MUTED }}>
                <th className="w-6 pb-1 text-left font-normal">#</th>
                <th className="pb-1 text-left font-normal">Model</th>
                <th className="hidden @lg:table-cell pb-1 pl-4 text-left font-normal">Running chips</th>
                <th className="pb-1 pl-3 font-normal">Chips</th>
                <th className="hidden @sm:table-cell pb-1 pl-3 font-normal">bb/100</th>
                <th className="pb-1 pl-3 font-normal">Hands</th>
              </tr>
            </thead>
            <tbody>
              {top.map((m, i) => (
                <tr key={m?.name ?? i} className="border-t text-right" style={{ borderColor: RULE }}>
                  <td className="py-1.5 text-left text-[13px]" style={{ color: MUTED }}>{m ? i + 1 : '\u00a0'}</td>
                  <th scope="row" className="py-1.5 text-left font-bold">
                    {m && (
                      <span className="flex items-center gap-2 min-w-0">
                        <LLMLogo model={m.name} size={18} />
                        <span translate="no" className="truncate">{m.name}</span>
                      </span>
                    )}
                  </th>
                  <td className="hidden @lg:table-cell w-[32%] py-1.5 pl-4">{m && <Spark m={m} />}</td>
                  <td className="py-1.5 pl-3 font-bold" style={{ color: m ? netColor(m.net_chips) : undefined }}>{m ? chips(m.net_chips) : '\u00a0'}</td>
                  <td className="hidden @sm:table-cell py-1.5 pl-3">{m ? signed(m.bb100, 0) : ''}</td>
                  <td className="py-1.5 pl-3">{m ? m.hands.toLocaleString() : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2">
            <Label>{failed ? 'The stats are not available right now.' : 'All time, the LLMs at the table now, by chips.'}</Label>
          </div>
        </section>

        <section className={CARD} style={{ boxShadow: CARD_SHADOW }}>
          <div className={HEADER}>
            <Sub className={TITLE}>Questions</Sub>
          </div>
          <ul>
            {QUESTIONS.map(({ id, q }) => (
              <li key={id} ref={id === 'turn' ? turn : undefined} className="border-t first:border-t-0" style={{ borderColor: RULE }}>
                <button
                  onClick={() => setOpen(open === id ? null : id)}
                  aria-expanded={open === id}
                  className="flex w-full items-center justify-between gap-3 py-2 text-left font-medium hover:bg-[rgba(55,53,47,0.04)] rounded px-1 -mx-1"
                >
                  {q}
                  <CaretDown size={14} weight="bold" aria-hidden className={`shrink-0 opacity-50 transition-transform ${open === id ? 'rotate-180' : ''}`} />
                </button>
                {open === id && <div className={`pb-3 flex flex-col gap-1 ${PROSE}`}>{answer(id)}</div>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Footer />
    </div>
  );
}

// A row's running chips (cumulative_bb: the same shape in big blinds) over its own hands, about its zero line, scaled to
// its own swing (the Chips column gives the size); shown only when the leaderboard is wide enough to give it room.
function Spark({ m }: { m: ModelStats }) {
  const pts = m.cumulative_bb, hands = pts.at(-1)?.[0] || 1, max = Math.max(1, ...pts.map(p => Math.abs(p[1])));
  const d = pts.map(([h, v], j) => `${j ? 'L' : 'M'}${((h / hands) * 100).toFixed(1)},${(10 - (v / max) * 9).toFixed(1)}`).join('');
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="block w-full h-5" aria-hidden>
      <line x1={0} x2={100} y1={10} y2={10} stroke={RULE} vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={modelColor(m.name)} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// The illustration: the table as an oval, the LLMs at it now around it (the engine's lineup, in seat order).
function Seats({ names, failed }: { names: string[]; failed: boolean }) {
  return (
    <div className="relative min-h-[220px] rounded-md overflow-hidden" style={{ background: 'rgba(55, 53, 47, 0.04)' }}>
      <div className="absolute inset-x-[17%] inset-y-[24%] rounded-[50%] bg-white" style={{ boxShadow: `0 0 0 1px ${RULE}, 0 0 0 8px rgba(55, 53, 47, 0.03), 0 0 0 9px ${RULE}` }} />
      <p className="absolute inset-0 flex items-center justify-center text-[13px]" style={{ color: MUTED }}>
        {failed ? 'The table is not available right now.' : 'The table now'}
      </p>
      {names.map((n, i) => {
        const a = (i / names.length) * 2 * Math.PI - Math.PI / 2;
        return (
          <div key={n} title={n} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-sm shadow-sm" style={{ left: `${50 + 41 * Math.cos(a)}%`, top: `${50 + 39 * Math.sin(a)}%` }}>
            <LLMLogo model={n} size={30} />
          </div>
        );
      })}
    </div>
  );
}
