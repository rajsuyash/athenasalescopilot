import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';

interface MeResponse {
  user: { email: string };
  workspace: { name: string };
}

interface DocSummary {
  id: string;
  name: string;
  status: string;
}

interface ScriptCollectionSummary {
  id: string;
  name: string;
  currentVersion: { version: number; status: string } | null;
}

export const dynamic = 'force-dynamic';

export default async function PlaybooksPage() {
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

  const [docs, collections] = await Promise.all([
    callBackend<DocSummary[]>({
      baseUrl: env.knowledgeUrl,
      path: '/v1/knowledge/documents',
    }).catch(() => [] as DocSummary[]),
    callBackend<ScriptCollectionSummary[]>({
      baseUrl: env.apiUrl,
      path: '/v1/scripts',
    }).catch(() => [] as ScriptCollectionSummary[]),
  ]);

  const publishedScripts = collections.filter(
    (c) => c.currentVersion?.status === 'published',
  ).length;

  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <header className="mb-8">
        <h1 className="text-2xl font-medium tracking-tight">Playbooks</h1>
        <p className="text-white/60 text-sm mt-1 max-w-2xl">
          Two kinds of content power the live coach during a call. Documents
          ground answers in your reference material. Scripts drive proactive
          stage-by-stage prompts (opening, discovery, pitch, closing).
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link
          href="/knowledge"
          className="group rounded-lg border border-white/10 bg-ink-900/40 p-6 hover:border-accent/60 hover:bg-ink-900/70 transition"
        >
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-medium group-hover:text-accent">Documents</h2>
            <span className="text-xs text-white/40">{docs.length} indexed</span>
          </div>
          <p className="text-sm text-white/60 mb-3">
            Reference material the coach grounds suggestions in. Upload product
            docs, case studies, FAQ, security one-pagers. The coach retrieves
            relevant chunks during objection handling and pitch.
          </p>
          <p className="text-xs text-white/40">
            Best for: factual answers, vendor comparisons, technical specs.
          </p>
        </Link>

        <Link
          href="/scripts"
          className="group rounded-lg border border-white/10 bg-ink-900/40 p-6 hover:border-accent/60 hover:bg-ink-900/70 transition"
        >
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-medium group-hover:text-accent">Scripts</h2>
            <span className="text-xs text-white/40">
              {publishedScripts} published
            </span>
          </div>
          <p className="text-sm text-white/60 mb-3">
            Stage-by-stage call playbook (opener → discovery → pitch → closing).
            The coach reads the active script and proactively suggests the rep&apos;s
            next opening line, qualifying question, or closing ask — without
            waiting for an objection.
          </p>
          <p className="text-xs text-white/40">
            Best for: discovery questions, pitch beats, objection reframes,
            next-step asks.
          </p>
        </Link>
      </div>

      <section className="mt-10 rounded-lg border border-white/5 bg-ink-900/30 p-5 text-sm text-white/60">
        <h3 className="text-white/80 font-medium mb-2">
          Not sure where to put it?
        </h3>
        <ul className="space-y-1 list-disc list-inside">
          <li>
            Stage-by-stage playbook (Open → Discover → Pitch → Close) →{' '}
            <strong className="text-white/80">Scripts</strong>
          </li>
          <li>
            Product docs, FAQs, case studies, pricing sheets →{' '}
            <strong className="text-white/80">Documents</strong>
          </li>
          <li>
            Sales call recording transcripts → <strong className="text-white/80">Documents</strong>
          </li>
          <li>
            Objection-reframer cheat sheet → <strong className="text-white/80">Documents</strong>{' '}
            (the coach uses these on customer objection turns)
          </li>
        </ul>
      </section>
    </Shell>
  );
}
