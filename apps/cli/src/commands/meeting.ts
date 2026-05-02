import { callApi, HttpError } from '../lib/api.js';
import { print } from '../lib/print.js';

interface Meeting {
  id: string;
  title: string | null;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
}

interface MeetingDetail extends Meeting {
  counts: { transcriptSegments: number; suggestions: number };
  hasSummary: boolean;
}

export async function meetingStartCmd(opts: { title?: string }): Promise<void> {
  try {
    const r = await callApi<Meeting>({
      method: 'POST',
      path: '/v1/meetings',
      body: { title: opts.title ?? null },
    });
    print.ok(`meeting ${r.id} started`);
    print.kv('id', r.id);
    if (r.title) print.kv('title', r.title);
    print.kv('status', r.status);
    if (r.startedAt) print.kv('startedAt', r.startedAt);
  } catch (err) {
    if (err instanceof HttpError) {
      print.err(`start failed: ${err.code}`);
      process.exit(1);
    }
    throw err;
  }
}

export async function meetingEndCmd(id: string): Promise<void> {
  try {
    const r = await callApi<{ id: string; status: string; endedAt: string | null }>({
      method: 'POST',
      path: `/v1/meetings/${encodeURIComponent(id)}/end`,
    });
    print.ok(`meeting ${r.id} ended`);
    if (r.endedAt) print.kv('endedAt', r.endedAt);
  } catch (err) {
    if (err instanceof HttpError) {
      print.err(`end failed: ${err.code}`);
      process.exit(1);
    }
    throw err;
  }
}

export async function meetingListCmd(opts: { limit?: number; status?: string }): Promise<void> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  try {
    const r = await callApi<{ total: number; meetings: Meeting[] }>({
      path: `/v1/meetings${qs ? `?${qs}` : ''}`,
    });
    if (r.meetings.length === 0) {
      print.warn('no meetings yet. Run `athena meeting start` or `athena listen --meeting "Title"`.');
      return;
    }
    print.heading(`${r.meetings.length}/${r.total} meeting(s)`);
    for (const m of r.meetings) {
      const when = m.startedAt ? m.startedAt.slice(0, 19).replace('T', ' ') : '?';
      print.kv(m.id, `${when}  [${m.status}]  ${m.title ?? '(untitled)'}`);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      print.err(`list failed: ${err.code}`);
      process.exit(1);
    }
    throw err;
  }
}

export async function meetingShowCmd(id: string): Promise<void> {
  try {
    const r = await callApi<MeetingDetail>({ path: `/v1/meetings/${encodeURIComponent(id)}` });
    print.heading(`meeting ${r.id}`);
    if (r.title) print.kv('title', r.title);
    print.kv('status', r.status);
    if (r.startedAt) print.kv('startedAt', r.startedAt);
    if (r.endedAt) print.kv('endedAt', r.endedAt);
    print.kv('transcript segments', String(r.counts.transcriptSegments));
    print.kv('suggestions', String(r.counts.suggestions));
    print.kv('hasSummary', String(r.hasSummary));
  } catch (err) {
    if (err instanceof HttpError) {
      print.err(`show failed: ${err.code}`);
      process.exit(1);
    }
    throw err;
  }
}
