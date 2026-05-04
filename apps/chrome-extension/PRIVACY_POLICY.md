# Privacy Policy — Athena Companion (Chrome Extension)

**Last updated:** 2026-05-04

This privacy policy describes how the Athena Companion Chrome extension ("the extension") and the Athena service ("Athena", "we", "us") collect, use, store, and share information when you install and use the extension.

By installing the extension and signing in with your Athena account, you consent to the practices described here.

---

## 1. Who we are

Athena is a software-as-a-service product that provides real-time AI coaching for sales calls held on Google Meet. The extension is one of several clients that integrate with the Athena platform.

**Contact:** rajsuyash@gmail.com

---

## 2. Information we collect

### 2.1 Account information

When you sign in via the extension popup, we collect:
- Your email address.
- Your password (used only to authenticate; never stored on disk in plaintext, only sent to the Athena API over TLS).
- Your workspace slug (optional).

We store the resulting access token and refresh token in `chrome.storage.local`. These tokens authenticate subsequent requests to the Athena API.

### 2.2 Meeting metadata

When you open a Google Meet URL, the extension captures:
- The Meet meeting code (e.g. `abc-defg-hij`).
- The browser tab title (typically the meeting name).
- Timestamps for join, capture-start, and capture-end events.

This metadata is associated with your authenticated Athena workspace.

### 2.3 Audio (only when you explicitly start capture)

When — and only when — you click "Start live capture" in the extension popup, the extension:
- Captures the audio playing in the Meet tab (i.e. the audio of remote participants) via Chrome's `tabCapture` API.
- Captures your microphone audio via `getUserMedia` (if you have granted microphone permission).

These two audio streams are mixed locally in your browser and streamed in real time as 16 kHz PCM frames over a secure WebSocket to Athena's realtime gateway, where they are transcribed and analyzed by the Athena coach.

**A red "Athena recording" indicator stays visible inside the Meet tab for the entire duration of capture.** Capture stops immediately when you click "Stop live capture", close the Meet tab, sign out, or close the browser.

### 2.4 Transcripts and AI suggestions

The transcripts generated from your meeting audio, and the AI-generated coach suggestions emitted in response, are stored in your Athena workspace database. They are visible to you (and to other members of your Athena workspace, subject to your workspace's access controls) in the Athena admin web app.

### 2.5 Notifications

When you have unread notifications in your Athena workspace, the extension polls Athena's notification endpoint every 30 seconds (via the `chrome.alarms` API) and surfaces new entries as native Chrome notifications. The notification content (title, body, link) is fetched from the Athena API and stored briefly in `chrome.storage.local` for display.

### 2.6 What we do NOT collect

- We do not capture audio outside of an active capture session you have explicitly started.
- We do not capture audio from any tab other than the Google Meet tab you are joined to.
- We do not read your browsing history or content from any non-Meet tab.
- We do not collect location, device fingerprints, or analytics about your browsing behavior.
- We do not sell or rent your data to advertisers.

---

## 3. How we use the information

- **Real-time coaching.** Audio is transcribed and the resulting transcript is fed to Athena's coach to generate grounded suggestions, which are sent back to your browser and rendered inside the Meet tab.
- **Account authentication and session continuity.** Tokens are used to keep you signed in across browser restarts.
- **Notifications.** Unread workspace notifications are polled and surfaced.
- **Workspace history.** Transcripts and suggestions are persisted in your Athena workspace so you (or your team, per your workspace permissions) can review meetings later.

We do not use your data to train shared AI models. Your transcripts and audio are scoped to your workspace and are not used to improve any product feature for users outside your workspace.

---

## 4. Where the data goes

| Data | Destination | Purpose |
|---|---|---|
| Sign-in credentials | Athena API (`athena-api-production-aa5b.up.railway.app`) | Authentication |
| Audio (PCM frames) | Athena realtime gateway (`athena-realtime-production.up.railway.app`) | Real-time transcription |
| Transcripts (intermediate) | Deepgram (sub-processor) | Speech-to-text |
| Transcripts (final) | Athena's PostgreSQL database (Railway) | Workspace history, suggestion grounding |
| Coach prompts | Anthropic (sub-processor) | LLM inference for suggestions |
| Suggestions, meeting metadata | Athena's PostgreSQL database (Railway) | Workspace history |
| Authentication tokens | Your local `chrome.storage.local` | Session continuity |

All transport is over TLS. All sub-processors (Deepgram, Anthropic, Railway) operate under Data Processing Agreements appropriate for the processing of business communications.

---

## 5. Data retention

- **Audio:** Not retained by default. PCM frames are discarded after transcription. Workspaces may opt in to audio retention via the Athena admin app, in which case the originating workspace controls the retention window.
- **Transcripts and suggestions:** Retained in your Athena workspace until you (or a workspace administrator) delete them, or until your account is deleted.
- **Authentication tokens:** Stored locally in `chrome.storage.local` until you sign out or uninstall the extension.
- **Notifications:** Mirrored locally for up to 200 most-recent entries to support in-popup display; the source of truth lives in your Athena workspace.

---

## 6. Your rights and controls

- **Access:** You can view all your transcripts, suggestions, and meeting history in the Athena admin web app.
- **Deletion:** You can delete individual meetings or your entire account from the Athena admin app under Settings → Account. Deletion of an account triggers soft-delete of all associated workspaces, transcripts, and suggestions, with hard-delete by retention enforcement jobs within 30 days.
- **Export:** You can request a data export by emailing rajsuyash@gmail.com.
- **Capture toggle:** Capture is off by default. The extension never captures audio without your explicit click on "Start live capture."
- **Sign out:** Signing out from the popup clears all stored tokens locally and stops any active capture immediately.
- **Uninstall:** Uninstalling the extension removes all locally stored state.

---

## 7. Children

Athena is not intended for use by children under 16, and we do not knowingly collect data from anyone in this age group.

---

## 8. Changes to this policy

We may update this policy from time to time. Material changes will be announced via the Athena admin app and via the extension's listing on the Chrome Web Store.

---

## 9. Contact

For privacy questions, data access requests, or deletion requests, contact:

**rajsuyash@gmail.com**

---

> **TODO before submission:** This file must be hosted at a stable, public HTTPS URL (e.g. `https://athena-admin-web-production.up.railway.app/privacy`) and that URL must be supplied in the Chrome Web Store listing form. The Web Store will reject submissions that link to a Markdown file in a Git repo or to a URL that 404s.
