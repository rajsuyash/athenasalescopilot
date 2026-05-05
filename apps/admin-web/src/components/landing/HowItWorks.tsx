'use client';

import { motion } from 'framer-motion';
import { SectionHeader } from './BentoGrid';

/**
 * Three-step "how it works" with a connecting timeline. Steps fade in and
 * the connecting line draws as the user scrolls past.
 */
const STEPS = [
  {
    n: '01',
    title: 'Sign up + drop your playbook',
    body: 'Create a workspace in 30 seconds. Upload your sales deck, FAQ, pricing — anything. We chunk it, embed it, and index it for retrieval.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="13" y2="17" />
      </svg>
    ),
  },
  {
    n: '02',
    title: 'Install the Chrome extension',
    body: 'One click from the Web Store. Sign in with the same workspace. Rocket pairs with the in-Meet overlay automatically — no extension keys, no settings.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
        <line x1="21.17" y1="8" x2="12" y2="8" />
        <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
        <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
      </svg>
    ),
  },
  {
    n: '03',
    title: 'Open Meet, hit Start, sell',
    body: 'Join your sales call. Click Start live capture. Suggestions stream into a discreet corner of the Meet tab in real time. Your prospect never sees a thing.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M23 7l-7 5 7 5z" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    ),
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="px-6 py-24 max-w-6xl mx-auto">
      <SectionHeader
        eyebrow="How it works"
        title="From signup to first coached call in three minutes."
        subtitle="No complex setup, no integration tickets, no waiting on IT. Real reps are getting real coaching the same afternoon they sign up."
      />

      <div className="mt-16 relative">
        {/* Connecting line — scroll-draws via path stroke */}
        <svg
          className="hidden lg:block absolute top-12 left-[10%] right-[10%] h-2 -z-10"
          viewBox="0 0 1000 4"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line x1="0" y1="2" x2="1000" y2="2" stroke="rgba(255,255,255,0.08)" strokeWidth="2" strokeDasharray="4 6" />
        </svg>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              className="relative"
            >
              <div className="relative aurora-border rounded-2xl">
                <div className="glass rounded-2xl p-6 h-full">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="relative w-12 h-12 rounded-xl grid place-items-center bg-gradient-to-br from-accent/20 via-accent/5 to-transparent border border-accent/30 text-accent">
                      {s.icon}
                    </div>
                    <span className="font-mono text-xs text-white/30 mt-2">
                      step {s.n}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-sm text-white/55 leading-relaxed">{s.body}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
