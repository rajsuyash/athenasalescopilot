# Chrome Extension Robustness Guide (for Claude Code CLI)

Use this document as a persistent context file for Claude Code CLI when working on your Chrome extension.

## How Claude should use this guide

- Treat this document as **non‑optional constraints** when editing or generating code for the extension.
- Prefer **small, incremental changes** plus clear explanations over large rewrites.
- Before proposing changes, Claude should:
  - Identify which section of this guide applies (e.g., Messaging, Storage, Service worker lifecycle).
  - Explain why a piece of code violates or follows the guideline.
  - Suggest a concrete patch (diff or full file) that brings the code in line with the guideline.

---

## 1. Architecture and file layout

**Goals:** Clear responsibilities, easy testing, minimal coupling.

- Use Manifest V3 with a **service worker** as the background script.
- Prefer a structure similar to:
  - `manifest.json`
  - `src/background/` – service worker, alarms, event listeners, core logic
  - `src/content/` – content scripts (DOM access only)
  - `src/ui/` – popup, options page, in‑page UI
  - `src/lib/` – shared helpers (logging, messaging, storage, API client)
- Claude should:
  - Move shared logic into `src/lib/` instead of duplicating code.
  - Keep DOM‑specific code only in content scripts or UI components.
  - Keep long‑lived state out of globals in the service worker.

### Non‑negotiables

- No inline scripts in HTML files.
- No remote JavaScript execution (no `eval`, no code loaded from external URLs).

---

## 2. Manifest and permissions

**Goals:** Correct, minimal, and future‑proof configuration.

Claude should:

- Ensure `manifest.json` is valid for MV3 and includes:
  - `"manifest_version": 3`
  - A `background.service_worker` entry.
  - Correct `icons`, `action` (or `browser_action` for older code, updated to MV3 where possible), and any `options_page`/`options_ui`.
- Keep permissions minimal:
  - Prefer `"activeTab"` instead of broad host access when possible.
  - Use `host_permissions` for specific domains instead of `"<all_urls>"`, unless there is a clear reason.
- Verify every script, HTML file, and icon referenced in the manifest actually exists and is spelled correctly.

When changing permissions, Claude should:

- Explain why a permission is required.
- Remove unused permissions and host patterns.

---

## 3. Service worker lifecycle (MV3 background)

**Goals:** No reliance on always‑on background pages; robust to restarts.

Claude should:

- Assume the service worker can start and stop at any time.
- Avoid long‑running loops or `setInterval` polling in the service worker.
- Use event‑driven patterns instead:
  - `chrome.alarms` for periodic tasks.
  - `chrome.runtime.onMessage` / `chrome.tabs.onUpdated` / other events for reactive logic.
- Keep state in durable storage (`chrome.storage`, IndexedDB) instead of globals when it must survive restarts.
- Make initialization idempotent:
  - Re‑registering listeners should be safe.
  - Re‑creating alarms or rules should not break anything.

Claude should refactor code that assumes a persistent background page into event‑driven, restart‑safe logic.

---

## 4. Messaging patterns

**Goals:** Typed, robust communication with clear error handling.

Claude should enforce these patterns:

- Messages use structured objects:
  - `{ type: "SOME_ACTION", version: 1, payload: { ... } }`.
- All `sendMessage` / `tabs.sendMessage` calls must handle failure:
  - Check `chrome.runtime.lastError` in callbacks.
  - Or handle rejected promises if using the promise‑based API.
- For async message handlers that respond later:
  - Return `true` from the listener so Chrome keeps the channel open.

Example (callback style):

```js
chrome.runtime.sendMessage({ type: "PING" }, (res) => {
  if (chrome.runtime.lastError) {
    console.warn("Message failed", chrome.runtime.lastError.message);
    // Provide a safe fallback here
    return;
  }
  // Normal success path
});
```

Claude should:

- Add missing error handling around messaging.
- Introduce a small messaging helper module if code is duplicated.
- Ensure messages are versioned so protocols can evolve without breaking older components.

---

## 5. Storage, defaults, and migrations

**Goals:** No crashes due to missing data, predictable upgrades.

Claude should:

- Wrap `chrome.storage` access in helper functions (e.g., `getSettings`, `setSettings`).
- Always merge stored values with a default schema so missing keys do not break code.
- Use a single source of truth for defaults (e.g., `src/lib/defaultSettings.ts` or similar).
- Implement a simple schema version:
  - Store `settingsVersion`.
  - On load, detect old versions and migrate data.
