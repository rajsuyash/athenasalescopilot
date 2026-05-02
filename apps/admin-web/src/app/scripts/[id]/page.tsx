import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { ScriptDetail } from '@/components/ScriptDetail';

interface MeResponse {
  user: { email: string };
  workspace: { name: string };
  role: string;
}

interface Block {
  id?: string;
  stage: string;
  persona: string | null;
  language: string;
  bodyMd: string;
  ordering: number;
}

interface VersionRow {
  id: string;
  version: number;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  blockCount: number;
}

interface Detail {
  id: string;
  name: string;
  currentVersionId: string | null;
  versions: VersionRow[];
  currentBlocks: Block[];
}

export const dynamic = 'force-dynamic';

export default async function ScriptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect('/signin');
  const env = serverEnv();
  let me: MeResponse;
  let detail: Detail;
  try {
    [me, detail] = await Promise.all([
      callBackend<MeResponse>({ baseUrl: env.apiUrl, path: '/v1/auth/me' }),
      callBackend<Detail>({
        baseUrl: env.apiUrl,
        path: `/v1/scripts/${encodeURIComponent(id)}`,
      }),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/signin');
    if (err instanceof ApiError && err.status === 404) {
      return (
        <Shell>
          <h1 className="text-xl font-semibold">Collection not found</h1>
          <Link href="/scripts" className="text-accent text-sm underline mt-3 inline-block">
            ← back to scripts
          </Link>
        </Shell>
      );
    }
    throw err;
  }
  const canEdit = ['admin', 'owner'].includes(me.role);

  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <Link href="/scripts" className="text-xs text-white/40 hover:text-white">
        ← Scripts
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight mt-2 mb-1">{detail.name}</h1>
      <p className="text-sm text-white/50 mb-6">
        {detail.currentVersionId
          ? 'A version is published — drafts here become the next candidate to publish.'
          : 'No version published yet. Save a draft and publish it to drive grounding.'}
      </p>
      <ScriptDetail initial={detail} canEdit={canEdit} />
    </Shell>
  );
}
