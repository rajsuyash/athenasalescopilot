import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@athena/db';
import type { LlmClient } from '@athena/sdk-llm';
import { shutdownLatency } from './latency.js';
import {
  mergeObjectionFirst,
  reconcileEpisode,
  classifyHeuristic,
  coachAndPersist,
  formatBusinessContext,
  isDuplicateOrSpoken,
  mergeFacts,
  type EpisodeState,
} from './coach.js';

test('reactive coach rejects failed/overlong output and only previews complete concise lines', async () => {
  const chunkId = '11111111-1111-4111-8111-111111111111';
  const secondId = '22222222-2222-4222-8222-222222222222';
  let retrievedId = chunkId;
  const saved: Array<{ data: { sourceChunkIds: string[] } }> = [];
  const restore: Array<() => void> = [];
  function stub(target: object, method: string, fn: (...args: any[]) => Promise<unknown>) {
    const original = Reflect.get(target, method);
    Reflect.set(target, method, fn);
    restore.push(() => {
      Reflect.set(target, method, original);
    });
  }
  const query = mock.method(prisma, '$queryRawUnsafe', async () => [
    {
      id: retrievedId,
      chunk_text: 'SOC 2 certified. HIPAA and BAAs are not offered.',
      document_version_id: chunkId,
      language: 'en-US',
      score: 0.8,
      document_name: 'security.md',
      document_category: 'security',
    },
    {
      id: secondId,
      chunk_text: 'Customers may select EU data residency.',
      document_version_id: secondId,
      language: 'en-US',
      score: 0.7,
      document_name: 'residency.md',
      document_category: 'security',
    },
  ]);
  stub(prisma.workspaceBmc, 'findUnique', async () => null);
  stub(prisma.scriptCollection, 'findMany', async () => []);
  stub(prisma.suggestion, 'create', async (input) => {
    saved.push(input);
    return { id: chunkId };
  });
  stub(prisma.latencyEvent, 'createMany', async () => ({ count: 0 }));
  const base = {
    type: 'answer',
    answer_text: "We don't offer HIPAA compliance or sign BAAs.",
    followup_text: null,
    source_chunk_ids: ['c1'],
    confidence: 0.95,
    rationale: 'Not offered.',
    episode: { is_objection: false },
    new_facts: [],
  };
  try {
    for (const mode of [
      'error',
      'cancelled',
      'invalid',
      'length',
      'long',
      'two-lines',
      'boundary',
      'escaped',
      'late-error',
      'invalid-escape',
      'no-model',
      'missing-source',
      'invalid-source',
      'raw-uuid',
      'remapped-source',
      'multiple-sources',
      'question-reframe',
      'valid',
    ] as const) {
      const previews: string[] = [];
      retrievedId = mode === 'remapped-source' ? '33333333-3333-4333-8333-333333333333' : chunkId;
      const parsed = {
        ...base,
        ...(mode === 'missing-source' ? { source_chunk_ids: [] } : {}),
        ...(mode === 'invalid-source' ? { source_chunk_ids: ['c3'] } : {}),
        ...(mode === 'raw-uuid' ? { source_chunk_ids: [chunkId] } : {}),
        ...(mode === 'multiple-sources' ? { source_chunk_ids: ['c2', 'c1'] } : {}),
        ...(mode === 'question-reframe'
          ? { type: 'coach', answer_text: 'Money aside, does this fit?' }
          : {}),
        ...(mode === 'long' ? { answer_text: Array(19).fill('word').join(' ') } : {}),
        ...(mode === 'boundary' ? { answer_text: Array(18).fill('word').join(' ') } : {}),
        ...(mode === 'escaped' ? { answer_text: 'The "Growth" plan includes onboarding.' } : {}),
        ...(mode === 'two-lines'
          ? { followup_text: 'Which other certifications do you need?' }
          : {}),
      };
      const llm: LlmClient = {
        complete: async (req) => {
          const prompt = req.messages.find((m) => m.role === 'user')!.content;
          assert.match(prompt, /INFORMATION QUESTION/);
          assert.match(prompt, /SOURCE_REF:c1/);
          assert.ok(!prompt.includes(retrievedId), 'model should not have to copy a UUID');
          if (['error', 'cancelled', 'invalid', 'length'].includes(mode))
            return {
              text: '',
              model: 'test',
              finishReason:
                mode === 'invalid' ? 'stop' : (mode as 'error' | 'cancelled' | 'length'),
              latencyMs: 1,
            };
          const text = JSON.stringify(parsed);
          if (mode === 'invalid-escape') {
            req.onPartialText?.(
              '',
              String.raw`{"type":"answer","answer_text":"bad\x escape","followup_text":null,"source_chunk_ids":["c1"]}`,
            );
            return { text: '', model: 'test', finishReason: 'stop', latencyMs: 1 };
          }
          for (let i = 1; i <= text.length; i++)
            req.onPartialText?.(text[i - 1]!, text.slice(0, i));
          if (mode === 'late-error')
            return { text: '', model: 'test', finishReason: 'error', latencyMs: 1 };
          return {
            text,
            parsed: req.schema!.parse(parsed),
            model: 'test',
            finishReason: 'stop',
            latencyMs: 1,
          };
        },
      };
      const before = saved.length;
      const out = await coachAndPersist(
        {
          workspaceId: `phase5-${mode}`,
          meetingId: `phase5-${mode}`,
          turnId: 'test',
          customerText: 'Can you sign a HIPAA business associate agreement?',
          contextTurns: [],
          onPartialText: (_d, a) => previews.push(a),
        },
        {
          instantOpeners: false,
          llm: mode === 'no-model' ? null : llm,
          minDisplayConfidence: 0.5,
          urgencyThreshold: 0.35,
          embeddings: {
            dimension: () => 3,
            embed: async () => ({ vectors: [[1, 0, 0]], dimension: 3, model: 'test' }),
          },
        },
      );
      const accepted = [
        'valid',
        'boundary',
        'escaped',
        'remapped-source',
        'multiple-sources',
      ].includes(mode);
      assert.equal(out.display, accepted, mode);
      assert.equal(saved.length - before, accepted ? 1 : 0, mode);
      assert.equal(previews.length, accepted || mode === 'late-error' ? 1 : 0, mode);
      if (accepted) {
        assert.equal(JSON.parse(previews[0]!).answer_text, parsed.answer_text);
        const expectedIds = mode === 'multiple-sources' ? [secondId, retrievedId] : [retrievedId];
        assert.deepEqual(out.sourceChunkIds, expectedIds);
        assert.deepEqual(
          out.sources.map((s) => s.id),
          mode === 'multiple-sources' ? [retrievedId, secondId] : [retrievedId],
        );
        assert.deepEqual(saved.at(-1)!.data.sourceChunkIds, expectedIds);
      }
    }
  } finally {
    await shutdownLatency();
    query.mock.restore();
    restore.reverse().forEach((fn) => fn());
  }
});

