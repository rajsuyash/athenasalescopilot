# Design Audit — Athena (Rocket Sales Agent) public site + admin UI
**Date:** 2026-05-15 · **Branch:** main · **Commit:** c437d59
**Target:** https://athena-admin-web-production.up.railway.app

Source-code-grounded audit. Live capture via gstack browse hit a tab-state
reset between commands so I used one good first-impression screenshot,
heading hierarchy extraction, and source review of the recently-changed
landing components + chrome-ext overlay surfaces.

Screenshots: `/tmp/athena-design-audit-20260515/screenshots/`

---

## Scores

| Surface | Design score | AI-slop score |
|---|---|---|
| Public landing (`/`) | **C+** (was B− pre-audit, dropped on scroll-render finding) | **B** |
| `/install` | **B** | **A−** |
| Admin Meeting Detail — Coach prompts panel | **A−** (post 227c937 redesign) | **A** |
| Chrome-ext in-Meet overlay | **B+** (post 227c937) | **A** |

The slop score is high (B+ to A across the board) because the recent work has been disciplined: no purple/violet gradients, no rocket emojis, no centered-everything, no decorative blobs, no generic "Welcome to X" copy. The 5-card bento grid is asymmetric (col-spans 3/3/2/2/2), not the canonical AI-slop 3-col grid.

---

## First impression (Phase 1)

> The site communicates **competence** but the first impression is **sparse**. Above the fold reads premium dark UI with a clean hero. Below the fold reads near-empty: the stat strip shows its 3 labels but no numbers; everything below is invisible until I scroll. If I'm skimming, I see a hero and then a black hole.

> First three things my eye goes to:
> 1. H1 "Close the deal while it's still hot." (72px / 600 weight — strong)
> 2. The glass card mockup showing a real coach prompt with cited source ("Onboarding: Workload framing")
> 3. The dual-CTA pair "Start free — no card" / "Install for Chrome"

> One word: **sparse.**

---

## Inferred design system

| Token | Observed | Notes |
|---|---|---|
| Font | system sans (rendered as Times in headless — actual prod is `-apple-system, BlinkMacSystemFont, Inter, ...`) | **AI-slop watch:** default font stack. No expressive type. Universal rule §"no default font stacks" applies. |
| H1 | 72px / 600 / -tracking-tight | Strong |
| H2 | 48px / 600 | Section heads |
| H2 (final CTA) | 60px / 600 | Slightly larger — intentional emphasis ✓ |
| H3 | **18px** / 600 | **Jump from 48→18 is 2.66× — very steep.** No mid-tier heading. |
| Body | unknown — needs CSS inspection per surface | |
| Accent | emerald `#34D399` ish (greenmint) + indigo glow at footer | Cool palette, consistent ✓ |
| Surface | dark-slate base + glass cards | Coherent ✓ |
| Console errors | 0 | ✓ |

---

## Findings (impact-ordered)

### FINDING-001 — HIGH — Below-fold sections hidden on initial paint

**Where:** `apps/admin-web/src/components/landing/{Stats.tsx, BentoGrid.tsx, HowItWorks.tsx, Pricing.tsx, Cta.tsx}` — all wrap content in `motion.div initial={{ opacity: 0, y: ... }}` + `whileInView` / `useInView`.

**Symptom:** The first viewport screenshot shows the hero + a stat strip with labels only (no numbers). The remaining ~4 sections render as black. The bento grid, the 3-step "How it works", pricing, and the final CTA aren't visible until the user scrolls into each one's intersection trigger.

**Why it matters:** Sales leaders skim B2B sites in 5-8 seconds before deciding to scroll. If the first viewport is a hero + apparently-empty page, they bounce. Even with `prefers-reduced-motion` fallback in `motion-utils.ts` (added in `cd29e5f`), the fallback only kills the animation — the `initial` opacity-0 state can still bite if the IntersectionObserver hasn't fired (which happens in headless renderers, slow connections, and any user whose scroll position hits the strip but margin gates haven't tripped).

**Evidence:** `screenshots/01-first-impression.png` shows the hero clearly, the stat strip with labels but no counter values, and ~70% black space below.

