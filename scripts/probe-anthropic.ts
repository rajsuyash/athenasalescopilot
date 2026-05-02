/**
 * Standalone probe: call Anthropic with the same prompt the gateway uses,
 * print raw text + parse outcome. Run with:
 *   pnpm exec tsx --env-file=.env scripts/probe-anthropic.ts
 */
const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';
if (!apiKey) {
  console.error('missing ANTHROPIC_API_KEY in env');
  process.exit(1);
}

const ALLOWED_TYPES = new Set(['answer', 'ask_next', 'coach', 'risk']);
function manualValidate(c: unknown): { ok: true; data: any } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  if (!c || typeof c !== 'object') return { ok: false, issues: ['not an object'] };
  const o = c as Record<string, unknown>;
  if (typeof o.type !== 'string' || !ALLOWED_TYPES.has(o.type)) issues.push(`type invalid: ${JSON.stringify(o.type)}`);
  if (!(o.answer_text === null || typeof o.answer_text === 'string')) issues.push(`answer_text not str|null: ${typeof o.answer_text}`);
  if (!(o.followup_text === null || typeof o.followup_text === 'string')) issues.push(`followup_text not str|null: ${typeof o.followup_text}`);
  if (!Array.isArray(o.source_chunk_ids)) issues.push(`source_chunk_ids not array: ${typeof o.source_chunk_ids}`);
  else for (const id of o.source_chunk_ids) if (typeof id !== 'string') issues.push(`source_chunk_ids contains non-string: ${typeof id} = ${JSON.stringify(id)}`);
  if (typeof o.confidence !== 'number' || o.confidence < 0 || o.confidence > 1) issues.push(`confidence invalid: ${JSON.stringify(o.confidence)}`);
  if (typeof o.rationale !== 'string') issues.push(`rationale not str: ${typeof o.rationale}`);
  return issues.length === 0 ? { ok: true, data: o } : { ok: false, issues };
}

const SUGGEST_SYSTEM = `You are a sales-call copilot. Generate ONE grounded suggestion.

Output ONLY raw JSON (no markdown, no prose, no \`\`\` fences):
{"type":"answer"|"ask_next"|"coach"|"risk","answer_text":<str|null>,"followup_text":<str|null>,"source_chunk_ids":[<id from chunks ONLY>],"confidence":<0..1>,"rationale":<short>}

Rules:
- answer_text comes from chunks ONLY. NEVER invent facts.
- source_chunk_ids must be a subset of provided ids. NEVER use the bracket number like [1] or [2] — always use the full UUID after CHUNK_ID:.
- ≤30 words. No marketing language. No "I" voice.
- No prose outside JSON.`;

const userPrompt = `Customer turn:
Honestly, this is way too expensive for what we get.

Intent: categories=pricing,objection stage=objection_handling urgency=0.80

Approved chunks (use the UUID after "CHUNK_ID:" in source_chunk_ids — never the bracket number):

[1] CHUNK_ID:abc-1111-2222 score=0.450 doc=Objection Reframer — 7-step loop (master)
DISARM: validate the emotion. ISOLATE: confirm price is the only blocker. UNCOVER: ask what value they expected. REFRAME: anchor against status-quo cost. JUSTIFY: tie to outcomes. CONSEQUENCE: what happens if no decision? IDENTITY CLOSE: who they want to be on the other side.

[2] CHUNK_ID:def-3333-4444 score=0.320 doc=Objection Reframer — pricing archetype
When prospect says "too expensive": "Money aside for a second — what would success look like in 90 days?"`;

async function main(): Promise<void> {
const t0 = Date.now();
const r = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model,
    max_tokens: 400,
    temperature: 0.2,
    system: SUGGEST_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  }),
});
const latency = Date.now() - t0;
console.log(`HTTP ${r.status} in ${latency}ms`);
const body = await r.text();
if (!r.ok) {
  console.error('error body:', body);
  process.exit(2);
}
const json = JSON.parse(body);
const text = (json.content?.[0]?.text ?? '').trim();
console.log('\n=== RAW MODEL TEXT ===');
console.log(text);
console.log('\n=== STOP REASON ===', json.stop_reason);
console.log('=== USAGE ===', json.usage);

console.log('\n=== PARSE ATTEMPTS ===');
let candidate: unknown = null;
try { candidate = JSON.parse(text); console.log('plain JSON.parse: OK'); }
catch (e) { console.log('plain JSON.parse: FAIL —', (e as Error).message); }
if (candidate === null) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try { candidate = JSON.parse(fenced[1].trim()); console.log('fenced parse: OK'); }
    catch (e) { console.log('fenced parse: FAIL —', (e as Error).message); }
  }
}
if (candidate === null) {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try { candidate = JSON.parse(m[0]); console.log('regex object parse: OK'); }
    catch (e) { console.log('regex object parse: FAIL —', (e as Error).message); }
  }
}

console.log('\n=== SCHEMA VALIDATE ===');
const v = manualValidate(candidate);
if (v.ok) {
  console.log('PASS:', JSON.stringify(v.data, null, 2));
} else {
  console.log('FAIL — issues:');
  for (const i of v.issues) console.log('  -', i);
  console.log('candidate was:', JSON.stringify(candidate, null, 2));
}
}
main().catch((e) => { console.error(e); process.exit(99); });
