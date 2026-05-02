import { redirect } from 'next/navigation';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { ScriptCollections } from '@/components/ScriptCollections';

interface MeResponse {
  user: { email: string };
  workspace: { name: string };
  role: string;
}

interface Collection {
  id: string;
  name: string;
  createdAt: string;
  currentVersion: {
    id: string;
    version: number;
    status: string;
    publishedAt: string | null;
  } | null;
  versionCount: number;
}

export const dynamic = 'force-dynamic';

export default async function ScriptsPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  const env = serverEnv();
  let me: MeResponse;
  let collections: Collection[];
  try {
    [me, collections] = await Promise.all([
      callBackend<MeResponse>({ baseUrl: env.apiUrl, path: '/v1/auth/me' }),
      callBackend<Collection[]>({ baseUrl: env.apiUrl, path: '/v1/scripts' }),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/signin');
    throw err;
  }
  const canEdit = ['admin', 'owner'].includes(me.role);

  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Scripts</h1>
      <p className="text-sm text-white/50 mb-6">
        Versioned playbooks. The published version is the one Athena grounds suggestions in
        during live calls.
      </p>
      <ScriptCollections initial={collections} canEdit={canEdit} />
    </Shell>
  );
}
