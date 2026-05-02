/**
 * Workspace-scoped aggregations for the analytics dashboard. PRD F12.
 *
 * Tenant invariant (PRD F10): every query filters on workspace_id directly
 * or via the row's parent entity (e.g. meeting → workspace_id).
 */
import { prisma } from '@athena/db';

export interface AdoptionStats {
  totalMeetings: number;
  meetingsLast7d: number;
  meetingsLast30d: number;
  totalSuggestions: number;
  suggestionsLast30d: number;
  meetingsByDay: Array<{ day: string; count: number }>;
}

export interface ObjectionTrend {
  category: string;
  count: number;
}

export interface QualityStats {
  totalScored: number;
  usefulRate: number;
  byType: Array<{ type: string; useful: number; notUseful: number; rate: number }>;
  bySource: Array<{ documentName: string; useful: number; notUseful: number; rate: number; n: number }>;
}

export interface CoverageStats {
  totalSuggestions: number;
  highConfidence: number;
  lowConfidence: number;
  askNextRate: number;
  gaps: Array<{ category: string; lowConfidenceCount: number; askNextCount: number }>;
}

export interface LatencyStats {
  windowDays: number;
  byStage: Array<{
    stage: string;
    n: number;
    p50: number;
    p95: number;
    p99: number;
    /** PRD §7 budget for this stage in ms; 0 = no published budget. */
    budgetMs: number;
    overBudgetRate: number;
  }>;
}

/** PRD §7 budgets per stage. 0 = unbounded / not published. */
const LATENCY_BUDGETS: Record<string, number> = {
  transcript_final: 300,
  intent: 400,
  retrieval: 800,
  suggestion: 3000,
  coach_total: 2000,
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx] ?? 0;
}

export async function latency(workspaceId: string, days = 7): Promise<LatencyStats> {
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await prisma.latencyEvent.findMany({
    where: { workspaceId, createdAt: { gte: since } },
    select: { stage: true, latencyMs: true },
    take: 50_000,
  });
  const grouped = new Map<string, number[]>();
  for (const r of rows) {
    const arr = grouped.get(r.stage) ?? [];
    arr.push(r.latencyMs);
    grouped.set(r.stage, arr);
  }
  const byStage: LatencyStats['byStage'] = [];
  for (const [stage, samples] of grouped.entries()) {
    samples.sort((a, b) => a - b);
    const budgetMs = LATENCY_BUDGETS[stage] ?? 0;
    const overBudget =
      budgetMs > 0 ? samples.filter((v) => v > budgetMs).length / samples.length : 0;
    byStage.push({
      stage,
      n: samples.length,
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      p99: percentile(samples, 0.99),
      budgetMs,
      overBudgetRate: overBudget,
    });
  }
  byStage.sort((a, b) => a.stage.localeCompare(b.stage));
  return { windowDays: days, byStage };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HIGH_CONF = 0.7;
const LOW_CONF = 0.4;

export async function adoption(workspaceId: string, now: Date = new Date()): Promise<AdoptionStats> {
  const last7d = new Date(now.getTime() - 7 * DAY_MS);
  const last30d = new Date(now.getTime() - 30 * DAY_MS);

  const [totalMeetings, meetingsLast7d, meetingsLast30d, totalSuggestions, suggestionsLast30d] =
    await Promise.all([
      prisma.meeting.count({ where: { workspaceId } }),
      prisma.meeting.count({ where: { workspaceId, startedAt: { gte: last7d } } }),
      prisma.meeting.count({ where: { workspaceId, startedAt: { gte: last30d } } }),
      prisma.suggestion.count({ where: { workspaceId } }),
      prisma.suggestion.count({ where: { workspaceId, generatedAt: { gte: last30d } } }),
    ]);

  // Bucket meetings into days for the last 30 days. Done in JS — small N.
  const recent = await prisma.meeting.findMany({
    where: { workspaceId, startedAt: { gte: last30d } },
    select: { startedAt: true },
  });
  const buckets = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, 0);
  }
  for (const m of recent) {
    if (!m.startedAt) continue;
    const key = m.startedAt.toISOString().slice(0, 10);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  const meetingsByDay = Array.from(buckets.entries()).map(([day, count]) => ({ day, count }));

  return {
    totalMeetings,
    meetingsLast7d,
    meetingsLast30d,
    totalSuggestions,
    suggestionsLast30d,
    meetingsByDay,
  };
}

