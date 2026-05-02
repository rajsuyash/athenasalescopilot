import { redirect } from 'next/navigation';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { KnowledgeUploader } from '@/components/KnowledgeUploader';
import { KnowledgeSearch } from '@/components/KnowledgeSearch';
import { DocumentList } from '@/components/DocumentList';

interface DocSummary {
  id: string;
  name: string;
  category: string;
  status: string;
  createdAt: string;
}

interface MeResponse {
  user: { email: string };
  workspace: { name: string };
}

export const dynamic = 'force-dynamic';

export default async function KnowledgePage() {
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

  const docs = await callBackend<DocSummary[]>({
    baseUrl: env.knowledgeUrl,
    path: '/v1/knowledge/documents',
  }).catch(() => [] as DocSummary[]);

  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section>
          <h2 className="text-lg font-medium mb-3">Add knowledge</h2>
          <KnowledgeUploader />
        </section>
        <section>
          <h2 className="text-lg font-medium mb-3">Search</h2>
          <KnowledgeSearch />
        </section>
      </div>

      <section className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium">
            Documents <span className="text-white/40 text-sm">({docs.length})</span>
          </h2>
        </div>
        <DocumentList initial={docs} />
      </section>
    </Shell>
  );
}
