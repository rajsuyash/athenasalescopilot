'use client';

/**
 * Onboarding gate: install extension → connect it → then the guided setup
 * (children) unlocks. Talks to the extension's connect content script over
 * window.postMessage (same protocol as /connect-extension):
 *
 *   page → {source:'rocket-connect-page', type:'ping'|'status'|'pair'}
 *   ext  → {source:'rocket-extension', type:'ready'|'status-result'|'pair-result'}
 *
 * The content script only exists after the extension is installed AND the
 * page is (re)loaded, so "I've installed it" re-checks via a page reload.
 * A "skip for now" escape hatch avoids dead-ends (other browser/profile).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { dictionaries, type Locale } from '@/lib/i18n/dictionaries';

const FROM_PAGE = 'rocket-connect-page';
const FROM_EXTENSION = 'rocket-extension';

type ExtPresence = 'searching' | 'missing' | 'present';

interface ExtensionSetupGateProps {
  zipHref: string;
  version: string;
  locale: Locale;
  children: React.ReactNode;
}

export function ExtensionSetupGate({ zipHref, version, locale, children }: ExtensionSetupGateProps) {
  const t = dictionaries[locale].gate;
  const [presence, setPresence] = useState<ExtPresence>('searching');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  const autoConnectStarted = useRef(false);

  const connect = useCallback(async (): Promise<void> => {
    setConnectError(null);
    try {
      const res = await fetch('/api/auth/extension/pair-start', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setConnectError(body.message ?? `pairing failed (HTTP ${res.status})`);
        return;
      }
      const { code } = (await res.json()) as { code: string };
      window.postMessage({ source: FROM_PAGE, type: 'pair', code }, window.location.origin);
      // Result arrives as a pair-result message handled below.
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'pairing failed');
    }
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        signedIn?: boolean;
        ok?: boolean;
        error?: string;
      };
      if (!data || data.source !== FROM_EXTENSION) return;
      if (data.type === 'ready') {
        setPresence('present');
        window.postMessage({ source: FROM_PAGE, type: 'status' }, window.location.origin);
      } else if (data.type === 'status-result') {
        setConnected(!!data.signedIn);
      } else if (data.type === 'pair-result') {
        if (data.ok) {
          setConnected(true);
          setConnectError(null);
        } else {
          setConnectError(data.error ?? 'unknown error');
        }
      }
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ source: FROM_PAGE, type: 'ping' }, window.location.origin);
    // Content scripts inject at document_idle — give the announcement a
    // moment before declaring the extension missing.
    const timer = setTimeout(() => setPresence((p) => (p === 'searching' ? 'missing' : p)), 1500);
    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
  }, []);

  // Extension present but not signed in → connect automatically, once.
  useEffect(() => {
    if (presence !== 'present' || connected !== false || autoConnectStarted.current) return;
    autoConnectStarted.current = true;
    void connect();
  }, [presence, connected, connect]);

  const installDone = presence === 'present';
  const connectDone = installDone && connected === true;
  const unlocked = connectDone || skipped;

  if (connectDone) {
    return (
      <div>
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-white/80">
          <span className="text-accent">✓</span>
          {t.connectedBanner(version)}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-xl border border-white/10 bg-ink-800/40 p-6 mb-8">
        <div className="text-xs uppercase tracking-widest text-accent mb-4">
          {t.beforeFirstCall}
        </div>

        <ol className="space-y-6">
          {/* Step 1 — install */}
          <StepRow n={1} done={installDone} active={!installDone} title={t.step1Title}>
            {installDone ? (
              <p className="text-sm text-white/60">{t.step1Installed}</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-white/60">{t.step1Body}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={zipHref}
                    download
                    className="inline-flex items-center gap-2 rounded-lg bg-accent text-ink-900 font-semibold px-4 py-2 text-xs hover:scale-[1.02] active:scale-[0.98] transition-transform duration-200"
                  >
                    {t.download(version)}
                  </a>
                  <Link
                    href="/install"
                    target="_blank"
                    className="text-xs text-accent underline underline-offset-2"
                  >
                    {t.installGuide}
                  </Link>
                </div>
                <button
                  onClick={() => window.location.reload()}
                  className="text-xs text-white/50 underline underline-offset-2 hover:text-white/80"
                >
                  {t.checkAgain}
                </button>
              </div>
            )}
          </StepRow>

          {/* Step 2 — connect */}
          <StepRow
            n={2}
            done={connectDone}
            active={installDone && !connectDone}
            title={t.step2Title}
          >
            {!installDone ? (
              <p className="text-sm text-white/40">{t.step2Waiting}</p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-white/60">{t.step2Body}</p>
                <button
                  onClick={() => void connect()}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent text-ink-900 font-semibold px-4 py-2 text-xs hover:scale-[1.02] active:scale-[0.98] transition-transform duration-200"
                >
                  {t.connect}
                </button>
                {connectError ? (
                  <p className="text-xs text-red-400">
                    {connectError} —{' '}
                    <Link href="/connect-extension" className="underline">
                      {t.connectErrorSuffix}
                    </Link>
                    .
                  </p>
                ) : null}
              </div>
            )}
          </StepRow>

          {/* Step 3 — guided setup */}
          <StepRow n={3} done={false} active={unlocked} title={t.step3Title}>
            <p className="text-sm text-white/40">{t.step3Body}</p>
          </StepRow>
        </ol>

        {!skipped ? (
          <button
            onClick={() => setSkipped(true)}
            className="mt-6 text-xs text-white/40 underline underline-offset-2 hover:text-white/70"
          >
            {t.skip}
          </button>
        ) : null}
      </div>

      {unlocked ? children : null}
    </div>
  );
}

function StepRow({
  n,
  done,
  active,
  title,
  children,
}: {
  n: number;
  done: boolean;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ring-1 ${
          done
            ? 'bg-accent/20 text-accent ring-accent/40'
            : active
              ? 'bg-white/10 text-white ring-white/30'
              : 'bg-white/5 text-white/40 ring-white/10'
        }`}
      >
        {done ? '✓' : n}
      </span>
      <div className="flex-1 pt-1">
        <div className={`text-sm font-medium mb-1 ${active || done ? 'text-white' : 'text-white/40'}`}>
          {title}
        </div>
        {children}
      </div>
    </li>
  );
}
