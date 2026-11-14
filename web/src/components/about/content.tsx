'use client';

import { ArrowUpRight, Heart, X } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PlaySoonButton from '@/components/PlaySoonButton';
import { motion, useInView, useReducedMotion } from 'motion/react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import { RATE_FROM, series } from '@/components/CumulativeChart';
import { CARD, CARD_SHADOW, Segmented, TITLE } from '@/components/Section';
import { MIN_HANDS, MUTED, ModelStats, TEXT, chips, netColor, seatedModels, signed, useStats } from '@/lib/stats';
import { EXAMPLE_REPLY, EXAMPLE_USER_PROMPT, SYSTEM_PROMPT } from '@/lib/systemPrompt';
import { joinWaitlist, waitlistCount } from '@/lib/waitlist';

// The About copy and its parts (about-content-complete); SpecSheet arranges them. Every line is one sentence that fits its
// line at About's widths (one sentence per line).

const BLUE = 'rgb(35, 131, 226)';
export const RULE = 'rgba(55, 53, 47, 0.16)'; // hairlines between sections
// A small uppercase label (13px muted, the stats' label size): a section's name, an eyebrow.
export const LABEL = 'text-[13px] leading-snug font-medium uppercase tracking-[0.08em]';

// The day the open dataset ships: one constant, so moving it is a one-word change.
const DATASET_DATE = 'Wednesday, Nov 18';

type Heading = 'h1' | 'h2' | 'h3';

// Secondary text: 13px muted, the stats cards' definition lines.
function Label({ as: Tag = 'p', className = '', children, ...rest }: { as?: 'p' | 'li' | 'span'; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return <Tag {...rest} className={`text-[13px] leading-snug ${className}`} style={{ color: MUTED }}>{children}</Tag>;
}

export function Eyebrow() {
  return <p className={LABEL} style={{ color: MUTED }}>About No-LLMit</p>;
}

// The thesis: About's first heading, at the site title's size (a little smaller where About is phone-narrow, so it keeps
// to its line).
export function Thesis({ as: H }: { as: Heading }) {
  return <H className="text-[24px] @md:text-[28px] leading-[1.15] font-bold tracking-[-0.01em]">A pseudo benchmark for LLMs.</H>;
}

export function Intro() {
  return (
    <div className="flex flex-col gap-0.5">
      <p>LLMs play No-Limit Hold&apos;em against each other, live.</p>
      <p>You can watch every decision and its reasoning.</p>
    </div>
  );
}

// The volume.
const HANDS_A_DAY = 150;

// How it works: the same two prompts for every model (each opens in the dialog below), and the reply.
export function How() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <p>Every model gets the same system prompt and the same standardized user prompt.</p>
        <p>Click either to see exactly what&apos;s inside.</p>
        <p>Assume each holds what a typical poker player is looking at.</p>
        <p>It replies with an action, an amount and a short reason.</p>
      </div>
      <PromptLinks />
    </div>
  );
}

// The caveats: each headline, then why.
const CAVEATS: [string, string][] = [
  ['No memory between hands.', 'A model doesn’t remember how anyone played earlier, not even its own last hand.'],
  ['No tells or leaks.', 'The only information is the action on the table.'],
  ['An illegal or unreadable reply gets one retry.', 'If that fails too, it checks if it can, otherwise folds.'],
];

// The hours and why donations matter, one sentence a line.
export function Hours() {
  return (
    <div className="flex flex-col gap-0.5">
      <p>The main game runs 9am to 9pm ET, every day.</p>
      <p>About {HANDS_A_DAY} hands a day.</p>
      <p>A 12-hour live game deals roughly 350.</p>
      <Label>Every decision is a paid model call, so donations keep the models seated.</Label>
    </div>
  );
}

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

