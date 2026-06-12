import Link from 'next/link';

interface OnboardingBannerProps {
  workspaceName: string;
}

/**
 * Surfaced on /dashboard when the workspace has zero meetings. One linear
 * path: /onboarding now opens with the extension install + connect gate,
 * then the guided playbook setup — so a single CTA covers the whole journey.
 */
export function OnboardingBanner({ workspaceName }: OnboardingBannerProps) {
  return (
    <div className="rounded-xl border border-accent/30 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent p-6 mb-8">
      <div className="text-xs uppercase tracking-widest text-accent mb-2">
        Welcome to {workspaceName}
      </div>
      <h2 className="text-lg font-medium mb-4">Get to your first coached call</h2>

      <ol className="mb-5 space-y-3 text-sm text-white/80">
        <li className="flex gap-3 items-center">
          <Pill n={1} />
          <span>
            <strong className="text-white">Install the Chrome extension</strong> — it joins your
            Google Meet calls and powers the live coach.
          </span>
        </li>
        <li className="flex gap-3 items-center">
          <Pill n={2} />
          <span>
            <strong className="text-white">Connect it</strong> — one click, signs the extension
            into this workspace.
          </span>
        </li>
        <li className="flex gap-3 items-center">
          <Pill n={3} />
          <span>
            <strong className="text-white">Build your playbook</strong> — a few questions become
            your canvas, script, and objection handling.
          </span>
        </li>
      </ol>

      <Link
        href="/onboarding"
        className="inline-flex items-center gap-2 rounded-lg bg-accent text-ink-900 font-semibold px-4 py-2 text-xs hover:scale-[1.02] active:scale-[0.98] transition-transform duration-200"
      >
        <span>Start setup (~5 minutes)</span>
        <Arrow />
      </Link>
      <p className="mt-3 text-xs text-white/50">
        Prefer manual setup? Upload docs on{' '}
        <Link href="/knowledge" className="underline">Knowledge</Link> · install guide on{' '}
        <Link href="/install" className="underline">/install</Link>.
      </p>
    </div>
  );
}

function Pill({ n }: { n: number }) {
  return (
    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-semibold ring-1 ring-accent/30">
      {n}
    </span>
  );
}

function Arrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3 h-3"
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}
