'use client';

import { useCallback, useEffect, useState } from 'react';

interface Block {
  id?: string;
  stage: string;
  persona: string | null;
  language: string;
  bodyMd: string;
  ordering: number;
}

interface VersionRow {
  id: string;
  version: number;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  blockCount: number;
}

interface Detail {
  id: string;
  name: string;
  currentVersionId: string | null;
  versions: VersionRow[];
  currentBlocks: Block[];
}

const TEMPLATE: Block[] = [
  {
    stage: 'opener',
    persona: null,
    language: 'en-US',
    bodyMd: 'Thanks for jumping on. Quick intro and what we hope to cover.',
    ordering: 0,
  },
  {
    stage: 'discovery',
    persona: null,
    language: 'en-US',
    bodyMd:
      '- What does your team do today?\n- Where does the existing tooling break down?\n- What does success look like 6 months from now?',
    ordering: 0,
  },
  {
    stage: 'objection_handling',
    persona: null,
    language: 'en-US',
    bodyMd: 'Acknowledge → reframe → ground in the approved retention / pricing snippet.',
    ordering: 0,
  },
  {
    stage: 'closing',
    persona: null,
    language: 'en-US',
    bodyMd: 'Next step: confirm decision criteria + schedule the technical deep-dive.',
    ordering: 0,
  },
];

export function ScriptDetail({ initial, canEdit }: { initial: Detail; canEdit: boolean }) {
  const [detail, setDetail] = useState<Detail>(initial);
  const [draft, setDraft] = useState<Block[]>(
    initial.currentBlocks.length > 0
      ? initial.currentBlocks.map((b, i) => ({ ...b, ordering: b.ordering ?? i }))
      : TEMPLATE,
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/scripts/${encodeURIComponent(detail.id)}`);
    if (r.ok) {
      const d = (await r.json()) as Detail;
      setDetail(d);
    }
  }, [detail.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveDraft = async (): Promise<void> => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/scripts/${encodeURIComponent(detail.id)}/versions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blocks: draft.map((b) => ({
            stage: b.stage,
            persona: b.persona ?? undefined,
            language: b.language,
            bodyMd: b.bodyMd,
            ordering: b.ordering,
          })),
        }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        message?: string;
        version?: number;
      };
      if (!r.ok) {
        setStatus({ ok: false, text: body.message ?? `HTTP ${r.status}` });
        return;
      }
      setStatus({ ok: true, text: `Draft v${body.version} saved.` });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const publish = async (versionId: string): Promise<void> => {
    if (!confirm('Publish this version? Active sessions complete on the prior version.')) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch(
        `/api/scripts/${encodeURIComponent(detail.id)}/versions/${encodeURIComponent(versionId)}/publish`,
        { method: 'POST' },
      );
      const body = (await r.json().catch(() => ({}))) as {
        message?: string;
        version?: number;
      };
      if (!r.ok) {
        setStatus({ ok: false, text: body.message ?? `HTTP ${r.status}` });
        return;
      }
      setStatus({ ok: true, text: `Published v${body.version}.` });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const updateBlock = (idx: number, patch: Partial<Block>): void => {
    setDraft((cur) => cur.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };
  const addBlock = (): void =>
    setDraft((cur) => [
      ...cur,
      { stage: 'discovery', persona: null, language: 'en-US', bodyMd: '', ordering: cur.length },
    ]);
  const removeBlock = (idx: number): void =>
    setDraft((cur) => cur.filter((_, i) => i !== idx));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Draft blocks</h2>
          {canEdit ? (
            <div className="flex gap-2">
              <button
                onClick={addBlock}
                className="rounded border border-white/10 px-3 py-1 text-xs hover:bg-white/5"
              >
                + Block
              </button>
              <button
                onClick={() => void saveDraft()}
                disabled={busy || draft.length === 0}
                className="rounded bg-accent text-ink-900 font-medium px-3 py-1 text-xs disabled:opacity-50"
              >
                Save as new draft
              </button>
            </div>
          ) : null}
        </div>
        {status ? (
          <div
            className={`rounded p-2 text-xs ${
              status.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'
            }`}
          >
            {status.text}
          </div>
        ) : null}
        {draft.map((b, i) => (
          <div
            key={i}
            className="rounded border border-white/5 bg-ink-800/40 p-3 space-y-2 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={b.stage}
                onChange={(e) => updateBlock(i, { stage: e.target.value })}
                disabled={!canEdit}
                placeholder="stage"
                className="rounded border border-white/10 bg-ink-700/60 px-2 py-1 w-40"
              />
              <input
                value={b.persona ?? ''}
                onChange={(e) => updateBlock(i, { persona: e.target.value || null })}
                disabled={!canEdit}
                placeholder="persona (optional)"
                className="rounded border border-white/10 bg-ink-700/60 px-2 py-1 w-40"
              />
              <input
                value={b.language}
                onChange={(e) => updateBlock(i, { language: e.target.value })}
                disabled={!canEdit}
                placeholder="en-US"
                className="rounded border border-white/10 bg-ink-700/60 px-2 py-1 w-24"
              />
              <input
                type="number"
                value={b.ordering}
                onChange={(e) => updateBlock(i, { ordering: Number(e.target.value || 0) })}
                disabled={!canEdit}
                className="rounded border border-white/10 bg-ink-700/60 px-2 py-1 w-16"
              />
              {canEdit ? (
                <button
                  onClick={() => removeBlock(i)}
                  className="ml-auto text-red-300 hover:text-red-100"
                >
                  Remove
                </button>
              ) : null}
            </div>
            <textarea
              value={b.bodyMd}
              onChange={(e) => updateBlock(i, { bodyMd: e.target.value })}
              disabled={!canEdit}
              rows={4}
              className="w-full rounded border border-white/10 bg-ink-700/60 px-2 py-2 font-mono"
            />
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Versions</h2>
        {detail.versions.length === 0 ? (
          <p className="text-xs text-white/40">No versions yet — save a draft to begin.</p>
        ) : (
          <div className="rounded-lg border border-white/5 bg-ink-800/40 divide-y divide-white/5">
            {detail.versions.map((v) => {
              const isCurrent = v.id === detail.currentVersionId;
              return (
                <div key={v.id} className="px-3 py-2 text-xs flex items-center gap-2">
                  <span className="font-mono w-12">v{v.version}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${
                      v.status === 'published'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : v.status === 'archived'
                          ? 'bg-white/5 text-white/40'
                          : 'bg-yellow-500/15 text-yellow-200'
                    }`}
                  >
                    {v.status}
                  </span>
                  <span className="text-white/40">{v.blockCount} blocks</span>
                  <span className="ml-auto text-white/40">
                    {new Date(v.createdAt).toLocaleDateString()}
                  </span>
                  {canEdit && !isCurrent ? (
                    <button
                      onClick={() => void publish(v.id)}
                      disabled={busy}
                      className="rounded border border-white/10 px-2 py-0.5 text-[10px] hover:bg-white/5 disabled:opacity-50"
                    >
                      {v.status === 'archived' ? 'Rollback' : 'Publish'}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
