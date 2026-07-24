/**
 * Coach-quality eval harness (F22).
 *
 * Deterministic, CI-safe (no DB, no LLM, no keys). Measures the coach-quality
 * signals that don't need a model, and gates regressions:
 *
 *   1. Objection-detection RECALL — for a corpus of realistic objection
 *      utterances, does the live urgency gate (classifyHeuristic urgencyScore
 *      >= URGENCY_THRESHOLD) let the turn through to the LLM? This is the gate
 *      that once suppressed 98/98 turns; a regex/threshold regression shows up
 *      here. English + French — both gated (FR patterns added in F20-FR).
 *   2. Objection-loop state machine — walks scripted episodes through
 *      reconcileEpisode end-to-end and asserts every transition.
 *   3. Retrieval ordering — mergeObjectionFirst keeps objection chunks first.
 *
 * Run:  pnpm --filter @athena/realtime-gateway eval
 * Exit: non-zero if any gated metric is below threshold.
 *
 * Extension point (not in v1): a `--live` mode gated on ANTHROPIC_API_KEY that
 * runs each fixture through the real SUGGEST_SYSTEM prompt and LLM-judges
 * entailment + loop-step correctness. Kept out of the default path so CI stays
 * key-free and fast.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  classifyHeuristic,
  reconcileEpisode,
  mergeObjectionFirst,
  type EpisodeState,
  type EpisodeDecision,
} from '../src/lib/coach.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (f: string): unknown => JSON.parse(readFileSync(join(HERE, 'fixtures', f), 'utf8'));

// Live default (config/env.ts URGENCY_THRESHOLD). A turn below this never
// reaches the LLM, so recall here = "would the coach even try?".
const URGENCY_THRESHOLD = Number(process.env.URGENCY_THRESHOLD ?? 0.35);

// Gates. Below these → non-zero exit.
// RECALL: real objections must reach the coach (EN + FR).
// PRECISION: benign turns must NOT trigger objection coaching. Precision is the
// gate F20 lacked — it shipped a false-positive regression (benign turns firing
// objection advice) because the eval only measured recall. It is weighted as a
// hard gate now: random advice on normal conversation is worse than a missed
// objection.
const EN_RECALL_GATE = 0.85;
const FR_RECALL_GATE = 0.8;
const PRECISION_GATE = 0.95;
const EPISODE_GATE = 1.0;

interface ObjectionItem {
  archetype: string;
  lang: string;
  text: string;
}

let failed = false;
const line = '─'.repeat(60);

// ── 1. Objection-detection recall ──────────────────────────────────────────
const objections = (load('objections.json') as { items: ObjectionItem[] }).items;
const byArchetype = new Map<string, { hit: number; total: number }>();
let enHit = 0;
let enTotal = 0;
let frHit = 0;
let frTotal = 0;
const misses: ObjectionItem[] = [];

for (const item of objections) {
  // Mirror the live gate (coach.ts): objections bypass the urgency threshold;
  // everything else must clear it. "Fires" = would reach the LLM.
  const intent = classifyHeuristic(item.text);
  const fires = intent.isObjection || intent.urgencyScore >= URGENCY_THRESHOLD;
  const bucket = byArchetype.get(item.archetype) ?? { hit: 0, total: 0 };
  bucket.total += 1;
  if (fires) bucket.hit += 1;
  byArchetype.set(item.archetype, bucket);
  if (item.lang === 'fr') {
    frTotal += 1;
    if (fires) frHit += 1;
  } else {
    enTotal += 1;
    if (fires) enHit += 1;
    if (!fires) misses.push(item);
  }
}

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);

console.log(
  `\n${line}\nF22 coach-eval · objection-detection recall (gate >= ${URGENCY_THRESHOLD})\n${line}`,
);
for (const [arch, b] of [...byArchetype.entries()].sort()) {
  console.log(`  ${arch.padEnd(14)} ${pct(b.hit, b.total).padStart(4)}  (${b.hit}/${b.total})`);
}
const enRecall = enTotal === 0 ? 0 : enHit / enTotal;
console.log(
  `\n  EN recall: ${pct(enHit, enTotal)} (${enHit}/${enTotal})   [gate ${Math.round(EN_RECALL_GATE * 100)}%]`,
);
const frRecall = frTotal === 0 ? 0 : frHit / frTotal;
console.log(
  `  FR recall: ${pct(frHit, frTotal)} (${frHit}/${frTotal})   [gate ${Math.round(FR_RECALL_GATE * 100)}%]`,
);
if (frRecall < FR_RECALL_GATE) {
  console.log(
    `\n  ✖ FR recall ${pct(frHit, frTotal)} below gate ${Math.round(FR_RECALL_GATE * 100)}% — REGRESSION`,
  );
  failed = true;
}
if (misses.length > 0) {
  console.log('\n  EN misses (would NOT reach the coach):');
  for (const m of misses) console.log(`    [${m.archetype}] "${m.text}"`);
}
if (enRecall < EN_RECALL_GATE) {
  console.log(
    `\n  ✖ EN recall ${pct(enHit, enTotal)} below gate ${Math.round(EN_RECALL_GATE * 100)}% — REGRESSION`,
  );
  failed = true;
}

// ── 1b. Precision — benign turns must NOT trigger objection coaching ────────
const benign = (load('benign.json') as { items: Array<{ text: string }> }).items;
let benignQuiet = 0;
const falsePositives: string[] = [];
for (const b of benign) {
  const intent = classifyHeuristic(b.text);
  // A benign turn "stays quiet" if it is not flagged as an objection. (Bare
  // questions are excluded from this corpus on purpose.)
  if (!intent.isObjection) benignQuiet += 1;
  else falsePositives.push(b.text);
}
const precision = benign.length === 0 ? 1 : benignQuiet / benign.length;
console.log(`\n${line}\nF22 coach-eval · precision (benign turns must stay quiet)\n${line}`);
console.log(
  `  benign kept quiet: ${pct(benignQuiet, benign.length)} (${benignQuiet}/${benign.length})   [gate ${Math.round(PRECISION_GATE * 100)}%]`,
);
if (falsePositives.length > 0) {
  console.log('\n  FALSE POSITIVES (benign turn → objection advice):');
  for (const t of falsePositives) console.log(`    "${t}"`);
}
if (precision < PRECISION_GATE) {
  console.log(
    `\n  ✖ precision ${pct(benignQuiet, benign.length)} below gate ${Math.round(PRECISION_GATE * 100)}% — random advice on benign turns`,
  );
  failed = true;
}

// ── 2. Objection-loop state machine ────────────────────────────────────────
function applyPure(prior: EpisodeState | null, d: EpisodeDecision): EpisodeState | null {
  switch (d.kind) {
    case 'none':
      return prior;
    case 'open':
      return {
        id: 'eval',
        archetype: d.archetype,
        currentStep: d.step,
        reframeUsed: d.reframe,
        deflections: 0,
      };
    case 'advance':
      return prior
        ? { ...prior, currentStep: d.step, reframeUsed: d.reframe, deflections: d.deflections }
        : null;
    case 'close':
      return null;
  }
}

interface EpisodeFixture {
  name: string;
  intentCategories: string[];
  steps: Array<{ report: Record<string, unknown>; expect: Record<string, unknown> }>;
}
const episodes = (load('episodes.json') as { episodes: EpisodeFixture[] }).episodes;
let epSteps = 0;
let epOk = 0;

console.log(`\n${line}\nF22 coach-eval · objection-loop state machine\n${line}`);
for (const ep of episodes) {
  let prior: EpisodeState | null = null;
  let epPass = true;
  for (const step of ep.steps) {
    epSteps += 1;
    const decision = reconcileEpisode(prior, step.report as never, ep.intentCategories as never);
    const e = step.expect;
    let ok = decision.kind === e.kind;
    if (ok && 'step' in e && decision.kind !== 'none' && decision.kind !== 'close') {
      ok = (decision as { step?: string }).step === e.step;
    }
    if (ok && 'status' in e && decision.kind === 'close') ok = decision.status === e.status;
    if (ok && 'archetype' in e && decision.kind === 'open') ok = decision.archetype === e.archetype;
    if (ok && 'deflections' in e && decision.kind === 'advance')
      ok = decision.deflections === e.deflections;
    if (ok) epOk += 1;
    else {
      epPass = false;
      console.log(`  ✖ ${ep.name}: expected ${JSON.stringify(e)}, got ${JSON.stringify(decision)}`);
    }
    prior = applyPure(prior, decision);
  }
  console.log(`  ${epPass ? '✔' : '✖'} ${ep.name}`);
}
const epRate = epSteps === 0 ? 0 : epOk / epSteps;
console.log(`\n  transitions: ${pct(epOk, epSteps)} (${epOk}/${epSteps})   [gate 100%]`);
if (epRate < EPISODE_GATE) failed = true;

// ── 3. Retrieval ordering ──────────────────────────────────────────────────
const merged = mergeObjectionFirst(
  [{ id: 'obj-1' }, { id: 'obj-2' }],
  [{ id: 'gen-1' }, { id: 'obj-1' }],
  3,
).map((r) => r.id);
const orderingOk = merged[0] === 'obj-1' && merged[1] === 'obj-2' && merged.length === 3;
console.log(`\n${line}\nF22 coach-eval · retrieval ordering\n${line}`);
console.log(
  `  ${orderingOk ? '✔' : '✖'} objection chunks lead, deduped, capped → ${JSON.stringify(merged)}`,
);
if (!orderingOk) failed = true;

console.log(
  `\n${line}\n${failed ? '✖ FAIL — a gated metric regressed' : '✔ PASS — all gated metrics within threshold'}\n${line}\n`,
);
process.exit(failed ? 1 : 0);
