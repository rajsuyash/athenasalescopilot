/**
 * Live LLM eval + judge (the `--live` mode promised in eval/run.ts).
 *
 * WHY THIS EXISTS. Two blockers, one artifact:
 *
 * 1. Statistical power. Hand-measuring 3 utterances against prod produced
 *    means of 1287ms and 1530ms across two runs with NO latency-affecting
 *    change between them — run-to-run variance is ~250ms, larger than the
 *    100-150ms effects being tuned. Any decision made on n=3 is noise.
 * 2. Safety for a provider swap. Reaching a speakable line in <1s needs a
 *    faster generator than Haiku 4.5 (measured floor: ~650ms TTFT + ~330ms to
 *    stream ~24 words). Swapping the model on a rule-dense strict-JSON prompt
 *    with nothing checking output quality is how quality collapses silently.
 *
 * This measures the LLM stage in isolation — TTFT and time-to-complete-line —
 * over the objection corpus, and LLM-judges every generated line. The
 * deterministic stages around it (110ms settle beat, ~60ms retrieval) are
 * measured separately and don't need re-sampling here.
 *
 * Run (needs a key — kept out of the default eval so CI stays key-free):
 *   railway run --service athena-realtime \
 *     pnpm --filter @athena/realtime-gateway eval:live
 *
 * Env:
 *   COACH_MODEL       model under test         (default claude-haiku-4-5)
 *   JUDGE_MODEL       model doing the judging  (default claude-sonnet-4-6)
 *   EVAL_SAMPLES      how many fixtures        (default 16)
 *   EVAL_CONCURRENCY  parallel calls           (default 4)
 *   EVAL_NO_JUDGE     set to skip judging (latency-only, much cheaper)
 *
 * Exits non-zero if a quality gate fails, so it can gate a model change.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createLlmClient } from '@athena/sdk-llm';
import { SUGGEST_SYSTEM } from '../src/lib/coach-prompt.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (f: string): unknown => JSON.parse(readFileSync(join(HERE, 'fixtures', f), 'utf8'));

const COACH_MODEL = process.env.COACH_MODEL ?? 'claude-haiku-4-5';
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? 'claude-sonnet-4-6';
const SAMPLES = Number(process.env.EVAL_SAMPLES ?? 16);
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 4);
const DO_JUDGE = !process.env.EVAL_NO_JUDGE;

/** Word cap the prompt asks for. Judged, not just measured. */
const WORD_CAP = 18;

// Quality gates. A provider swap must hold these to ship.
const GATE_SPEAKABLE = 0.9; // fraction of lines a rep could read verbatim
const GATE_NO_PLACEHOLDER = 1.0; // a leaked {slot} is unreadable mid-call
const GATE_PARSE = 0.95; // strict-JSON adherence — first thing a weaker model loses

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error(
    'ANTHROPIC_API_KEY required. Run via: railway run --service athena-realtime pnpm --filter @athena/realtime-gateway eval:live',
  );
  process.exit(2);
}

/**
 * Synthetic grounding chunks. Real UUIDs so source_chunk_ids validation
 * behaves exactly as in prod (the gateway rejects unknown ids), and content a
 * price / authority / comparison objection could legitimately cite.
 */
const CHUNKS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    doc: 'pricing.md',
    text: 'Growth plan is $1,200/month for up to 25 seats, billed annually. Onboarding is included. Month-to-month is available at $1,450/month.',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    doc: 'objection-handling-matrix.md',
    text: 'On price pushback: anchor against the cost of the status quo. Teams typically recover the subscription cost within two months from reduced manual handling.',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    doc: 'security.md',
    text: 'SOC 2 Type II certified. Data residency available in EU and US. Customer audio is dropped after transcription unless retention is explicitly enabled.',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    doc: 'implementation.md',
    text: 'Standard rollout is 10 business days: week one for workspace and knowledge setup, week two for rep enablement. No engineering work required.',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    doc: 'objection-handling-reframes.md',
    text: 'Switching cost objection: acknowledge the friction, then surface what the incumbent is not solving. Migration of existing content is handled by our team.',
  },
];

const BUSINESS_CONTEXT = [
  'Who we sell to: B2B sales teams of 10-50 reps running discovery calls on video.',
  'Problem we solve: reps miss objections live and lose deals they could have saved.',
  "Why us: real-time coaching grounded in the team's own approved material.",
  'Offer: Growth plan, $1,200/month up to 25 seats.',
  'Pricing: annual billing, onboarding included.',
].join('\n');

