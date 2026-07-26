/**
 * Tiny client for postcall-service + api-service. Used at session end to:
 *   1. mark the meeting `completed`
 *   2. fire Stage D recap
 *   3. fetch the summary so we can stream it back to the client
 *
 * Runs server-side with the SAME bearer token the WS connection authenticated
 * with — that token already carries `workspace_id`, so tenant scope is enforced
 * downstream (PRD F10).
 */

interface RecapRunResp {
  id: string;
  cached: boolean;
  source?: string;
  lowSignal?: boolean;
}

export interface RecapPayload {
  meetingId: string;
  title: string | null;
  summary: string;
  followupEmail: { subject: string; body: string };
  nextSteps: Array<{ owner: string; action: string; due: string | null }>;
  objections: Array<{ category: string; text: string; resolution: string; notes: string | null }>;
  crmSuggestions: {
    stage: string;
    nextStep: string | null;
    objections: string[];
    useCase: string | null;
    closeDateConfidence: number;
  };
  adherence: { framework: string; score: number; missing: string[] };
  lowSignal: boolean;
}

export async function endMeeting(apiUrl: string, token: string, meetingId: string): Promise<void> {
  const res = await fetch(`${apiUrl}/v1/meetings/${encodeURIComponent(meetingId)}/end`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: '{}',
  });
  // Don't throw on 404 — meeting may already be ended.
  if (!res.ok && res.status !== 404) {
    throw new Error(`endMeeting ${res.status}`);
  }
}

export async function runRecap(
  postcallUrl: string,
  token: string,
  meetingId: string,
): Promise<RecapPayload> {
  const post = await fetch(
    `${postcallUrl}/v1/postcall/meetings/${encodeURIComponent(meetingId)}/recap`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: '{}',
    },
  );
  if (!post.ok) throw new Error(`recap.run ${post.status}: ${await post.text().catch(() => '')}`);
  const _runResp = (await post.json()) as RecapRunResp;
  void _runResp;

  const get = await fetch(
    `${postcallUrl}/v1/postcall/meetings/${encodeURIComponent(meetingId)}/recap`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!get.ok) throw new Error(`recap.get ${get.status}`);
  const body = (await get.json()) as RecapPayload;
  return body;
}
