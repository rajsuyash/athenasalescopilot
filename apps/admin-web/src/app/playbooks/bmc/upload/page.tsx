import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';
import { BmcUploader } from '@/components/BmcUploader';

interface MeResponse {
  user: { email: string };
  workspace: { name: string };
}

export const dynamic = 'force-dynamic';

export default async function BmcUploadPage() {
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

  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <header className="mb-6">
        <Link href="/playbooks" className="text-xs text-white/40 hover:text-white/70">
          &larr; Playbooks
        </Link>
        <h1 className="text-2xl font-medium tracking-tight mt-2">
          Generate your sales script from a BMC
        </h1>
        <p className="text-white/60 text-sm mt-1 max-w-2xl">
          Upload your Business Model Canvas as a PDF. We extract your niche,
          domino problem, MVP phases, mechanism, and pricing — then the agent
          uses the sales-script-generator skill to write a full SLOSHED 2.0
          probing + 5-Step Pillar Pitching script tailored to your offer. The
          live coach starts using it within 30 seconds.
        </p>
      </header>
      <BmcUploader />
    </Shell>
  );
}
