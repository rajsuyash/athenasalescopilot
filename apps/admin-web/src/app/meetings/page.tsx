import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';

interface Meeting {
  id: string;
  title: string | null;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  externalPlatform: string;
}

interface MeResponse {
  user: { email: string };
  workspace: { name: string };
}

export const dynamic = 'force-dynamic';

export default async function MeetingsPage() {
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

  const meetings = await callBackend<{ total: number; meetings: Meeting[] }>({
    baseUrl: env.apiUrl,
    path: '/v1/meetings?limit=50',
  }).catch(() => ({ total: 0, meetings: [] as Meeting[] }));

  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Meetings</h1>
      <p className="text-sm text-white/50 mb-6">
        Hosted by you. Run <code className="text-white/70">athena listen --gateway</code> from the
        CLI or open the macOS overlay to capture more.
      </p>

      {meetings.meetings.length === 0 ? (
        <p className="text-sm text-white/50">No meetings yet.</p>
      ) : (
        <div className="rounded-lg border border-white/5 bg-ink-800/40 divide-y divide-white/5">
          {meetings.meetings.map((m) => (
            <Link
              key={m.id}
              href={`/meetings/${m.id}`}
              className="block px-4 py-3 flex items-center text-sm hover:bg-white/5 transition-colors"
            >
              <div className="flex-1 truncate">
                <div className="font-medium">{m.title ?? '(untitled)'}</div>
                <div className="text-xs text-white/40 font-mono">{m.id}</div>
              </div>
              <span className="w-24 text-xs text-white/40">{m.status}</span>
              <span className="w-44 text-xs text-white/40 text-right">
                {m.startedAt ? new Date(m.startedAt).toLocaleString() : '—'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}
