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
 *      here. English + French; FR is informational (English-only regex, F20).
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
// F20 raised EN objection-detection recall from ~45% to ~100% by making
// objections bypass the urgency gate (isObjection) and widening the objection
// patterns. Gate is set with headroom below current so new fixtures can be
// added without instantly failing, but a real regression trips it. FR is still
// English-only (~10%) — informational until FR intent lands (F20-FR).
const EN_RECALL_GATE = 0.9;
const EN_RECALL_TARGET = 0.95;
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
  `\n  EN recall: ${pct(enHit, enTotal)} (${enHit}/${enTotal})   [baseline gate ${Math.round(EN_RECALL_GATE * 100)}%, target ${Math.round(EN_RECALL_TARGET * 100)}% via F20]`,
);
console.log(
  `  FR recall: ${pct(frHit, frTotal)} (${frHit}/${frTotal})   [informational — English-only regex, F20]`,
);
if (misses.length > 0) {
  console.log('\n  EN misses (would NOT reach the coach):');
  for (const m of misses) console.log(`    [${m.archetype}] "${m.text}"`);
}
if (enRecall < EN_RECALL_GATE) {
  console.log(
    `\n  ✖ EN recall ${pct(enHit, enTotal)} below baseline gate ${Math.round(EN_RECALL_GATE * 100)}% — REGRESSION`,
  );
  failed = true;
} else if (enRecall < EN_RECALL_TARGET) {
  console.log(
    `\n  ⚠ EN recall below the ${Math.round(EN_RECALL_TARGET * 100)}% target — regex gate leaks objections (drives F20).`,
  );
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
