'use client';

import { useCallback, useEffect, useState } from 'react';

interface Subscription {
  planTier: 'free' | 'pro' | 'enterprise';
  status: string;
  seats: number;
  meetingHourLimit: number;
  currentPeriodEnd: string | null;
}

interface Usage {
  usage: {
    activeMembers: number;
    monthlyActiveReps: number;
    meetingHours: number;
    knowledgeChunks: number;
    periodStart: string;
    periodEnd: string;
  };
  seats: { seatLimit: number; activeMembers: number; overLimit: boolean };
}

const PLAN_NEXT: Record<Subscription['planTier'], 'pro' | 'enterprise' | null> = {
  free: 'pro',
  pro: 'enterprise',
  enterprise: null,
};

export function BillingCard({ canEdit }: { canEdit: boolean }) {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [seats, setSeats] = useState(5);

  const refresh = useCallback(async () => {
    const [s, u] = await Promise.all([
      fetch('/api/billing/subscription').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/billing/usage').then((r) => (r.ok ? r.json() : null)),
    ]);
    setSub(s as Subscription | null);
    setUsage(u as Usage | null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upgrade = async (target: 'pro' | 'enterprise'): Promise<void> => {
    if (!canEdit) return;
    setBusy(true);
    setStatus(null);
    try {
      // Try real Checkout first; fall back to mock-upgrade if Stripe is in mock mode.
      const r = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planTier: target, seats }),
      });
      const body = (await r.json().catch(() => ({}))) as { url?: string; mock?: boolean; message?: string };
      if (!r.ok) {
        setStatus(body.message ?? `HTTP ${r.status}`);
        return;
      }
      if (body.mock) {
        // Mock mode — apply the upgrade locally so the UX is testable.
        const m = await fetch('/api/billing/mock-upgrade', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ planTier: target, seats }),
        });
        if (m.ok) {
          setStatus(`(mock) upgraded to ${target}`);
          await refresh();
        } else {
          setStatus('mock upgrade failed');
        }
        return;
      }
      if (body.url) window.location.href = body.url;
    } finally {
      setBusy(false);
    }
  };

  const portal = async (): Promise<void> => {
    if (!canEdit) return;
    setBusy(true);
    try {
      const r = await fetch('/api/billing/portal', { method: 'POST' });
      const body = (await r.json()) as { url?: string };
      if (body.url) window.location.href = body.url;
    } finally {
      setBusy(false);
    }
  };

  const next = sub ? PLAN_NEXT[sub.planTier] : null;

  return (
    <div className="rounded-lg border border-white/5 bg-ink-800/40 p-5 mt-6 space-y-4">
      <div>
        <h3 className="font-medium">Billing</h3>
        <p className="text-xs text-white/50">Plan tier, seats, and usage this period.</p>
      </div>

      {!sub || !usage ? (
        <p className="text-sm text-white/40">Loading…</p>
      ) : (
        <>
          {sub.status === 'past_due' ? (
            <div className="rounded bg-red-500/10 text-red-300 text-xs px-3 py-2">
              Payment overdue — new meetings are blocked. Open the Stripe portal to fix.
            </div>
          ) : null}
          {usage.seats.overLimit ? (
            <div className="rounded bg-yellow-500/10 text-yellow-300 text-xs px-3 py-2">
              Seat limit reached ({usage.seats.activeMembers} active /{' '}
              {usage.seats.seatLimit} seats). New invites will return SEAT_LIMIT.
            </div>
          ) : null}
          {sub.meetingHourLimit > 0 &&
          usage.usage.meetingHours >= sub.meetingHourLimit ? (
            <div className="rounded bg-yellow-500/10 text-yellow-300 text-xs px-3 py-2">
              Meeting-hour limit reached ({usage.usage.meetingHours} /{' '}
              {sub.meetingHourLimit}h). New meetings will return METERING_LIMIT.
            </div>
          ) : null}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Mini label="plan" value={sub.planTier} />
            <Mini label="status" value={sub.status} />
            <Mini
              label="seats"
              value={`${usage.seats.activeMembers} / ${sub.seats}`}
              warn={usage.seats.overLimit}
            />
            <Mini
              label="meeting hrs"
              value={`${usage.usage.meetingHours} / ${
                sub.meetingHourLimit < 0 ? '∞' : sub.meetingHourLimit
              }`}
              warn={
                sub.meetingHourLimit > 0 && usage.usage.meetingHours > sub.meetingHourLimit
              }
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-white/50">
            <div>
              MAR (this month): <span className="text-white/80">{usage.usage.monthlyActiveReps}</span>
            </div>
            <div>
              Knowledge chunks: <span className="text-white/80">{usage.usage.knowledgeChunks}</span>
            </div>
            <div>
              Period:{' '}
              <span className="text-white/80">
                {usage.usage.periodStart.slice(0, 10)} → {usage.usage.periodEnd.slice(0, 10)}
              </span>
            </div>
          </div>

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {next ? (
                <>
                  <label className="text-xs text-white/50 flex items-center gap-2">
                    seats
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={seats}
                      onChange={(e) => setSeats(Math.max(1, Number(e.target.value || 1)))}
                      className="w-20 rounded border border-white/10 bg-ink-700/60 px-2 py-1 text-sm"
                    />
                  </label>
                  <button
                    onClick={() => void upgrade(next)}
                    disabled={busy}
                    className="rounded bg-accent text-ink-900 font-medium px-3 py-1 text-sm disabled:opacity-50"
                  >
                    {busy ? 'Working…' : `Upgrade to ${next}`}
                  </button>
                </>
              ) : (
                <span className="text-xs text-white/50">Top tier — no upgrade available.</span>
              )}
              <button
                onClick={() => void portal()}
                disabled={busy}
                className="rounded border border-white/10 px-3 py-1 text-sm hover:bg-white/5 disabled:opacity-50"
              >
                Manage in Stripe
              </button>
              {status ? <span className="text-xs text-white/60">{status}</span> : null}
            </div>
          ) : (
            <p className="text-xs text-white/40">Only owners can change the plan.</p>
          )}
        </>
      )}
    </div>
  );
}

function Mini({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div
      className={`rounded border ${warn ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-white/5 bg-ink-700/40'} p-2 text-center`}
    >
      <div className="text-[10px] text-white/40 uppercase">{label}</div>
      <div className={`text-sm font-medium ${warn ? 'text-yellow-200' : ''}`}>{value}</div>
    </div>
  );
}
