import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { MeetingDetail } from '@/components/MeetingDetail';

interface MeetingDetailDto {
  id: string;
  title: string | null;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  counts: { transcriptSegments: number; suggestions: number };
  hasSummary: boolean;
}

interface MeResponse {
  user: { email: string };
  workspace: { name: string };
  role: string;
}

export const dynamic = 'force-dynamic';

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect('/signin');

  const env = serverEnv();
  let me: MeResponse;
  let meeting: MeetingDetailDto;
  try {
    [me, meeting] = await Promise.all([
      callBackend<MeResponse>({ baseUrl: env.apiUrl, path: '/v1/auth/me' }),
      callBackend<MeetingDetailDto>({
        baseUrl: env.apiUrl,
        path: `/v1/meetings/${encodeURIComponent(id)}`,
      }),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/signin');
    if (err instanceof ApiError && err.status === 404) {
      return (
        <Shell>
          <h1 className="text-xl font-semibold mb-2">Meeting not found</h1>
          <p className="text-sm text-white/50">
            This meeting doesn't exist or isn't in your workspace.
          </p>
          <Link href="/meetings" className="text-accent text-sm underline mt-3 inline-block">
            ← back to meetings
          </Link>
        </Shell>
      );
    }
    throw err;
  }

  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <Link href="/meetings" className="text-xs text-white/40 hover:text-white">
        ← Meetings
      </Link>
      <div className="flex items-end justify-between mt-2 mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {meeting.title ?? '(untitled)'}
          </h1>
          <p className="text-xs text-white/50 mt-1 font-mono">{meeting.id}</p>
        </div>
        <div className="text-right text-xs text-white/50 space-y-0.5">
          <div>status: {meeting.status}</div>
          <div>
            {meeting.startedAt
              ? `started ${new Date(meeting.startedAt).toLocaleString()}`
              : '—'}
          </div>
          {meeting.endedAt ? (
            <div>ended {new Date(meeting.endedAt).toLocaleString()}</div>
          ) : null}
          <div>
            {meeting.counts.transcriptSegments} segments ·{' '}
            {meeting.counts.suggestions} suggestions
          </div>
        </div>
      </div>

      <MeetingDetail
        meetingId={meeting.id}
        canFlag={['manager', 'admin', 'owner'].includes(me.role)}
      />
    </Shell>
  );
}
