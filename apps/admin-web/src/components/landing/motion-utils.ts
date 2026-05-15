'use client';

/**
 * Shared framer-motion props for landing-page fade-up animations.
 *
 * Two pieces of behaviour matter:
 *   1. `prefers-reduced-motion` users get NO animation at all — content
 *      renders at its natural CSS state immediately (`initial={false}`).
 *      Without this, we'd ship a sub-par experience to the audience that
 *      explicitly asked the OS to suppress motion.
 *   2. The whileInView margin used to be `-80px` on all sides, which
 *      shrinks the IntersectionObserver root by 80 px in every direction.
 *      On a 375x812 mobile viewport the trigger window becomes very
 *      narrow, so sections sometimes fail to fire when the user
 *      scroll-jumps via touch. We use `0px 0px -100px 0px` instead —
 *      meaning "fire when the element is 100 px above the viewport
 *      bottom" — which is more permissive without being trigger-happy
 *      on the way down.
 *
 * Components import `useFadeUp(opts)` and spread the result into a
 * <motion.div>:
 *
 *     const fadeUp = useFadeUp();
 *     <motion.div {...fadeUp({ y: 24, delay: 0.06 })}> ...
 *
 * The hook returns a function so each call site can override per-element
 * delay / y-offset without re-reading the user's reduced-motion pref.
 */
import { useReducedMotion, type MotionProps } from 'framer-motion';

export interface FadeUpOptions {
  /** Vertical offset before the animation runs. Default 24. */
  y?: number;
  /** Per-element start delay in seconds. Default 0. */
  delay?: number;
  /** Total animation duration in seconds. Default 0.6. */
  duration?: number;
}

export function useFadeUp(): (opts?: FadeUpOptions) => MotionProps {
  const reduce = useReducedMotion();
  return (opts: FadeUpOptions = {}) => {
    if (reduce) {
      // Skip animation entirely. `initial={false}` tells framer-motion to
      // render the element with its natural CSS state — no opacity/transform
      // overrides, no transition. Equivalent to not wrapping in motion.* at all.
      return { initial: false } satisfies MotionProps;
    }
    const { y = 24, delay = 0, duration = 0.6 } = opts;
    // Content renders VISIBLE on first paint — `initial` only translates by
    // `y`, never goes to opacity 0. Sections below the fold still slide up
    // when scrolled into view, but a user who never scrolls (skim-and-bounce)
    // sees the full page, not 70% empty space waiting for the
    // IntersectionObserver to fire. Caught in 2026-05-15 design audit:
    // headless renderers and 5-second skim users were seeing an empty page
    // because every section started at opacity 0.
    return {
      initial: { opacity: 1, y },
      whileInView: { opacity: 1, y: 0 },
      viewport: { once: true, margin: '0px 0px -100px 0px' },
      transition: { duration, ease: [0.16, 1, 0.3, 1], delay },
    } satisfies MotionProps;
  };
}
