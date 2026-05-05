import Link from 'next/link';

interface OnboardingBannerProps {
  workspaceName: string;
}

/**
 * Surfaced on /dashboard when the workspace has zero meetings. Lists the two
 * remaining setup steps so a fresh signup gets to a coached call quickly.
 *
 * Step 2 deep-links to /install (our internal install page) — the Web Store
 * listing is still in review, so /install is the only surface that actually
 * gets the user up and running today via the sideloaded .zip.
 */
export function OnboardingBanner({ workspaceName }: OnboardingBannerProps) {
  return (
    <div className="rounded-xl border border-accent/30 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent p-6 mb-8">
      <div className="text-xs uppercase tracking-widest text-accent mb-2">
        Welcome to {workspaceName}
      </div>
      <h2 className="text-lg font-medium mb-4">Two steps to your first coached call</h2>

      <ol className="space-y-4 text-sm text-white/80">
        <li className="flex gap-3">
          <Pill n={1} />
          <span className="pt-0.5">
            <Link href="/knowledge" className="text-accent underline underline-offset-2">
              Upload your sales playbook
            </Link>{' '}
            (a PDF deck or a chunk of FAQ text). We&apos;ve seeded a starter doc so suggestions
            already work — yours will be grounded in your own copy.
          </span>
        </li>

        <li className="flex gap-3">
          <Pill n={2} />
          <div className="pt-0.5 flex-1">
            <p>
              <strong className="text-white">Install the Rocket Chrome extension.</strong> Our Web
              Store listing is in review (typical wait: 1–3 weeks for audio-capture extensions). In
              the meantime, sideload the .zip — same code, same behavior, ~3 minutes to set up.
            </p>
            <Link
              href="/install"
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent text-ink-900 font-semibold px-4 py-2 text-xs hover:scale-[1.02] active:scale-[0.98] transition-transform duration-200"
            >
              <DownloadIcon />
              <span>Get the extension + install guide</span>
              <Arrow />
            </Link>
            <p className="mt-2 text-xs text-white/50">
              Already a Rocket CLI user? Run{' '}
              <code className="text-white/80">rocket listen</code> for a quick test without the
              extension.
            </p>
          </div>
        </li>
      </ol>
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

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
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
