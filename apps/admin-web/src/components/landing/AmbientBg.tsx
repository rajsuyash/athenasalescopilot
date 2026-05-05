'use client';

import { motion } from 'framer-motion';

/**
 * Whole-page ambient background — fixed under all content via the
 * `.ambient-canvas` class defined in globals.css.
 *
 * Three layers, painter's order:
 *   1. Drifting orbs — large, blurred, low-opacity color washes that
 *      slowly translate. Carries the "Apple Vision-Pro spatial" vibe.
 *   2. Grid overlay — fading 56px line grid, masked to top of viewport.
 *   3. Noise overlay — film-grain that sells the "premium" feel.
 *
 * All animations are pure CSS transform/opacity for GPU compositing.
 * `prefers-reduced-motion` is honoured by the global rule in globals.css.
 */
export function AmbientBg() {
  return (
    <div className="ambient-canvas" aria-hidden="true">
      {/* Three drifting orbs — top-left mint, top-right electric, bottom violet. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.4, ease: 'easeOut' }}
        className="absolute -top-40 -left-32 w-[640px] h-[640px] rounded-full blur-3xl
                   bg-gradient-to-br from-accent/40 via-accent/10 to-transparent
                   animate-orb-drift"
      />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.4, ease: 'easeOut', delay: 0.15 }}
        className="absolute top-20 -right-40 w-[720px] h-[720px] rounded-full blur-3xl
                   bg-gradient-to-bl from-electric-500/35 via-electric-500/10 to-transparent
                   animate-orb-drift-slow"
      />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.4, ease: 'easeOut', delay: 0.3 }}
        className="absolute top-[80vh] left-1/3 w-[560px] h-[560px] rounded-full blur-3xl
                   bg-gradient-to-tr from-violet-500/30 via-violet-500/8 to-transparent
                   animate-orb-drift"
      />

      {/* Grid lines fading from top */}
      <div className="grid-overlay" />

      {/* Film grain */}
      <div className="noise-overlay" />

      {/* Vignette — darken the very edges so content reads against any orb */}
      <div className="absolute inset-0 bg-gradient-radial from-transparent via-transparent to-ink-950"
        style={{
          background:
            'radial-gradient(ellipse 100% 80% at 50% 50%, transparent 40%, #05080d 100%)',
        }}
      />
    </div>
  );
}