test('mergeObjectionFirst puts objection rows first', () => {
  const objection = [{ id: 'o1' }, { id: 'o2' }];
  const general = [{ id: 'g1' }, { id: 'g2' }];
  const out = mergeObjectionFirst(objection, general, 5).map((r) => r.id);
  assert.deepEqual(out, ['o1', 'o2', 'g1', 'g2']);
});

test('mergeObjectionFirst dedups by id, first occurrence wins', () => {
  const objection = [{ id: 'x' }, { id: 'o2' }];
  const general = [{ id: 'x' }, { id: 'g1' }];
  const out = mergeObjectionFirst(objection, general, 5).map((r) => r.id);
  assert.deepEqual(out, ['x', 'o2', 'g1']);
});

test('mergeObjectionFirst caps at limit', () => {
  const objection = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }];
  const general = [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }];
  const out = mergeObjectionFirst(objection, general, 5).map((r) => r.id);
  assert.equal(out.length, 5);
  assert.deepEqual(out, ['o1', 'o2', 'o3', 'g1', 'g2']);
});

const openPrice: EpisodeState = {
  id: 'ep1',
  archetype: 'price',
  currentStep: 'isolate',
  reframeUsed: null,
  deflections: 0,
};

test('coachAndPersist: questions reach retrieval at high thresholds while chatter stays silent', async () => {
  const retrieved: string[] = [];
  const deps = {
    instantOpeners: false,
    llm: null,
    minDisplayConfidence: 0.6,
    urgencyThreshold: 1,
    embeddings: {
      dimension: () => 3,
      embed: async ({ texts }: { texts: string[] }) => {
        retrieved.push(...texts);
        return { vectors: [], dimension: 3, model: 'test' };
      },
    },
  };
  for (const customerText of ['How does it work', 'How does it work?', 'Thanks, that helps']) {
    const result = await coachAndPersist(
      { workspaceId: 'test', meetingId: 'test', turnId: 'test', customerText, contextTurns: [] },
      deps,
    );
    assert.equal(result.display, false, 'no approved evidence must not produce a claim');
  }
  assert.deepEqual(retrieved, ['How does it work', 'How does it work?']);
});

