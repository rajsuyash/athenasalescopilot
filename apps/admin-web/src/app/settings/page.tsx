import { redirect } from 'next/navigation';
import { UserProfile } from '@clerk/nextjs';
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
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Settings</h1>

      <section className="mb-10">
        <h2 className="text-lg font-medium mb-3">Profile &amp; security</h2>
        <p className="text-sm text-white/50 mb-4 max-w-2xl">
          Manage your name, email, password, two-factor auth, connected
          accounts (Google / Microsoft), active sessions, and account
          deletion.
        </p>
        <UserProfile routing="hash" />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-medium mb-1">Workspace retention</h2>
        <p className="text-sm text-white/50 mb-3 max-w-2xl">
          PRD §7 defaults — transcripts 30 days, raw audio not retained,
          summaries 365 days, audit 365 days.
        </p>
        {!canEdit ? (
          <div className="rounded bg-yellow-500/10 text-yellow-300 text-sm p-3 mb-4">
            You&apos;re signed in as <code>{me.role}</code>. Only <code>owner</code> or{' '}
            <code>admin</code> can change retention.
          </div>
        ) : null}
        <RetentionForm initial={retention} />
        {canEdit ? <EnforceButton /> : null}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Billing</h2>
        <BillingCard canEdit={me.role === 'owner'} />
      </section>
    </Shell>
  );
}