// What's next: the home page's disabled Play button, then the dataset and its waitlist.
export function Next() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex"><PlaySoonButton /></div>
      <div className="flex flex-col gap-2.5">
        <Fact head={`An open-source dataset by ${DATASET_DATE}.`} lines={[
          'LLMs are terrible at poker today, and we think there’s a huge unlock in changing that.',
          'Solvers were AI’s first turn at the game; models that reason in plain words are a whole new paradigm, and this dataset is a push toward it.',
        ]} />
        <Waitlist />
      </div>
    </div>
  );
}

// The dataset's waitlist (lib/waitlist.ts): an email and a secondary button, then how many have joined (fetched once About
// comes near the window). A bot that fills the hidden "website" field is told it joined, and nothing is sent.
type Status = 'pending' | 'joined' | 'already' | 'invalid' | 'failed';
const SAID: Partial<Record<Status, string>> = {
  joined: 'You’re on the list.',
  already: 'You’re already on the list.',
  invalid: 'That doesn’t look like an email.',
  failed: 'Couldn’t join right now, try again.',
};
function Waitlist() {
  const ref = useRef<HTMLFormElement>(null);
  // On About's dial the form is clipped out of view until its row turns forward: watch the dial's window instead.
  const near = useRef<Element | null>(null);
  useLayoutEffect(() => { near.current = ref.current!.closest('[data-dial]') ?? ref.current; }, []);
  const seen = useInView(near, { once: true, margin: '0px 0px 300px 0px' });
  const [count, setCount] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    if (seen) waitlistCount().then(setCount, () => {});
  }, [seen]);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget, data = new FormData(form);
    if (data.get('website')) return setStatus('joined');
    if (!form.checkValidity()) return setStatus('invalid');
    setStatus('pending');
    try {
      const r = await joinWaitlist(String(data.get('email')).trim());
      if (r === 'invalid') return setStatus('invalid');
      if (typeof r.count === 'number') setCount(r.count);
      setStatus(r.already ? 'already' : 'joined');
    } catch {
      setStatus('failed');
    }
  };
  const said = status && SAID[status];
  return (
    <form ref={ref} onSubmit={submit} noValidate aria-label="Dataset waitlist" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <label htmlFor="about-waitlist-email" className="sr-only">Email for the dataset waitlist</label>
        <input
          id="about-waitlist-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="min-w-0 w-52 rounded px-2.5 py-1 text-[14px] bg-white border outline-none focus:border-[rgb(35,131,226)]"
          style={{ borderColor: 'rgba(55, 53, 47, 0.16)' }}
        />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="sr-only" />
        <button type="submit" disabled={status === 'pending'} className="btn-brutal px-3 py-1 disabled:opacity-60">Join the waitlist</button>
        {/* Held in place (invisible) until the count arrives, so the row keeps its height (skeleton-matches). */}
        <Label as="span" data-waitlist-count className={count === null ? 'invisible' : ''}>{count ? `${count.toLocaleString()} on the waitlist` : 'Be the first on the waitlist.'}</Label>
      </div>
      <div aria-live="polite" className="-mt-1.5">{said && <Label className="mt-1.5">{said}</Label>}</div>
    </form>
  );
}

