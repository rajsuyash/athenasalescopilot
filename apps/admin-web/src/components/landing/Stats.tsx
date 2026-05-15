'use client';

/**
 * Counter strip — three trust metrics under the hero.
 *
 * The earlier version animated a count-up from 0 → value when the strip
 * entered the viewport. Caught in the 2026-05-15 design audit: users who
 * skim without scrolling (the 5-second-decision crowd) and headless
 * renderers see the strip with the labels but the numbers stuck at 0.
 * That undermines the entire trust signal — "0.0s median latency" reads
 * as a broken page, not a metric.
 *
 * Fix: render the final values immediately. The count-up flourish is
 * gone; the trust strip is now a static display. Worth the trade — a
 * stat strip's job is to be read instantly, not animate prettily.
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
  return (
    <div
      className={`relative px-6 py-8 ${divider ? 'md:border-l md:border-white/5' : ''}`}
    >
      <div className="text-4xl md:text-5xl font-semibold tracking-tight">
        <span className="text-white">{value.toFixed(decimals)}</span>
        <span className="text-accent">{suffix}</span>
      </div>
      <p className="mt-2 text-sm text-white/50">{label}</p>
    </div>
  );
}
