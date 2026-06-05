'use client';

/**
 * Guided client onboarding wizard (3 steps):
 *   1. Build the Business Model Canvas via one-question-per-section Q&A.
 *   2. Generate the probing + pitching script from that BMC.
 *   3. Generate the BMC-specific objection-handling matrix.
 *
 * Step 1 is resumable: the server passes the already-filled BMC sections as
 * `initialSections`, and the wizard starts at the first empty section. Each
 * answer is POSTed to /api/playbooks/bmc/generate-section, which runs the bmc-builder
 * skill and persists the section, so a refresh mid-wizard never loses progress.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ONBOARDING_QUESTIONS } from '@/lib/onboarding-questions';

type Step = 'bmc' | 'script' | 'objections' | 'done';

interface OnboardingWizardProps {
  /** BMC sections already filled (section key → text), for resume. */
  initialSections: Record<string, string>;
  initialVersion: number;
}

interface BuildResponse {
  ok?: boolean;
  section?: string;
  text?: string;
  version?: number;
  error?: string;
  message?: string;
}

interface ScriptResponse {
  ok?: boolean;
  collectionId?: string;
  blockCount?: number;
  message?: string;
}

interface MatrixEntry {
  archetype: string;
  bmcTheme: string;
  objectionText: string;
  suggestedLine: string;
  triggerPhrases: string[];
}

interface MatrixResponse {
  ok?: boolean;
  entries?: MatrixEntry[];
  dropped?: number;
  message?: string;
}

const MIN_SECTION_LEN = 10;

function isFilled(text: string | undefined): boolean {
  return (text ?? '').trim().length >= MIN_SECTION_LEN;
}