test('classifyHeuristic: direct questions survive the urgency gate without STT punctuation', () => {
  for (const text of [
    'How does it work',
    'Can you explain that',
    'What happens next',
    'Comment ça marche',
    'Pouvez-vous expliquer cela',
  ]) {
    assert.ok(classifyHeuristic(text).urgencyScore >= 0.35, text);
  }
  for (const text of [
    'We know how it works',
    'That is what we need',
    'Thanks, that helps',
    'What we need is better reporting',
    'How we work has changed',
  ]) {
    assert.ok(classifyHeuristic(text).urgencyScore < 0.35, text);
  }
});

test('reconcileEpisode: no report → none (episode untouched)', () => {
  assert.deepEqual(reconcileEpisode(openPrice, undefined, ['objection']), { kind: 'none' });
  assert.deepEqual(reconcileEpisode(null, undefined, ['none']), { kind: 'none' });
});

test('reconcileEpisode: new objection with no prior → open, archetype from report', () => {
  const d = reconcileEpisode(null, { is_objection: true, archetype: 'stall', step: 'disarm' }, [
    'objection',
  ]);
  assert.deepEqual(d, { kind: 'open', archetype: 'stall', step: 'disarm', reframe: null });
});

test('reconcileEpisode: new objection, null archetype → falls back to intent mapping', () => {
  const d = reconcileEpisode(null, { is_objection: true, archetype: null, step: null }, [
    'pricing',
  ]);
  assert.equal(d.kind, 'open');
  if (d.kind === 'open') {
    assert.equal(d.archetype, 'price');
    assert.equal(d.step, 'disarm');
  }
});

test('reconcileEpisode: continuing episode advances step and counts deflection', () => {
  const d = reconcileEpisode(
    openPrice,
    { is_objection: true, step: 'reframe', reframe: 'opportunity_cost', deflected: true },
    ['pricing'],
  );
  assert.deepEqual(d, {
    kind: 'advance',
    step: 'reframe',
    reframe: 'opportunity_cost',
    deflections: 1,
  });
});

test('reconcileEpisode: explicit resolved closes the episode', () => {
  const d = reconcileEpisode(openPrice, { is_objection: true, status: 'resolved' }, ['pricing']);
  assert.deepEqual(d, { kind: 'close', status: 'resolved' });
});

test('reconcileEpisode: non-objection turn with open episode → close abandoned', () => {
  const d = reconcileEpisode(openPrice, { is_objection: false }, ['none']);
  assert.deepEqual(d, { kind: 'close', status: 'abandoned' });
});

test('reconcileEpisode: non-objection turn, no episode → none', () => {
  assert.deepEqual(reconcileEpisode(null, { is_objection: false }, ['none']), { kind: 'none' });
});

