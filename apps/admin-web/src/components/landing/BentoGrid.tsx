'use client';

import { motion } from 'framer-motion';
import { useFadeUp } from './motion-utils';

/**
 * Apple-style bento grid for product features. 6 cards across a 6-col
 * desktop grid with asymmetric column-spans:
 *
 *   ┌──────────────┬──────────────┐
 *   │   2 wide     │   2 wide     │   row 1: live coach + grounded
 *   ├──────────────┼──────┬───────┤
 *   │   2 wide     │ 1w   │ 1w    │   row 2: speed + privacy + recap
 *   └──────────────┴──────┴───────┘
 *
 * Single column on mobile. Each card has its own scroll-triggered fade-up
 * with a small stagger.
 */
const CARDS: Array<{
  title: string;
  body: string;
  span: string;
  visual: 'live' | 'grounded' | 'speed' | 'privacy' | 'recap';
}> = [
  {
    title: 'Live coaching, in your ear',
    body: 'Real-time suggestions appear inside the Meet tab the second a customer raises an objection — no alt-tabbing, no scrambling for the playbook.',
    span: 'lg:col-span-3 lg:row-span-2',
    visual: 'live',
  },
  {
    title: 'Grounded in your stack',
    body: 'Every suggestion cites the doc, deck, or playbook section it came from. Zero hallucination — if it&apos;s not in your knowledge base, it doesn&apos;t get said.',
    span: 'lg:col-span-3',
    visual: 'grounded',
  },
  {
    title: 'Sub-2s latency',
    body: 'From the moment the customer finishes their sentence, your suggestion lands in under two seconds. Coffee-shop wifi tested.',
    span: 'lg:col-span-2',
    visual: 'speed',
  },
  {
    title: 'Privacy by default',
    body: 'Audio is dropped after transcription. Workspace-scoped data, soft-delete by default, audit log on every access.',
    span: 'lg:col-span-2',
    visual: 'privacy',
  },
  {
    title: 'Auto-recap + follow-up email',
    body: 'When the call ends, Rocket ships a summary, draft follow-up, and CRM updates to your inbox.',
    span: 'lg:col-span-2',
    visual: 'recap',
  },
];

