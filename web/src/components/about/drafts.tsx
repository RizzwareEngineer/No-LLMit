'use client';

import { ArrowUpRight, CaretRight, Heart, X } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { CARD_SHADOW, Segmented, TITLE } from '@/components/ui';
import PlaySoonButton from '@/components/PlaySoonButton';
import { BLUE, MUTED, TEXT } from '@/lib/stats';
import { EXAMPLE_REPLY, EXAMPLE_USER_PROMPT, SYSTEM_PROMPT } from '@/lib/systemPrompt';
import {
  CAVEATS, Caveats, Code, DATASET_DATE, Eyebrow, Footer, HANDS_A_DAY, LABEL, Label, PromptDialog, RULE, SPONSORS, Thesis,
  Waitlist, type View,
} from '@/components/about/content';
import { LiveProvider, LiveTable, stepMark, useLive, useStep, type Draft, type Mark, type Step } from '@/components/about/live';

// Three drafts of a shorter About, on /about?about=a, b or c (owner, 2026-11-28: "the amount of text is just a little bit
// too much still ... keep the table running"). Each keeps the six things About must say (how it works, the system
// prompt, the user prompt, the caveats, the hours, what's next), shows a few lines at first and the rest on demand, and
// puts the live table on the page as the thing being explained.
//   a: the table explains itself: four numbered steps that follow the live hand on the table, the rest on tabs under them.
//   b: one hand, annotated: the prompts in a code viewer beside the table; opening a part rings where it is on the table.
//   c: six cards: one small card per topic beside the table; a card opens over the cards, the table plays on.
// The copy is About's own (about/content.tsx, lib/systemPrompt.ts), cut down; nothing here states a new fact.

const WIDE = 'max-w-[1264px]';

// The header every draft shares: who we are in two lines, and the ask as one pill.
function Head() {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
      <div className="flex flex-col gap-2 min-w-0">
        <Eyebrow />
        <Thesis as="h1" />
        <p>LLMs play No-Limit Hold&apos;em against each other, live.</p>
      </div>
      <Sponsor />
    </header>
  );
}

// "Keep the table running" as the page's one filled button: the donation card's ask, in a line.
function Sponsor() {
  return (
    <a
      href={SPONSORS}
      target="_blank"
      rel="noopener noreferrer"
      data-sponsor
      className="flex items-center gap-2 rounded-full px-4 py-2 text-[15px] font-medium text-white shadow-sm hover:brightness-110 transition-[filter] whitespace-nowrap"
      style={{ background: BLUE }}
    >
      <Heart size={15} weight="fill" aria-hidden />
      Keep the table running
      <ArrowUpRight size={13} weight="bold" aria-hidden />
    </a>
  );
}

// The hours, short: the window as the figure, then the volume, then why donations matter (About's Hours, cut).
function HoursBody() {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[20px] leading-8 font-bold tabular-nums">9am to 9pm ET</p>
      <p>Every day, about {HANDS_A_DAY} hands a day.</p>
      <Label>Every decision is a paid model call, so donations keep the models seated.</Label>
    </div>
  );
}

// What's next, short: the Play button, the dataset and its waitlist (About's Next, its second reason cut).
function NextBody() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex"><PlaySoonButton /></div>
      <div className="flex flex-col gap-0.5">
        <p className="font-bold">An open-source dataset by {DATASET_DATE}.</p>
        <Label>LLMs are terrible at poker today, and we think there&apos;s a huge unlock in changing that.</Label>
      </div>
      <Waitlist />
    </div>
  );
}

// The four steps of a turn (how it works), each with the line it shows when it is the step in focus.
const STEPS: { n: Step; title: string; line: string }[] = [
  { n: 1, title: 'The engine deals.', line: 'A 9-handed No-Limit cash game.' },
  { n: 2, title: 'The model gets the prompts.', line: 'The same two prompts for every model.' },
  { n: 3, title: 'It answers.', line: 'An action, an amount and a short reason.' },
  { n: 4, title: 'The engine checks the move.', line: 'An illegal or unreadable reply gets one retry.' },
];

