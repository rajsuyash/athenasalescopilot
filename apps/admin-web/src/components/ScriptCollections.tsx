'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

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

export function ScriptCollections({
  initial,
  canEdit,
}: {
  initial: Collection[];
  canEdit: boolean;
}) {
  const [items, setItems] = useState<Collection[]>(initial);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch('/api/scripts');
    if (r.ok) setItems((await r.json()) as Collection[]);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async (): Promise<void> => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/scripts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { message?: string };
        setErr(body.message ?? `HTTP ${r.status}`);
        return;
      }
      setName('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Collection name (e.g. discovery script)"
            className="flex-1 rounded border border-white/10 bg-ink-700/60 px-3 py-2 text-sm"
            disabled={busy}
          />
          <button
            onClick={() => void create()}
            disabled={busy || !name.trim()}
            className="rounded bg-accent text-ink-900 font-medium px-3 py-2 text-sm disabled:opacity-50"
          >
            New collection
          </button>
        </div>
      ) : null}
      {err ? <div className="text-sm text-red-400">{err}</div> : null}

      {items.length === 0 ? (
        <p className="text-sm text-white/50">
          No script collections yet. Create one to start versioning your call playbook.
        </p>
      ) : (
        <div className="rounded-lg border border-white/5 bg-ink-800/40 divide-y divide-white/5">
          {items.map((c) => (
            <Link
              key={c.id}
              href={`/scripts/${c.id}`}
              className="block px-4 py-3 flex items-center text-sm hover:bg-white/5"
            >
              <span className="flex-1 truncate font-medium">{c.name}</span>
              <span className="w-32 text-xs text-white/50">
                {c.currentVersion
                  ? `v${c.currentVersion.version} published`
                  : `${c.versionCount} version${c.versionCount === 1 ? '' : 's'}`}
              </span>
              <span className="w-44 text-xs text-white/40 text-right">
                {new Date(c.createdAt).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