export function BentoGrid() {
  const fadeUp = useFadeUp();
  return (
    <section id="features" className="px-6 py-24 max-w-6xl mx-auto">
      <SectionHeader
        eyebrow="Features"
        title="Built for the seven seconds after the prospect speaks."
        subtitle="The window between an objection and your reply is the deal. Rocket fills that window with the right line, every time."
      />
      <div className="mt-14 grid grid-cols-1 lg:grid-cols-6 gap-4 auto-rows-[minmax(220px,_auto)]">
        {CARDS.map((c, i) => (
          <motion.div
            key={c.title}
            {...fadeUp({ y: 24, delay: i * 0.06 })}
            className={`aurora-border rounded-2xl ${c.span}`}
          >
            <div className="relative h-full glass rounded-2xl p-6 flex flex-col gap-4 overflow-hidden group">
              <CardVisual kind={c.visual} />
              <div className="mt-auto">
                <h3 className="text-lg font-semibold tracking-tight text-white">
                  {c.title}
                </h3>
                <p className="mt-1.5 text-sm text-white/55 leading-relaxed">
                  {c.body}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  const fadeUp = useFadeUp();
  return (
    <div className="max-w-3xl">
      <motion.div
        {...fadeUp({ y: 12, duration: 0.5 })}
        className="text-xs uppercase tracking-[0.22em] text-accent"
      >
        {eyebrow}
      </motion.div>
      <motion.h2
        {...fadeUp({ y: 12, delay: 0.06 })}
        className="mt-3 text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05]"
      >
        {title}
      </motion.h2>
      <motion.p
        {...fadeUp({ y: 12, delay: 0.12 })}
        className="mt-4 text-base md:text-lg text-white/60 leading-relaxed"
      >
        {subtitle}
      </motion.p>
    </div>
  );
}

function CardVisual({ kind }: { kind: 'live' | 'grounded' | 'speed' | 'privacy' | 'recap' }) {
  if (kind === 'live') {
    return (
      <div className="relative h-48 lg:h-72 -mx-2 mb-2 rounded-xl bg-gradient-to-br from-accent/10 via-transparent to-electric-500/10 overflow-hidden">
        <div className="absolute inset-0 grid-overlay opacity-50" />
        <div className="absolute top-4 left-4 right-4 space-y-2">
          <FakeBubble side="left" w="78%">
            &quot;This is way more expensive than the alternatives.&quot;
          </FakeBubble>
          <FakeBubble side="right" w="86%" mint>
            &quot;You&apos;re right — most customers chose us because the time-to-close savings paid for the difference in Q1.&quot;
          </FakeBubble>
        </div>
      </div>
    );
  }
  if (kind === 'grounded') {
    return (
      <div className="relative h-32 -mx-2 mb-2 rounded-xl bg-gradient-to-br from-violet-500/10 via-transparent to-accent/10 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className={`w-12 h-3 rounded-sm ${i === 4 ? 'bg-accent shadow-[0_0_12px_2px_rgba(110,231,183,0.6)]' : 'bg-white/10'}`}
              />
            ))}
          </div>
        </div>
        <div className="absolute bottom-3 left-3 text-[10px] text-white/40 uppercase tracking-wider">
          1 of 247 chunks · cited
        </div>
      </div>
    );
  }
  if (kind === 'speed') {
    return (
      <div className="relative h-32 -mx-2 mb-2 rounded-xl bg-gradient-to-br from-accent/10 via-transparent to-transparent overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center font-mono text-3xl font-semibold text-white">
          1.<span className="text-accent">4</span>s
        </div>
        <div className="absolute bottom-3 left-3 right-3 h-1 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full w-[18%] bg-accent rounded-full" />
        </div>
      </div>
    );
  }
  if (kind === 'privacy') {
    return (
      <div className="relative h-32 -mx-2 mb-2 rounded-xl bg-gradient-to-br from-electric-500/10 via-transparent to-transparent overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-14 h-14 rounded-2xl bg-ink-700/80 border border-white/10 grid place-items-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-accent">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
        </div>
      </div>
    );
  }
  // recap
  return (
    <div className="relative h-32 -mx-2 mb-2 rounded-xl bg-gradient-to-br from-violet-500/10 via-transparent to-accent/10 overflow-hidden">
      <div className="absolute inset-3 rounded-lg bg-ink-800/70 border border-white/5 p-3 space-y-1.5">
        <div className="h-2 rounded-full bg-white/10 w-3/4" />
        <div className="h-2 rounded-full bg-white/10 w-2/3" />
        <div className="h-2 rounded-full bg-white/10 w-1/2" />
        <div className="pt-1 flex gap-1">
          <span className="text-[8px] px-1.5 py-0.5 rounded bg-accent/20 text-accent">SENT</span>
          <span className="text-[8px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">CRM</span>
        </div>
      </div>
    </div>
  );
}

function FakeBubble({
  side,
  w,
  mint,
  children,
}: {
  side: 'left' | 'right';
  w: string;
  mint?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex ${side === 'right' ? 'justify-end' : 'justify-start'}`}>
      <div
        style={{ maxWidth: w }}
        className={`text-[11px] leading-relaxed px-3 py-2 rounded-2xl ${
          side === 'left' ? 'rounded-tl-sm' : 'rounded-tr-sm'
        } ${
          mint
            ? 'bg-gradient-to-br from-accent/25 to-electric-500/10 border border-accent/30 text-white/95'
            : 'bg-white/[0.04] border border-white/5 text-white/75'
        }`}
      >
        {children}
      </div>
    </div>
  );
}
