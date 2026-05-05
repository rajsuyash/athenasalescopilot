'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/Shell';

interface PairStartResponse {
  code: string;
  expiresAt: string;
}

interface PairError {
  error?: string;
  message?: string;
}

type Phase = 'idle' | 'minting' | 'ready' | 'expired' | 'error';

export default function ConnectExtensionPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function mint(): Promise<void> {
    setPhase('minting');
    setError(null);
    setCopied(false);
    try {
      const res = await fetch('/api/auth/extension/pair-start', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as PairError;
        setError(body.message ?? `Mint failed (HTTP ${res.status})`);
        setPhase('error');
        return;
      }
      const json = (await res.json()) as PairStartResponse;
      setCode(json.code);
      setExpiresAt(new Date(json.expiresAt));
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'mint failed');
      setPhase('error');
    }
  }

  // Countdown ticker.
  useEffect(() => {
    if (!expiresAt) return;
    const tick = (): void => {
      const left = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setPhase('expired');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  async function copy(): Promise<void> {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // best-effort; the code is also selectable as text on screen
    }
  }

  const mm = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const ss = (secondsLeft % 60).toString().padStart(2, '0');

  return (
    <Shell>
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/70 backdrop-blur">
          <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_2px_rgba(110,231,183,0.6)]" />
          One-tap sign-in
        </div>

        <h1 className="mt-6 text-3xl md:text-4xl font-semibold tracking-tight leading-[1.1]">
          Connect the Chrome extension
        </h1>
        <p className="mt-4 text-base text-white/60 leading-relaxed max-w-xl">
          Signed in with Google? Mint a one-time pairing code below and paste it
          into the Athena extension popup. Works for every account type — no
          extra password to remember.
        </p>

        {phase === 'idle' || phase === 'error' ? (
          <div className="mt-10 rounded-2xl border border-white/10 bg-ink-900/40 p-8 text-center">
            <button
              onClick={mint}
              className="rounded-xl bg-accent text-ink-900 font-semibold px-5 py-2.5 shadow-glow-mint hover:scale-[1.02] active:scale-[0.98] transition-transform duration-200"
            >
              Generate pairing code
            </button>
            {error ? <div className="mt-4 text-sm text-red-400">{error}</div> : null}
          </div>
        ) : null}

        {phase === 'minting' ? (
          <div className="mt-10 rounded-2xl border border-white/10 bg-ink-900/40 p-8 text-center text-sm text-white/60">
            Generating code…
          </div>
        ) : null}

        {phase === 'ready' && code ? (
          <div className="mt-10 space-y-6">
            <div className="aurora-border rounded-2xl">
              <div className="glass rounded-2xl p-8 text-center">
                <div className="text-xs uppercase tracking-[0.22em] text-accent mb-4">
                  Your pairing code
                </div>
                <div className="font-mono text-3xl md:text-4xl font-bold tracking-[0.2em] text-white select-all">
                  {code}
                </div>
                <div className="mt-4 text-xs text-white/50">
                  Expires in <span className="text-white font-mono">{mm}:{ss}</span>{' '}
                  · single-use
                </div>
                <div className="mt-6 flex items-center justify-center gap-3">
                  <button
                    onClick={copy}
                    className="rounded-lg border border-white/15 hover:border-white/30 hover:bg-white/[0.04] px-4 py-2 text-sm transition-colors"
                  >
                    {copied ? 'Copied ✓' : 'Copy code'}
                  </button>
                  <button
                    onClick={mint}
                    className="rounded-lg border border-white/10 hover:border-white/20 px-4 py-2 text-sm text-white/70 transition-colors"
                  >
                    Generate new
                  </button>
                </div>
              </div>
            </div>

            <ol className="space-y-4 text-white/70">
              <Step n={1}>
                Click the puzzle-piece icon in Chrome&apos;s toolbar →{' '}
                <strong className="text-white">Athena Companion</strong>.
              </Step>
              <Step n={2}>
                In the popup, click{' '}
                <em className="text-white/90">Sign in with pairing code</em>.
              </Step>
              <Step n={3}>
                Paste the code above and submit. The extension signs in and is
                ready to coach your next call.
              </Step>
            </ol>
          </div>
        ) : null}

        {phase === 'expired' ? (
          <div className="mt-10 rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-6 text-sm">
            That code expired. Codes are 10 minutes for security.
            <button
              onClick={mint}
              className="ml-3 rounded bg-accent text-ink-900 font-medium px-3 py-1 text-xs"
            >
              Mint a new code
            </button>
          </div>
        ) : null}

        <div className="mt-12 text-sm text-white/50">
          Don&apos;t have the extension yet?{' '}
          <Link href="/install" className="text-accent underline underline-offset-2 hover:text-accent/80">
            Install it first
          </Link>
          .
        </div>
      </div>
    </Shell>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <div className="flex-shrink-0 w-9 h-9 rounded-xl grid place-items-center bg-gradient-to-br from-accent/20 via-accent/5 to-transparent border border-accent/30 text-accent font-mono text-sm">
        {String(n).padStart(2, '0')}
      </div>
      <div className="flex-1 pt-1.5 leading-relaxed">{children}</div>
    </li>
  );
}
