'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Phase = 'idle' | 'uploading' | 'extracted' | 'generating' | 'done' | 'error';

interface ImportResponse {
  ok: boolean;
  version: number;
  data: Record<string, string>;
  confidence: number;
  indexed?: { indexed: number; skipped: number; failed: number } | null;
}

interface GenerateResponse {
  ok: boolean;
  collectionId: string;
  blockCount: number;
}

const SECTION_LABELS: Record<string, string> = {
  passion: 'Passion / market',
  niche: 'Niche',
  problem: 'Domino problem',
  usp: 'Unique value proposition',
  mvp: 'MVP phases',
  mechanism: 'Unique mechanism',
  message: 'Marketing message',
  channel: 'Channel',
  pricing: 'Pricing',
  delivery: 'Delivery model',
};

export function BmcUploader() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);

  async function handleUpload() {
    if (!file) return;
    setPhase('uploading');
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/playbooks/bmc/import', { method: 'POST', body: fd });
      const json = (await res.json().catch(() => ({}))) as ImportResponse & {
        code?: string;
        message?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.message ?? `Import failed (HTTP ${res.status})`);
        setPhase('error');
        return;
      }
      setExtracted(json);
      setPhase('extracted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
      setPhase('error');
    }
  }

  async function handleGenerate() {
    setPhase('generating');
    setError(null);
    try {
      const res = await fetch('/api/playbooks/script/generate', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as GenerateResponse & {
        message?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.message ?? `Generation failed (HTTP ${res.status})`);
        setPhase('error');
        return;
      }
      setCollectionId(json.collectionId);
      setPhase('done');
      // Auto-route to the script detail page after a beat so the user sees
      // the generated stages immediately.
      setTimeout(() => router.push(`/scripts/${json.collectionId}`), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generation failed');
      setPhase('error');
    }
  }

  return (
    <div className="space-y-6">
      {phase === 'idle' || phase === 'uploading' || phase === 'error' ? (
        <div className="rounded-lg border border-white/10 bg-ink-900/40 p-6">
          <label className="block text-sm font-medium mb-2">Choose a BMC PDF (or .md / .txt)</label>
          <input
            type="file"
            accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-white/70 file:mr-3 file:rounded file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-ink-900 file:font-medium"
          />
          <p className="text-xs text-white/40 mt-2">
            Max 50 MB. We extract 10 BMC sections via Claude. Documents that
            don&apos;t look like a BMC are rejected — try the guided builder
            instead (coming soon).
          </p>
          <button
            onClick={handleUpload}
            disabled={!file || phase === 'uploading'}
            className="mt-4 rounded bg-accent text-ink-900 font-medium px-4 py-1.5 text-sm disabled:opacity-40"
          >
            {phase === 'uploading' ? 'Extracting…' : 'Upload + extract BMC'}
          </button>
          {error ? <div className="mt-3 text-sm text-red-400">{error}</div> : null}
        </div>
      ) : null}

      {phase === 'extracted' && extracted ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
            BMC extracted with confidence{' '}
            <strong>{(extracted.confidence * 100).toFixed(0)}%</strong>. Review the sections
            below, then generate the script.
            {extracted.indexed && extracted.indexed.indexed > 0 ? (
              <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Indexed for retrieval · {extracted.indexed.indexed}/
                {extracted.indexed.indexed + extracted.indexed.skipped + extracted.indexed.failed}
                {' sections'}
              </div>
            ) : null}
          </div>
          <div className="rounded-lg border border-white/10 bg-ink-900/40 divide-y divide-white/5 max-h-[420px] overflow-y-auto">
            {Object.entries(SECTION_LABELS).map(([key, label]) => {
              const value = extracted.data[key] ?? '';
              return (
                <div key={key} className="p-3">
                  <div className="text-xs uppercase tracking-wide text-white/40 mb-1">{label}</div>
                  <div className="text-sm whitespace-pre-wrap text-white/80">
                    {value || <span className="text-white/30">(empty)</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            onClick={handleGenerate}
            className="rounded bg-accent text-ink-900 font-medium px-4 py-1.5 text-sm"
          >
            Generate sales script from BMC
          </button>
        </div>
      ) : null}

      {phase === 'generating' ? (
        <div className="rounded-lg border border-white/10 bg-ink-900/40 p-6 text-sm text-white/70">
          Generating SLOSHED 2.0 probing + 5-Step Pillar Pitching script…
          <div className="text-xs text-white/40 mt-1">
            This takes ~30-60 seconds. Don&apos;t close the tab.
          </div>
        </div>
      ) : null}

      {phase === 'done' && collectionId ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-6 text-sm">
          Script generated and published. The live coach will start using it
          within 30 seconds. Redirecting to the script editor…
        </div>
      ) : null}
    </div>
  );
}
