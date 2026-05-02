'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

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

function fireBrowserNotification(n: Notif): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const native = new Notification(n.title, {
      body: n.body,
      tag: `athena:${n.id}`,
      icon: '/favicon.ico',
    });
    if (n.linkPath) {
      native.onclick = () => {
        window.focus();
        window.location.href = n.linkPath as string;
      };
    }
  } catch {
    // ignore — quota / permission edge cases
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notif[]>([]);
  const popRef = useRef<HTMLDivElement | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications?limit=20');
      if (!r.ok) return;
      const body = (await r.json()) as ListResponse;
      setUnread(body.unread);
      setItems(body.notifications ?? []);
      // Skip notifications on the first poll — those are the backlog. After
      // priming, only ping for IDs we've never seen.
      const fresh = body.notifications ?? [];
      if (primedRef.current) {
        for (const n of fresh) {
          if (n.readAt) continue;
          if (seenRef.current.has(n.id)) continue;
          fireBrowserNotification(n);
        }
      }
      seenRef.current = new Set(fresh.map((n) => n.id));
      primedRef.current = true;
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => undefined);
      }
    }
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const markAll = async (): Promise<void> => {
    setItems((curr) => curr.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    setUnread(0);
    await fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => undefined);
  };

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const markRead = async (id: string): Promise<void> => {
    setItems((curr) =>
      curr.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    setUnread((u) => Math.max(0, u - 1));
    await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  };

  return (
    <div className="relative" ref={popRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded px-2 py-1 hover:bg-white/5"
        title="Notifications"
        aria-label="notifications"
      >
        🔔
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] rounded-full px-1 min-w-[16px] text-center">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-lg border border-white/10 bg-ink-800 shadow-lg z-20">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 sticky top-0 bg-ink-800">
            <Link
              href="/inbox"
              className="text-[11px] uppercase tracking-wide text-white/50 hover:text-white"
            >
              Inbox →
            </Link>
            <button
              onClick={() => void markAll()}
              disabled={unread === 0}
              className="text-[10px] text-white/60 hover:text-white disabled:opacity-30"
            >
              Mark all read
            </button>
          </div>
          {items.length === 0 ? (
            <div className="p-3 text-xs text-white/40">No notifications.</div>
          ) : (
            items.map((n) => (
              <div key={n.id} className="p-3 border-b border-white/5 last:border-b-0">
                <div className="flex items-start gap-2">
                  <span className="text-xs">
                    {n.readAt ? '○' : <span className="text-accent">●</span>}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white/90">{n.title}</div>
                    <div className="text-[11px] text-white/60">{n.body}</div>
                    <div className="flex items-center justify-between mt-1 text-[10px] text-white/40">
                      <span>{new Date(n.createdAt).toLocaleString()}</span>
                      {n.linkPath ? (
                        <Link
                          href={n.linkPath}
                          onClick={() => void markRead(n.id)}
                          className="underline hover:text-white"
                        >
                          open
                        </Link>
                      ) : (
                        <button
                          onClick={() => void markRead(n.id)}
                          className="underline hover:text-white"
                          disabled={!!n.readAt}
                        >
                          mark read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
