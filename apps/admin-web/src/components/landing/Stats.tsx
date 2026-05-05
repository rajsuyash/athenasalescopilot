'use client';

import { motion, useInView } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

/**
 * Counter strip — three trust metrics that count up when scrolled into view.
 * Uses Framer Motion's `useInView` to trigger the animation only on first
 * appearance (reduces CPU on long pages).
 */
const STATS = [
  { value: 1.4, suffix: 's', label: 'Median suggestion latency', decimals: 1 },
  { value: 96, suffix: '%', label: 'Coach answers cited to playbook', decimals: 0 },
  { value: 24, suffix: '/7', label: 'Always on, never coffee-breaks', decimals: 0 },
];

export function Stats() {
  return (
    <section className="px-6 py-16 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm overflow-hidden">
        {STATS.map((s, i) => (
          <Stat key={s.label} {...s} divider={i > 0} />
        ))}
      </div>
    </section>
  );
}

function Stat({
  value,
  suffix,
  label,
  decimals,
  divider,
}: {
  value: number;
  suffix: string;
  label: string;
  decimals: number;
  divider: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    const duration = 1400;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setN(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value]);

  return (
    <div
      ref={ref}
      className={`relative px-6 py-8 ${divider ? 'md:border-l md:border-white/5' : ''}`}
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6 }}
        className="text-4xl md:text-5xl font-semibold tracking-tight"
      >
        <span className="text-white">{n.toFixed(decimals)}</span>
        <span className="text-accent">{suffix}</span>
      </motion.div>
      <p className="mt-2 text-sm text-white/50">{label}</p>
    </div>
  );
}