// The steps as a rail: the one the live hand is on is lit (its number filled, its line shown); a click holds a step lit
// (its mark stays on the table) until "Follow the live hand". Every line's room is kept, so lighting one moves nothing.
function Rail({ s, as: H = 'h2', label = true }: { s: ReturnType<typeof useStep>; as?: 'h2' | 'h3'; label?: boolean }) {
  return (
    <section aria-labelledby="about-how" data-item="how" className="flex flex-col gap-3">
      <div className={`flex items-baseline gap-4 ${label ? 'justify-between' : 'justify-end'}`}>
        <H id="about-how" className={label ? LABEL : 'sr-only'} style={{ color: MUTED }}>How it works</H>
        {/* The live state or the way back to it, in one place of one width (no shift). */}
        <span className="text-[13px] whitespace-nowrap min-w-[150px] text-right">
          {s.pinned ? (
            <button type="button" onClick={() => s.setPinned(null)} className="font-medium hover:underline" style={{ color: BLUE }}>Follow the live hand</button>
          ) : (
            <span className="inline-flex items-center gap-1.5" style={{ color: MUTED }}>
              <span aria-hidden className="size-1.5 rounded-full bg-[rgb(224,62,62)] motion-safe:animate-pulse" />Following the live hand
            </span>
          )}
        </span>
      </div>
      <ol className="flex flex-col">
        {STEPS.map(st => {
          const on = s.step === st.n;
          return (
            <li key={st.n}>
              <button
                type="button"
                data-open="how"
                aria-pressed={s.pinned === st.n}
                onClick={() => s.setPinned(s.pinned === st.n ? null : st.n)}
                className="w-full flex items-start gap-3 rounded-md px-2 py-1.5 -mx-2 text-left hover:bg-[rgba(55,53,47,0.04)]"
              >
                <span
                  className="mt-px grid place-items-center size-6 shrink-0 rounded-full text-[13px] font-bold tabular-nums motion-safe:transition-colors"
                  style={on ? { background: BLUE, color: 'white' } : { boxShadow: `inset 0 0 0 1.5px ${RULE}`, color: MUTED }}
                >
                  {st.n}
                </span>
                <span className="flex flex-col min-w-0">
                  <span data-copy className={`font-bold whitespace-nowrap ${on ? '' : 'opacity-70'}`}>{st.title}</span>
                  <span data-copy className={`text-[14px] leading-normal whitespace-nowrap ${on ? '' : 'invisible'}`} style={{ color: MUTED }}>{st.line}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// Tabs whose panels share one cell as tall as the tallest, so a switch moves nothing under them. ← → move along them.
function Tabs({ tabs, initial = 0 }: { tabs: { id: string; label: string; opens: string; body: React.ReactNode }[]; initial?: number }) {
  const [at, setAt] = useState(initial);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const uid = useId();
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = (at + d + tabs.length) % tabs.length;
    setAt(i);
    refs.current[i]?.focus();
  };
  return (
    <div className="flex flex-col">
      <div role="tablist" aria-label="More about No-LLMit" onKeyDown={onKey} className="flex gap-6 border-b" style={{ borderColor: RULE }}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="tab"
            data-open={t.opens}
            id={`${uid}-tab-${i}`}
            aria-selected={i === at}
            aria-controls={`${uid}-panel-${i}`}
            tabIndex={i === at ? 0 : -1}
            onClick={() => setAt(i)}
            className={`${LABEL} -mb-px py-2.5 border-b-2 whitespace-nowrap`}
            style={{ color: i === at ? TEXT : MUTED, borderColor: i === at ? TEXT : 'transparent' }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-3.5 grid items-start [&>*]:[grid-area:1/1]">
        {tabs.map((t, i) => (
          <section
            key={t.id}
            role="tabpanel"
            id={`${uid}-panel-${i}`}
            aria-labelledby={`${uid}-tab-${i}`}
            data-item={t.id}
            className={i === at ? '' : 'invisible'}
          >
            {t.body}
          </section>
        ))}
      </div>
    </div>
  );
}

// The two prompts, each a heading, a line and the way to read it whole (the prompt dialog).
function Prompts({ open }: { open: (v: View) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5" data-item="system">
        <h3 className="font-bold">The system prompt</h3>
        <button type="button" data-open="system" aria-haspopup="dialog" onClick={() => open('system')} className="self-start font-medium hover:underline" style={{ color: BLUE }}>Show the full prompt</button>
      </div>
      <div className="flex flex-col gap-0.5" data-item="user">
        <h3 className="font-bold">The user prompt</h3>
        <button type="button" data-open="user" aria-haspopup="dialog" onClick={() => open('user')} className="self-start font-medium hover:underline" style={{ color: BLUE }}>Show the prompt and the reply</button>
      </div>
    </div>
  );
}

// The table's box: as wide as `w` allows and short enough that the table, its caption and the page's header fit the
// window (`room`: what the rest of the screen takes), never under `min`.
const tableW = (w: number, room: number, min: number) => `max(${min}px, min(${w}px, calc((100svh - ${room}px) * 1000 / 642)))`;

// ---- Draft A: the table explains itself ----
function DraftA() {
  const { actor } = useLive();
  const s = useStep();
  const [view, setView] = useState<View | null>(null);
  return (
    <>
      <div className="flex flex-col gap-6 md:grid md:grid-cols-[auto_400px] md:gap-x-12 md:items-start">
        <LiveTable marks={[stepMark(s.step, actor)]} className="md:w-[var(--tw)]" />
        <div className="flex flex-col gap-6 min-w-0">
          <Rail s={s} />
          <Tabs tabs={[
            { id: 'prompts', label: 'Prompts', opens: 'system user', body: <Prompts open={setView} /> },
            { id: 'caveats', label: 'Caveats', opens: 'caveats', body: <Caveats /> },
            { id: 'hours', label: 'Hours', opens: 'hours', body: <HoursBody /> },
            { id: 'next', label: 'What’s next', opens: 'next', body: <NextBody /> },
          ]} />
        </div>
      </div>
      <PromptDialog view={view} onView={setView} />
    </>
  );
}

// ---- Draft B: one hand, annotated ----
// The prompts in parts, each with where it shows on the live table (its marks).
type Part = { title: string; text: string; marks: (actor: number, seats: number) => Mark[] };
const seatSel = (i: number) => `[data-seat="${i}"]`;
const paras = (t: string) => t.split('\n\n');
const SYS = paras(SYSTEM_PROMPT), USR = paras(EXAMPLE_USER_PROMPT);
const PARTS: Record<'system' | 'user' | 'reply', Part[]> = {
  system: [
    { title: 'The role', text: SYS[0], marks: () => [] },
    { title: 'What each message gives', text: SYS[1], marks: (a, n) => Array.from({ length: n }, (_, i) => ({ n: '', sel: seatSel(i) })).concat(a >= 0 ? [{ n: 'You', sel: seatSel(a) }] : []) },
    { title: 'How to reply', text: SYS[2], marks: () => [{ n: 3, sel: '[data-caption]' }] },
  ],
  user: [
    { title: 'Blinds', text: USR[0], marks: () => [{ n: '', sel: '[data-pot] || [data-felt]' }] },
    { title: 'Opponents', text: USR[1], marks: (a, n) => Array.from({ length: n }, (_, i) => i).filter(i => i !== a).map(i => ({ n: '', sel: seatSel(i) })) },
    { title: 'You', text: USR[2], marks: a => (a >= 0 ? [{ n: 'You', sel: seatSel(a) }] : []) },
    { title: 'The action so far', text: USR[3], marks: () => [{ n: '', sel: '[data-felt-cards]' }] },
    { title: 'Legal actions', text: USR[4], marks: a => (a >= 0 ? [{ n: 'You', sel: seatSel(a) }] : []) },
  ],
  reply: [{ title: 'The reply', text: EXAMPLE_REPLY, marks: () => [{ n: 3, sel: '[data-caption]' }] }],
};
const VIEWER: { label: string; value: keyof typeof PARTS }[] = [
  { label: 'System prompt', value: 'system' }, { label: 'User prompt', value: 'user' }, { label: 'Reply', value: 'reply' },
];
const lineCount = (t: string) => { const n = t.split('\n').length; return `${n} line${n > 1 ? 's' : ''}`; };

function Viewer({ onMarks }: { onMarks: (m: Mark[]) => void }) {
  const { actor, gameState } = useLive();
  const seats = gameState?.players.length ?? 0;
  const [tab, setTab] = useState<keyof typeof PARTS>('user');
  const [open, setOpen] = useState<Set<string>>(() => new Set(['system:0', 'user:2', 'reply:0']));
  const [hot, setHot] = useState<string | null>(null);
  const parts = PARTS[tab];
  const key = (i: number) => `${tab}:${i}`;
  // The part under the pointer or focus is ringed on the table; else the last part opened.
  const lit = hot ?? [...open].filter(k => k.startsWith(`${tab}:`)).at(-1) ?? null;
  const litPart = lit ? parts[+lit.split(':')[1]] : null;
  const marks = litPart ? litPart.marks(actor, seats) : [];
  const sig = JSON.stringify(marks);
  useEffect(() => onMarks(JSON.parse(sig)), [sig, onMarks]);
  const all = parts.every((_, i) => open.has(key(i)));
  const toggle = (k: string) => setOpen(o => { const n = new Set(o); if (n.has(k)) n.delete(k); else { n.delete(k); n.add(k); } return n; });
  const setAll = () => setOpen(o => { const n = new Set([...o].filter(k => !k.startsWith(`${tab}:`))); if (!all) parts.forEach((_, i) => n.add(key(i))); return n; });
  return (
    <div className="flex flex-col min-h-0 max-md:flex-1 rounded-lg bg-white" style={{ boxShadow: CARD_SHADOW }}>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b" style={{ borderColor: RULE }}>
        <Segmented label="Show" options={VIEWER} value={tab} onChange={v => { setTab(v); setHot(null); }} />
        <button type="button" data-open={tab} onClick={setAll} className="text-[14px] font-medium hover:underline whitespace-nowrap" style={{ color: BLUE }}>
          {all ? 'Collapse all' : 'Show all'}
        </button>
      </div>
      <h3 className="sr-only">{tab === 'system' ? 'The system prompt' : tab === 'user' ? 'The user prompt' : 'The reply'}</h3>
      <div data-item={tab} role="region" aria-label={VIEWER.find(v => v.value === tab)!.label} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:[outline:2px_solid_rgb(35,131,226)]">
        {parts.map((p, i) => {
          const k = key(i), on = open.has(k);
          return (
            <div key={k} className="border-b last:border-b-0" style={{ borderColor: RULE }} onPointerEnter={() => setHot(k)} onPointerLeave={() => setHot(h => (h === k ? null : h))}>
              <button
                type="button"
                aria-expanded={on}
                onClick={() => toggle(k)}
                onFocus={() => setHot(k)}
                onBlur={() => setHot(h => (h === k ? null : h))}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[rgba(55,53,47,0.03)]"
                style={lit === k ? { background: 'rgba(35, 131, 226, 0.06)' } : undefined}
              >
                <CaretRight size={12} weight="bold" aria-hidden className="shrink-0 motion-safe:transition-transform" style={{ transform: on ? 'rotate(90deg)' : 'none', color: MUTED }} />
                <span className="flex-1 font-medium text-[15px]">{p.title}</span>
                <span className="text-[13px] tabular-nums" style={{ color: MUTED }}>{lineCount(p.text)}</span>
              </button>
              {on && <div className="px-3 pb-3"><Code>{p.text}</Code></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A one-line card whose "More" opens the topic over the page above it (a popover), so nothing below it moves.
function MoreCard({ id, title, line, children }: { id: string; title: string; line: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null), more = useRef<HTMLButtonElement>(null), head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!open) return;
    head.current?.focus();
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); more.current?.focus(); } };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div ref={box} className="relative min-w-0">
      <section className="flex flex-col gap-0.5 rounded-lg bg-white px-3.5 py-2.5 h-full" style={{ boxShadow: CARD_SHADOW }}>
        <h2 className={LABEL} style={{ color: MUTED }}>{title}</h2>
        <p className="text-[15px] whitespace-nowrap truncate">{line}</p>
        <button ref={more} type="button" data-open={id} aria-expanded={open} onClick={() => setOpen(o => !o)} className="self-start text-[14px] font-medium hover:underline" style={{ color: BLUE }}>{open ? 'Less' : 'More'}</button>
      </section>
      {open && (
        <div role="dialog" aria-label={title} data-item={id} className="absolute z-40 left-0 bottom-full mb-2 w-[min(440px,calc(100vw-24px))] max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:mb-0 max-md:w-auto max-md:rounded-b-none max-md:max-h-[80svh] max-md:overflow-y-auto rounded-lg bg-white p-4 flex flex-col gap-3" style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0 0 0 1px, rgba(15, 15, 15, 0.2) 0 8px 24px' }}>
          <div className="flex items-start gap-3">
            <h3 ref={head} tabIndex={-1} className={`flex-1 outline-none ${TITLE}`}>{title}</h3>
            <button type="button" onClick={() => { setOpen(false); more.current?.focus(); }} aria-label="Close" className="shrink-0 p-1.5 -m-1 rounded hover:bg-[rgba(55,53,47,0.06)]"><X size={18} aria-hidden /></button>
          </div>
          {children}
        </div>
      )}
    </div>
  );
}

function DraftB() {
  const [marks, setMarks] = useState<Mark[]>([]);
  return (
    <div className="flex flex-col gap-6 md:grid md:grid-cols-[auto_460px] md:gap-x-10">
      <div className="max-md:contents flex flex-col gap-4 min-w-0 md:w-[var(--tw)]">
        <LiveTable marks={marks} className="max-md:order-1" />
        <div className="max-md:order-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <MoreCard id="caveats" title="Caveats" line="No memory, no tells."><Caveats /></MoreCard>
          <MoreCard id="hours" title="Hours" line="9am to 9pm ET daily."><HoursBody /></MoreCard>
          <MoreCard id="next" title="What’s next" line="Open-source dataset."><NextBody /></MoreCard>
        </div>
      </div>
      {/* No taller than the table's column (height 0, at least the row's): a part opened scrolls inside the viewer. */}
      <div className="max-md:order-2 flex flex-col gap-3 min-w-0 max-md:h-[560px] md:h-0 md:min-h-full">
        <div className="flex flex-col gap-1" data-item="how">
          <h2 className={LABEL} style={{ color: MUTED }}>How it works</h2>
          <p>Every model gets the same two prompts.</p>
        </div>
        <Viewer onMarks={setMarks} />
      </div>
    </div>
  );
}

// ---- Draft C: six cards ----
function MiniCards({ cards }: { cards: string[] }) {
  const SUIT: Record<string, [string, string]> = { s: ['♠', TEXT], h: ['♥', 'rgb(224, 62, 62)'], d: ['♦', 'rgb(35, 131, 226)'], c: ['♣', 'rgb(15, 123, 108)'] };
  return (
    <span className="flex gap-1" aria-label={cards.join(' ')} role="img">
      {cards.map(c => (
        <span key={c} aria-hidden className="grid place-items-center w-[26px] h-[34px] rounded bg-white text-[14px] font-bold leading-none" style={{ boxShadow: 'rgba(15, 15, 15, 0.12) 0 0 0 1px', color: SUIT[c[1]][1] }}>
          <span>{c[0]}<br />{SUIT[c[1]][0]}</span>
        </span>
      ))}
    </span>
  );
}
function StepDots({ step }: { step: Step }) {
  return (
    <span className="flex items-center gap-1" aria-label={`Step ${step} of 4 in the live hand`} role="img">
      {STEPS.map(s => (
        <span key={s.n} aria-hidden className="grid place-items-center size-6 rounded-full text-[13px] leading-none font-bold tabular-nums" style={s.n === step ? { background: BLUE, color: 'white' } : { boxShadow: `inset 0 0 0 1.5px ${RULE}`, color: MUTED }}>{s.n}</span>
      ))}
    </span>
  );
}

type CardId = 'how' | 'system' | 'user' | 'caveats' | 'hours' | 'next';
const SYS_LINES = SYSTEM_PROMPT.split('\n').filter(Boolean).length;

function DraftC() {
  const { actor, step: live } = useLive();
  const s = useStep();
  const [open, setOpen] = useState<CardId | null>(null);
  const opener = useRef<Partial<Record<CardId, HTMLButtonElement | null>>>({});
  const head = useRef<HTMLHeadingElement>(null);
  const close = () => { const was = open; setOpen(null); if (was) requestAnimationFrame(() => opener.current[was]?.focus()); };
  useEffect(() => {
    if (!open) return;
    head.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  const CARDS: { id: CardId; title: string; line: string; fig: React.ReactNode; body: React.ReactNode }[] = [
    { id: 'how', title: 'How it works', line: 'Deal, prompt, answer, check.', fig: <StepDots step={live} />, body: <Rail s={s} as="h3" label={false} /> },
    { id: 'system', title: 'System prompt', line: 'Same for every model.', fig: <span className="tabular-nums">{SYS_LINES} lines</span>, body: <><Label>Sent to every model at the start of each turn.</Label><Code>{SYSTEM_PROMPT}</Code></> },
    { id: 'user', title: 'User prompt', line: 'A real hand, as sent.', fig: <MiniCards cards={['As', 'Kd']} />, body: <><Label>Sent each turn, after the system prompt.</Label><Code>{EXAMPLE_USER_PROMPT}</Code><p className="font-bold">The reply</p><Code>{EXAMPLE_REPLY}</Code></> },
    { id: 'caveats', title: 'Caveats', line: 'What to keep in mind.', fig: <span className="tabular-nums">{CAVEATS.length}</span>, body: <Caveats /> },
    { id: 'hours', title: 'Hours', line: 'Every day.', fig: <span className="tabular-nums">9am to 9pm ET</span>, body: <HoursBody /> },
    { id: 'next', title: 'What’s next', line: 'An open-source dataset.', fig: <span className="tabular-nums">{DATASET_DATE.split(', ')[1]}</span>, body: <NextBody /> },
  ];
  const sheet = CARDS.find(c => c.id === open);
  const marks = open === 'how' ? [stepMark(s.step, actor)] : open === 'user' && actor >= 0 ? [{ n: 'You', sel: seatSel(actor) }] : [];
  return (
    <div className="flex flex-col gap-6 md:grid md:grid-cols-[auto_520px] md:gap-x-10">
      <LiveTable marks={marks} className="md:w-[var(--tw)]" />
      <div className="relative min-w-0">
        <div inert={!!open || undefined} className="grid grid-cols-2 gap-3 h-full md:auto-rows-fr">
          {CARDS.map(c => (
            <article key={c.id} data-card={c.id} className="relative flex flex-col gap-2 rounded-lg bg-white p-3.5 hover:bg-[#fcfcfb] focus-within:[outline:2px_solid_rgb(35,131,226)] focus-within:[outline-offset:2px]" style={{ boxShadow: CARD_SHADOW }}>
              <h2 className={LABEL} style={{ color: MUTED }}>{c.title}</h2>
              <div className="text-[20px] leading-8 font-bold min-h-[34px] flex items-center">{c.fig}</div>
              <p className="text-[14px] leading-normal mt-auto" style={{ color: MUTED }}>{c.line}</p>
              {/* The whole card opens it (a stretched button), its words outside the button. */}
              <button
                ref={el => { opener.current[c.id] = el; }}
                type="button"
                data-open={c.id}
                aria-haspopup="dialog"
                aria-expanded={open === c.id}
                aria-label={`Open ${c.title}`}
                onClick={() => setOpen(c.id)}
                className="absolute inset-0 rounded-lg outline-none"
              />
              <ArrowUpRight size={14} weight="bold" aria-hidden className="absolute top-3.5 right-3.5" style={{ color: MUTED }} />
            </article>
          ))}
        </div>
        {sheet && <div aria-hidden onClick={close} className="md:hidden fixed inset-0 z-40 bg-[rgba(15,15,15,0.3)]" />}
        {sheet && (
          <div role="dialog" aria-modal="false" aria-labelledby="about-sheet-title" data-item={sheet.id} className="absolute inset-0 z-40 max-md:z-50 flex flex-col rounded-lg bg-white max-md:fixed max-md:inset-auto max-md:left-0 max-md:right-0 max-md:bottom-0 max-md:max-h-[80svh] max-md:rounded-b-none" style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0 0 0 1px, rgba(15, 15, 15, 0.2) 0 8px 24px' }}>
            <div className="flex items-start gap-3 px-4 pt-3 pb-2.5 border-b" style={{ borderColor: RULE }}>
              <h3 ref={head} tabIndex={-1} id="about-sheet-title" className={`flex-1 outline-none ${TITLE}`}>{sheet.title}</h3>
              <button type="button" onClick={close} aria-label="Close" className="shrink-0 p-1.5 -m-1 rounded hover:bg-[rgba(55,53,47,0.06)]"><X size={18} aria-hidden /></button>
            </div>
            <div tabIndex={0} role="region" aria-label={sheet.title} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 flex flex-col gap-2 outline-none [&>*]:shrink-0">{sheet.body}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// The drafts' page: the header, the draft, the footer; one stream for the table. `--tw`: the table's width on a desktop,
// as big as the window's height leaves room for (each draft's own room).
const ROOM: Record<Draft, [number, number, number]> = { a: [784, 310, 560], b: [730, 420, 540], c: [670, 310, 540] };
export default function AboutDrafts({ draft }: { draft: Draft }) {
  const [w, room, min] = ROOM[draft];
  return (
    <LiveProvider>
      <article
        data-about
        data-about-draft={draft}
        className={`@container flex flex-col gap-6 md:gap-7 text-[16px] leading-normal ${WIDE} mx-auto`}
        style={{ color: TEXT, '--tw': tableW(w, room, min) } as React.CSSProperties}
      >
        <div className="md:w-fit md:mx-auto flex flex-col gap-6 md:gap-7">
          <Head />
          {draft === 'a' ? <DraftA /> : draft === 'b' ? <DraftB /> : <DraftC />}
        </div>
        <Footer />
      </article>
    </LiveProvider>
  );
}
