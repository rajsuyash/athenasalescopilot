import { PublicShell } from '@/components/PublicShell';

export const metadata = { title: 'Privacy · Athena' };

export default function PrivacyPage() {
  return (
    <PublicShell>
      <article className="prose-invert max-w-3xl mx-auto px-6 py-12 text-white/80 text-sm leading-relaxed">
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Privacy Policy</h1>
        <p className="text-white/50 text-xs mb-8">Last updated: 2026-04-29</p>

        <h2 className="text-lg font-semibold text-white mt-6 mb-2">What we collect</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Account data</strong> — name, email, hashed password, workspace name. Stored in
            our primary Postgres database.
          </li>
          <li>
            <strong>Knowledge content</strong> — documents you upload (PDF, text, URL) and their
            embeddings. Used only to ground suggestions for your workspace.
          </li>
          <li>
            <strong>Meeting transcripts</strong> — speech-to-text output for calls you start with
            Athena. Stored alongside the meeting record.
          </li>
          <li>
            <strong>Audio</strong> — by default we drop audio frames after speech-to-text processes
            them. We retain raw audio only if you opt in via workspace settings.
          </li>
          <li>
            <strong>Operational logs</strong> — request metadata (timestamps, status codes,
            anonymized IPs). Retained for ≤90 days for security and abuse prevention.
          </li>
        </ul>

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">How we use it</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>To deliver the live coaching, recap, and analytics features.</li>
          <li>To detect abuse and protect the service.</li>
          <li>
            To send you transactional email about your account (sign-in, security alerts). We do not
            send marketing email without explicit opt-in.
          </li>
        </ul>

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">Sub-processors</h2>
        <p>
          We send call audio and transcript text to third-party AI providers strictly for
          processing:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Deepgram (speech-to-text)</li>
          <li>Anthropic (LLM grounded answers)</li>
          <li>OpenAI (embeddings)</li>
          <li>Stripe (billing, when paid plans are enabled)</li>
        </ul>
        <p className="mt-2">
          Each provider is contractually bound to use the data only to deliver their service. We do
          not sell or share your data with anyone else.
        </p>

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">Tenant isolation</h2>
        <p>
          Every record in our database is scoped to a workspace. Your knowledge documents,
          transcripts, and recaps are never visible to any other workspace.
        </p>

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">Your controls</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Export</strong> — request a JSON export of your workspace data via{' '}
            <a className="underline" href="mailto:privacy@athena.app">
              privacy@athena.app
            </a>
            .
          </li>
          <li>
            <strong>Delete</strong> — workspace owners can permanently delete the workspace from{' '}
            <em>Settings → Danger zone</em>. Data is removed within 30 days.
          </li>
          <li>
            <strong>Retention policy</strong> — adjust per-workspace retention (transcripts, audio,
            recaps) under Settings.
          </li>
        </ul>

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">Cookies</h2>
        <p>
          We use a single first-party httpOnly session cookie. No third-party advertising or
          tracking cookies.
        </p>

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">Contact</h2>
        <p>
          Questions:{' '}
          <a className="underline" href="mailto:privacy@athena.app">
            privacy@athena.app
          </a>
        </p>
      </article>
    </PublicShell>
  );
}
