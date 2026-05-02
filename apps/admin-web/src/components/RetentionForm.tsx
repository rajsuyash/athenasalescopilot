'use client';

import { useState } from 'react';

interface Retention {
  id: string;
  transcriptDays: number;
  audioDays: number;
  summaryDays: number;
  auditDays: number;
}

const FIELDS: Array<{
  key: keyof Omit<Retention, 'id'>;
  label: string;
  hint: string;
}> = [
  {
    key: 'transcriptDays',
    label: 'Transcripts',
    hint: 'Speech-to-text segments. 0 = drop after Stage D recap.',
  },
  {
    key: 'audioDays',
    label: 'Raw audio',
    hint: 'Default 0 — audio is dropped after STT processes it (PRD F2).',
  },
  {
    key: 'summaryDays',
    label: 'Recap summaries',
    hint: 'MeetingSummary rows. 0 = indefinite.',
  },
  {
    key: 'auditDays',
    label: 'Audit logs',
    hint: 'Append-only audit trail. 0 = indefinite. Required ≥365 for SOC 2.',
  },
];

export function RetentionForm({ initial }: { initial: Retention }) {
  const [values, setValues] = useState<Retention>(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const update = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/retention', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transcriptDays: values.transcriptDays,
          audioDays: values.audioDays,
          summaryDays: values.summaryDays,
          auditDays: values.auditDays,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setStatus({ ok: false, text: body.message ?? `HTTP ${res.status}` });
        return;
      }
      setStatus({ ok: true, text: 'Retention policy updated.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-white/5 bg-ink-800/40 p-5 space-y-4">
      {FIELDS.map((f) => (
        <div key={f.key} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
          <div>
            <div className="text-sm font-medium">{f.label}</div>
            <div className="text-xs text-white/50">{f.hint}</div>
          </div>
          <div className="md:col-span-2 flex items-center gap-3">
            <input
              type="number"
              min={0}
              max={3650}
              value={values[f.key]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: Math.max(0, Number(e.target.value || 0)) }))
              }
              className="w-32 rounded border border-white/10 bg-ink-700/60 px-2 py-1 text-sm"
            />
            <span className="text-xs text-white/40">days (0 = indefinite, audio: drop)</span>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-white/40">
          Hard delete is enforced by the retention job; soft-delete happens immediately on save.
        </div>
        <button
          onClick={() => void update()}
          disabled={busy}
          className="rounded bg-accent text-ink-900 font-medium px-4 py-2 text-sm disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {status ? (
        <div
          className={[
            'rounded p-2 text-sm',
            status.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300',
          ].join(' ')}
        >
          {status.text}
        </div>
      ) : null}
    </div>
  );
}
