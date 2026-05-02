'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface Notif {
  id: string;
  kind: string;
  title: string;
  body: string;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

interface ListResponse {
  unread: number;
  notifications: Notif[];
}

type Filter = 'all' | 'unread';

export function InboxList() {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (filter === 'unread') qs.set('unreadOnly', 'true');
      const r = await fetch(`/api/notifications?${qs}`);
      if (!r.ok) return;
      const body = (await r.json()) as ListResponse;
      setItems(body.notifications ?? []);
      setUnread(body.unread);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (id: string): Promise<void> => {
    setItems((curr) =>
      curr.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    setUnread((u) => Math.max(0, u - 1));
    await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }).catch(
      () => undefined,
    );
  };

  const markAll = async (): Promise<void> => {
    setItems((curr) =>
      curr.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
    );
    setUnread(0);
    await fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => undefined);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs">
        <div className="rounded border border-white/10 inline-flex">
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </FilterButton>
          <FilterButton active={filter === 'unread'} onClick={() => setFilter('unread')}>
            Unread ({unread})
          </FilterButton>
        </div>
        <button
          onClick={() => void markAll()}
          disabled={unread === 0}
          className="ml-auto rounded border border-white/10 px-2 py-1 hover:bg-white/5 disabled:opacity-30"
        >
          Mark all read
        </button>
      </div>
      <div className="rounded-lg border border-white/5 bg-ink-800/40 divide-y divide-white/5">
        {loading ? (
          <div className="p-4 text-sm text-white/40">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-sm text-white/40">
            {filter === 'unread' ? 'Inbox zero. Nice.' : 'No notifications yet.'}
          </div>
        ) : (
          items.map((n) => <Row key={n.id} n={n} onMarkRead={() => void markRead(n.id)} />)
        )}
      </div>
    </div>
  );
}

function Row({ n, onMarkRead }: { n: Notif; onMarkRead: () => void }) {
  return (
    <div className="p-3 flex items-start gap-3">
      <span className="mt-1 text-xs">
        {n.readAt ? <span className="text-white/30">○</span> : <span className="text-accent">●</span>}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-white/40">{n.kind}</span>
          <span className="text-[10px] text-white/30">{new Date(n.createdAt).toLocaleString()}</span>
        </div>
        <div className="text-sm font-medium text-white/90">{n.title}</div>
        <div className="text-xs text-white/60">{n.body}</div>
      </div>
      <div className="flex flex-col gap-1 text-[11px]">
        {n.linkPath ? (
          <Link href={n.linkPath} onClick={onMarkRead} className="underline text-accent hover:text-white">
            Open
          </Link>
        ) : null}
        {!n.readAt ? (
          <button onClick={onMarkRead} className="text-white/50 hover:text-white">
            Mark read
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 ${
        active ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
