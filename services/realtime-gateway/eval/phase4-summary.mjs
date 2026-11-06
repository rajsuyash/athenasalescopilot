import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(
  new URL('../../../research/athena-phase4/results.json', import.meta.url),
);
const report = JSON.parse(readFileSync(path, 'utf8'));
const normalize = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const stats = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const p = (q) =>
    sorted.length ? Math.round(sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]) : null;
  return { n: sorted.length, p50: p(0.5), p95: p(0.95), max: p(1) };
};
assert.deepEqual(stats([1, 2, 3, 4]), { n: 4, p50: 2, p95: 4, max: 4 });
assert.deepEqual(stats([]), { n: 0, p50: null, p95: null, max: null });
const turns = [];
for (const sample of report.samples) {
  for (const final of sample.frames.filter((f) => f.type === 'suggestion.generated')) {
    const start = sample.frames.find(
      (f) => f.type === 'suggestion.started' && f.generationId === final.generationId,
    );
    assert.ok(start, 'Every final must have a generation start');
    const audio = sample.audio.findLast((a) => a.start <= start.at);
    assert.ok(audio, 'A measured generation must follow synthetic speech');
    const suggestion = final.suggestion;
    const line = suggestion?.answerText || suggestion?.followupText;
    const shown = !!(suggestion?.display && line);
    const paints = sample.paints.filter((p) => p.generationId === final.generationId && p.stable);
    const complete = shown
      ? paints.find(
          (p) =>
            (p.event === 'streaming' && normalize(p.draft).includes(normalize(line))) ||
            (p.event === 'generated' && normalize(p.text).includes(normalize(line))),
        )
      : null;
    const committed = shown
      ? paints.find((p) => p.event === 'generated' && normalize(p.text).includes(normalize(line)))
      : null;
    const firstDraft = paints.find((p) => p.draft);
    const transcript = sample.frames.findLast(
      (f) => f.type === 'transcript.final' && f.at <= start.at,
    );
    turns.push({
      scenario: sample.id,
      repeat: sample.repeat,
      generationId: final.generationId,
      input: audio.text,
      recognizedText: transcript?.segment?.text ?? null,
      shown,
      line: line ?? null,
      followup: suggestion?.followupText ?? null,
      rationale: suggestion?.rationale ?? null,
      kind: suggestion?.rationale?.startsWith('instant')
        ? 'template'
        : suggestion?.rationale?.includes('llm fallback')
          ? 'fallback'
          : 'generated',
      speechToSttMs: transcript ? transcript.at - audio.end : null,
      sttToStartMs: transcript ? start.at - transcript.at : null,
      firstDraftMs: firstDraft ? firstDraft.at - audio.end : null,
      completeLineMs: complete ? complete.at - audio.end : null,
      committedMs: committed ? committed.at - audio.end : null,
      words: line ? line.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0,
      sources: suggestion?.sources ?? [],
    });
  }
}
const stages = report.samples.flatMap((s) => s.stages);
const generated = turns.filter((t) => t.shown && t.kind === 'generated');
const templates = turns.filter((t) => t.shown && t.kind === 'template');
const fallbacks = turns.filter((t) => t.shown && t.kind === 'fallback');
report.summary = {
  sessions: report.samples.length,
  audioTurns: report.samples.reduce((n, s) => n + s.audio.length, 0),
  browserErrors: report.samples.flatMap((s) => s.errors),
  gatewayErrors: report.samples.flatMap((s) => s.frames.filter((f) => f.type === 'error')),
  llmFinishes: stages.filter((s) => s.stage === 'llm').map((s) => s.finish),
  observedInterruptions: report.samples.filter((s) => s.interruptionObserved).length,
  generatedCompleteLineMs: stats(generated.map((t) => t.completeLineMs)),
  generatedCommittedMs: stats(generated.map((t) => t.committedMs)),
  templateCompleteLineMs: stats(templates.map((t) => t.completeLineMs)),
  fallbackCompleteLineMs: stats(fallbacks.map((t) => t.completeLineMs)),
  speechToSttMs: stats(turns.map((t) => t.speechToSttMs)),
  sttToStartMs: stats(turns.map((t) => t.sttToStartMs)),
  embeddingMs: stats(stages.filter((s) => s.stage === 'embedding').map((s) => s.end - s.start)),
  llmTtftMs: stats(
    stages
      .filter((s) => s.stage === 'llm' && s.firstRawToken)
      .map((s) => s.firstRawToken - s.start),
  ),
  retrievalMs: stats(
    report.samples.flatMap((s) =>
      s.telemetry.filter((t) => t.stage === 'retrieval').map((t) => t.latencyMs),
    ),
  ),
  cacheReadTokens: stages
    .filter((s) => s.stage === 'llm')
    .map((s) => s.usage?.cacheReadTokens ?? null),
  turns,
};
// Missing display measurements must remain missing, never silently become 0ms.
assert.ok(
  generated.every((t) => t.completeLineMs !== null && t.committedMs !== null),
  'Missing visible text evidence',
);
assert.ok(
  templates.every((t) => t.completeLineMs !== null),
  'Missing template evidence',
);
writeFileSync(path, JSON.stringify(report, null, 2));
assert.equal(JSON.parse(readFileSync(path, 'utf8')).samples.length, report.samples.length);
console.log(JSON.stringify(report.summary, null, 2));
