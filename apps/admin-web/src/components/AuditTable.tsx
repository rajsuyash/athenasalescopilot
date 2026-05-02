'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface AuditEvent {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  actor: { id: string; email: string; name: string } | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadataJson: unknown;
  createdAt: string;
}

interface Facets {
  windowDays: number;
  actions: Array<{ action: string; count: number }>;
  actors: Array<{ id: string; email: string; name: string }>;
}

interface ListResponse {
  total: number;
  limit: number;
  offset: number;
  events: AuditEvent[];
}

const PAGE = 50;

export function AuditTable() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchEvents = useCallback(
    async (nextOffset: number) => {
      setBusy(true);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE),
          offset: String(nextOffset),
        });
        if (actionFilter) params.set('action', actionFilter);
        if (actorFilter) params.set('actorUserId', actorFilter);
        if (resourceTypeFilter) params.set('resourceType', resourceTypeFilter);
        const res = await fetch(`/api/audit?${params.toString()}`);
        if (!res.ok) return;
        const body = (await res.json()) as ListResponse;
        setEvents(body.events ?? []);
        setTotal(body.total ?? 0);
        setOffset(body.offset ?? nextOffset);
      } finally {
        setBusy(false);
      }
    },
    [actionFilter, actorFilter, resourceTypeFilter],
  );

  useEffect(() => {
    void fetch('/api/audit/facets?days=30')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setFacets(b as Facets | null));
  }, []);

  useEffect(() => {
    void fetchEvents(0);
  }, [fetchEvents]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE)), [total]);
  const currentPage = Math.floor(offset / PAGE) + 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-white/60 flex items-center gap-2">
          action
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded border border-white/10 bg-ink-700/60 px-2 py-1 text-sm"
          >
            <option value="">all</option>
            {facets?.actions.map((a) => (
              <option key={a.action} value={a.action}>
                {a.action} ({a.count})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-white/60 flex items-center gap-2">
          actor
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="rounded border border-white/10 bg-ink-700/60 px-2 py-1 text-sm"
          >
            <option value="">all</option>
            {facets?.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} &lt;{a.email}&gt;
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-white/60 flex items-center gap-2">
          resource
          <input
            value={resourceTypeFilter}
            onChange={(e) => setResourceTypeFilter(e.target.value)}
            placeholder="meeting / suggestion / …"
            className="rounded border border-white/10 bg-ink-700/60 px-2 py-1 text-sm w-40"
          />
        </label>
        <span className="ml-auto text-xs text-white/40">
          {total.toLocaleString()} event{total === 1 ? '' : 's'} match — page {currentPage}/{totalPages}
        </span>
        <ExportLink
          format="csv"
          filters={{ actionFilter, actorFilter, resourceTypeFilter }}
        />
        <ExportLink
          format="json"
          filters={{ actionFilter, actorFilter, resourceTypeFilter }}
        />
      </div>

      <div className="rounded-lg border border-white/5 bg-ink-800/40 divide-y divide-white/5">
        {events.length === 0 && !busy ? (
          <div className="px-4 py-6 text-center text-sm text-white/40">No audit events match.</div>
        ) : null}
        {events.map((e) => (
          <div key={e.id}>
            <button
              onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              className="w-full px-4 py-2 flex items-start gap-3 text-left hover:bg-white/5"
            >
              <span className="text-xs text-white/40 w-44 shrink-0">
                {new Date(e.createdAt).toLocaleString()}
              </span>
              <span className="font-mono text-xs text-white/80 w-56 shrink-0 truncate">
                {e.action}
              </span>
              <span className="text-xs text-white/60 truncate flex-1">
                {e.resourceType}/{e.resourceId.slice(0, 8)}…
              </span>
              <span className="text-xs text-white/40 truncate w-48 text-right">
                {e.actor?.email ?? '(system)'}
              </span>
            </button>
            {expanded === e.id ? (
              <div className="px-4 pb-3 text-xs space-y-1 bg-ink-900/40">
                <KV k="id" v={e.id} />
                {e.ipAddress ? <KV k="ip" v={e.ipAddress} /> : null}
                {e.userAgent ? <KV k="user-agent" v={e.userAgent} /> : null}
                <KV k="metadata" v={JSON.stringify(e.metadataJson, null, 2)} mono />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => void fetchEvents(Math.max(0, offset - PAGE))}
          disabled={busy || offset === 0}
          className="rounded border border-white/10 px-3 py-1 text-xs hover:bg-white/5 disabled:opacity-40"
        >
          ← prev
        </button>
        <button
          onClick={() => void fetchEvents(offset + PAGE)}
          disabled={busy || offset + PAGE >= total}
          className="rounded border border-white/10 px-3 py-1 text-xs hover:bg-white/5 disabled:opacity-40"
        >
          next →
        </button>
      </div>
    </div>
  );
}

function KV({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex">
      <span className="text-white/40 w-28">{k}</span>
      <span className={`text-white/80 break-all ${mono ? 'font-mono whitespace-pre-wrap' : ''}`}>
        {v}
      </span>
    </div>
  );
}

function ExportLink({
  format,
  filters,
}: {
  format: 'csv' | 'json';
  filters: { actionFilter: string; actorFilter: string; resourceTypeFilter: string };
}) {
  const params = new URLSearchParams({ format });
  if (filters.actionFilter) params.set('action', filters.actionFilter);
  if (filters.actorFilter) params.set('actorUserId', filters.actorFilter);
  if (filters.resourceTypeFilter) params.set('resourceType', filters.resourceTypeFilter);
  return (
    <a
      href={`/api/audit/export?${params.toString()}`}
      className="rounded border border-white/10 px-2 py-1 text-xs hover:bg-white/5"
      download
    >
      Export {format.toUpperCase()}
    </a>
  );
}
