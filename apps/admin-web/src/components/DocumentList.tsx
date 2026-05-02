'use client';

import { useCallback, useEffect, useState } from 'react';

interface DocSummary {
  id: string;
  name: string;
  category: string;
  status: string;
  createdAt: string;
}

export function DocumentList({ initial }: { initial: DocSummary[] }) {
  const [docs, setDocs] = useState<DocSummary[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge/documents');
      if (!res.ok) return;
      const list = (await res.json()) as DocSummary[];
      setDocs(list);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener('athena:kb-refresh', handler);
    return () => window.removeEventListener('athena:kb-refresh', handler);
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      if (!confirm('Delete this document? Chunks become inactive immediately. Hard delete runs via the retention job.')) {
        return;
      }
      setBusyId(id);
      try {
        const res = await fetch(`/api/knowledge/documents/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (!res.ok && res.status !== 204) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          alert(body.message ?? `HTTP ${res.status}`);
          return;
        }
        setDocs((prev) => prev.filter((d) => d.id !== id));
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  if (docs.length === 0) {
    return (
      <p className="text-sm text-white/50">
        No documents yet. Drop a PDF or paste a script above to get started.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-white/5 bg-ink-800/40 divide-y divide-white/5">
      {docs.map((d) => (
        <div key={d.id} className="px-4 py-3 flex items-center text-sm">
          <span className="flex-1 truncate" title={d.id}>{d.name}</span>
          <span className="w-24 text-xs text-white/40">{d.category}</span>
          <span className="w-20 text-xs text-white/40">{d.status}</span>
          <span className="w-44 text-xs text-white/40 text-right">
            {new Date(d.createdAt).toLocaleString()}
          </span>
          <button
            onClick={() => void remove(d.id)}
            disabled={busyId === d.id}
            className="ml-3 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
            title="Delete (soft)"
          >
            {busyId === d.id ? '...' : 'Delete'}
          </button>
        </div>
      ))}
    </div>
  );
}