export async function objectionTrends(workspaceId: string, days = 30): Promise<ObjectionTrend[]> {
  const since = new Date(Date.now() - days * DAY_MS);
  const events = await prisma.intentEvent.findMany({
    where: { meeting: { workspaceId }, detectedAt: { gte: since } },
    select: { categories: true },
    take: 5000,
  });
  const counts = new Map<string, number>();
  for (const e of events) {
    for (const cat of e.categories) {
      if (cat === 'none') continue;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export async function quality(workspaceId: string, days = 30): Promise<QualityStats> {
  const since = new Date(Date.now() - days * DAY_MS);

  const scored = await prisma.suggestion.findMany({
    where: {
      workspaceId,
      generatedAt: { gte: since },
      acceptedSignal: { not: null },
    },
    select: {
      suggestionType: true,
      acceptedSignal: true,
      sourceChunkIds: true,
    },
    take: 5000,
  });
  const totalScored = scored.length;
  const useful = scored.filter((s) => s.acceptedSignal === 'useful').length;
  const usefulRate = totalScored > 0 ? useful / totalScored : 0;

  const byTypeMap = new Map<string, { useful: number; notUseful: number }>();
  for (const s of scored) {
    const cur = byTypeMap.get(s.suggestionType) ?? { useful: 0, notUseful: 0 };
    if (s.acceptedSignal === 'useful') cur.useful += 1;
    else cur.notUseful += 1;
    byTypeMap.set(s.suggestionType, cur);
  }
  const byType = [...byTypeMap.entries()]
    .map(([type, v]) => ({
      type,
      useful: v.useful,
      notUseful: v.notUseful,
      rate: v.useful / Math.max(1, v.useful + v.notUseful),
    }))
    .sort((a, b) => (b.useful + b.notUseful) - (a.useful + a.notUseful));

  // Source attribution: aggregate by document via the chunks → version → doc chain.
  const allChunkIds = scored.flatMap((s) => s.sourceChunkIds);
  const uniqueChunkIds = [...new Set(allChunkIds)];
  let chunkToDoc = new Map<string, string>();
  if (uniqueChunkIds.length > 0) {
    const chunks = await prisma.knowledgeChunk.findMany({
      where: { workspaceId, id: { in: uniqueChunkIds } },
      select: {
        id: true,
        documentVersion: { select: { document: { select: { name: true } } } },
      },
    });
    chunkToDoc = new Map(
      chunks.map((c) => [c.id, c.documentVersion.document.name] as [string, string]),
    );
  }
  const bySourceMap = new Map<string, { useful: number; notUseful: number; n: number }>();
  for (const s of scored) {
    const docs = new Set(
      s.sourceChunkIds.map((id) => chunkToDoc.get(id)).filter((x): x is string => !!x),
    );
    for (const docName of docs) {
      const cur = bySourceMap.get(docName) ?? { useful: 0, notUseful: 0, n: 0 };
      if (s.acceptedSignal === 'useful') cur.useful += 1;
      else cur.notUseful += 1;
      cur.n += 1;
      bySourceMap.set(docName, cur);
    }
  }
  const bySource = [...bySourceMap.entries()]
    .map(([documentName, v]) => ({
      documentName,
      useful: v.useful,
      notUseful: v.notUseful,
      rate: v.useful / Math.max(1, v.useful + v.notUseful),
      n: v.n,
    }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  return { totalScored, usefulRate, byType, bySource };
}

export async function coverage(workspaceId: string, days = 30): Promise<CoverageStats> {
  const since = new Date(Date.now() - days * DAY_MS);
  const sugs = await prisma.suggestion.findMany({
    where: { workspaceId, generatedAt: { gte: since } },
    select: { confidenceScore: true, suggestionType: true, turn: { select: { id: true } } },
    take: 5000,
  });
  const totalSuggestions = sugs.length;
  const highConfidence = sugs.filter((s) => s.confidenceScore >= HIGH_CONF).length;
  const lowConfidence = sugs.filter((s) => s.confidenceScore < LOW_CONF).length;
  const askNext = sugs.filter((s) => s.suggestionType === 'ask_next').length;
  const askNextRate = totalSuggestions > 0 ? askNext / totalSuggestions : 0;

  // Knowledge gaps: which intent categories most often produce a low-confidence
  // or ask_next suggestion? Use the intent event tied to the same turn.
  const turnIds = sugs.map((s) => s.turn.id);
  let intentByTurn = new Map<string, string[]>();
  if (turnIds.length > 0) {
    const intents = await prisma.intentEvent.findMany({
      where: { meeting: { workspaceId }, turnId: { in: turnIds } },
      select: { turnId: true, categories: true },
      take: 5000,
    });
    intentByTurn = new Map(intents.map((i) => [i.turnId, i.categories]));
  }
  const gaps = new Map<string, { lowConfidenceCount: number; askNextCount: number }>();
  for (const s of sugs) {
    const cats = intentByTurn.get(s.turn.id) ?? [];
    for (const cat of cats) {
      if (cat === 'none') continue;
      const cur = gaps.get(cat) ?? { lowConfidenceCount: 0, askNextCount: 0 };
      if (s.confidenceScore < LOW_CONF) cur.lowConfidenceCount += 1;
      if (s.suggestionType === 'ask_next') cur.askNextCount += 1;
      gaps.set(cat, cur);
    }
  }
  const gapList = [...gaps.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .filter((g) => g.lowConfidenceCount + g.askNextCount > 0)
    .sort((a, b) => b.lowConfidenceCount + b.askNextCount - (a.lowConfidenceCount + a.askNextCount))
    .slice(0, 10);

  return { totalSuggestions, highConfidence, lowConfidence, askNextRate, gaps: gapList };
}