test('classifyHeuristic: single-signal objections are flagged (F20 recall fix)', () => {
  // These scored ~0.30 (< 0.35 urgency) before F20 and were silently dropped.
  for (const t of [
    "You're being a bit pushy here.",
    "I'll have to run this by my boss first.",
    "Now isn't a good time, we're slammed.",
    "We're already using a different tool for this.",
    "Let's circle back in a few weeks.",
  ]) {
    assert.equal(classifyHeuristic(t).isObjection, true, t);
  }
});

test('classifyHeuristic: benign turns are not flagged as objections', () => {
  for (const t of [
    "Yeah that sounds great, let's do it.",
    'Can you walk me through the dashboard?',
    'We have about fifty reps on the team.',
  ]) {
    assert.equal(classifyHeuristic(t).isObjection, false, t);
  }
});

test('formatBusinessContext: builds a labelled block from BMC sections in priority order', () => {
  const block = formatBusinessContext({
    passion: 'ignored',
    niche: 'Mid-market SaaS founders',
    problem: 'Churn from bad onboarding',
    usp: 'Only tool with live call coaching',
    pricing: '$499/mo per seat',
    channel: 'ignored too',
  });
  assert.ok(block);
  const lines = (block as string).split('\n');
  assert.equal(lines[0], 'Who we sell to: Mid-market SaaS founders');
  assert.ok((block as string).includes('Why us: Only tool with live call coaching'));
  assert.ok((block as string).includes('Pricing: $499/mo per seat'));
  // passion + channel are skipped (marketing-facing, not useful live).
  assert.ok(!(block as string).includes('ignored'));
});

test('formatBusinessContext: null/empty in → null out (no block injected)', () => {
  assert.equal(formatBusinessContext(null), null);
  assert.equal(formatBusinessContext({}), null);
  assert.equal(formatBusinessContext({ niche: '   ', usp: 42 as unknown as string }), null);
});

test('classifyHeuristic: French objections are flagged (F20-FR)', () => {
  for (const t of [
    "C'est beaucoup trop cher pour nous en ce moment.",
    'Laissez-moi y réfléchir et je reviens vers vous.',
    'Je dois en parler à mon associé avant de décider.',
    'Il faut que je valide avec ma direction.',
    'On utilise déjà un autre outil pour ça.',
    "Je n'ai vraiment pas le temps en ce moment.",
  ]) {
    assert.equal(classifyHeuristic(t).isObjection, true, t);
  }
});

test('isDuplicateOrSpoken: repeated suggestion and already-answered lines are caught', () => {
  const ctx = [
    { speaker: 'customer' as const, text: 'We have about forty seats across the team.' },
    { speaker: 'rep' as const, text: 'How many seats are you sizing this for right now?' },
  ];
  // Same line as a recent suggestion → duplicate.
  assert.equal(
    isDuplicateOrSpoken(
      'How many seats are you sizing this for?',
      ['How many seats are you sizing this for?'],
      ctx,
    ),
    true,
  );
  // Rep already spoke (a paraphrase of) the candidate → duplicate.
  assert.equal(
    isDuplicateOrSpoken('How many seats are you sizing this for right now?', [], ctx),
    true,
  );
  // Fresh line → not a duplicate.
  assert.equal(
    isDuplicateOrSpoken('What would a successful rollout look like for you?', [], ctx),
    false,
  );
});

test('mergeFacts: dedupes reworded-identical facts, caps, keeps newest', () => {
  const merged = mergeFacts(
    ['after-hours calls go to voicemail', 'team is ~40 reps'],
    ['After-hours calls go to voicemail!', 'budget is approved', '  '],
  );
  assert.deepEqual(merged, [
    'after-hours calls go to voicemail',
    'team is ~40 reps',
    'budget is approved',
  ]);
  // Cap drops oldest first.
  const capped = mergeFacts(['fact one', 'fact two', 'fact three'], ['fact four'], 3);
  assert.deepEqual(capped, ['fact two', 'fact three', 'fact four']);
});