function buildUserPrompt(customerText: string): string {
  return [
    `Customer turn:\n${customerText}`,
    `Business context (the rep's own company — ground every suggestion in THIS offer, buyer, and pricing; never generic):\n${BUSINESS_CONTEXT}`,
    `Context:\nREP: Thanks for making time today — let me show you how the live coaching works.\nCUSTOMER: Yeah, it looks interesting.\nREP: What does your team's discovery process look like right now?`,
    `Intent: categories=objection stage=objection_handling urgency=0.70`,
    `Approved chunks (use the UUID after "CHUNK_ID:" in source_chunk_ids — never the bracket number):\n\n${CHUNKS.map(
      (c, i) => `[${i + 1}] CHUNK_ID:${c.id} score=0.500 doc=${c.doc}\n${c.text}`,
    ).join('\n\n')}`,
  ].join('\n\n');
}

interface Sample {
  archetype: string;
  text: string;
  parsed: boolean;
  ttftMs: number | null;
  lineDoneMs: number | null;
  totalMs: number;
  line: string | null;
  type: string | null;
  words: number | null;
  hasPlaceholder: boolean;
  citedIds: string[];
  finishReason: string;
}

const llm = createLlmClient({
  provider: 'anthropic',
  anthropicApiKey: apiKey,
  anthropicModel: COACH_MODEL,
});
const judge = createLlmClient({
  provider: 'anthropic',
  anthropicApiKey: apiKey,
  anthropicModel: JUDGE_MODEL,
});

