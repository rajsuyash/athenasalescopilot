'use client';

import { useCallback, useEffect, useState } from 'react';

interface Flag {
  id: string;
  reason: 'risky' | 'wrong' | 'example' | 'revisit' | string;
  notes: string | null;
  flaggedBy: string;
  resolvedAt: string | null;
  createdAt: string;
}

interface Comment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

const REASONS: Array<Flag['reason']> = ['risky', 'wrong', 'example', 'revisit'];

export function CoachingThread({
  suggestionId,
  canFlag,
}: {
  suggestionId: string;
  canFlag: boolean;
}) {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reason, setReason] = useState<Flag['reason']>('risky');
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/suggestions/${encodeURIComponent(suggestionId)}/coaching`);
    if (!r.ok) return;
    const body = (await r.json()) as { flags: Flag[]; comments: Comment[] };
    setFlags(body.flags ?? []);
    setComments(body.comments ?? []);
  }, [suggestionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submitFlag = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await fetch(`/api/suggestions/${encodeURIComponent(suggestionId)}/flag`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason, notes: notes.trim() || undefined }),
      });
      if (r.ok) {
        setNotes('');
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const resolveFlag = async (flagId: string): Promise<void> => {
    setBusy(true);
    try {
      const r = await fetch(
        `/api/suggestions/${encodeURIComponent(suggestionId)}/flags/${encodeURIComponent(flagId)}/resolve`,
        { method: 'POST' },
      );
      if (r.ok) await refresh();
    } finally {
      setBusy(false);
    }
  };

  const submitComment = async (): Promise<void> => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/suggestions/${encodeURIComponent(suggestionId)}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: draft.trim() }),
      });
      if (r.ok) {
        setDraft('');
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded border border-white/10 bg-ink-900/50 p-2 text-xs space-y-2">
      {flags.length > 0 ? (
        <ul className="space-y-1">
          {flags.map((f) => (
            <li key={f.id} className="flex items-start gap-2">
              <span
                className={`px-1.5 py-0.5 rounded font-mono uppercase ${
                  f.resolvedAt
                    ? 'bg-white/10 text-white/40 line-through'
                    : 'bg-yellow-500/20 text-yellow-200'
                }`}
              >
                {f.reason}
              </span>
              {f.notes ? (
                <span className={f.resolvedAt ? 'text-white/40 line-through' : 'text-white/80'}>
                  {f.notes}
                </span>
              ) : null}
              {!f.resolvedAt && canFlag ? (
                <button
                  onClick={() => void resolveFlag(f.id)}
                  className="ml-auto text-white/40 hover:text-white"
                  disabled={busy}
                >
                  resolve
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canFlag ? (
        <div className="flex items-center gap-2">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as Flag['reason'])}
            className="rounded border border-white/10 bg-ink-700/60 px-1.5 py-0.5 text-[11px]"
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="optional note"
            className="flex-1 rounded border border-white/10 bg-ink-700/60 px-2 py-0.5 text-[11px]"
          />
          <button
            onClick={() => void submitFlag()}
            disabled={busy}
            className="rounded border border-white/10 px-2 py-0.5 text-[11px] hover:bg-white/5 disabled:opacity-50"
          >
            Flag
          </button>
        </div>
      ) : null}

      {comments.length > 0 ? (
        <ul className="space-y-1">
          {comments.map((c) => (
            <li key={c.id} className="border-l-2 border-white/10 pl-2">
              <div className="text-white/40 text-[10px] font-mono">
                {c.authorId.slice(0, 8)} · {new Date(c.createdAt).toLocaleString()}
              </div>
              <div className="text-white/80 whitespace-pre-wrap">{c.body}</div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-start gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Comment…"
          rows={1}
          className="flex-1 rounded border border-white/10 bg-ink-700/60 px-2 py-1 text-[11px] resize-none"
        />
        <button
          onClick={() => void submitComment()}
          disabled={busy || !draft.trim()}
          className="rounded bg-accent text-ink-900 font-medium px-2 py-1 text-[11px] disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
