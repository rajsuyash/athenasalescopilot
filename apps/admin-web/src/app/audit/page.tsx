import { redirect } from 'next/navigation';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { AuditTable } from '@/components/AuditTable';

interface MeResponse {
  user: { email: string };
  workspace: { name: string };
  role: string;
}

const ALLOWED_ROLES = new Set(['compliance_viewer', 'admin', 'owner']);

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  const env = serverEnv();
  let me: MeResponse;
  try {
    me = await callBackend<MeResponse>({ baseUrl: env.apiUrl, path: '/v1/auth/me' });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/signin');
    throw err;
  }
  if (!ALLOWED_ROLES.has(me.role)) {
    return (
      <Shell email={me.user.email} workspace={me.workspace.name}>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Audit log</h1>
        <p className="rounded bg-yellow-500/10 text-yellow-300 text-sm p-3">
          You're signed in as <code>{me.role}</code>. Only{' '}
          <code>compliance_viewer</code>, <code>admin</code>, or <code>owner</code> can read the
          audit log.
        </p>
      </Shell>
    );
  }

  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Audit log</h1>
      <p className="text-sm text-white/50 mb-6">
        Append-only trail of admin actions, content changes, exports, and AI suggestion visibility.
      </p>
      <AuditTable />
    </Shell>
  );
}
