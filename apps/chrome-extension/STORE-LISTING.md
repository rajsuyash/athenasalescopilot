# Chrome Web Store Listing — Athena Companion

> Copy/paste source for the Chrome Web Store Developer Console submission form.
> Char counts checked against published Web Store limits.

---

## Single-purpose description (Web Store required field)

> Joins a Google Meet, captures the call audio, and shows AI-generated answers, follow-up questions, and risk flags inside the Meet tab so the rep can respond in real time.

(One sentence — Web Store reviewers will reject vague multi-purpose pitches.)

---

## Short description (≤132 chars)

> Real-time AI sales coach for Google Meet. Captures the call, transcribes, and surfaces grounded answers in the Meet tab.

(127 chars.)

---

## Detailed description (≤16,000 chars)

**Athena Companion turns Google Meet into a coached sales call.**

When you start a meeting, Athena listens to both sides of the conversation, transcribes it in real time, and surfaces grounded answers, follow-up questions, and risk flags inside the Meet tab — so you can respond confidently without alt-tabbing to a CRM, knowledge base, or notes doc.

Every suggestion is sourced from your own playbook, knowledge base, or sales collateral. No hallucinated answers, no generic templates.

### What it does

- **Live transcription.** Captures both the customer's audio (from the Meet tab) and your microphone, ships PCM frames to Athena's secure realtime gateway, and transcribes via Deepgram.
- **Grounded suggestions.** When a customer raises an objection, asks about pricing, or signals interest, Athena's coach pulls the relevant snippet from your indexed sales material and renders it as a card inside the Meet tab.
- **In-Meet history panel.** A floating panel inside Meet shows every suggestion the coach has emitted during the call, filterable by Ask / Answer / Coach / Risk.
- **Notifications.** Mention pings, comment threads, and post-call recap alerts surface as native Chrome notifications.
- **Recording indicator.** A persistent red "Athena recording" pill is visible inside Meet whenever capture is active. You always know when it's listening.

### How it works

1. Sign in once with your Athena email + password (in the extension popup).
2. Open any Google Meet URL — the popup shows "DETECTED."
3. Click "Start live capture." Chrome prompts for tab + microphone access (one-time).
4. Athena listens in real time. Suggestion cards appear inside the Meet tab as the conversation unfolds.
5. Click "Stop live capture" or close the tab to end the session.

### Privacy

- **Capture is opt-in per session.** Nothing is captured until you explicitly click "Start live capture." Closing the tab or clicking Stop ends the session immediately.
- **A red recording indicator stays visible inside Meet** for the entire capture session.
- **Audio is not retained by default.** PCM frames are streamed to Athena's gateway, transcribed, and dropped. Workspaces can opt in to audio retention via the Athena admin app.
- **Transcripts and AI suggestions are stored** in your Athena workspace and visible in the Athena admin app. You can delete them at any time.
- **Full privacy policy:** [hosted URL — see PRIVACY_POLICY.md]

### Requirements

