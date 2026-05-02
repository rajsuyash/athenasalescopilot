# Chrome Web Store listing — Athena Companion

## Short description (≤132 chars)

Real-time sales coach for Google Meet. Pairs with Athena to surface grounded answers and follow-ups during your call.

## Long description

Athena Companion turns Google Meet into a coached sales call. The extension detects when you're on a Meet, pairs with the Athena overlay (or web app), and ships captions back so the AI can suggest grounded answers, the next-best question, and risk flags in real time — all sourced from your own playbook.

### Why use it

- **Real-time grounding** — answers and follow-ups arrive while you're talking, not after.
- **Notifications** — flag pings, comment threads, and recap-ready alerts surface as native Chrome banners.
- **Privacy-first** — captions only ship when you explicitly opt in. No audio leaves your machine through the extension.
- **Free tier** — three seats, five meeting hours per month, no credit card.

### Setup

1. Sign up at https://athena.app and copy your access token from the CLI config (`~/.athena/config.json`).
2. Open the extension popup, paste the token, and tick **Ship Meet captions**.
3. Open any Google Meet URL — the popup will show **DETECTED**.
4. Click **Open in Athena** to attach the macOS overlay, or use the admin web meeting view.

### Permissions explained

- `tabs`, `activeTab`, `scripting` — to detect when a Google Meet tab is active and pull captions from the DOM.
- `storage` — to remember your access token + settings between sessions.
- `notifications` — to surface inbox events (flags, comments) as native banners.
- `alarms` — to poll the inbox in the background without keeping the popup open.
- Host: `https://meet.google.com/*` — required to read Meet captions.

### Open source

The extension and the rest of Athena are open-source. Source: https://github.com/athena-app/athena (placeholder).

## Category

Productivity

## Language

English

## Required screenshots (1280×800 each)

1. Popup with active Meet detected — caption-shipping toggle visible.
2. Popup with inbox surface — 2-3 unread items, "Mark read" actions.
3. Popup settings — token + URL fields filled, "Ship captions" enabled.

## Promo tile (440×280)

Solid ink-900 background, accent-mint "Athena" wordmark, subtitle: "Real-time coach for sales calls."

## Notes for reviewers

- The extension does not record audio. Captions are read from the DOM only when the user toggles the option.
- All AI processing happens server-side at https://athena.app under the user's authenticated workspace.
- Privacy policy: https://athena.app/privacy · Terms: https://athena.app/terms
