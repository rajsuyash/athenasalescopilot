'use client';

import { motion } from 'framer-motion';

/**
 * "Trusted by" logo strip — vector-only placeholders styled like classic
 * Y-Combinator-startup wordmarks. Once we have real customers, replace
 * these with their actual SVG logos.
 *
 * Marquee scroll on mobile, static on desktop. Subtle opacity to avoid
 * stealing attention from the hero CTAs above.
 */
const PLACEHOLDERS = [
  { name: 'Northwind', kind: 'serif' },
  { name: 'Helix Labs', kind: 'mono' },
  { name: 'Quill', kind: 'serif' },
  { name: 'Beacon', kind: 'sans' },
  { name: 'Atlas Inc', kind: 'mono' },
  { name: 'Vega', kind: 'sans' },
];

export function LogosRow() {
  return (
    <section className="px-6 py-10 max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.7 }}
        className="text-center"
      >
        <p className="text-xs uppercase tracking-[0.2em] text-white/40">
          Trusted by sales teams at design-partner stage
        </p>
        <div className="mt-7 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-10 gap-y-6 items-center">
          {PLACEHOLDERS.map((p) => (
            <span
              key={p.name}
              className={`text-white/30 hover:text-white/60 transition-colors text-base md:text-lg select-none ${
                p.kind === 'serif'
                  ? 'font-serif italic'
                  : p.kind === 'mono'
                  ? 'font-mono tracking-tight'
                  : 'font-semibold tracking-tight'
              }`}
            >
              {p.name}
            </span>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
