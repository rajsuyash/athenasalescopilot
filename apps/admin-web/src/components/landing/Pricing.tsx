'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { SectionHeader } from './BentoGrid';
import { useFadeUp } from './motion-utils';

const TIERS = [
  {
    tier: 'Free',
    price: '$0',
    cadence: 'forever',
    blurb: 'Solo reps. Hobby calls. Trying it out.',
    features: ['3 seats', '5 meeting hours / month', 'Full coach + grounding', 'Email support'],
    cta: 'Start free',
    href: '/signin?mode=signup',
    highlighted: false,
  },
  {
    tier: 'Pro',
    price: '$39',
    cadence: 'per seat / month',
    blurb: 'Small sales teams ready to compound.',
    features: ['25 seats', '250 meeting hours / month', 'Manager dashboards', 'Priority support', 'Slack notifications'],
    cta: 'Join the waitlist',
    href: '/signin?mode=signup',
    highlighted: true,
    badge: 'Most popular',
  },
  {
    tier: 'Enterprise',
    price: 'Custom',
    cadence: 'talk to us',
    blurb: 'For larger orgs that need SSO + audit.',
    features: ['Unlimited seats', 'Unlimited meeting hours', 'SAML SSO + SCIM', 'Custom retention', 'Dedicated success'],
    cta: 'Contact sales',
    href: 'mailto:rajsuyash@gmail.com',
    highlighted: false,
  },
];

export function Pricing() {
  const fadeUp = useFadeUp();
  return (
    <section id="pricing" className="px-6 py-24 max-w-6xl mx-auto">
      <SectionHeader
        eyebrow="Pricing"
        title="One coach in every rep&apos;s ear, for the price of a SaaS subscription."
        subtitle="Free forever for solo reps. Real plans launch when we&apos;re onboarding the first ten teams."
      />

      <div className="mt-14 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {TIERS.map((t, i) => (
          <motion.div
            key={t.tier}
            {...fadeUp({ y: 24, delay: i * 0.08 })}
            whileHover={{ y: -4 }}
            className={`relative rounded-2xl ${t.highlighted ? 'aurora-border' : ''}`}
          >
            <div
              className={`relative h-full glass rounded-2xl p-7 flex flex-col ${
                t.highlighted ? 'shadow-glow-mint' : ''
              }`}
            >
              {t.highlighted && t.badge && (
                <span className="absolute -top-2.5 left-7 inline-flex items-center gap-1.5 rounded-full bg-accent text-ink-900 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 shadow-glow-mint">
                  <span className="w-1 h-1 rounded-full bg-ink-900" />
                  {t.badge}
                </span>
              )}
              <div className="text-sm text-white/50">{t.tier}</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight">
                  {t.price}
                </span>
                <span className="text-xs text-white/40">{t.cadence}</span>
              </div>
              <p className="mt-2 text-sm text-white/55">{t.blurb}</p>

              <ul className="mt-6 space-y-2.5 text-sm text-white/75 flex-1">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={t.href}
                className={`mt-7 text-center rounded-lg font-semibold py-2.5 transition-all duration-200 ${
                  t.highlighted
                    ? 'bg-accent text-ink-900 hover:scale-[1.02] active:scale-[0.98] shadow-glow-mint'
                    : 'border border-white/15 hover:bg-white/5 hover:border-white/25 text-white'
                }`}
              >
                {t.cta}
              </Link>
            </div>
          </motion.div>
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-white/40">
        Pro + Enterprise launch end of Q2. Sign up free now and you&apos;ll be grandfathered in.
      </p>
    </section>
  );
}

function Check({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
