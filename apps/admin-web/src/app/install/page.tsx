import Link from 'next/link';
import type { Metadata } from 'next';
import { PublicShell } from '@/components/PublicShell';

export const metadata: Metadata = {
  title: 'Install Rocket Sales Agent for Chrome',
  description:
    'Step-by-step install guide for the Rocket Sales Agent Chrome extension. Sideload the .zip while we wait for Web Store approval.',
};

const EXT_VERSION = '0.1.2';
const ZIP_HREF = `/downloads/rocket-sales-agent-${EXT_VERSION}.zip`;
const ZIP_SIZE_KB = 21;
const WEB_STORE_URL =
  'https://chromewebstore.google.com/detail/iojoelioomllmbjklcphjcdpblifkhdn';

export default function InstallPage() {
  return (
    <PublicShell>
      <article className="relative px-6 pt-32 pb-24 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/70 backdrop-blur">
          <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_2px_rgba(110,231,183,0.6)]" />
          Chrome extension · v{EXT_VERSION}
        </div>

        <h1 className="mt-6 text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05]">
          Install <span className="text-gradient">Rocket Sales Agent</span> for Chrome.
        </h1>
        <p className="mt-5 text-base md:text-lg text-white/60 leading-relaxed max-w-2xl">
          Two paths. Pick the one that&apos;s available — they install the same extension.
        </p>

        {/* Two install paths */}
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Web Store path */}
          <div className="aurora-border rounded-2xl">
            <div className="glass rounded-2xl p-6 h-full flex flex-col">
              <div className="flex items-center gap-2.5">
                <ChromeMark />
                <h2 className="text-lg font-semibold">Chrome Web Store</h2>
                <span className="ml-auto text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 bg-yellow-500/15 text-yellow-300/90 border border-yellow-500/20">
                  In review
                </span>
              </div>
              <p className="mt-3 text-sm text-white/55 leading-relaxed flex-1">
                Submitted to Google. Audio-capture extensions get an
                in-depth review — typically 1–3 weeks. When it goes live,
                this button installs in one click.
              </p>
              <a
                href={WEB_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 text-center rounded-lg border border-white/15 hover:border-white/30 hover:bg-white/[0.04] py-2.5 text-sm transition-colors"
              >
                Open listing
              </a>
            </div>
          </div>

          {/* Sideload path */}
          <div className="aurora-border rounded-2xl">
            <div className="relative glass rounded-2xl p-6 h-full flex flex-col shadow-glow-mint">
              <div className="flex items-center gap-2.5">
                <BoxIcon />
                <h2 className="text-lg font-semibold">Sideload the .zip</h2>
                <span className="ml-auto text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 bg-accent/20 text-accent border border-accent/30">
                  Available now
                </span>
              </div>
              <p className="mt-3 text-sm text-white/55 leading-relaxed flex-1">
                Download the unpacked extension. Drop the folder into
                Chrome&apos;s Developer Mode — same code, same behavior,
                no Web Store wait.
              </p>
              <a
                href={ZIP_HREF}
                download
                className="group mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-accent text-ink-900 font-semibold py-2.5 text-sm shadow-glow-mint hover:scale-[1.01] active:scale-[0.99] transition-transform duration-200"
              >
                <DownloadIcon />
                <span>Download .zip ({ZIP_SIZE_KB} KB)</span>
              </a>
              <p className="mt-2 text-center text-[11px] text-white/40">
                v{EXT_VERSION} · Manifest V3 · 2026-05-05
              </p>
            </div>
          </div>
        </div>

        {/* Sideload step-by-step */}
        <section className="mt-20">
          <div className="text-xs uppercase tracking-[0.22em] text-accent">
            Sideload guide
          </div>
          <h2 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight">
            Five steps. Three minutes. Done.
          </h2>

          <ol className="mt-10 space-y-8">
            <Step n={1} title="Download + unzip">
              <p>
                Click the download button above. Chrome saves{' '}
                <code className="px-1.5 py-0.5 rounded bg-white/5 text-accent text-[12px] font-mono">
                  rocket-sales-agent-{EXT_VERSION}.zip
                </code>{' '}
                to your Downloads folder.
              </p>
              <p className="mt-2">
                Double-click the zip to unpack it. You&apos;ll get a folder
                named{' '}
                <code className="px-1.5 py-0.5 rounded bg-white/5 text-accent text-[12px] font-mono">
                  rocket-sales-agent-{EXT_VERSION}
                </code>{' '}
                — keep it somewhere stable like your Documents folder. Chrome
                loads the extension from disk, so deleting or moving this
                folder will break the install.
              </p>
            </Step>

            <Step n={2} title="Open Chrome's extensions page">
              <p>
                In a new Chrome tab, paste this into the address bar and hit
                enter:
              </p>
              <CopyableCode value="chrome://extensions" />
            </Step>

            <Step n={3} title="Turn on Developer mode">
              <p>
                In the top-right corner of the extensions page, flip the{' '}
                <strong className="text-white">Developer mode</strong> toggle
                on. Three new buttons appear in the top-left:{' '}
                <em className="text-white/80">Load unpacked</em>,{' '}
                <em className="text-white/80">Pack extension</em>,{' '}
                <em className="text-white/80">Update</em>.
              </p>
              <Callout>
                Developer mode is safe to leave on. Chrome warns you about it
                each launch — that&apos;s a one-banner trade-off until the
                Web Store listing publishes.
              </Callout>
            </Step>

            <Step n={4} title="Click 'Load unpacked' and pick the folder">
              <p>
                Click <strong className="text-white">Load unpacked</strong> →
                navigate to the folder you unzipped in step 1 → select it.
              </p>
              <p className="mt-2">
                The Rocket Sales Agent card appears in your extensions list.
                Pin it to your toolbar by clicking the puzzle-piece icon in
                Chrome&apos;s top bar and clicking the pin next to{' '}
                <em className="text-white/80">Rocket Sales Agent</em>.
              </p>
            </Step>

            <Step n={5} title="Sign in + start coaching">
              <p>
                Click the Rocket icon in your toolbar. Sign in with your{' '}
                <Link
                  href="/signup"
                  className="text-accent underline underline-offset-2 hover:text-accent/80"
                >
                  Rocket Sales Agent account
                </Link>{' '}
                (sign up is free — no card). On first use:
              </p>
              <ul className="mt-3 space-y-1.5 list-disc pl-5 text-white/70">
                <li>Click <em className="text-white/90">Grant mic permission (one-time)</em></li>
                <li>
                  Open any{' '}
                  <code className="px-1.5 py-0.5 rounded bg-white/5 text-accent text-[12px] font-mono">
                    meet.google.com
                  </code>{' '}
                  call
                </li>
                <li>
                  Click <em className="text-white/90">Start live capture</em>{' '}
                  in the popup → approve the tab-audio prompt → suggestions
                  start appearing inside Meet within ~5 seconds
                </li>
              </ul>
            </Step>
          </ol>
        </section>

        {/* Update flow */}
        <section className="mt-20">
          <div className="text-xs uppercase tracking-[0.22em] text-accent">
            Updating
          </div>
          <h2 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight">
            Updating to a new version
          </h2>
          <p className="mt-5 text-white/60 leading-relaxed">
            Sideloaded extensions don&apos;t auto-update. When we ship a new
            release, come back here, download the fresh .zip, replace the
            folder, and click the circular reload icon on the Rocket card in{' '}
            <code className="px-1.5 py-0.5 rounded bg-white/5 text-accent text-[12px] font-mono">
              chrome://extensions
            </code>
            .
          </p>
          <p className="mt-3 text-white/60 leading-relaxed">
            Once the Web Store listing publishes, switch to that install — it
            auto-updates and you can uninstall the sideloaded copy.
          </p>
        </section>

        {/* Privacy + safety */}
        <section className="mt-20">
          <div className="text-xs uppercase tracking-[0.22em] text-accent">
            Privacy &amp; safety
          </div>
          <h2 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight">
            What the extension does — and doesn&apos;t.
          </h2>
          <ul className="mt-6 space-y-2.5 text-white/70">
            {[
              'Captures Google Meet tab audio + your microphone ONLY when you click Start live capture.',
              'A persistent recording indicator stays visible inside Meet for the entire session.',
              'Audio is dropped after transcription — not stored, not shared, not used to train shared AI models.',
              "It never reads tabs other than Google Meet, never injects remote scripts, never sells data.",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3">
                <Check />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-white/60">
            Full policy:{' '}
            <Link
              href="/privacy"
              className="text-accent underline underline-offset-2 hover:text-accent/80"
            >
              Privacy policy
            </Link>
            .
          </p>
        </section>

        {/* Troubleshooting */}
        <section className="mt-20">
          <div className="text-xs uppercase tracking-[0.22em] text-accent">
            Troubleshooting
          </div>
          <h2 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight">
            Something off? Try these.
          </h2>
          <dl className="mt-6 space-y-5 text-white/70">
            <Tip
              q="Chrome says &quot;Manifest file is missing or unreadable.&quot;"
              a="You probably picked the parent folder by accident, or Chrome can't see the manifest.json. Make sure the folder you select contains manifest.json directly inside it."
            />
            <Tip
              q="The popup says &quot;Could not connect.&quot;"
              a="The api/realtime backends are on Railway — sometimes a deploy is in flight. Refresh after 30s. If it persists, the status pill in the footer of every page tells you whether the backend is healthy."
            />
            <Tip
              q="No suggestions appear during a Meet call."
              a="Open the popup mid-call. The status line shows live · audio frames N · finals M · suggestions K. If finals stay 0, your mic likely isn't being captured — click Grant mic permission again."
            />
            <Tip
              q="The recording pill stays visible after I close the tab."
              a="Click the extension icon → Stop live capture. If the popup is unresponsive, disable + re-enable the extension on chrome://extensions."
            />
          </dl>
        </section>

        {/* Final CTA */}
        <section className="mt-20 rounded-2xl glass p-8 text-center relative overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-accent/10 via-transparent to-electric-500/10" />
          <h3 className="text-xl md:text-2xl font-semibold tracking-tight">
            All set? Start with a workspace.
          </h3>
          <p className="mt-2 text-white/55 max-w-md mx-auto">
            The extension needs an account to sign in to. Spin one up — free,
            no card, 30 seconds.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-accent text-ink-900 font-semibold px-5 py-2.5 shadow-glow-mint hover:scale-[1.02] active:scale-[0.98] transition-transform duration-200"
            >
              Create your workspace
            </Link>
            <Link
              href="/"
              className="inline-flex items-center rounded-xl border border-white/15 hover:bg-white/[0.04] hover:border-white/25 px-5 py-2.5 transition-colors text-sm"
            >
              Back to home
            </Link>
          </div>
        </section>
      </article>
    </PublicShell>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-5">
      <div className="flex-shrink-0 w-10 h-10 rounded-xl grid place-items-center bg-gradient-to-br from-accent/20 via-accent/5 to-transparent border border-accent/30 text-accent font-mono text-sm">
        {String(n).padStart(2, '0')}
      </div>
      <div className="flex-1 pt-0.5">
        <h3 className="text-lg font-semibold tracking-tight text-white">{title}</h3>
        <div className="mt-2 text-white/65 leading-relaxed">{children}</div>
      </div>
    </li>
  );
}

function CopyableCode({ value }: { value: string }) {
  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-ink-800 border border-white/10 pl-3 pr-1 py-1 font-mono text-sm">
      <span className="text-accent">{value}</span>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-white/55">
      <span className="text-white/80">Heads up:</span> {children}
    </div>
  );
}

function Tip({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4">
      <dt className="font-medium text-white/85" dangerouslySetInnerHTML={{ __html: q }} />
      <dd className="mt-1.5 text-sm text-white/55 leading-relaxed">{a}</dd>
    </div>
  );
}

function ChromeMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-electric-400">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3.5" />
      <line x1="21.5" y1="9.5" x2="12" y2="9.5" />
      <line x1="3.5" y1="6" x2="9" y2="14.5" />
      <line x1="11" y1="22" x2="15.5" y2="14.5" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-accent">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-accent flex-shrink-0 mt-1">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