- An Athena account (free tier available — no credit card required).
- Chrome 120 or later.
- Microphone permission (granted once via the extension's permission tab).

---

## Permissions justification

The Web Store reviewer reads this verbatim. Each line maps to one entry in `manifest.json`.

| Permission | Why we need it |
|---|---|
| `tabs` | Detect when the user navigates to a `meet.google.com` URL so we can attach the in-Meet UI and report the active meeting in the popup. |
| `activeTab` | Read the active Meet tab's URL and title so we know which meeting code to associate with captured audio. |
| `scripting` | Inject the in-Meet content script that renders the suggestion overlay, history panel, and recording pill. |
| `storage` | Persist the user's signed-in session (access + refresh tokens) and capture/inbox state across browser restarts. |
| `notifications` | Surface workspace events (mention pings, post-call recap alerts) as native Chrome notifications when the popup is closed. |
| `alarms` | Wake the service worker every 30 seconds to poll the Athena inbox for new notifications. Required because MV3 service workers are ephemeral. |
| `tabCapture` | Capture the audio playing in the Meet tab (the customer's voice). This is the primary input to live transcription. Only invoked when the user clicks "Start live capture." |
| `offscreen` | Hold the long-lived `MediaStream`, `AudioContext`, and `WebSocket` that stream PCM to the realtime gateway. MV3 service workers cannot keep these alive, so an offscreen document is required. |

### Host permissions

| Host | Why |
|---|---|
| `https://meet.google.com/*` | Detect Meet sessions and inject the in-call UI (suggestion overlay, history panel, recording pill). |
| `https://athena-api-production-aa5b.up.railway.app/*` | Fetch the user's authenticated session, post meeting metadata, and read/mark notifications. |
| `https://athena-realtime-production.up.railway.app/*` and `wss://...` | Open the realtime WebSocket that streams PCM audio to Athena's transcription/coach pipeline. |

### Microphone access (`getUserMedia`)

Triggered manually by the user via the "Grant mic permission" button in the popup, which opens a dedicated extension page where Chrome's permission prompt actually persists. Used to capture the rep's voice in addition to the customer's audio (Chrome's `tabCapture` only delivers the remote participant's audio). Mic access is best-effort — the extension still functions with tab audio alone if the user declines.

---

## Privacy disclosure (Web Store form fields)

| Field | Answer |
|---|---|
| Single purpose | Live AI sales coaching for Google Meet calls. |
| Personally identifiable information | Yes — user's email (sign-in), call audio, transcripts, in-meeting metadata. |
| Health information | No |
| Financial / payment info | No |
| Authentication info | Yes — Athena access token + refresh token (stored in `chrome.storage.local`). |
| Personal communications | Yes — captured Meet audio and resulting transcripts may include personal/business communications. |
| Location | No |
| Web history | No |
| User activity | Yes — meeting participation timestamps, suggestion-acknowledged events. |
| Website content | No (we only read content from the user's own Meet tab while they are a participant). |

### Data handling certification (must check all three)

- [x] I do not sell or transfer user data to third parties, except for the approved use cases described in this form (third parties: Deepgram for STT, Anthropic for coach inference — both processors under DPA).
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## Category

**Productivity** → **Workflow & Planning Tools**

---

## Language

English

---

## Screenshots needed (1280×800, 1–5 total)

The Web Store form requires at least one screenshot. Recommended: 4.

1. **Hero — coach card live inside a Meet call.** Show an in-progress Meet with the suggestion card visible in the bottom-right and the red "Athena recording" pill in the top-right.
2. **History panel open.** Same Meet tab with the floating Athena button expanded, showing 3–4 prior suggestions with filter chips visible.
3. **Popup — meeting detected, capture running.** The extension popup with green "● Live — listening for prompts" status and the "Stop live capture" button.
4. **Popup — sign-in card.** Empty sign-in form so reviewers see the auth flow.

(640×400 is also accepted; 1280×800 looks much better in the listing carousel — use 1280×800 unless you can't.)

---

## Promo tile (440×280) — optional but recommended

Solid dark background (`#0c1519`), accent-mint "Athena" wordmark, subtitle: "Real-time coach for sales calls."

---

## Marquee promo tile (1400×560) — optional

Same brand treatment, wider canvas. Show a stylized coach card and the Meet UI.

---

## Notes for Chrome Web Store reviewer

- **Test account:** [supply rajsuyash@gmail.com or a dedicated reviewer account on submission].
- **What to test:** Sign in via the popup, open any `meet.google.com/<code>` URL, click "Start live capture." A red recording pill should appear inside the Meet tab; speaking should produce suggestion cards.
- **Backend uptime:** Athena's API and realtime gateway run on Railway. If the reviewer hits a downtime window, please retry — both services have ≥99.5% monthly uptime.
- **Sample data:** The free tier allows 5 meeting hours / 3 seats per workspace. Reviewers can use a workspace pre-populated with sample sales playbook content.
- **Privacy policy:** [hosted URL — see PRIVACY_POLICY.md]
- **No remote code.** The extension does not load any external JavaScript. All code is bundled at build time.
