import { redirect } from 'next/navigation';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { RetentionForm } from '@/components/RetentionForm';
import { EnforceButton } from '@/components/EnforceButton';
import { BillingCard } from '@/components/BillingCard';

interface Retention {
  id: string;
  transcriptDays: number;
  audioDays: number;
  summaryDays: number;
  auditDays: number;
}

interface MeResponse {
  user: { email: string };
  workspace: { name: string };
  role: string;
}

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  const env = serverEnv();
  let me: MeResponse;
  let retention: Retention;
  try {
    [me, retention] = await Promise.all([
      callBackend<MeResponse>({ baseUrl: env.apiUrl, path: '/v1/auth/me' }),
      callBackend<Retention>({ baseUrl: env.apiUrl, path: '/v1/workspaces/me/retention' }),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/signin');
    throw err;
  }

  const canEdit = me.role === 'owner' || me.role === 'admin';

  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Settings</h1>
      <p className="text-sm text-white/50 mb-8">
        Workspace retention policy. Defaults follow PRD §7 — transcripts 30 days,
        raw audio not retained, summaries 365 days, audit 365 days.
      </p>

      {!canEdit ? (
        <div className="rounded bg-yellow-500/10 text-yellow-300 text-sm p-3 mb-4">
          You're signed in as <code>{me.role}</code>. Only <code>owner</code> or{' '}
          <code>admin</code> can change retention.
        </div>
      ) : null}

      <RetentionForm initial={retention} />
      {canEdit ? <EnforceButton /> : null}
      <BillingCard canEdit={me.role === 'owner'} />
    </Shell>
  );
}