- Handle quota errors and unexpected failures by:
  - Catching errors.
  - Logging (if available) or failing with safe defaults instead of throwing.

Claude should refactor scattered `chrome.storage` calls into a central abstraction.

---

## 6. Content scripts and DOM robustness

**Goals:** Survive site changes and SPAs without breaking.

Claude should:

- Treat DOM queries as optional:
  - Always check for `null`/`undefined` before accessing properties.
  - Exit early if required elements are missing.
- Prefer stable selectors:
  - Data attributes or semantic selectors over brittle `nth-child` chains.
- Support single‑page apps:
  - Use `MutationObserver` or listen for navigation events instead of assuming full page reloads.
- Keep heavy logic out of content scripts when possible:
  - Compute in the service worker or a shared module and send minimal data to the page.

When Claude sees direct DOM assumptions that can easily break, it should propose more defensive selectors and null‑checks.

---

## 7. Network and API calls

**Goals:** Graceful degradation under network issues, no secrets in client.

Claude should:

- Avoid putting secrets (API keys, tokens) in the extension bundle.
- Separate concerns:
  - A small API client module with:
    - Uniform error handling.
    - Optional retry with backoff for transient failures.
    - Clear return types (success / failure objects).
- Handle errors in layers:
  - Network failures.
  - HTTP status (4xx, 5xx).
  - Application‑level errors (error codes in JSON).
- Ensure user‑visible UI surfaces friendly error messages instead of silent failures.

Where an external backend exists, Claude should:

- Keep the extension logic as thin as possible.
- Have the backend handle sensitive operations and complex decisions.

---

## 8. Security and privacy

**Goals:** Pass Chrome review, protect users, avoid future removals.

Claude must enforce:

- No remote executable code (no loading `.js` from CDNs).
- No `eval` / `Function` constructor for running arbitrary strings.
- Least privilege in permissions and host access.
- Validation of incoming messages:
  - Check `sender.id`, `sender.origin` (when available), and message `type`.
- Clear separation of user data handling:
  - If user data is stored or transmitted, ensure there is a clear code path and appropriate UI/consent.

When Claude adds features that touch user data, it should:

- Note the change in comments.
- Suggest updating documentation and the privacy policy outside of code.

---

## 9. Testing and diagnostics

**Goals:** Catch issues before release; make field failures debuggable.

Claude should:

- Add lightweight logging helpers that can be toggled (e.g., based on a debug flag or build mode).
- Encourage writing small unit tests for pure logic modules (storage helpers, messaging helpers, API client).
- Keep the code test‑friendly:
  - Isolate Chrome APIs behind thin wrappers so they can be mocked in tests.
- When adding new flows, propose:
  - At least a manual test checklist.
  - Where reasonable, automated tests (e.g., using Playwright/Puppeteer) that exercise the core flows.

For critical errors (storage failures, API failures, unexpected message types), Claude should ensure they are logged in a way that makes remote debugging feasible.

---

## 10. Release and deployment checklist

Claude should help maintain and update this checklist as the project evolves.

Before each release:

1. **Manifest review**
   - Version is bumped.
   - All paths in `manifest.json` exist.
   - Permissions and host permissions are still minimal and necessary.
2. **Build sanity**
   - Production bundle builds without errors.
   - No inline scripts are introduced by tooling.
3. **Local install of the packed build**
   - The same ZIP that will be uploaded is installed in `chrome://extensions`.
   - Main flows (install, first‑run, common user actions) are tested.
4. **Policy and privacy**
   - No remote code.
   - Any new data collection has matching UI and documentation.
5. **Rollout strategy**
   - If possible, test with a small user group or internal testers before full rollout.

Claude should propose updates to this checklist whenever it introduces new patterns (e.g., new permissions, new external services).

---

## 11. How to ask Claude for help (prompt patterns)

You can include prompts like these when calling Claude Code CLI with this file loaded:

- "Review the messaging between content scripts and the service worker and align it with the Messaging patterns in the robustness guide. Propose a patch."
- "Refactor storage access to use a single helper module, following the Storage section of the robustness guide."
- "Audit manifest.json against the Manifest and permissions section and suggest minimal, safe permissions."
- "Harden the content script DOM queries following the Content scripts section. Add null‑checks and explain each change."
- "Introduce a small logging utility consistent with the Testing and diagnostics section and replace ad‑hoc console.log calls."

Claude should always explain how its changes map back to specific sections of this guide.