export function OnboardingWizard({ initialSections }: OnboardingWizardProps) {
  const router = useRouter();
  // Local mirror of persisted sections; build responses update it.
  const [sections, setSections] = useState<Record<string, string>>(initialSections);

  // Resume at the first unfilled section.
  const firstEmpty = useMemo(() => {
    const i = ONBOARDING_QUESTIONS.findIndex((q) => !isFilled(initialSections[q.section]));
    return i === -1 ? ONBOARDING_QUESTIONS.length - 1 : i;
  }, [initialSections]);

  const allFilledInitially = ONBOARDING_QUESTIONS.every((q) =>
    isFilled(initialSections[q.section]),
  );

  const [step, setStep] = useState<Step>(allFilledInitially ? 'script' : 'bmc');
  const [index, setIndex] = useState(firstEmpty);
  const [answer, setAnswer] = useState('');
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2 (script) state.
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [scriptResult, setScriptResult] = useState<{
    collectionId: string;
    blockCount: number;
  } | null>(null);

  // Step 3 (objection matrix) state.
  const [matrixBusy, setMatrixBusy] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [matrixEntries, setMatrixEntries] = useState<MatrixEntry[] | null>(null);

  const current = ONBOARDING_QUESTIONS[index]!;
  const generated = sections[current.section] ?? '';
  const filledCount = ONBOARDING_QUESTIONS.filter((q) => isFilled(sections[q.section])).length;

  async function submitAnswer() {
    if (answer.trim().length === 0 || building) return;
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch('/api/playbooks/bmc/generate-section', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ section: current.section, userInput: answer.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as BuildResponse;
      if (!res.ok || !json.ok || !json.text) {
        setError(json.message ?? `Build failed (HTTP ${res.status})`);
        return;
      }
      setSections((prev) => ({ ...prev, [current.section]: json.text! }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setBuilding(false);
    }
  }

  function advance() {
    setAnswer('');
    setError(null);
    if (index < ONBOARDING_QUESTIONS.length - 1) {
      setIndex(index + 1);
    } else {
      setStep('script');
    }
  }

  function goBack() {
    if (index > 0) {
      setAnswer('');
      setError(null);
      setIndex(index - 1);
    }
  }

  async function generateScript() {
    if (scriptBusy) return;
    setScriptBusy(true);
    setScriptError(null);
    try {
      const res = await fetch('/api/playbooks/script/generate', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as ScriptResponse;
      if (!res.ok || !json.ok || !json.collectionId) {
        setScriptError(json.message ?? `Generation failed (HTTP ${res.status})`);
        return;
      }
      setScriptResult({ collectionId: json.collectionId, blockCount: json.blockCount ?? 0 });
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setScriptBusy(false);
    }
  }

  async function generateMatrix() {
    if (matrixBusy) return;
    setMatrixBusy(true);
    setMatrixError(null);
    try {
      const res = await fetch('/api/playbooks/objection-matrix', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as MatrixResponse;
      if (!res.ok || !json.ok || !json.entries) {
        setMatrixError(json.message ?? `Generation failed (HTTP ${res.status})`);
        return;
      }
      setMatrixEntries(json.entries);
    } catch (err) {
      setMatrixError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setMatrixBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <ProgressRail step={step} bmcDone={filledCount} bmcTotal={ONBOARDING_QUESTIONS.length} />

      {step === 'bmc' ? (
        <section className="rounded-xl border border-white/10 bg-ink-900/40 p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs uppercase tracking-widest text-accent">
              Step 1 · Business Model Canvas
            </div>
            <div className="text-xs text-white/40">
              {index + 1} / {ONBOARDING_QUESTIONS.length} · {current.label}
            </div>
          </div>

          <h2 className="text-lg font-medium mt-2">{current.question}</h2>
          <p className="text-sm text-white/50 mt-1">{current.helper}</p>

          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={current.placeholder}
            rows={4}
            disabled={building}
            className="mt-4 w-full rounded-lg border border-white/10 bg-ink-950/60 p-3 text-sm text-white/90 placeholder:text-white/25 focus:border-accent/60 focus:outline-none disabled:opacity-50"
          />

          {error ? <div className="mt-3 text-sm text-red-400">{error}</div> : null}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={submitAnswer}
              disabled={building || answer.trim().length === 0}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-ink-900 disabled:opacity-40"
            >
              {building ? 'Building section…' : generated ? 'Rebuild section' : 'Build section'}
            </button>
            {index > 0 ? (
              <button
                onClick={goBack}
                disabled={building}
                className="text-sm text-white/50 hover:text-white/80 disabled:opacity-40"
              >
                ← Back
              </button>
            ) : null}
          </div>

          {generated ? (
            <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="text-xs uppercase tracking-wide text-emerald-300/80 mb-1">
                Generated · {current.label}
              </div>
              <p className="whitespace-pre-wrap text-sm text-white/85">{generated}</p>
              <button
                onClick={advance}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-1.5 text-sm font-medium text-white hover:bg-white/15"
              >
                {index < ONBOARDING_QUESTIONS.length - 1
                  ? 'Looks good → next section'
                  : 'Finish BMC → generate script'}
                <span aria-hidden>→</span>
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 'script' ? (
        <section className="rounded-xl border border-white/10 bg-ink-900/40 p-6">
          <div className="text-xs uppercase tracking-widest text-accent mb-2">
            Step 2 · Probing + pitching script
          </div>
          <p className="text-sm text-white/70">
            Your Business Model Canvas is complete ({filledCount}/{ONBOARDING_QUESTIONS.length}{' '}
            sections). Generate a SLOSHED 2.0 probing + 5-Step Pillar Pitching script tailored to
            your offer. The live coach starts using it within 30 seconds.
          </p>

          {scriptError ? <div className="mt-3 text-sm text-red-400">{scriptError}</div> : null}

          {scriptResult ? (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
              Script generated — <strong>{scriptResult.blockCount}</strong> blocks.{' '}
              <button
                onClick={() => router.push(`/scripts/${scriptResult.collectionId}`)}
                className="text-accent underline underline-offset-2"
              >
                Open the script editor
              </button>
              .
              <div className="mt-4">
                <button
                  onClick={() => setStep('objections')}
                  className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-1.5 text-sm font-medium text-white hover:bg-white/15"
                >
                  Next → objection handling <span aria-hidden>→</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={generateScript}
                disabled={scriptBusy}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-ink-900 disabled:opacity-40"
              >
                {scriptBusy ? 'Generating script… (~30-60s)' : 'Generate sales script'}
              </button>
              <button
                onClick={() => setStep('bmc')}
                disabled={scriptBusy}
                className="text-sm text-white/50 hover:text-white/80 disabled:opacity-40"
              >
                ← Edit BMC
              </button>
            </div>
          )}
        </section>
      ) : null}

      {step === 'objections' ? (
        <section className="rounded-xl border border-white/10 bg-ink-900/40 p-6">
          <div className="text-xs uppercase tracking-widest text-accent mb-2">
            Step 3 · Objection handling
          </div>
          <p className="text-sm text-white/70">
            Pre-build the objections this business will actually face — each with a grounded,
            ready-to-deliver reframe — so the coach answers instantly when a customer pushes back.
          </p>

          {matrixError ? <div className="mt-3 text-sm text-red-400">{matrixError}</div> : null}

          {matrixEntries ? (
            <div className="mt-4 space-y-4">
              <div className="text-sm text-emerald-300">
                {matrixEntries.length} grounded objections ready.
              </div>
              <ul className="space-y-3">
                {matrixEntries.map((e, i) => (
                  <li
                    key={`${e.archetype}-${i}`}
                    className="rounded-lg border border-white/10 bg-ink-950/40 p-4"
                  >
                    <div className="mb-1 text-xs uppercase tracking-wide text-white/40">
                      {e.archetype} · {e.bmcTheme}
                    </div>
                    <div className="text-sm font-medium text-white/90">{e.objectionText}</div>
                    <div className="mt-2 text-sm text-white/70">
                      <span className="text-white/40">Say:</span> {e.suggestedLine}
                    </div>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setStep('done')}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-ink-900"
              >
                Finish setup <span aria-hidden>→</span>
              </button>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={generateMatrix}
                disabled={matrixBusy}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-ink-900 disabled:opacity-40"
              >
                {matrixBusy ? 'Generating objections… (~30-60s)' : 'Generate objection handling'}
              </button>
              <button
                onClick={() => setStep('script')}
                disabled={matrixBusy}
                className="text-sm text-white/50 hover:text-white/80 disabled:opacity-40"
              >
                ← Back to script
              </button>
            </div>
          )}
        </section>
      ) : null}

      {step === 'done' ? (
        <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6">
          <h2 className="text-lg font-medium">You&apos;re all set 🎉</h2>
          <p className="mt-2 text-sm text-white/70">
            Your BMC, sales script, and objection-handling matrix are live. Install the Chrome
            extension, open a Google Meet, and the coach is ready on your first call.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-ink-900"
            >
              Go to dashboard
            </button>
            <button
              onClick={() => router.push('/install')}
              className="rounded-lg bg-white/10 px-4 py-1.5 text-sm font-medium text-white hover:bg-white/15"
            >
              Install the extension
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ProgressRail({
  step,
  bmcDone,
  bmcTotal,
}: {
  step: Step;
  bmcDone: number;
  bmcTotal: number;
}) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'bmc', label: 'Business Model Canvas' },
    { key: 'script', label: 'Probing + pitching script' },
    { key: 'objections', label: 'Objection handling' },
  ];
  const order: Step[] = ['bmc', 'script', 'objections', 'done'];
  const activeIdx = order.indexOf(step);

  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
      {steps.map((s, i) => {
        const done = order.indexOf(s.key) < activeIdx;
        const active = s.key === step;
        return (
          <li key={s.key} className="flex items-center gap-2 sm:flex-1">
            <span
              className={[
                'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1',
                done
                  ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/40'
                  : active
                    ? 'bg-accent/20 text-accent ring-accent/40'
                    : 'bg-white/5 text-white/40 ring-white/10',
              ].join(' ')}
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={active ? 'text-sm text-white' : 'text-sm text-white/50'}>
              {s.label}
              {s.key === 'bmc' ? (
                <span className="ml-1 text-xs text-white/30">
                  ({bmcDone}/{bmcTotal})
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
