import Link from 'next/link';
import { getDict } from '@/lib/i18n/server';

interface OnboardingBannerProps {
  workspaceName: string;
}

/**
 * Surfaced on /dashboard when the workspace has zero meetings. One linear
 * path: /onboarding now opens with the extension install + connect gate,
 * then the guided playbook setup — so a single CTA covers the whole journey.
 */
export async function OnboardingBanner({ workspaceName }: OnboardingBannerProps) {
  const { t } = await getDict();
  const steps = [
    { title: t.banner.step1Title, body: t.banner.step1Body },
    { title: t.banner.step2Title, body: t.banner.step2Body },
    { title: t.banner.step3Title, body: t.banner.step3Body },
  ];
  return (
    <div className="rounded-xl border border-accent/30 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent p-6 mb-8">
      <div className="text-xs uppercase tracking-widest text-accent mb-2">
        {t.banner.welcome(workspaceName)}
      </div>
      <h2 className="text-lg font-medium mb-4">{t.banner.title}</h2>

      <ol className="mb-5 space-y-3 text-sm text-white/80">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 items-center">
            <Pill n={i + 1} />
            <span>
              <strong className="text-white">{s.title}</strong> {s.body}
            </span>
          </li>
        ))}
      </ol>

      <Link
        href="/onboarding"
        className="inline-flex items-center gap-2 rounded-lg bg-accent text-ink-900 font-semibold px-4 py-2 text-xs hover:scale-[1.02] active:scale-[0.98] transition-transform duration-200"
      >
        <span>{t.banner.cta}</span>
        <Arrow />
      </Link>
      <p className="mt-3 text-xs text-white/50">
        {t.banner.manual}{' '}
        <Link href="/knowledge" className="underline">{t.banner.manualKnowledge}</Link> ·{' '}
        <Link href="/install" className="underline">{t.banner.manualInstall}</Link>.
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