**Fix (minimal):** Change each section's `initial` to `{ opacity: 1, y: 0 }` (visible by default) and use `animate` only as a progressive enhancement when the user scrolls. The `whileInView` becomes the trigger for an entrance flourish, not a gate on visibility. Specifically:

```tsx
// Before
<motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} />

// After
<motion.div
  initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
  whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
  viewport={{ once: true }}
/>
```

Or simpler: rely on CSS-only entrance via `@starting-style` (Chrome 117+, Safari 17+) and drop the motion gate entirely for above-the-fold pre-render.

**Impact rating:** HIGH (first-impression destroyer)

---

### FINDING-002 — MEDIUM — Stats counters display "0" before inView fires

**Where:** `apps/admin-web/src/components/landing/Stats.tsx:42-59`

**Symptom:** Each Stat starts at `n = 0` (line 44) and only counts up after `useInView` fires. Before the user scrolls into the strip, the numbers display "0.0s", "0%", "0/7" — even though the actual values are 1.4s, 96%, 24/7. The strip looks broken.

**Why it matters:** This is the trust-metric band right under the hero. Showing zeros undermines the credibility claim it's supposed to make.

**Fix:** Initialize `useState(value)` (final value) instead of `useState(0)`. Use `useInView` only to trigger the count-UP animation FROM the displayed value, not gate the display. Or initialize to `value` for `prefers-reduced-motion` users and 0 for everyone else.

**Impact rating:** MEDIUM

---

### FINDING-003 — MEDIUM — Hero dual-CTA lacks primary/secondary differentiation

**Symptom:** Both "Start free — no card" and "Install for Chrome" appear to use the same mint-green styling in the screenshot. Two equally-prominent CTAs = no primary action. Sales leaders default to ambiguity-avoidance and click neither.

**Why it matters:** The hero is doing two jobs (signup AND install) without ranking them. Pick one as primary, demote the other to a secondary ghost-button.

**Fix:** "Start free — no card" stays mint-green primary. "Install for Chrome" → outline-only secondary (transparent bg, mint border, mint text). Maintains both paths, signals which one Rocket wants.

**Impact rating:** MEDIUM

---

### FINDING-004 — MEDIUM — Heading scale: 48 → 18 jump is too steep

**Where:** Multiple landing sections render H3 at 18px directly under H2 at 48px. Ratio: 2.66×. Standard scales (major third 1.25, perfect fourth 1.333, minor third 1.2) give a more readable rhythm: 48 → 32 → 24 → 18.

**Why it matters:** Big jumps make subheads feel like body text, weakening the visual hierarchy. Sales leaders scan headlines first; subheads should feel like a clear second tier, not a footnote.

**Fix:** Either bump section subheads to 24-28px, or introduce an intermediate H3 size for direct-under-section subheads (24px) and keep the current 18px for inline-card headers. In Tailwind: `text-xl` (20px) or `text-2xl` (24px) on the subheads inside bento/howitworks cards.

**Impact rating:** MEDIUM

---

### FINDING-005 — LOW — Default font stack flagged by universal rule

**Where:** The page uses Inter / system-ui via Tailwind defaults. Universal rule §"no default font stacks" calls this out as generic.

**Why it matters:** Voxdonna brand isn't recognizable from typography alone. A B2B sales tool can absolutely ship with Inter (most do), but the rule exists because "looks AI-generated" is the failure mode and default fonts are part of that signal.

**Fix:** Pair a display font (Söhne, Romie, Gambarino, Editorial New, Migra) for H1/H2 with Inter for body. Or commission a custom logo wordmark and reuse its letterforms in display tier. Defer if the brand isn't ready — this is a brand-system decision, not a styling fix.

**Impact rating:** LOW (acceptable to defer; brand decision)

---

### FINDING-006 — POLISH — Heading text-wrap balance

**Where:** Final-CTA H2 reads "Your next call deserves a coach.Ours is free." — no space after the period (likely a `<br>` is missing or `text-wrap: balance` is splitting awkwardly).

**Fix:** Wrap in `<span>Your next call deserves a coach.</span><br /><span>Ours is free.</span>` and add `text-wrap: balance` to the H2. Or fix the missing space in the source.

