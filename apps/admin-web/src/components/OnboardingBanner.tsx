import Link from 'next/link';

interface OnboardingBannerProps {
  workspaceName: string;
}

/**
 * Surfaced on /dashboard when the workspace has zero meetings. Lists the two
 * remaining setup steps so a fresh signup gets to a coached call quickly.
 */
export function OnboardingBanner({ workspaceName }: OnboardingBannerProps) {
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-5 mb-8">
      <div className="text-xs uppercase tracking-widest text-accent mb-2">
        Welcome to {workspaceName}
      </div>
      <h2 className="text-lg font-medium mb-3">Two steps to your first coached call</h2>
      <ol className="space-y-3 text-sm text-white/80">
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs">
            1
          </span>
          <span>
            <Link href="/knowledge" className="text-accent underline">
              Upload your sales playbook
            </Link>{' '}
            (a PDF deck or a chunk of FAQ text). We&apos;ve seeded a starter doc so suggestions
            already work — yours will be grounded in your own copy.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs">
            2
          </span>
          <span>
            Install the{' '}
            <a
              className="text-accent underline"
              href="https://chrome.google.com/webstore"
              target="_blank"
              rel="noreferrer"
            >
              Chrome extension
            </a>{' '}
            and open a Google Meet — or run{' '}
            <code className="text-white/90">athena listen</code> from the CLI for a quick test.
          </span>
        </li>
      </ol>
    </div>
  );
}
