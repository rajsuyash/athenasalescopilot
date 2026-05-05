import { PublicShell } from '@/components/PublicShell';

export const metadata = { title: 'Privacy · Athena' };

export default function PrivacyPage() {
  return (
    <PublicShell>
      <article className="prose-invert max-w-3xl mx-auto px-6 py-12 text-white/80 text-sm leading-relaxed">
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Privacy Policy</h1>
        <p className="text-white/50 text-xs mb-8">Last updated: 2026-05-05</p>

        <p>
          Athena is a software-as-a-service product that provides real-time AI coaching for sales
          calls held on Google Meet. This policy covers all Athena clients — the admin web app, the
          Chrome extension (&quot;Athena Companion&quot;), the macOS desktop overlay, and the CLI.
          By signing in to any Athena client you consent to the practices described here.
        </p>

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">What we collect</h2>
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
          <li>
            We do <strong>not</strong> use your data to train shared AI models. Your transcripts and
            audio are scoped to your workspace and are never used to improve any product feature for
            users outside your workspace.
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
          <li>Clerk (authentication)</li>
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

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">
          Athena Companion (Chrome extension) specifics
        </h2>
        <p>
          The Chrome extension (&quot;Athena Companion&quot;) is one of several Athena clients. It
          captures Google Meet audio when — and only when — you explicitly start a session. The
          following clauses apply specifically to the extension:
        </p>

        <h3 className="text-base font-semibold text-white mt-6 mb-2">Audio capture is opt-in per session</h3>
        <p>
          Nothing is captured until you click <em>&quot;Start live capture&quot;</em> in the
          extension popup. The extension does <strong>not</strong> automatically start capturing
          when you join a Meet. Capture stops immediately when you click <em>Stop live capture</em>,
          close the Meet tab, sign out, or close the browser.
        </p>

        <h3 className="text-base font-semibold text-white mt-6 mb-2">Always-visible recording indicator</h3>
        <p>
          A persistent <em>&quot;● Athena recording&quot;</em> pill is rendered inside the Google
          Meet tab for the entire duration of any active capture session. You always know when the
          extension is listening.
        </p>

        <h3 className="text-base font-semibold text-white mt-6 mb-2">What the extension captures</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Tab audio</strong> — the audio playing in the Meet tab (i.e. the audio of remote
            participants), via Chrome&apos;s <code>tabCapture</code> API.
          </li>
          <li>
            <strong>Microphone audio</strong> — your voice, via <code>getUserMedia</code>, only if
            you have granted microphone permission. Mic capture is best-effort; the extension still
            functions with tab audio alone if you decline.
          </li>
          <li>
            <strong>Meeting metadata</strong> — the Meet meeting code (e.g. <code>abc-defg-hij</code>)
            and the browser tab title, used to associate captured audio with the correct meeting in
            your workspace.
          </li>
        </ul>
        <p className="mt-2">
          Audio is mixed locally in your browser and streamed in real time as 16 kHz PCM frames over
          a secure WebSocket to Athena&apos;s realtime gateway, where it is transcribed and analyzed
          by the Athena coach. No audio is captured outside an active capture session you have
          explicitly started, and no audio is captured from any tab other than the Google Meet tab
          you are joined to.
        </p>

        <h3 className="text-base font-semibold text-white mt-6 mb-2">Local storage by the extension</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Authentication tokens</strong> — your Athena access token + refresh token are
            stored in <code>chrome.storage.local</code> for session continuity. Cleared on sign-out
            or extension uninstall.
          </li>
          <li>
            <strong>Notification mirror</strong> — up to the 200 most-recent workspace notifications
            are mirrored locally for in-popup display. The source of truth lives in your Athena
            workspace.
          </li>
        </ul>

        <h3 className="text-base font-semibold text-white mt-6 mb-2">What the extension does NOT do</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Read your browsing history or content from any non-Meet tab.</li>
          <li>Capture location, device fingerprints, or analytics about your browsing behavior.</li>
          <li>Inject any remote-hosted JavaScript. All extension code is bundled at build time.</li>
          <li>Sell or rent your data to advertisers.</li>
        </ul>

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">Your controls</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Export</strong> — request a JSON export of your workspace data via{' '}
            <a className="underline" href="mailto:rajsuyash@gmail.com">
              rajsuyash@gmail.com
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
          <li>
            <strong>Capture toggle</strong> — capture is off by default. The extension never
            captures audio without your explicit click on <em>Start live capture</em>.
          </li>
          <li>
            <strong>Sign out</strong> — signing out from the extension popup clears all stored
            tokens locally, stops any active capture immediately, and clears the cached inbox.
          </li>
          <li>
            <strong>Uninstall</strong> — uninstalling the extension removes all locally stored
            state.
          </li>
        </ul>

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">Cookies</h2>
        <p>
          The Athena admin web app uses a single first-party httpOnly session cookie. No
          third-party advertising or tracking cookies. The extension does not set cookies.
        </p>

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">Children</h2>
        <p>
          Athena is not intended for use by children under 16, and we do not knowingly collect data
          from anyone in this age group.
        </p>

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">Changes to this policy</h2>
        <p>
          We may update this policy from time to time. Material changes will be announced via the
          Athena admin app and via the extension&apos;s listing on the Chrome Web Store.
        </p>

        <h2 className="text-lg font-semibold text-white mt-8 mb-2">Contact</h2>
        <p>
          For privacy questions, data access requests, or deletion requests:{' '}
          <a className="underline" href="mailto:rajsuyash@gmail.com">
            rajsuyash@gmail.com
          </a>
        </p>
      </article>
    </PublicShell>
  );
}
