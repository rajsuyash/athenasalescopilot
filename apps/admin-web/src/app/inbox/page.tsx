import { redirect } from 'next/navigation';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { InboxList } from '@/components/InboxList';

interface MeResponse {
  user: { email: string };
  workspace: { name: string };
  role: string;
}

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
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
  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Inbox</h1>
      <p className="text-sm text-white/50 mb-6">
        Flags, comments, and recap pings addressed to you. The bell shows recent unread; this page is
        the full archive.
      </p>
      <InboxList />
    </Shell>
  );
}
