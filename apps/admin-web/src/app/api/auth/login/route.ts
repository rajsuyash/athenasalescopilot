import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env';
import { publicRedirectUrl } from '@/lib/redirect';
import { setSession } from '@/lib/session';

interface LoginResp {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: { id: string };
  workspace: { id: string };
}

export async function POST(req: Request): Promise<Response> {
  const env = serverEnv();
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const slugRaw = String(form.get('workspaceSlug') ?? '').trim();
  const body: Record<string, string> = { email, password };
  if (slugRaw) body.workspaceSlug = slugRaw;

  const res = await fetch(`${env.apiUrl}/v1/auth/login`, {
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
      publicRedirectUrl(`/signin?error=${encodeURIComponent(msg)}`, req),
      303,
    );
  }
  const data = payload as LoginResp;
  await setSession({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
    workspaceId: data.workspace.id,
  });
  return NextResponse.redirect(publicRedirectUrl('/dashboard', req), 303);
}
