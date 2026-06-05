/**
 * Guided-setup question copy — one prompt per BMC section, in the canonical
 * order the backend's BMC_SECTIONS enum and bmc-builder skill expect. The
 * wizard walks these top-to-bottom; each answer is POSTed to /v1/playbooks/
 * bmc/build, which runs the bmc-builder skill to turn the freeform answer into
 * a polished section.
 *
 * Keep `section` values in lockstep with services/knowledge-service BMC_SECTIONS.
 */
export interface OnboardingQuestion {
  section: string;
  label: string;
  /** The plain-English question the rep answers. */
  question: string;
  /** Short helper under the question — what a good answer looks like. */
  helper: string;
  /** Greyed placeholder example inside the textarea. */
  placeholder: string;
}

export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = [
  {
    section: 'passion',
    label: 'Passion / market',
    question: 'What market or problem are you genuinely excited to work in?',
    helper: 'The space you could talk about for hours — where your interest and expertise overlap.',
    placeholder:
      'e.g. Helping early-stage B2B founders fix their sales process — I have closed millions in deals and love teaching it.',
  },
  {
    section: 'niche',
    label: 'Niche',
    question: 'Who exactly is your ideal customer?',
    helper: 'Get specific: role, company size, stage, the situation that makes them a perfect fit.',
    placeholder:
      'e.g. Seed-to-Series-A SaaS founders doing $20k–$80k MRR who are still the only ones who can close deals.',
  },
  {
    section: 'problem',
    label: 'Domino problem',
    question: 'What is the single biggest problem you solve for them?',
    helper:
      'The "domino" — the one problem that, once solved, knocks down a chain of other problems.',
    placeholder:
      'e.g. They cannot hire reps because they have no repeatable script, so they stay stuck as the bottleneck.',
  },
  {
    section: 'usp',
    label: 'Unique value proposition',
    question: 'Why do customers choose you over the alternatives?',
    helper:
      'Your unmistakable edge — the must-have, the thing done better, and the delightful surprise.',
    placeholder:
      'e.g. A live AI coach that listens on the call and feeds the rep the exact next line, grounded in their own playbook.',
  },
  {
    section: 'mvp',
    label: 'MVP phases',
    question: 'What does the core offer look like, step by step?',
    helper: 'The phases or milestones a customer moves through from sign-up to result.',
    placeholder:
      'e.g. (1) Build their playbook, (2) install the live coach, (3) run 10 coached calls, (4) hand off to a hired rep.',
  },
  {
    section: 'mechanism',
    label: 'Unique mechanism',
    question: 'What is the unique mechanism that makes your offer actually work?',
    helper:
      'The "secret sauce" — the method or system that produces the result others cannot copy.',
    placeholder:
      'e.g. Grounded real-time retrieval: every suggestion cites the customer’s own approved sales material, so it never goes off-script.',
  },
  {
    section: 'message',
    label: 'Marketing message',
    question: 'What is the one-line message that grabs your customer’s attention?',
    helper: 'The hook that makes the right person stop and think "that is exactly me".',
    placeholder:
      'e.g. Close like your best rep on every call — even when your best rep is not on the call.',
  },
  {
    section: 'channel',
    label: 'Channel',
    question: 'Where do you find and reach these customers?',
    helper: 'Your top one or two acquisition channels — where attention actually converts.',
    placeholder:
      'e.g. Founder-led LinkedIn content plus warm intros from our existing customer base.',
  },
  {
    section: 'pricing',
    label: 'Pricing',
    question: 'How do you price and package the offer?',
    helper: 'Price points, tiers, and the structure (one-time, subscription, usage) of the deal.',
    placeholder:
      'e.g. $499/mo per seat, annual discount, plus a one-time $2k playbook build onboarding.',
  },
  {
    section: 'delivery',
    label: 'Delivery model',
    question: 'How is the offer delivered and supported?',
    helper:
      'How customers actually receive the value — software, service, done-with-you, support model.',
    placeholder:
      'e.g. Self-serve Chrome extension plus a weekly group coaching call and async Slack support.',
  },
] as const;