**Impact rating:** POLISH (cosmetic, but it's the final CTA so any glitch there is bad)

---

### FINDING-007 — POLISH — Admin Meeting Detail card colors are good but the H2 "Coach prompts" eyebrow at 60px (per earlier screenshot you shared) lacks a quiet "11 proactive · script-grounded" counter alignment

**Where:** `apps/admin-web/src/components/MeetingDetail.tsx` Coach prompts header.

**Symptom:** From the screenshot you shared 5 days ago: the title "Coach prompts" is left-aligned and the right-side meta ("11 proactive · script-grounded") sits at top edge. Vertical alignment looks correct but the meta is mint-green at the same weight as the title — flat hierarchy.

**Fix:** Demote the meta to white/55 small-caps tracked, OR turn it into a real status pill with a leading dot. The post-`227c937` redesign of the cards themselves is excellent (unified 17px speak-this style); the surrounding chrome can match.

**Impact rating:** POLISH

---

### FINDING-008 — POLISH — Footer aurora-gradient could read AI-slop blue-to-purple

**Where:** Bottom of `apps/admin-web/src/app/page.tsx` — the visible blue-purple-emerald aurora bloom above the footer.

**Symptom:** In the screenshot, the gradient blob behind the footer drifts blue-purple — close to AI-slop blacklist item #1 (purple/violet/indigo gradient).

**Why it matters:** It's far enough from the hero to not poison the first impression, but it's the last thing a scrolling user sees. The mint-emerald accent doesn't carry through the bottom of the page.

**Fix:** Pull the gradient toward mint/teal/emerald and away from blue/purple. Or de-saturate the bottom band so the aurora is barely there. Test with `chromatic-blue-aware` palette comparison.

**Impact rating:** POLISH

---

## What's working (don't change)

These are intentional and well-executed; flagging so the team doesn't touch them:

- **Hero glass card with cited source** — best single design moment on the site. Shows product working, includes "Onboarding: Workload framing" citation. Premium.
- **Asymmetric bento grid (3/3/2/2/2 col-spans)** — avoids the AI-slop 3-col grid trap. Cards have real visuals, not icon-in-circle decoration.
- **Mint-green accent + dark slate base** — coherent, not AI-default. Limited palette.
- **No rocket emojis, no "Welcome to X" copy, no "Let's dive in"** — disciplined copy across the audit.
- **Coach prompts panel post-227c937** — unified 17px speak-this style, no prefix labels, both answer and followup styled identically. Clear hierarchy fix.
- **Chrome-ext in-Meet glass overlay post-227c937** — `SPEAK_STYLE` const applied to both streaming and final cards, dropped "→ Ask next:" prefix. Production-ready.
- **Heading H1 at 72px / 600 / tracking-tight** — appropriately loud for a landing hero.

---

## Quick wins (≤30 min each)

1. **FINDING-002** — Initialize Stats counters to final value (5 min). Highest impact-per-effort ratio in the audit.
2. **FINDING-001** — Drop `initial={{ opacity: 0 }}` from sections that should be visible on first paint; keep `whileInView` for entrance animation as enhancement (15 min across 4-5 files).
3. **FINDING-006** — Fix "Ours is free." missing space in final CTA H2 (1 min).
4. **FINDING-003** — Outline-only secondary button for "Install for Chrome" (10 min).

Doing the first two together would lift the public-site design score from C+ → B+ in under 20 minutes.

---

## NOT in scope (deferred)

- Full responsive 3-breakpoint audit (mobile/tablet/desktop) — browse tab-state issue limited my live testing
- Lighthouse/Core Web Vitals — not measured here
- DESIGN.md export — offered but not generated
- Codex source-code audit (parallel voice) — deferred to keep this session focused

---

## Verdict

**Public landing: SHIP-but-iterate.** No CRITICAL findings; the hero, bento, and copy are good. The two HIGH/MEDIUM items (lazy-render hiding 80% of the page, stats showing zero) are 20 min of focused work and turn a C+ into a B+. Three POLISH items can wait.

**Admin UI + Chrome ext overlay: SHIP.** The Coach prompts redesign (`227c937`) closed the major UX gap the user reported. No new findings worth fixing today.
