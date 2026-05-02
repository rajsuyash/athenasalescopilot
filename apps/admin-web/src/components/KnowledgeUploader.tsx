'use client';

import { useCallback, useRef, useState } from 'react';

interface IngestResult {
  documentId: string;
  versionId: string;
  chunkCount: number;
  duplicate: boolean;
}

interface ApiError {
  error?: string;
  message?: string;
}

const FORMAT_BY_EXT: Record<string, 'pdf' | 'csv' | 'docx' | 'markdown' | 'text'> = {
  pdf: 'pdf',
  csv: 'csv',
  docx: 'docx',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
};

const CATEGORIES = [
  'product_notes',
  'script',
  'faq',
  'battlecard',
  'pricing',
  'implementation',
  'security',
  'case_study',
] as const;

export function KnowledgeUploader() {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('product_notes');
  const [textInput, setTextInput] = useState('');
  const [textName, setTextName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.toLowerCase().split('.').pop() ?? '';
      const format = FORMAT_BY_EXT[ext];
      if (!format) {
        setStatus({ ok: false, text: `Unsupported extension: .${ext}` });
        return;
      }
      const form = new FormData();
      form.set('name', file.name);
      form.set('category', category);
      form.set('format', format);
      form.set('file', file);
      setBusy(true);
      setStatus(null);
      try {
        const res = await fetch('/api/knowledge/upload', { method: 'POST', body: form });
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
          const e = payload as ApiError | null;
          setStatus({ ok: false, text: e?.message ?? `HTTP ${res.status}` });
          return;
        }
        const r = payload as IngestResult;
        setStatus({
          ok: true,
          text: r.duplicate
            ? `duplicate; reused doc ${r.documentId}`
            : `ingested ${r.chunkCount} chunks → ${r.documentId}`,
        });
        // Refresh document list (server component re-fetches on navigation).
        window.dispatchEvent(new CustomEvent('athena:kb-refresh'));
      } catch (err) {
        setStatus({ ok: false, text: err instanceof Error ? err.message : 'upload failed' });
      } finally {
        setBusy(false);
      }
    },
    [category],
  );

  const submitText = useCallback(async () => {
    if (!textInput.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/knowledge/text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: textName || `inline-${Date.now()}`,
          category,
          format: 'text',
          text: textInput,
        }),
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
        const e = payload as ApiError | null;
        setStatus({ ok: false, text: e?.message ?? `HTTP ${res.status}` });
        return;
      }
      const r = payload as IngestResult;
      setStatus({
        ok: true,
        text: r.duplicate
          ? `duplicate; reused doc ${r.documentId}`
          : `ingested ${r.chunkCount} chunks → ${r.documentId}`,
      });
      setTextInput('');
      setTextName('');
      window.dispatchEvent(new CustomEvent('athena:kb-refresh'));
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : 'ingest failed' });
    } finally {
      setBusy(false);
    }
  }, [textInput, textName, category]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-xs text-white/60">Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
          className="rounded border border-white/10 bg-ink-700/60 px-2 py-1 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={[
          'rounded-lg border-2 border-dashed p-10 text-center cursor-pointer transition-colors',
          drag ? 'border-accent bg-accent/5' : 'border-white/10 hover:border-white/30',
          busy ? 'opacity-50 pointer-events-none' : '',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.csv,.docx,.md,.markdown,.txt"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.currentTarget.value = '';
          }}
        />
        <div className="text-sm font-medium">
          Drop a PDF, MD, TXT, CSV, or DOCX file here
        </div>
        <div className="text-xs text-white/40 mt-1">or click to browse · max 50 MB</div>
      </div>

      <div className="rounded-lg border border-white/5 bg-ink-800/40 p-4 space-y-2">
        <div className="text-xs text-white/60">Or paste text directly</div>
        <input
          value={textName}
          onChange={(e) => setTextName(e.target.value)}
          placeholder="Document name (optional)"
          className="w-full rounded border border-white/10 bg-ink-700/60 px-2 py-1 text-sm"
        />
        <textarea
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          rows={5}
          placeholder="Paste a script, FAQ snippet, retention policy, ..."
          className="w-full rounded border border-white/10 bg-ink-700/60 px-2 py-2 text-sm font-mono"
        />
        <div className="flex justify-end">
          <button
            onClick={() => void submitText()}
            disabled={busy || !textInput.trim()}
            className="rounded bg-accent text-ink-900 font-medium px-3 py-1 text-sm disabled:opacity-50"
          >
            Ingest text
          </button>
        </div>
      </div>

      {status ? (
        <div
          className={[
            'rounded p-3 text-sm',
            status.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300',
          ].join(' ')}
          data-testid="upload-status"
        >
          {status.text}
        </div>
      ) : null}
    </div>
  );
}
