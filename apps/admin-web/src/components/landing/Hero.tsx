'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { CoachCard } from './CoachCard';

/**
 * Above-the-fold hero. Composition:
 *   - Eyebrow pill ("Live · Real-time AI sales coach").
 *   - Two-line headline with gradient accent on the punch word.
 *   - Subtext, dual CTA, sub-CTA microcopy.
 *   - On the right, a simulated CoachCard that demos the product —
 *     a transcript line + an AI suggestion appearing in real time.
 *   - Floating ambient pulses orbit the demo card.
 *
 * Layout collapses to a single column on mobile, with the demo card
 * dropping below the headline.
 */
export function Hero() {
  const reduced = useReducedMotion();

  return (
    <section className="relative px-6 pt-36 pb-24 max-w-6xl mx-auto">
      <div className="grid lg:grid-cols-12 gap-10 items-center">
        {/* Left: copy + CTA */}
        <div className="lg:col-span-7">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/70 backdrop-blur"
          >
            <span className="relative inline-flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-accent animate-pulse-ring" />
              <span className="relative rounded-full bg-accent w-1.5 h-1.5" />
            </span>
            Live · Real-time sales coach
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
            className="mt-6 text-5xl md:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.05]"
          >
            Close the deal{' '}
            <span className="text-gradient">while it&apos;s still hot.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
            className="mt-6 max-w-xl text-base md:text-lg text-white/65 leading-relaxed"
          >
            Rocket joins your Google Meet calls, listens to both sides, and
            whispers the next-best line, the right objection reframe, and the
            grounded answer — pulled from your own playbook in under{' '}
            <span className="text-white">two seconds</span>.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <PrimaryCta href="/signin?mode=signup">Start free — no card</PrimaryCta>
            <SecondaryCta href="#how">Watch how it works</SecondaryCta>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-5 text-xs text-white/40"
          >
            Free forever for solo reps · 5 meeting hours / month · 3 seats included
          </motion.p>
        </div>

        {/* Right: simulated coach card */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
          className="lg:col-span-5 relative"
        >
          {/* Halo glow behind card */}
          {!reduced && (
            <div className="pointer-events-none absolute -inset-10 rounded-[3rem] bg-gradient-to-tr from-accent/30 via-electric-500/20 to-violet-500/20 blur-3xl opacity-70" />
          )}
          <CoachCard />
        </motion.div>
      </div>
    </section>
  );
}

function PrimaryCta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group relative inline-flex items-center gap-2 rounded-xl bg-accent text-ink-900 font-semibold px-5 py-3 shadow-glow-mint hover:scale-[1.02] active:scale-[0.98] transition-transform duration-200"
    >
      <span>{children}</span>
      <span className="relative inline-flex w-4 h-4 items-center justify-center">
        <Arrow className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function SecondaryCta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/25 text-white px-5 py-3 transition-colors backdrop-blur-sm"
    >
      <PlayIcon className="w-3.5 h-3.5 text-accent" />
      <span>{children}</span>
    </Link>
  );
}

function Arrow({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

function PlayIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
