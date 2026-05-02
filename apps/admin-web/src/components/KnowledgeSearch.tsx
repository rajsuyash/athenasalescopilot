'use client';

import { useCallback, useState } from 'react';

interface SearchHit {
  id: string;
  text: string;
  score: number;
  documentName: string | null;
  category: string | null;
}

export function KnowledgeSearch() {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query, topK: '5' });
      const res = await fetch(`/api/knowledge/search?${params}`);
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
        const e = payload as { message?: string } | null;
        setError(e?.message ?? `HTTP ${res.status}`);
        return;
      }
      const r = payload as { chunks: SearchHit[] };
      setHits(r.chunks ?? []);
    } finally {
      setBusy(false);
    }
  }, [query]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
          placeholder='Try: "what is your data retention policy?"'
          className="flex-1 rounded border border-white/10 bg-ink-700/60 px-3 py-2 text-sm"
        />
        <button
          onClick={() => void run()}
          disabled={busy || !query.trim()}
          className="rounded bg-accent text-ink-900 font-medium px-4 py-2 text-sm disabled:opacity-50"
        >
          Search
        </button>
      </div>
      {error ? <div className="text-sm text-red-400">{error}</div> : null}
      {hits.length === 0 && !error ? (
        <div className="text-xs text-white/40">
          Hybrid pgvector + trigram, scoped to your workspace.
        </div>
      ) : null}
      <ul className="space-y-2">
        {hits.map((h) => (
          <li
            key={h.id}
            className="rounded border border-white/5 bg-ink-800/40 p-3 text-sm"
          >
            <div className="flex items-center justify-between text-xs text-white/40 mb-1">
              <span>{h.documentName ?? '(unknown doc)'}</span>
              <span>{(h.score ?? 0).toFixed(3)}</span>
            </div>
            <p className="whitespace-pre-wrap">{h.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
