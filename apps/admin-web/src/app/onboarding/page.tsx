import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { ExtensionSetupGate } from '@/components/ExtensionSetupGate';
import extensionMeta from '@/lib/extension-meta.json';
import { getDict } from '@/lib/i18n/server';

interface MeResponse {
  user: { email: string };
  workspace: { name: string };
}

interface BmcResponse {
  data: Record<string, string>;
  sourceType: string | null;
  version: number;
  updatedAt: string | null;
}

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/signin');

  const env = serverEnv();
  const { locale, t } = await getDict();
  let me: MeResponse;
  try {
    me = await callBackend<MeResponse>({ baseUrl: env.apiUrl, path: '/v1/auth/me' });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/signin');
    throw err;
  }

  // Read the current BMC so the wizard resumes at the first empty section.
  const bmc = await callBackend<BmcResponse>({
    baseUrl: env.knowledgeUrl,
    path: '/v1/playbooks/bmc',
  }).catch(() => ({ data: {}, sourceType: null, version: 0, updatedAt: null }) as BmcResponse);

  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <header className="mb-8">
        <Link href="/dashboard" className="text-xs text-white/40 hover:text-white/70">
          &larr; {t.onboarding.backToDashboard}
        </Link>
        <h1 className="text-2xl font-medium tracking-tight mt-2">{t.onboarding.title}</h1>
        <p className="text-white/60 text-sm mt-1 max-w-2xl">{t.onboarding.subtitle}</p>
      </header>

      <ExtensionSetupGate
        zipHref={`/downloads/${extensionMeta.zipName}`}
        version={extensionMeta.version}
        locale={locale}
      >
        <OnboardingWizard initialSections={bmc.data ?? {}} initialVersion={bmc.version ?? 0} />
      </ExtensionSetupGate>
    </Shell>
  );
}
