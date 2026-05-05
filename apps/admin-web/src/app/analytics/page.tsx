import { redirect } from 'next/navigation';
import { ApiError, callBackend } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { getSession } from '@/lib/session';
import { Shell } from '@/components/Shell';

interface Adoption {
  totalMeetings: number;
  meetingsLast7d: number;
  meetingsLast30d: number;
  totalSuggestions: number;
  suggestionsLast30d: number;
  meetingsByDay: Array<{ day: string; count: number }>;
}
interface Objections {
  categories: Array<{ category: string; count: number }>;
}
interface Quality {
  totalScored: number;
  usefulRate: number;
  byType: Array<{ type: string; useful: number; notUseful: number; rate: number }>;
  bySource: Array<{ documentName: string; useful: number; notUseful: number; rate: number; n: number }>;
}
interface Coverage {
  totalSuggestions: number;
  highConfidence: number;
  lowConfidence: number;
  askNextRate: number;
  gaps: Array<{ category: string; lowConfidenceCount: number; askNextCount: number }>;
}

interface Latency {
  windowDays: number;
  byStage: Array<{
    stage: string;
    n: number;
    p50: number;
    p95: number;
    p99: number;
    budgetMs: number;
    overBudgetRate: number;
  }>;
}

interface MeResponse {
  user: { email: string };
  workspace: { name: string };
  role: string;
}

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  const env = serverEnv();
  let me: MeResponse;
  try {
    me = await callBackend<MeResponse>({ baseUrl: env.apiUrl, path: '/v1/auth/me' });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/signin');
    throw err;
  }

  const [adoption, objections, quality, coverage, latency] = await Promise.all([
    callBackend<Adoption>({ baseUrl: env.analyticsUrl, path: '/v1/analytics/adoption' }).catch(
      () => null,
    ),
    callBackend<Objections>({ baseUrl: env.analyticsUrl, path: '/v1/analytics/objections' }).catch(
      () => null,
    ),
    callBackend<Quality>({ baseUrl: env.analyticsUrl, path: '/v1/analytics/quality' }).catch(
      () => null,
    ),
    callBackend<Coverage>({ baseUrl: env.analyticsUrl, path: '/v1/analytics/coverage' }).catch(
      () => null,
    ),
    callBackend<Latency>({ baseUrl: env.analyticsUrl, path: '/v1/analytics/latency' }).catch(
      () => null,
    ),
  ]);

  return (
    <Shell email={me.user.email} workspace={me.workspace.name}>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Analytics</h1>
      <p className="text-sm text-white/50 mb-8">
        Workspace-scoped aggregations over the last 30 days.
      </p>

      {!adoption || !objections || !quality || !coverage ? (
        <div className="rounded bg-yellow-500/10 text-yellow-300 text-sm p-3">
          Analytics service unreachable — try again in a moment.
        </div>
      ) : (
        <div className="space-y-8">
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Meetings (all time)" value={fmt(adoption.totalMeetings)} />
            <Stat label="Meetings · 7d" value={fmt(adoption.meetingsLast7d)} />
            <Stat label="Meetings · 30d" value={fmt(adoption.meetingsLast30d)} />
            <Stat label="Suggestions · 30d" value={fmt(adoption.suggestionsLast30d)} />
          </section>

          <section className="rounded-lg border border-white/5 bg-ink-800/40 p-4">
            <h2 className="text-sm font-medium mb-3">Meetings · last 30 days</h2>
            <Sparkline data={adoption.meetingsByDay.map((d) => d.count)} />
            <div className="flex justify-between text-[10px] text-white/40 mt-1">
              <span>{adoption.meetingsByDay[0]?.day ?? ''}</span>
              <span>{adoption.meetingsByDay[adoption.meetingsByDay.length - 1]?.day ?? ''}</span>
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section className="rounded-lg border border-white/5 bg-ink-800/40 p-4">
              <h2 className="text-sm font-medium mb-3">Top objection categories</h2>
              <BarList
                items={objections.categories.map((c) => ({ label: c.category, value: c.count }))}
                emptyHint="No objections classified yet."
              />
            </section>

            <section className="rounded-lg border border-white/5 bg-ink-800/40 p-4">
              <h2 className="text-sm font-medium mb-3">
                Useful-rate by suggestion type ·{' '}
                <span className="text-white/40">
                  workspace {((quality.usefulRate || 0) * 100).toFixed(0)}% over{' '}
                  {quality.totalScored} scored
                </span>
              </h2>
              <BarList
                items={quality.byType.map((t) => ({
                  label: `${t.type} (${t.useful + t.notUseful})`,
                  value: Math.round(t.rate * 100),
                  suffix: '%',
                }))}
                emptyHint="No 👍/👎 yet."
              />
            </section>

            <section className="rounded-lg border border-white/5 bg-ink-800/40 p-4">
              <h2 className="text-sm font-medium mb-3">Top source documents (useful-rate)</h2>
              <BarList
                items={quality.bySource.map((s) => ({
                  label: `${s.documentName} (${s.n})`,
                  value: Math.round(s.rate * 100),
                  suffix: '%',
                }))}
                emptyHint="No source-attributed feedback yet."
              />
            </section>

            <section className="rounded-lg border border-white/5 bg-ink-800/40 p-4">
              <h2 className="text-sm font-medium mb-3">
                Realtime latency · last {latency?.windowDays ?? 7}d
              </h2>
              {!latency || latency.byStage.length === 0 ? (
                <div className="text-xs text-white/40">
                  No latency events yet — start a meeting via the gateway.
                </div>
              ) : (
                <div className="space-y-2">
                  {latency.byStage.map((s) => {
                    const overBudget = s.budgetMs > 0 && s.p95 > s.budgetMs;
                    return (
                      <div key={s.stage} className="text-xs">
                        <div className="flex justify-between mb-0.5">
                          <span className="text-white/70 font-mono">
                            {s.stage}{' '}
                            <span className="text-white/40">({s.n})</span>
                          </span>
                          <span className={overBudget ? 'text-red-300' : 'text-white/50'}>
                            p50 {s.p50}ms · p95 {s.p95}ms · p99 {s.p99}ms
                            {s.budgetMs > 0 ? ` · budget ${s.budgetMs}ms` : ''}
                          </span>
                        </div>
                        {s.budgetMs > 0 ? (
                          <div className="h-1.5 bg-white/5 rounded">
                            <div
                              className={`h-full rounded ${overBudget ? 'bg-red-400/70' : 'bg-emerald-400/70'}`}
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.round((s.p95 / Math.max(1, s.budgetMs)) * 100),
                                )}%`,
                              }}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-white/5 bg-ink-800/40 p-4">
              <h2 className="text-sm font-medium mb-3">Coverage</h2>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <Mini label="high conf" value={fmt(coverage.highConfidence)} />
                <Mini label="low conf" value={fmt(coverage.lowConfidence)} />
                <Mini
                  label="ask_next %"
                  value={`${Math.round((coverage.askNextRate || 0) * 100)}%`}
                />
              </div>
              <div className="text-xs uppercase tracking-wide text-white/40 mb-2">
                Knowledge gaps
              </div>
              <BarList
                items={coverage.gaps.map((g) => ({
                  label: g.category,
                  value: g.lowConfidenceCount + g.askNextCount,
                }))}
                emptyHint="No gaps detected — your KB covers what reps are getting asked."
              />
            </section>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-ink-800/40 p-4">
      <div className="text-xs text-white/40 mb-1">{label}</div>
      <div className="text-2xl font-medium">{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/5 bg-ink-700/40 p-2 text-center">
      <div className="text-[10px] text-white/40 uppercase">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function BarList({
  items,
  emptyHint,
}: {
  items: Array<{ label: string; value: number; suffix?: string }>;
  emptyHint: string;
}) {
  if (items.length === 0) {
    return <div className="text-xs text-white/40">{emptyHint}</div>;
  }
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-1">
      {items.map((it) => {
        const pct = Math.max(2, Math.round((it.value / max) * 100));
        return (
          <li key={it.label} className="text-xs">
            <div className="flex justify-between mb-0.5">
              <span className="text-white/70 truncate mr-3">{it.label}</span>
              <span className="text-white/50">
                {it.value}
                {it.suffix ?? ''}
              </span>
            </div>
            <div className="h-1.5 bg-white/5 rounded">
              <div
                className="h-full bg-accent/70 rounded"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length === 0) return <div className="text-xs text-white/40">No data.</div>;
  const w = 600;
  const h = 60;
  const max = Math.max(...data, 1);
  const stepX = data.length > 1 ? w / (data.length - 1) : w;
  const points = data
    .map((v, i) => {
      const x = (i * stepX).toFixed(2);
      const y = (h - (v / max) * (h - 6) - 3).toFixed(2);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-12">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={points}
        className="text-accent"
      />
      {data.map((v, i) => {
        const cx = (i * stepX).toFixed(2);
        const cy = (h - (v / max) * (h - 6) - 3).toFixed(2);
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={1.5}
            className={v > 0 ? 'fill-accent' : 'fill-white/20'}
          />
        );
      })}
    </svg>
  );
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
