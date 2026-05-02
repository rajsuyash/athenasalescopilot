import { redirect } from 'next/navigation';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { OnboardingBanner } from '@/components/OnboardingBanner';

interface MeResponse {
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string; slug: string; planTier: string };
  role: string;
}

interface DocSummary {
  id: string;
  name: string;
  category: string;
  status: string;
  createdAt: string;
}

interface MeetingsResponse {
  total: number;
  meetings: Array<{
    id: string;
    title: string | null;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
  }>;
}

export default async function DashboardPage() {
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

  const [docs, meetings] = await Promise.all([
    callBackend<DocSummary[]>({
      baseUrl: env.knowledgeUrl,
      path: '/v1/knowledge/documents',
    }).catch(() => [] as DocSummary[]),
    callBackend<MeetingsResponse>({
      baseUrl: env.apiUrl,
      path: '/v1/meetings?limit=5',
    }).catch(() => ({ total: 0, meetings: [] }) as MeetingsResponse),
  ]);

  const isFresh = meetings.total === 0;

  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">{me.workspace.name}</h1>
      <p className="text-white/60 text-sm mb-8">
        {me.user.name} · {me.role} · plan {me.workspace.planTier}
      </p>

      {isFresh ? <OnboardingBanner workspaceName={me.workspace.name} /> : null}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        <Stat label="Workspace role" value={me.role} />
        <Stat label="Documents" value={String(docs.length)} />
        <Stat label="Recent meetings" value={String(meetings.total)} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-lg border border-white/5 bg-ink-800/40 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Latest documents</h2>
            <a href="/knowledge" className="text-xs text-accent hover:underline">
              Manage →
            </a>
          </div>
          {docs.length === 0 ? (
            <p className="text-sm text-white/50">
              No documents yet. Upload scripts, FAQs, battlecards on{' '}
              <a className="underline" href="/knowledge">
                Knowledge
              </a>
              .
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {docs.slice(0, 6).map((d) => (
                <li key={d.id} className="flex items-center justify-between">
                  <span className="truncate mr-3">{d.name}</span>
                  <span className="text-xs text-white/40">{d.category}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-white/5 bg-ink-800/40 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Recent meetings</h2>
            <a href="/meetings" className="text-xs text-accent hover:underline">
              View all →
            </a>
          </div>
          {meetings.meetings.length === 0 ? (
            <p className="text-sm text-white/50">
              No meetings yet. Run <code className="text-white/70">athena listen</code> from the CLI
              or open the Mac overlay.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {meetings.meetings.map((m) => (
                <li key={m.id} className="flex items-center justify-between">
                  <span className="truncate mr-3">{m.title ?? '(untitled)'}</span>
                  <span className="text-xs text-white/40">{m.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-ink-800/40 p-4">
      <div className="text-xs text-white/40 mb-1">{label}</div>
      <div className="text-2xl font-medium">{value}</div>
    </div>
  );
}
