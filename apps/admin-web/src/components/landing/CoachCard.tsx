'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';

/**
 * Auto-cycling demo card that mimics the real in-Meet coach UI. Three
 * scenes cycle every ~5 seconds:
 *
 *   1. Customer raises an objection (transcript bubble appears).
 *   2. AI thinking shimmer.
 *   3. Suggestion card appears with grounded source citation.
 *
 * Pure presentation — no real backend calls. Uses Framer Motion's
 * AnimatePresence for smooth scene transitions.
 */
const SCENES = [
  {
    customer: 'Honestly, this is way more expensive than the alternatives we looked at.',
    type: 'Objection',
    answer:
      "Acknowledge it — then reframe value. Try: \"You're right, we're not the cheapest. Most of our customers chose us because the time-to-close savings paid for the difference in the first quarter.\"",
    source: 'Pricing playbook · §3 Premium positioning',
    accent: 'from-accent/30 via-electric-500/20',
  },
  {
    customer: 'We already have a vendor handling this for us.',
    type: 'Reframe',
    answer:
      'Lean into curiosity. Ask: "What\'s the one thing about your current vendor you\'d change tomorrow if you could?" — surfaces the real pain.',
    source: 'Discovery script · §1 Sloshed-2 probing',
    accent: 'from-electric-500/30 via-violet-500/20',
  },
  {
    customer: 'Let me think about it and I\'ll get back to you next week.',
    type: 'Next step',
    answer:
      'Pin a real next step. Try: "Totally — does Tuesday at 2pm work for a 15-min follow-up so I can answer anything that comes up?"',
    source: 'Closing playbook · §4 Pinning the next step',
    accent: 'from-violet-500/30 via-accent/20',
  },
];

const SCENE_MS = 5_400;
const TYPE_MS = 1_400;

export function CoachCard() {
  const reduced = useReducedMotion();
  const [sceneIdx, setSceneIdx] = useState(0);
  const [phase, setPhase] = useState<'transcript' | 'thinking' | 'answer'>('transcript');

  useEffect(() => {
    if (reduced) {
      setPhase('answer');
      return;
    }
    const seq = setTimeout(() => setPhase('thinking'), TYPE_MS);
    const seq2 = setTimeout(() => setPhase('answer'), TYPE_MS + 1100);
    const cycle = setTimeout(() => {
      setSceneIdx((i) => (i + 1) % SCENES.length);
      setPhase('transcript');
    }, SCENE_MS);
    return () => {
      clearTimeout(seq);
      clearTimeout(seq2);
      clearTimeout(cycle);
    };
  }, [sceneIdx, reduced]);

  const scene = SCENES[sceneIdx]!;

  return (
    <div className="relative aurora-border rounded-2xl">
      <div className="relative glass rounded-2xl p-6 overflow-hidden">
        {/* Header — pretend Meet chrome */}
        <div className="flex items-center gap-2.5 mb-5">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
          </div>
          <span className="text-[10px] uppercase tracking-[0.16em] text-white/40 ml-2">
            meet.google.com
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-accent">
            <span className="relative inline-flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-accent animate-pulse-ring" />
              <span className="relative rounded-full bg-accent w-1.5 h-1.5" />
            </span>
            Recording
          </span>
        </div>

        {/* Customer transcript bubble */}
        <div className="space-y-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={`tr-${sceneIdx}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="flex gap-3"
            >
              <Avatar label="C" />
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-[0.15em] text-white/40 mb-1">
                  Customer
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-white/5 border border-white/5 px-4 py-3 text-sm text-white/80">
                  {scene.customer}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Coach response — thinking shimmer → final card */}
          <AnimatePresence mode="wait">
            {phase === 'thinking' && !reduced && (
              <motion.div
                key={`th-${sceneIdx}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex gap-3"
              >
                <Avatar label="R" mint />
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-[0.15em] text-accent mb-1">
                    Rocket · thinking…
                  </div>
                  <div className="space-y-1.5">
                    <ShimmerBar w="80%" />
                    <ShimmerBar w="65%" />
                    <ShimmerBar w="40%" />
                  </div>
                </div>
              </motion.div>
            )}
            {(phase === 'answer' || reduced) && (
              <motion.div
                key={`an-${sceneIdx}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                className="flex gap-3"
              >
                <Avatar label="R" mint />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] uppercase tracking-[0.15em] text-accent">
                      Rocket · {scene.type}
                    </span>
                    <span className="text-[10px] text-white/30">· 1.4s</span>
                  </div>
                  <div className={`relative rounded-2xl rounded-tl-sm border border-accent/30 bg-gradient-to-br ${scene.accent} to-transparent p-4`}>
                    <div className="absolute inset-0 rounded-2xl rounded-tl-sm bg-ink-800/70" />
                    <div className="relative">
                      <p className="text-sm text-white/90 leading-relaxed">
                        {scene.answer}
                      </p>
                      <div className="mt-3 flex items-center gap-2 text-[10px] text-white/50">
                        <DocIcon className="w-3 h-3 text-accent/80" />
                        <span>{scene.source}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer mini-controls */}
        <div className="mt-6 flex items-center gap-2 text-[10px] text-white/30">
          <span className="px-1.5 py-0.5 rounded border border-white/10">⌘ K</span>
          <span>command palette</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-accent" />
            <span>Connected to gateway</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Avatar({ label, mint = false }: { label: string; mint?: boolean }) {
  return (
    <div
      className={`relative w-9 h-9 rounded-full grid place-items-center text-[11px] font-semibold flex-shrink-0 ${
        mint
          ? 'bg-gradient-to-br from-accent to-electric-500 text-ink-900 shadow-[0_8px_24px_-8px_rgba(110,231,183,0.6)]'
          : 'bg-white/5 border border-white/10 text-white/70'
      }`}
    >
      {label}
    </div>
  );
}

function ShimmerBar({ w }: { w: string }) {
  return (
    <div
      className="h-3 rounded-full bg-white/[0.06] overflow-hidden relative"
      style={{ width: w }}
    >
      <div
        className="absolute inset-0 -translate-x-full animate-shimmer"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(110,231,183,0.18) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
        }}
      />
    </div>
  );
}

function DocIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
