import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env';
import { setSession } from '@/lib/session';

interface SignupResp {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: { id: string };
  workspace: { id: string };
}

export async function POST(req: Request): Promise<Response> {
  const env = serverEnv();
  const form = await req.formData();
  const body = {
    name: String(form.get('name') ?? '').trim(),
    email: String(form.get('email') ?? '').trim(),
    password: String(form.get('password') ?? ''),
    workspaceName: String(form.get('workspaceName') ?? '').trim(),
    workspaceSlug: String(form.get('workspaceSlug') ?? '')
      .trim()
      .toLowerCase(),
  };

  const res = await fetch(`${env.apiUrl}/v1/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!res.ok) {
    const e = payload as { error?: string; message?: string } | null;
    const msg = e?.message ?? `HTTP ${res.status}`;
    return NextResponse.redirect(
      new URL(
        `/signin?mode=signup&error=${encodeURIComponent(msg)}`,
        req.url,
      ),
      303,
    );
  }
  const data = payload as SignupResp;
  await setSession({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
    workspaceId: data.workspace.id,
  });
  return NextResponse.redirect(new URL('/dashboard', req.url), 303);
}