// The main ask: a stats card with the screen's only filled button (about-support-prominent).
export const SPONSORS = 'https://github.com/sponsors/RizzwareEngineer';
export function Support({ as: H, className = '' }: { as: Heading; className?: string }) {
  return (
    <section className={`${CARD} relative gap-3 ${className}`} style={{ boxShadow: CARD_SHADOW }}>
      <H className={TITLE}>Keep the table running</H>
      <div className="flex flex-col gap-0.5">
        <p>Donations pay for the OpenRouter model calls and the servers.</p>
        <Label>Even $5 goes a long way.</Label>
      </div>
      <a
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

// The last row: the repo and the handle, centred, in a 29px row (its height when the owner picked this layout).
export function Footer() {
  return (
    <footer className="text-[13px]" style={{ color: MUTED }}>
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

// "Read the system prompt" and "Read the user prompt": the real prompt text (lib/systemPrompt.ts, never copied here) in a modal
// <dialog> over the page, so opening it never changes About's size (the page leaves wheel and keys inside a dialog alone).
type View = 'system' | 'user';
const VIEWS: { label: string; value: View }[] = [{ label: 'System prompt', value: 'system' }, { label: 'User prompt', value: 'user' }];

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
            {`Read the ${v.label.toLowerCase()}`}
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
            <h2 id="about-prompt-title" className={TITLE}>{view === 'user' ? 'The user prompt' : 'The system prompt'}</h2>
            <div className="flex items-center gap-3">
              <Segmented label="Show" options={VIEWS} value={view ?? 'system'} onChange={setView} />
              <button onClick={close} aria-label="Close" className="p-1.5 -m-1 rounded hover:bg-[rgba(55,53,47,0.06)]">
                <X size={18} aria-hidden />
              </button>
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4 flex flex-col gap-2">
            {view === 'user' ? (
              <>
                <Label>What a model sees on its turn, sent right after the system prompt.</Label>
                <Code>{EXAMPLE_USER_PROMPT}</Code>
                <p className="mt-2 font-semibold">The reply</p>
                <Label>An action, an amount and a short reason.</Label>
                <Code>{EXAMPLE_REPLY}</Code>
              </>
            ) : (
              <>
                <Label>Every model gets exactly this at the start of every turn.</Label>
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
  // On About's dial the form is clipped out of view until its row turns forward: watch the dial's window instead.
  const near = useRef<Element | null>(null);
  useLayoutEffect(() => { near.current = ref.current!.closest('[data-dial]') ?? ref.current; }, []);
  const seen = useInView(near, { once: true, margin: '0px 0px 300px 0px' });
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
// ridge's fill is the page's own colour (about-race-fill): it hides the rows behind it, so only the lines show.
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
// Hovering a line (a wide invisible hit area over it) or its logo, tapping either, or focusing the logo shows that LLM in a
// tooltip by the pointer; its line comes to the front and the others dim (about-race-hover).
export function Race({ art, className = '' }: { art: string; className?: string }) {
  const { ref, field, failed } = useField();
  const reduce = useReducedMotion();
  const rows = useMemo(() => ridges(field), [field]);
  const leader = field[0]?.hands >= MIN_HANDS ? field[0] : undefined;
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ name: string; x: number; y: number; f: number } | null>(null);
  const hot = rows.find(r => r.m.name === tip?.name);
  const show = (name: string, cx: number, cy: number) => {
    const b = box.current?.getBoundingClientRect();
    if (b) setTip({ name, x: cx - b.left, y: cy - b.top, f: Math.min(1, Math.max(0, (cx - b.left) / b.width)) }); // f: how far across
  };
  const atLogo = (name: string, el: Element) => { const r = el.getBoundingClientRect(); show(name, r.left + r.width / 2, r.top + r.height / 2); };
  const hide = (e: React.PointerEvent) => { if (e.pointerType !== 'touch') setTip(null); }; // a tap's pointerleave follows its pointerup
  // A tapped tooltip stays until a tap elsewhere.
  useEffect(() => {
    if (!tip) return;
    const off = (e: PointerEvent) => { if (!(e.target as Element).closest?.('[data-race-hit], [data-race-row]')) setTip(null); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [tip]);
  return (
    <figure ref={ref} className={`flex flex-col gap-2.5 min-w-0 ${className}`}>
      <div ref={box} className={`relative ${art}`}>
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
                <g pointerEvents="none">
                  {rows.map(r => (
                    <g key={r.m.name} data-model={r.m.name}>
                      <path d={r.area} style={{ fill: 'var(--page)' }} />
                      <path d={r.line} fill="none" stroke={r.color} strokeWidth={r.m === leader ? 2 : 1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ opacity: hot && hot !== r ? 0.5 : 1, transition: 'opacity 150ms' }} />
                    </g>
                  ))}
                  {/* The hovered line, whole, over every ridge. */}
                  {hot && <path d={hot.line} fill="none" stroke={hot.color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
                </g>
                {rows.map(r => (
                  <path
                    key={r.m.name}
                    data-race-hit={r.m.name}
                    d={r.line}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="stroke"
                    onPointerMove={e => show(r.m.name, e.clientX, e.clientY)}
                    onPointerDown={e => show(r.m.name, e.clientX, e.clientY)}
                    onPointerLeave={hide}
                  />
                ))}
              </g>
            </>
          )}
        </svg>
        {/* Each row's logo where its ridge ends, top to bottom in rank order (about-bb100). */}
        {rows.map((r, i) => (
          <motion.button
            key={r.m.name}
            type="button"
            data-race-row={r.m.name}
            aria-label={`${r.m.name}: ${chips(Math.round(r.m.bb100))} bb/100 over ${r.m.hands.toLocaleString()} hands`}
            initial={{ opacity: reduce ? 1 : 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduce ? 0 : 0.6 + i * 0.05, duration: 0.3 }}
            className="absolute right-0 -translate-y-1/2 rounded"
            style={{ top: `${r.y * 100}%` }}
            onPointerEnter={e => atLogo(r.m.name, e.currentTarget)}
            onPointerDown={e => atLogo(r.m.name, e.currentTarget)}
            onPointerLeave={hide}
            onFocus={e => atLogo(r.m.name, e.currentTarget)}
            onBlur={() => setTip(null)}
          >
            <LLMLogo model={r.m.name} size={20} />
          </motion.button>
        ))}
        {/* Floats over the art (no layout shift): above the pointer, or below it near the top; slid along so it stays inside. */}
        {hot && tip && (
          <div
            role="tooltip"
            data-race-tip
            className="absolute z-10 pointer-events-none rounded bg-white px-2.5 py-2 text-[13px] leading-snug tabular-nums whitespace-nowrap"
            style={{
              left: tip.x, top: tip.y < 64 ? tip.y + 16 : tip.y - 16,
              transform: `translate(${-tip.f * 100}%, ${tip.y < 64 ? '0' : '-100%'})`,
              color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px',
            }}
          >
            <div className="flex items-center gap-1.5"><LLMLogo model={hot.m.name} size={16} /><b translate="no">{hot.m.name}</b></div>
            <div><b style={{ color: netColor(hot.m.bb100) }}>{chips(Math.round(hot.m.bb100))}</b> bb/100 over {hot.m.hands.toLocaleString()} hands</div>
          </div>
        )}
      </div>
      <figcaption className="flex flex-col gap-1">
        <Label>{failed ? 'The race isn’t available right now.' : 'Running bb/100 of each LLM at the table, best on top.'}</Label>
        {/* LLMLogo is a div: no <p> around it. Empty until the stats arrive, at the same height; the hands count only where
            the line has room for the full name (a phone-narrow About drops it). */}
        <div className="flex items-center gap-1.5 min-w-0 min-h-[22px] whitespace-nowrap">
          {leader ? (
            <>
              <LLMLogo model={leader.name} size={18} />
              <b translate="no" className="truncate">{leader.name}</b>
              <span className="shrink-0">leads with <b style={{ color: netColor(leader.bb100) }}>{signed(leader.bb100, 0)}</b> bb/100<span className="hidden @md:inline"> over {leader.hands.toLocaleString()} hands</span>.</span>
            </>
          ) : field.length > 0 && <span>No LLM has played {MIN_HANDS} hands yet.</span>}
        </div>
        {leader && field.some(m => m.hands < MIN_HANDS) && <Label>LLMs with fewer than {MIN_HANDS} hands rank below the rest.</Label>}
      </figcaption>
    </figure>
  );
}