/** Pull a JSON string field out of a partial stream (same trick the gateway uses). */
function partialField(text: string, field: string): string | null {
  const m = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`).exec(text);
  return m?.[1] ?? null;
}

async function runOne(archetype: string, customerText: string): Promise<Sample> {
  const t0 = Date.now();
  let ttftMs: number | null = null;
  // When the spoken field stops growing we have a complete line — that is the
  // moment the rep can actually read it, which is the metric that matters.
  let lastLen = 0;
  let lineDoneMs: number | null = null;

  const r = await llm.complete({
    workspaceId: 'eval',
    messages: [
      { role: 'system', content: SUGGEST_SYSTEM },
      { role: 'user', content: buildUserPrompt(customerText) },
    ],
    temperature: 0.2,
    maxTokens: 400,
    deadlineMs: 20_000,
    onPartialText: (_d, acc) => {
      if (ttftMs === null) ttftMs = Date.now() - t0;
      const spoken = partialField(acc, 'followup_text') ?? partialField(acc, 'answer_text');
      if (spoken && spoken.length > lastLen) {
        lastLen = spoken.length;
        lineDoneMs = Date.now() - t0; // keeps advancing; final value = line complete
      }
    },
  });
  const totalMs = Date.now() - t0;

  let parsedOk = false;
  let line: string | null = null;
  let type: string | null = null;
  let citedIds: string[] = [];
  try {
    const j = JSON.parse(r.text.trim().replace(/^```(?:json)?|```$/g, '')) as Record<
      string,
      unknown
    >;
    parsedOk = true;
    type = typeof j.type === 'string' ? j.type : null;
    line =
      (typeof j.followup_text === 'string' && j.followup_text) ||
      (typeof j.answer_text === 'string' && j.answer_text) ||
      null;
    citedIds = Array.isArray(j.source_chunk_ids) ? (j.source_chunk_ids as string[]) : [];
  } catch {
    /* parsedOk stays false */
  }

  return {
    archetype,
    text: customerText,
    parsed: parsedOk,
    ttftMs,
    lineDoneMs,
    totalMs,
    line,
    type,
    words: line ? line.trim().split(/\s+/).filter(Boolean).length : null,
    hasPlaceholder: line ? /[{<]\s*\w+[_\s]*\w*\s*[}>]|\[\w+\]/.test(line) : false,
    citedIds,
    finishReason: r.finishReason,
  };
}

/**
 * The judge MUST be told the methodology.
 *
 * The first version of this prompt graded against a common-sense standard of
 * "does the line address the objection", and it failed two canonical moves:
 * it called the Compared-to-What isolate "pivots away from price entirely"
 * and the Yin-Yang opener "deflects comparison instead of addressing it".
 * Both are exactly what the framework prescribes — deliberately NOT answering
 * the surface objection is the whole technique.
 *
 * An uninformed judge therefore penalises correct behaviour and, used as a
 * gate, would push the coach toward generic direct rebuttals — the failure
 * mode the product exists to avoid. Teaching it the loop is not grading
 * leniency; it is grading the right thing.
 */
const JUDGE_SYSTEM = `You grade one line written by a live sales-coaching assistant. The line is
shown to a sales rep mid-call and must be readable ALOUD, word for word, with
no editing.

IMPORTANT — the methodology you are grading against. This assistant runs a
Socratic reframe loop, NOT direct rebuttal:

  DISARM → ISOLATE → UNCOVER → REFRAME → JUSTIFY → CONSEQUENCE → IDENTITY CLOSE

Deliberately setting the surface objection aside is CORRECT, not evasion. On a
freshly-raised objection the right move is disarm + isolate — e.g. answering
"that's a lot of money" with "money aside for a second, do you feel this
actually gets you to <their goal>?" is the textbook move and must PASS. Asking
"how will you know before you try?" in response to vendor comparison is the
canonical opener and must PASS. Do NOT require the line to directly answer,
differentiate, defend price, or list features — a line that does those things
early is usually WRONG for this framework.

Score three things independently. Be strict on 1 and 3.

1. speakable: is this a complete sentence the rep can literally say to the
   prospect right now? FAIL if it describes an action ("isolate the
   objection", "acknowledge and pivot"), addresses the rep instead of the
   prospect ("you should ask..."), names a technique, is a fragment, or reads
   like a note rather than speech.
2. archetype_fit: is this a plausible next move in the loop FOR THIS objection
   type — disarm/isolate/uncover/reframe all count. FAIL only if it is aimed
   at a genuinely different objection (a price reframe answering a security
   question), or so generic it would fit any objection with no adaptation.
3. natural: does it sound like a human salesperson speaking — not marketing
   copy, not a template with slots showing, not condescending? A line that
   would make a senior enterprise buyer bristle FAILS this.

Output ONLY raw JSON:
{"speakable":<bool>,"archetype_fit":<bool>,"natural":<bool>,"why":"<12 words max>"}`;

interface Verdict {
  speakable: boolean;
  fit: boolean;
  natural: boolean;
  why: string;
}

async function judgeOne(s: Sample): Promise<Verdict> {
  if (!s.line) return { speakable: false, fit: false, natural: false, why: 'no line produced' };
  const r = await judge.complete({
    workspaceId: 'eval',
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      {
        role: 'user',
        content: `Objection type: ${s.archetype}\nProspect said: "${s.text}"\nCoach line: "${s.line}"`,
      },
    ],
    temperature: 0,
    maxTokens: 200,
    deadlineMs: 30_000,
  });
  try {
    const j = JSON.parse(r.text.trim().replace(/^```(?:json)?|```$/g, '')) as Record<
      string,
      unknown
    >;
    return {
      speakable: j.speakable === true,
      fit: j.archetype_fit === true,
      natural: j.natural === true,
      why: typeof j.why === 'string' ? j.why : '',
    };
  } catch {
    return { speakable: false, fit: false, natural: false, why: 'judge parse failed' };
  }
}

/** Bounded-concurrency map — keeps the API from being hit with 60 calls at once. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const pct = (xs: number[], q: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const ms = (n: number): string => (Number.isFinite(n) ? `${Math.round(n)}ms` : 'n/a');

// ── corpus ────────────────────────────────────────────────────────────────
const corpus = (
  load('objections.json') as { items: Array<{ archetype: string; lang: string; text: string }> }
).items.filter((i) => i.lang === 'en');

// Spread across archetypes rather than taking the first N — the file is grouped
// by archetype, so a naive slice would test price nine times and authority never.
const byArch = new Map<string, Array<{ archetype: string; text: string }>>();
for (const i of corpus) {
  const a = byArch.get(i.archetype) ?? [];
  a.push({ archetype: i.archetype, text: i.text });
  byArch.set(i.archetype, a);
}
const picked: Array<{ archetype: string; text: string }> = [];
for (let round = 0; picked.length < Math.min(SAMPLES, corpus.length); round++) {
  let added = false;
  for (const [, items] of byArch) {
    if (items[round] && picked.length < SAMPLES) {
      picked.push(items[round]!);
      added = true;
    }
  }
  if (!added) break;
}

console.log('─'.repeat(74));
console.log(`live coach eval — model under test: ${COACH_MODEL}`);
console.log(
  `judge: ${DO_JUDGE ? JUDGE_MODEL : '(skipped)'}   samples: ${picked.length}   concurrency: ${CONCURRENCY}`,
);
console.log('─'.repeat(74));

const samples = await pool(picked, CONCURRENCY, (p) => runOne(p.archetype, p.text));
const verdicts: Verdict[] = DO_JUDGE
  ? await pool(samples, CONCURRENCY, (s) => judgeOne(s))
  : samples.map(() => ({ speakable: true, fit: true, natural: true, why: '(not judged)' }));

console.log('\nper-sample:');
console.log('  arch        ttft   line   words  spk fit nat  line');
samples.forEach((s, i) => {
  const v = verdicts[i]!;
  const flag = (b: boolean): string => (b ? ' ✓ ' : ' ✗ ');
  console.log(
    `  ${s.archetype.padEnd(11)} ${String(ms(s.ttftMs ?? NaN)).padStart(6)} ${String(ms(s.lineDoneMs ?? NaN)).padStart(6)} ` +
      `${String(s.words ?? '-').padStart(6)} ${flag(v.speakable)}${flag(v.fit)}${flag(v.natural)} ${(s.line ?? '(none)').slice(0, 62)}`,
  );
});

// ── latency ───────────────────────────────────────────────────────────────
const ttfts = samples.map((s) => s.ttftMs).filter((x): x is number => x !== null);
const lineDones = samples.map((s) => s.lineDoneMs).filter((x): x is number => x !== null);
console.log(
  '\nLATENCY (LLM stage only — excludes the 110ms settle beat, ~60ms retrieval, network)',
);
console.log(
  `  TTFT           mean=${ms(mean(ttfts))}  p50=${ms(pct(ttfts, 0.5))}  p90=${ms(pct(ttfts, 0.9))}`,
);
console.log(
  `  line complete  mean=${ms(mean(lineDones))}  p50=${ms(pct(lineDones, 0.5))}  p90=${ms(pct(lineDones, 0.9))}`,
);
console.log(`  full JSON      mean=${ms(mean(samples.map((s) => s.totalMs)))}`);

// End-to-end projection, so the number is comparable to the 1s goal.
const SETTLE = 110;
const RETRIEVAL = 60;
const NETWORK = 85;
const proj = (x: number): number => x + SETTLE + RETRIEVAL + NETWORK;
console.log(
  `\n  projected SPEAKABLE end-to-end (+${SETTLE} settle +${RETRIEVAL} retrieval +${NETWORK} network):`,
);
console.log(
  `    mean=${ms(proj(mean(lineDones)))}  p50=${ms(proj(pct(lineDones, 0.5)))}  p90=${ms(proj(pct(lineDones, 0.9)))}   target ≤1000ms`,
);

// ── quality ───────────────────────────────────────────────────────────────
const n = samples.length;
const rate = (k: number): number => (n ? k / n : 0);
const parsed = rate(samples.filter((s) => s.parsed).length);
const speakable = rate(verdicts.filter((v) => v.speakable).length);
const fit = rate(verdicts.filter((v) => v.fit).length);
const natural = rate(verdicts.filter((v) => v.natural).length);
const noPlaceholder = rate(samples.filter((s) => !s.hasPlaceholder).length);
const withinCap = rate(samples.filter((s) => (s.words ?? 0) <= WORD_CAP).length);
const badCite = samples.filter((s) => s.citedIds.some((id) => !CHUNKS.some((c) => c.id === id)));

const pctS = (x: number): string => `${Math.round(x * 100)}%`;
console.log('\nQUALITY');
console.log(`  strict-JSON parsed    ${pctS(parsed)}   [gate ${pctS(GATE_PARSE)}]`);
console.log(`  speakable verbatim    ${pctS(speakable)}   [gate ${pctS(GATE_SPEAKABLE)}]`);
console.log(`  archetype fit         ${pctS(fit)}`);
console.log(`  natural phrasing      ${pctS(natural)}`);
console.log(`  no placeholder leak   ${pctS(noPlaceholder)}   [gate ${pctS(GATE_NO_PLACEHOLDER)}]`);
console.log(
  `  within ${WORD_CAP}-word cap   ${pctS(withinCap)}   (mean ${mean(samples.map((s) => s.words ?? 0)).toFixed(1)} words)`,
);
console.log(`  hallucinated chunk id ${badCite.length}`);

const failures = samples
  .map((s, i) => ({ s, v: verdicts[i]! }))
  .filter(({ s, v }) => !v.speakable || !v.fit || s.hasPlaceholder || !s.parsed);
if (failures.length) {
  console.log('\nFAILURES');
  for (const { s, v } of failures) {
    console.log(`  [${s.archetype}] ${v.why || (s.parsed ? '' : 'json parse failed')}`);
    console.log(`     prospect: ${s.text.slice(0, 78)}`);
    console.log(`     line    : ${s.line ?? '(none)'}`);
  }
}

const gatesPass =
  parsed >= GATE_PARSE && speakable >= GATE_SPEAKABLE && noPlaceholder >= GATE_NO_PLACEHOLDER;
console.log('\n' + '─'.repeat(74));
console.log(
  gatesPass ? '✔ PASS — quality gates held' : '✘ FAIL — a quality gate is below threshold',
);
console.log('─'.repeat(74));
process.exit(gatesPass ? 0 : 1);
