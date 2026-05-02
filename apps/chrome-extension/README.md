# chrome-extension

Manifest V3 companion (TypeScript). PRD F15. Optional — desktop app works without it.

## Build

```bash
pnpm --filter @athena/chrome-extension build
```

Outputs `dist/` with `manifest.json`, `background/index.js`, `content/index.js`,
`popup/index.js`, `popup.html`. Load it in Chrome via
`chrome://extensions` → Developer mode → "Load unpacked" → pick `dist/`.

## What it does

- Watches `meet.google.com/<id>` tabs (URL pattern + title mutation).
- On detection, persists `{ meetingId, title, tabId }` to `chrome.storage.local`,
  badges the toolbar with `M`, and exposes the state to the popup.
- Popup shows the detected meeting + buttons:
  - **Copy meeting ID** — pasteable into the CLI / overlay.
  - **Open in Athena** — deep link `athena://start?meeting_id=…&title=…`
    (handler will land in the macOS overlay phase).
- On tab close or navigation away, clears the state.

PRD F1 AC3 honored: when two Meet tabs are open, the first one wins; the
second is ignored until the first clears.

## Not yet wired

- Caption-DOM observer (PRD F2 fallback signal).
- Native messaging to the desktop app — for v1 we use the chrome.storage +
  custom URL scheme path.

## Responsibilities

- Detect Meet pages, send `{ meeting_url, tab_id, page_state, captions_visible }` to desktop app via native messaging.
- Read Meet caption DOM nodes when consented (parallel signal to F2).
- Deep-link into desktop app to start a session.

## Build

`pnpm build` produces `dist/` for `web-ext` packaging.

## Distribution

Chrome Web Store. Manual publish.
