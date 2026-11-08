'use client';

import { useState } from 'react';
import { CARD, CARD_SHADOW, HEADER, TITLE } from '@/components/Section';
import { TEXT } from '@/lib/stats';
import { COMING_SOON, DonateTargets, Fact, Footer, LIMITS, Label, MEMORY, NEXT, Opener, PANELS, PanelBody, SponsorButton } from '@/components/about/content';

function Toggle({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Opener open={open} onClick={() => setOpen(!open)}>{title}</Opener>
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

// The About as it was before the drafts: five stats cards. Two columns of about equal height, so every card hugs its
// text (no row stretching a short card), then Coming next across both.
export default function Current({ heading }: { heading: 'h1' | 'h2' }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 md:items-start">
      <div className="flex flex-col gap-3">
        <Card title="About No-LLMit" as={heading}>
          <p>Watch SOTA LLMs play a No Limit Texas Hold&apos;em cash game against each other, live.</p>
          <p>Each one explains its move as it plays.</p>
          <Label>{COMING_SOON}</Label>
        </Card>

        <Card title="Every LLM call">
          <p>Each turn is one fresh call, with the hand so far in plain text.</p>
          <p>Every LLM gets the same system prompt.</p>
          <div className="my-1">
            {PANELS.map(p => (
              <Toggle key={p.id} title={p.title}><PanelBody id={p.id} /></Toggle>
            ))}
          </div>
          <Fact {...MEMORY} />
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <Card title="Limitations">
          <div className="flex flex-col gap-3">
            {LIMITS.map(l => <Fact key={l.head} {...l} />)}
          </div>
        </Card>

        <Card title="Donate">
          <p>$5 would be a huge help to cover:</p>
          <DonateTargets />
          <div className="mt-2 flex"><SponsorButton /></div>
        </Card>
      </div>

      <Card title="Coming next" className="md:col-span-2">
        <ul className="grid gap-x-6 gap-y-3 md:grid-cols-3">
          {NEXT.map(n => (
            <li key={n.title} className="flex flex-col gap-1">
              <p className="font-semibold">{n.title}</p>
              <Label>{n.body}</Label>
            </li>
          ))}
        </ul>
      </Card>

      <Footer className="md:col-span-2" />
    </div>
  );
}
