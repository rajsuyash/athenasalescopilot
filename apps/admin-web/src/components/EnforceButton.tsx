'use client';

import { useState } from 'react';

interface EnforceResult {
  workspaceId: string;
  transcripts: number;
  summaries: number;
  audits: number;
  archivedDocuments: number;
}

export function EnforceButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EnforceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (
      !confirm(
        'Run retention enforcement now? Hard-deletes data past the configured TTLs. Cannot be undone.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/retention/enforce', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as Partial<EnforceResult> & {
        message?: string;
      };
      if (!res.ok) {
        setError(body.message ?? `HTTP ${res.status}`);
        return;
      }
      setResult(body as EnforceResult);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-white/5 bg-ink-800/40 p-5 mt-6 space-y-3">
      <div>
        <h3 className="font-medium">Enforce now</h3>
        <p className="text-xs text-white/50">
          Manual sweep across this workspace. The retention worker also runs
          hourly in the background.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => void run()}
          disabled={busy}
          className="rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 px-3 py-1 text-sm disabled:opacity-50"
        >
          {busy ? 'Running…' : 'Enforce retention now'}
        </button>
        {result ? (
          <div className="text-xs text-white/60">
            transcripts={result.transcripts} summaries={result.summaries} audits=
            {result.audits} archivedDocs={result.archivedDocuments}
          </div>
        ) : null}
        {error ? <div className="text-xs text-red-400">{error}</div> : null}
      </div>
    </div>
  );
}
