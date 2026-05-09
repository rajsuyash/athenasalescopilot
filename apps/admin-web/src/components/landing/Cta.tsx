'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useFadeUp } from './motion-utils';

/**
 * Final-conversion section. Big headline, single CTA, ambient glow halo.
 * Intentionally minimalist — the user already knows what the product does
 * by this point, just close the tab.
 */
export function Cta() {
  const fadeUp = useFadeUp();
  return (
    <section className="px-6 py-32 max-w-4xl mx-auto text-center relative">
      {/* Ambient glow halo */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 mx-auto w-[80%] h-72 rounded-full blur-3xl bg-gradient-to-r from-accent/25 via-electric-500/15 to-violet-500/25 -z-10" />

      <motion.h2
        {...fadeUp({ y: 16, duration: 0.7 })}
        className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]"
      >
        Your next call deserves a coach.
        <br />
        <span className="text-gradient">Ours is free.</span>
      </motion.h2>

      <motion.p
        {...fadeUp({ y: 12, delay: 0.1 })}
        className="mt-5 text-base md:text-lg text-white/60"
      >
        Spin up a workspace in 30 seconds. Upload your playbook. Coach yourself
        through your next discovery call.
      </motion.p>

      <motion.div
        {...fadeUp({ y: 12, delay: 0.2 })}
        className="mt-10 flex items-center justify-center gap-3 flex-wrap"
      >
        <Link
          href="/signin?mode=signup"
          className="group inline-flex items-center gap-2 rounded-xl bg-accent text-ink-900 font-semibold px-6 py-3.5 shadow-glow-mint hover:scale-[1.02] active:scale-[0.98] transition-transform duration-200 text-base"
        >
          <span>Create your workspace</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </Link>
        <Link
          href="/signin"
          className="inline-flex items-center rounded-xl border border-white/15 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/25 px-6 py-3.5 transition-colors text-base"
        >
          Sign in
        </Link>
      </motion.div>

      <p className="mt-5 text-xs text-white/40">
        No credit card · Free forever for solo reps · Setup in under 30 seconds
      </p>
    </section>
  );
}
