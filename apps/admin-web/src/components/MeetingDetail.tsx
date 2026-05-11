'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CoachingThread } from './CoachingThread';

interface Segment {
  id: string;
  speakerType: 'rep' | 'customer' | 'unknown' | string;
  speakerLabel: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  sourceType: string;
  language: string;
}

interface Suggestion {
  id: string;
  suggestionType: 'answer' | 'ask_next' | 'coach' | 'risk';
  answerText: string | null;
  followupText: string | null;
  confidenceScore: number;
  priorityScore: number;
  rationale: string;
  generatedAt: string;
  turnStartMs: number;
  turnEndMs: number;
  acceptedSignal: 'useful' | 'not_useful' | null;
  dismissedAt: string | null;
}

interface Recap {
  meetingId: string;
  title: string | null;
  summary: string;
  followupEmail: { subject: string; body: string };
  nextSteps: Array<{ owner: string; action: string; due: string | null }>;
  objections: Array<{ category: string; text: string; resolution: string; notes: string | null }>;
  crmSuggestions: {
    stage: string;
    nextStep: string | null;
    objections: string[];
    useCase: string | null;
    closeDateConfidence: number;
  };
  adherence: { framework: string; score: number; missing: string[] };
  lowSignal: boolean;
}

export function MeetingDetail({
  meetingId,
  canFlag,
}: {
  meetingId: string;
  canFlag: boolean;
}) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [recapBusy, setRecapBusy] = useState(false);
  const [recapError, setRecapError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [t, s, r] = await Promise.all([
      fetch(`/api/meetings/${encodeURIComponent(meetingId)}/transcript`).then((res) =>
        res.ok ? res.json() : Promise.resolve({ segments: [] }),
      ),
      fetch(`/api/meetings/${encodeURIComponent(meetingId)}/suggestions`).then((res) =>
        res.ok ? res.json() : Promise.resolve({ suggestions: [] }),
      ),
      fetch(`/api/postcall/recap/${encodeURIComponent(meetingId)}`).then((res) =>
        res.ok ? res.json() : Promise.resolve(null),
      ),
    ]);
    setSegments((t as { segments: Segment[] }).segments ?? []);
    setSuggestions((s as { suggestions: Suggestion[] }).suggestions ?? []);
    setRecap((r as Recap | null) ?? null);
  }, [meetingId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const runRecap = useCallback(
    async (force: boolean) => {
      setRecapBusy(true);
      setRecapError(null);
      try {
        const res = await fetch(`/api/postcall/recap/${encodeURIComponent(meetingId)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(force ? { force: true } : {}),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          setRecapError(body.message ?? `HTTP ${res.status}`);
          return;
        }
        await fetchAll();
      } finally {
        setRecapBusy(false);
      }
    },
    [meetingId, fetchAll],
  );

  const submitFeedback = useCallback(
    async (id: string, feedback: 'useful' | 'not_useful') => {
      // Optimistic flip — revert on error.
      const prev = suggestions;
      setSuggestions((curr) =>
        curr.map((s) => (s.id === id ? { ...s, acceptedSignal: feedback } : s)),
      );
      try {
        const res = await fetch(`/api/suggestions/${encodeURIComponent(id)}/feedback`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ feedback }),
        });
        if (!res.ok) {
          setSuggestions(prev);
        }
      } catch {
        setSuggestions(prev);
      }
    },
    [suggestions],
  );

  const usefulRate = useMemo(() => {
    const scored = suggestions.filter((s) => s.acceptedSignal !== null);
    if (scored.length === 0) return null;
    const useful = scored.filter((s) => s.acceptedSignal === 'useful').length;
    return useful / scored.length;
  }, [suggestions]);

  // Index suggestions by turn start so we can interleave them with segments.
  const suggestionByStart = useMemo(() => {
    const m = new Map<number, Suggestion[]>();
    for (const s of suggestions) {
      const arr = m.get(s.turnStartMs) ?? [];
      arr.push(s);
      m.set(s.turnStartMs, arr);
    }
    return m;
  }, [suggestions]);

  // Proactive coach prompts (Block N) synthesize a Turn with startMs=0, so
  // they don't line up with any real transcript segment. Render those, plus
  // any other orphans, in a dedicated pane above the transcript so they
  // don't disappear from the UI.
  const orphanSuggestions = useMemo(() => {
    const segmentStarts = new Set(segments.map((seg) => seg.startMs));
    return suggestions
      .filter((s) => !segmentStarts.has(s.turnStartMs))
      .sort(
        (a, b) =>
          new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
      );
  }, [segments, suggestions]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Transcript timeline */}
      <section className="lg:col-span-2">
        {orphanSuggestions.length > 0 ? (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-medium">Coach prompts</h2>
              <span className="text-xs text-white/40">
                {orphanSuggestions.length} proactive · script-grounded
              </span>
            </div>
            <div className="rounded-lg border border-white/5 bg-ink-800/40 p-3 space-y-2 max-h-[280px] overflow-y-auto">
              {orphanSuggestions.map((s) => (
                <SuggestionInline
                  key={s.id}
                  s={s}
                  onFeedback={submitFeedback}
                  canFlag={canFlag}
                />
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Transcript</h2>
          <span className="text-xs text-white/40">
            {segments.length} segments · {suggestions.length} suggestions
            {usefulRate !== null ? ` · useful ${(usefulRate * 100).toFixed(0)}%` : ''}
          </span>
        </div>
        <div className="rounded-lg border border-white/5 bg-ink-800/40 divide-y divide-white/5 max-h-[640px] overflow-y-auto">
          {segments.length === 0 ? (
            <div className="p-6 text-sm text-white/50">
              No transcript captured. Use{' '}
              <code className="text-white/70">
                rocket listen --gateway --meeting-id {meetingId}
              </code>{' '}
              to attach.
            </div>
          ) : (
            segments.map((seg) => (
              <div key={seg.id} className="p-3 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <SpeakerBadge type={seg.speakerType} />
                  <span className="text-xs text-white/40">{seg.speakerLabel}</span>
                  <span className="text-xs text-white/40 ml-auto">{formatMs(seg.startMs)}</span>
                </div>
                <p className="whitespace-pre-wrap leading-relaxed">{seg.text}</p>
                {(suggestionByStart.get(seg.startMs) ?? []).map((s) => (
                  <SuggestionInline
                    key={s.id}
                    s={s}
                    onFeedback={submitFeedback}
                    canFlag={canFlag}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Recap pane */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Recap</h2>
          <div className="flex gap-2">
            <button
              onClick={() => void runRecap(false)}
              disabled={recapBusy}
              className="rounded bg-accent text-ink-900 font-medium px-3 py-1 text-xs disabled:opacity-50"
            >
              {recap ? 'Refresh' : 'Generate'}
            </button>
            {recap ? (
              <button
                onClick={() => void runRecap(true)}
                disabled={recapBusy}
                className="rounded border border-white/10 px-3 py-1 text-xs disabled:opacity-50"
                title="Regenerate from scratch"
              >
                Force
              </button>
            ) : null}
          </div>
        </div>
        {recapError ? <div className="text-sm text-red-400">{recapError}</div> : null}
        {!recap ? (
          <div className="rounded border border-white/5 bg-ink-800/40 p-4 text-sm text-white/60">
            {recapBusy ? 'Generating Stage D recap…' : 'No recap yet. Click Generate.'}
          </div>
        ) : (
          <>
            {recap.lowSignal ? (
              <div className="rounded bg-yellow-500/10 text-yellow-300 text-xs px-2 py-1 inline-block">
                low_signal — short transcript
              </div>
            ) : null}
            <div className="rounded-lg border border-white/5 bg-ink-800/40 p-4 text-sm whitespace-pre-wrap">
              {recap.summary}
            </div>
            {recap.objections.length > 0 ? (
              <div className="rounded-lg border border-white/5 bg-ink-800/40 p-4">
                <div className="text-xs uppercase tracking-wide text-white/40 mb-2">Objections</div>
                <ul className="space-y-1 text-sm">
                  {recap.objections.map((o, i) => (
                    <li key={i}>
                      <span className="text-white/60">[{o.category}/{o.resolution}]</span>{' '}
                      {o.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {recap.nextSteps.length > 0 ? (
              <div className="rounded-lg border border-white/5 bg-ink-800/40 p-4">
                <div className="text-xs uppercase tracking-wide text-white/40 mb-2">Next steps</div>
                <ul className="space-y-1 text-sm">
                  {recap.nextSteps.map((n, i) => (
                    <li key={i}>
                      <span className="text-white/60">[{n.owner}]</span> {n.action}
                      {n.due ? <span className="text-white/40"> · due {n.due}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="rounded-lg border border-white/5 bg-ink-800/40 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wide text-white/40">Follow-up email</div>
                <button
                  className="text-xs underline text-white/60 hover:text-white"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      `Subject: ${recap.followupEmail.subject}\n\n${recap.followupEmail.body}`,
                    );
                  }}
                >
                  Copy
                </button>
              </div>
              <div className="text-sm font-medium mb-1">{recap.followupEmail.subject}</div>
              <pre className="text-sm whitespace-pre-wrap font-sans">{recap.followupEmail.body}</pre>
            </div>
            <div className="rounded-lg border border-white/5 bg-ink-800/40 p-4 text-sm">
              <div className="text-xs uppercase tracking-wide text-white/40 mb-2">CRM</div>
              <KV k="stage" v={recap.crmSuggestions.stage} />
              {recap.crmSuggestions.nextStep ? (
                <KV k="next step" v={recap.crmSuggestions.nextStep} />
              ) : null}
              {recap.crmSuggestions.useCase ? (
                <KV k="use case" v={recap.crmSuggestions.useCase} />
              ) : null}
              <KV
                k="close date conf"
                v={recap.crmSuggestions.closeDateConfidence.toFixed(2)}
              />
            </div>
            <div className="rounded-lg border border-white/5 bg-ink-800/40 p-4 text-sm">
              <div className="text-xs uppercase tracking-wide text-white/40 mb-2">
                Adherence ({recap.adherence.framework})
              </div>
              <KV k="score" v={recap.adherence.score.toFixed(2)} />
              {recap.adherence.missing.length > 0 ? (
                <KV k="missing" v={recap.adherence.missing.join(', ')} />
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function SuggestionInline({
  s,
  onFeedback,
  canFlag,
}: {
  s: Suggestion;
  onFeedback: (id: string, feedback: 'useful' | 'not_useful') => void;
  canFlag: boolean;
}) {
  const colors: Record<Suggestion['suggestionType'], string> = {
    answer: 'bg-emerald-500/10 border-emerald-500/30',
    ask_next: 'bg-cyan-500/10 border-cyan-500/30',
    coach: 'bg-yellow-500/10 border-yellow-500/30',
    risk: 'bg-red-500/10 border-red-500/30',
  };
  const isUseful = s.acceptedSignal === 'useful';
  const isNotUseful = s.acceptedSignal === 'not_useful';
  const [coachOpen, setCoachOpen] = useState(false);
  return (
    <div className={`mt-2 rounded border px-3 py-2 text-xs ${colors[s.suggestionType]}`}>
      <div className="flex items-center gap-2 text-white/70 mb-1">
        <span className="font-mono uppercase">{s.suggestionType}</span>
        <span className="text-white/40">conf {s.confidenceScore.toFixed(2)}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => onFeedback(s.id, 'useful')}
            className={`rounded px-1.5 py-0.5 ${isUseful ? 'bg-emerald-500/30 text-emerald-100' : 'hover:bg-white/10 text-white/50'}`}
            title="Mark useful"
          >
            👍
          </button>
          <button
            onClick={() => onFeedback(s.id, 'not_useful')}
            className={`rounded px-1.5 py-0.5 ${isNotUseful ? 'bg-red-500/30 text-red-100' : 'hover:bg-white/10 text-white/50'}`}
            title="Mark not useful"
          >
            👎
          </button>
          <button
            onClick={() => setCoachOpen((v) => !v)}
            className="rounded px-1.5 py-0.5 hover:bg-white/10 text-white/50"
            title="Coaching thread"
          >
            💬
          </button>
        </div>
      </div>
      {s.answerText ? (
        <div className="text-white/95 text-lg leading-relaxed">{s.answerText}</div>
      ) : null}
      {s.followupText ? (
        <div className="text-white/95 text-lg leading-relaxed">{s.followupText}</div>
      ) : null}
      {coachOpen ? <CoachingThread suggestionId={s.id} canFlag={canFlag} /> : null}
    </div>
  );
}

function SpeakerBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    rep: 'bg-emerald-500/20 text-emerald-200',
    customer: 'bg-cyan-500/20 text-cyan-200',
    unknown: 'bg-white/10 text-white/50',
  };
  const cls = map[type] ?? map.unknown ?? 'bg-white/10 text-white/50';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${cls}`}>{type}</span>;
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex">
      <span className="text-white/40 w-32">{k}</span>
      <span className="text-white/80">{v}</span>
    </div>
  );
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
