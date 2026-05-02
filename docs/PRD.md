# Athena — Product Requirements

<!--
This PRD is written for both humans AND AI coding agents (Claude Code).
Every section is explicit, testable, and self-contained.
Conventions:
- TODO: <text>   → requires product decision from a human
- ASSUMPTION: <text> → best guess; confirm before building
- P0 = must ship in v1. P1 = nice to have. P2 = backlog.
- Source: condensed and restructured from the v1.0 source PRD dated April 27, 2026.
-->

**Status:** Draft v1 (scaffold-ready) · **Last updated:** April 27, 2026 · **Codename:** Athena

---

## 1. Summary

**What it is (one sentence):** A multi-tenant SaaS sales copilot — native macOS app plus cloud backend — that listens to live Google Meet calls, detects customer questions and objections, retrieves approved answers from a workspace knowledge base, and surfaces grounded suggestions to the rep in real time.

**Problem:** Reps lose momentum on live calls when prospects ask technical, pricing, security, or procurement questions that aren't top of mind. They guess, over-talk, or promise to follow up — lowering win rate and creating inconsistent messaging across teams. Sales enablement content exists but isn't operationalized in the moment of need.

**Primary user:** SDRs and AEs running live discovery, demo, and objection-handling calls on Google Meet using a Mac.

**Product type:** Native desktop app (macOS) + web admin app + cloud backend + optional Chrome extension companion.

**Stage:** Greenfield. No existing codebase.

---

## 2. Users & context

### Primary persona — "The AE on a live demo"

| Attribute | Value |
|-----------|-------|
| Role | Account Executive or SDR running Google Meet calls from a Mac |
| Context | Mid-call, customer asks a security/pricing/integration question; rep has 1–3 seconds to respond credibly |
| Current workflow | Searches Notion / Google Drive / Slack mid-call, guesses, or defers — often loses the thread |
| What they care about | Saying the right thing fast, sounding credible, not breaking eye contact, hitting quota |
| What they explicitly don't care about | Configuration, content management, analytics dashboards, taxonomy of objections |

### Secondary personas

| Persona | Why they matter |
|---------|-----------------|
| Sales manager | Reviews calls, coaches reps, identifies recurring objection patterns |
| Revenue enablement lead | Owns scripts, FAQs, battlecards, objection libraries; needs versioning + governance |
| RevOps admin | Configures CRM integrations, retention policies, SSO, team structure |
| Enterprise IT/security buyer | Gates the purchase; needs SSO, audit logs, retention controls, region-aware storage |

### Key use cases

1. When a prospect asks a pricing/security/integration question, rep wants a concise grounded answer surfaced in <2s, so they can respond without breaking eye contact.
2. When discovery is shallow, rep wants a next-best-question prompt, so they can qualify deeper without freezing.
3. When the call ends, rep wants an auto-generated summary, follow-up email draft, and CRM field suggestions, so post-call admin takes minutes, not 30+ minutes.
4. When an enablement lead publishes a new script version, all reps' suggestions reflect the update without redeploying anything client-side.
5. When a manager reviews a call, they want to see which suggestions fired, which were used, and what objections came up — to coach the rep.

---

## 3. Scope

### In scope for v1

| # | Feature | Priority | Brief description |
|---|---------|----------|-------------------|
| F1 | Meeting session detection | P0 | Detect active Google Meet sessions on macOS; manual-start fallback |
| F2 | Audio capture + transcript ingestion | P0 | Capture meeting audio (and optionally Meet captions) on Mac with permissions |
| F3 | Streaming speech-to-text | P0 | Provider-abstracted streaming STT with partials, finals, speaker labels |
| F4 | Turn segmentation + intent detection | P0 | Segment turns, classify into objection/pricing/security/etc. categories |
| F5 | Retrieval + grounded answer generation | P0 | RAG over workspace knowledge base, returns answer + source IDs + confidence |
| F6 | Rep overlay UI (window modes + actions) | P0 | Compact near-camera overlay; pin/dismiss/copy/feedback; keyboard shortcuts |
| F7 | Knowledge ingestion + script management | P0 | Upload PDF/DOCX/MD/text/CSV/URLs; chunk + embed + version + publish |
| F8 | Workspace administration + RBAC | P0 | Workspaces, teams, roles (owner/admin/manager/rep/analyst/compliance) |
| F9 | Post-call outputs | P0 | Summary, objections, unanswered questions, follow-up email draft, CRM field suggestions |
| F10 | Multi-tenant isolation | P0 | Tenant-scoped data at app, DB, cache, object store, vector index layers |
| F11 | Audit logs | P0 | Admin actions, content changes, exports, AI suggestion visibility |
| F12 | Analytics dashboards | P1 | Adoption, objection trends, suggestion useful-rate, latency, knowledge gaps |
| F13 | Coaching workflows | P1 | Manager call review, suggestion feedback, low-confidence flagging |
| F14 | CRM integrations | P1 | Salesforce + HubSpot field-suggestion sync |
| F15 | Optional Chrome extension companion | P1 | Detect Meet tabs, pass meeting URL/state to desktop app via native messaging |
| F16 | Billing | P1 | Stripe + invoicing; seat / MAR / meeting-hour metering hooks |

### Explicitly NOT in scope for v1 (non-goals)

- Native Zoom or Microsoft Teams support
- Autonomous meeting-bot that joins meetings as a participant on any platform
- Mobile or iPad client (iOS/Android)
- Windows or Linux desktop client
- On-premises deployment
- Custom proprietary model fine-tuning pipeline
- Full LMS / sales enablement authoring suite (rich editor, learning paths, certifications)
- Agentic outbound prospecting (cold-call dialing, automated outbound sequences)
- SSO/SAML — defer to Phase 3 enterprise milestone (basic email + OAuth in v1)
- Region-aware multi-region storage — single-region (US) at v1
- Real-time translation across languages mid-call
- Public API / partner integrations beyond CRM

### Future considerations (do NOT build in v1)

- Zoom + Teams support (Phase 4)
- API platform + partner integrations
- Advanced coaching analytics with win-rate correlation
- Tenant-specific model adaptation
- iOS/Android companion

---

## 4. Feature specifications

### F1 · Meeting session detection — P0

**User story:** As a rep, I want Athena to automatically detect when I'm on a Google Meet call, so I don't have to manually start it every time.

**Description:** The macOS app monitors for active Google Meet sessions in Chrome (and optionally other Chromium browsers). When detected, it surfaces a "Start Athena" banner. If detection fails, the rep can manually start a session by selecting "Start for current meeting" from the menu bar.

**Happy path:**

1. Rep is signed in to the desktop app.
2. Rep opens or joins `https://meet.google.com/<meeting-id>` in Chrome.
3. Desktop app detects the active Meet session (via Chrome extension companion native message, or via running-process / window-title polling fallback).
4. Desktop app shows session banner: meeting title (when available), meeting ID, "Start Athena" button.
5. Rep clicks Start. App enters Active session state.

**Data in (detection event):**

```json
{
  "platform": "google_meet",
  "external_meeting_id": "abc-defg-hij",
  "meeting_title": "Acme Corp <> Athena - Discovery",
  "browser_tab_id": "tab_4821",
  "detected_at": "2026-04-27T14:02:11Z",
  "detection_source": "chrome_extension"
}
```

**Data out (session created in backend):**

```json
{
  "meeting_id": "mtg_01HXYZ...",
  "workspace_id": "ws_01HABC...",
  "host_user_id": "usr_01HDEF...",
  "external_platform": "google_meet",
  "external_meeting_id": "abc-defg-hij",
  "status": "ready",
  "consent_mode": "rep_only",
  "retention_policy_id": "ret_default_30d",
  "created_at": "2026-04-27T14:02:11Z"
}
```

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Rep is signed in and Chrome is open with a Meet tab | The Meet URL becomes active | A session banner appears within 3 seconds with the meeting title (or "Untitled meeting" if not extractable) |
| AC2 | Auto-detection fails (e.g. no extension installed, Meet in non-Chrome browser) | Rep clicks menu-bar item "Start for current meeting" | App opens a manual entry form to confirm/edit meeting metadata, then creates the session |
| AC3 | Two Meet tabs are open simultaneously | Detection fires | App prompts the rep to choose which meeting to attach Athena to; never auto-attaches to two |
| AC4 | Rep is not signed in | Meet session is detected | Banner says "Sign in to use Athena"; no session is created in backend |

**Error cases:**

| Case | Expected behavior |
|------|------------------|
| Chrome extension not installed | Fall back to process/window-title detection; if that also fails, rely on manual start. No error shown to rep unless they invoke a feature requiring detection. |
| Detection misfires on non-Meet URL | Validate URL pattern `https://meet.google.com/[a-z]{3}-[a-z]{4}-[a-z]{3}` before showing banner. Reject silently otherwise. |
| Backend unreachable during session creation | Queue session creation locally; show "Connecting…" indicator; retry with exponential backoff for up to 60s; if still failing, surface "Cannot connect to Athena cloud — try again". |
| Rep declines all OS permissions | Show explainer linking to permission setup; do not crash; allow app to remain idle. |

**Dependencies:** F8 (auth/workspace), F15 (Chrome extension — optional path).

**Out of scope for this feature:** Detection of Zoom/Teams/Webex; detection in non-Chromium browsers (Safari, Firefox).

---

### F2 · Audio capture + transcript ingestion — P0

**User story:** As a rep, I want Athena to capture both my voice and the meeting audio reliably, so the copilot has the full conversation to work with.

**Description:** Captures system audio (meeting output) and microphone input on macOS using `ScreenCaptureKit` / `AVAudioEngine`. Optionally ingests Google Meet's visible captions when enabled. Buffers locally for resilience and streams to backend.

**Happy path:**

1. Rep clicks Start on the session banner.
2. App requests Screen Recording permission and Microphone permission (first run only).
3. App begins capturing system audio + mic, mixed into a single stream with channel labels (`system`, `mic`).
4. App opens a secure WebSocket / gRPC stream to the realtime gateway.
5. Audio is chunked (recommended 100ms frames) and streamed.
6. If Meet captions are visible, app reads caption DOM via Chrome extension companion (when present and user-consented) and streams them as a parallel signal.
7. Local rolling buffer holds the last 60s of raw audio for recovery.

**Data in (per audio chunk):**

```json
{
  "meeting_id": "mtg_01HXYZ...",
  "channel": "system",
  "sequence": 4821,
  "timestamp_ms": 482100,
  "payload_bytes": "<base64 PCM 16kHz mono>",
  "format": "pcm_s16le_16khz_mono"
}
```

**Data out (acknowledged event):**

```json
{
  "meeting_id": "mtg_01HXYZ...",
  "ack_sequence": 4821,
  "received_at_server_ms": 482250
}
```

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Permissions granted, network healthy | Rep starts session | Audio frames flow to backend with per-frame ack within 200ms (P95) on a 50 Mbps connection |
| AC2 | Network drops for <30s | Capture continues locally | Frames buffer in a bounded ring buffer (max 60s); on reconnect, buffered frames are sent in order with original timestamps |
| AC3 | Network drops for >60s | Local buffer overflows | App marks the session as "degraded", drops oldest frames, surfaces a yellow indicator to rep, continues capturing fresh frames |
| AC4 | Rep clicks "Pause listening" | Capture stops | No frames sent until rep clicks Resume; backend marks session paused; buffered frames are discarded |

**Error cases:**

| Case | Expected behavior |
|------|------------------|
| Screen Recording permission denied | Show modal explaining requirement; deep-link to System Settings → Privacy → Screen Recording; do not start session |
| Microphone permission denied | Allow system-audio-only mode if rep consents; otherwise block start |
| Audio device changes mid-session (e.g. AirPods disconnect) | Detect device change event; pause briefly, switch to default device, resume; log event |
| Backend WebSocket closes unexpectedly | Reconnect with exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s); replay un-acked frames from buffer |
| Disk full / cannot allocate ring buffer | Continue streaming live frames only; surface non-blocking warning to rep |

**Dependencies:** F1, F3 (downstream consumer).

**Out of scope:** Server-side audio storage by default. ASSUMPTION: raw audio is dropped after STT processes it unless the workspace has explicitly enabled `audio_retention=true` policy.

---

### F3 · Streaming speech-to-text — P0

**User story:** As the orchestrator service, I need partial and final transcripts with speaker labels and timestamps, so downstream stages can reason about who said what.

**Description:** Realtime gateway forwards audio frames to a configured STT provider via the provider-abstraction layer. Returns partial transcripts (low confidence, can mutate) and final transcripts (confirmed). Persists final transcripts to `transcript_segments`.

**Data in:** audio chunks from F2.

**Data out (transcript event — partial or final):**

```json
{
  "type": "transcript.final.received",
  "meeting_id": "mtg_01HXYZ...",
  "segment_id": "seg_01HMNO...",
  "speaker_type": "customer",
  "speaker_label": "Speaker 2",
  "text": "What's your data retention policy?",
  "start_ms": 482000,
  "end_ms": 484300,
  "confidence": 0.94,
  "is_final": true,
  "language": "en-US",
  "source_type": "stt_audio"
}
```

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Audio frames are streaming | A speaker finishes a phrase | A partial transcript is emitted within 800ms (P95) of speech receipt |
| AC2 | A turn boundary is detected | STT marks segment final | A `transcript.final.received` event is emitted within 300ms of finalization with `is_final=true` |
| AC3 | Workspace has custom vocabulary `["Athena", "MEDDIC", "RevOps"]` | Audio contains these terms | STT request includes vocabulary boost; transcripts preserve these spellings exactly |
| AC4 | Two speakers overlap | Diarization runs | Each segment is tagged with a stable `speaker_label` consistent across the meeting |

**Error cases:**

| Case | Expected behavior |
|------|------------------|
| STT provider returns 5xx | Retry with backoff up to 3x, then mark stage degraded; suppress live suggestions; continue capturing audio |
| STT provider rate-limits the workspace | Switch to fallback provider per workspace policy; if no fallback, degrade to caption-only mode if Meet captions are available; otherwise pause suggestions and surface a banner |
| Audio is silent for >30s | Skip STT calls entirely (silence detection); resume on first non-silent frame |
| Confidence < `workspace.min_stt_confidence` (default 0.6) | Mark segment as low-confidence; do not trigger downstream intent detection unless segment is part of a multi-segment turn that pushes total confidence above threshold |

**Dependencies:** F2; provider-abstraction module (`packages/sdk/stt`).

**Out of scope:** Server-side fine-tuning of STT models; on-device STT (deferred to F-future).

---

### F4 · Turn segmentation + intent detection — P0

**User story:** As the orchestrator, I need to know when a customer has just asked a question and what kind of question it is, so I can decide whether to trigger retrieval and answer generation.

**Description:** Two-stage logic. First, segment the rolling transcript into "turns" using silence (≥500ms), punctuation, and STT finalization signals. Second, run a fast classifier on each finalized customer turn to assign category labels and an urgency score.

**Categories:** `pricing`, `implementation`, `security`, `integration`, `procurement`, `competitor`, `timeline`, `authority`, `budget`, `next_steps`, `product_fit`, `objection`, `technical_validation`, `feature_request`, `none`.

**Sales-stage signals (separate label):** `opener`, `qualification`, `discovery`, `demo`, `objection_handling`, `closing`.

**Data in:** `transcript.final.received` events from F3.

**Data out (intent event):**

```json
{
  "type": "intent.detected",
  "meeting_id": "mtg_01HXYZ...",
  "turn_id": "turn_01HPQR...",
  "speaker_type": "customer",
  "categories": ["security", "objection"],
  "stage_signal": "objection_handling",
  "urgency_score": 0.82,
  "interruption_priority": 0.74,
  "confidence": 0.91,
  "model_version": "router-v3",
  "detected_at": "2026-04-27T14:08:14Z"
}
```

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | A customer finishes asking a question (≥500ms silence + sentence-final punctuation) | Turn is finalized | An `intent.detected` event is emitted within 400ms of turn finalization |
| AC2 | A turn is rep-spoken filler (e.g. "yeah, totally") | Classifier runs | Returns `categories: ["none"]`; no downstream retrieval triggered |
| AC3 | A turn matches multiple categories | Classifier runs | Returns up to 3 categories sorted by likelihood, each with confidence |
| AC4 | Rolling 5-minute hot context is full | New turn arrives | Oldest turn evicts; classifier still has access to last 2 minutes of context for stage_signal disambiguation |

**Error cases:**

| Case | Expected behavior |
|------|------------------|
| Classifier model returns malformed JSON | Discard event; log; treat turn as `categories: ["none"]` |
| Classifier latency > 1s | Return whatever finished within deadline; mark `degraded: true`; do not block downstream |
| Turn has no clear speaker (diarization failed) | Default `speaker_type: "unknown"`; do not run intent detection on unknown turns |

**Dependencies:** F3; classifier model (Stage A in AI architecture).

**Out of scope:** Sentiment scoring; emotion detection.

---

### F5 · Retrieval + grounded answer generation — P0

**User story:** As a rep, when a prospect asks a tough question, I want a concise answer pulled from my company's approved content, with a source I can trust, so I can respond with confidence.

**Description:** When `intent.detected` fires with `urgency_score ≥ workspace.urgency_threshold` (default 0.5), the orchestrator runs hybrid retrieval (semantic + keyword) over the workspace's `knowledge_chunks` (filtered by published script versions, persona, language). Top-k chunks are passed to a grounded answer generator (Stage C) which produces:

- **Answer mode** — direct response to the prospect
- **Ask-next mode** — recommended follow-up question (when discovery is shallow)
- **Coach mode** — tactical hint
- **Risk mode** — warning about a missed discovery point or risky claim

Every output includes source chunk IDs, confidence, and a policy version.

**Data in:**

```json
{
  "meeting_id": "mtg_01HXYZ...",
  "turn_id": "turn_01HPQR...",
  "categories": ["security"],
  "customer_text": "What's your data retention policy?",
  "context_window": [
    { "speaker": "customer", "text": "We're SOC 2..." },
    { "speaker": "rep", "text": "Got it..." }
  ],
  "workspace_id": "ws_01HABC...",
  "active_script_version_id": "ver_01HKLM..."
}
```

**Data out (suggestion):**

```json
{
  "type": "suggestion.generated",
  "id": "sug_01HSTU...",
  "meeting_id": "mtg_01HXYZ...",
  "turn_id": "turn_01HPQR...",
  "suggestion_type": "answer",
  "answer_text": "We retain transcripts for 30 days by default; admins can configure 7/30/90/365-day retention or disable transcript storage entirely.",
  "followup_text": null,
  "confidence_score": 0.88,
  "priority_score": 0.79,
  "source_chunk_ids": ["chk_01HVW...", "chk_01HVX..."],
  "policy_version": "policy-v12",
  "rationale": "matched approved security FAQ entry 'data-retention-policy'",
  "generated_at": "2026-04-27T14:08:15.420Z"
}
```

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Customer asks a security-category question and matching approved content exists | `intent.detected` fires with urgency ≥ threshold | A `suggestion.generated` event is published within 2s (P95) of turn end under normal network |
| AC2 | No matching content exists in the workspace knowledge base | Retrieval returns no chunks above relevance threshold | Generator emits `suggestion_type: "ask_next"` with a clarifying question instead of fabricating an answer |
| AC3 | An approved canonical answer template exists for this category | Retrieval runs | Generator prefers the canonical template wording over generative paraphrase; confidence is boosted |
| AC4 | Workspace policy says "pricing answers must use exact approved phrasing" | Customer asks pricing question | Generator returns the verbatim approved snippet; if no exact snippet exists, returns `suggestion_type: "coach"` saying "defer to follow-up" |
| AC5 | Two redundant suggestions are generated within 10s for the same turn | Ranker runs | Only the higher-confidence one is displayed; the other is suppressed with reason `redundant` |

**Error cases:**

| Case | Expected behavior |
|------|------------------|
| Vector search returns no results | Fall back to keyword-only search; if still empty, emit `ask_next` suggestion |
| LLM returns a chunk ID not present in the retrieval result set | Reject the suggestion (hallucinated source); log as `policy_violation: invalid_source`; generate fallback `coach` suggestion |
| LLM response fails JSON schema validation | Retry once with stricter prompt; if still fails, drop suggestion and log |
| Generator latency > 3s | Cancel; do not display stale suggestion; log SLA breach |
| Confidence < `workspace.min_display_confidence` (default 0.5) | Suppress display; still persist for analytics |

**Dependencies:** F4, F7 (knowledge base must be populated), F10 (tenant-scoped retrieval is mandatory — never query across workspaces).

**Out of scope:** Rep-typed custom questions (handled separately in F6 as a manual ask flow); cross-meeting context (memory across calls).

---

### F6 · Rep overlay UI — P0

**User story:** As a rep, I want a small, glanceable overlay near my camera that shows the next thing to say without forcing me to look away from the customer.

**Description:** Always-on-top overlay window with five modes, configurable per workspace and per rep. Default placement is top-center of the active display, near the camera notch on Apple Silicon Macs.

**Window modes:**

| Mode | Content |
|------|---------|
| Micro | One line of answer text (≤80 chars), tiny source dot |
| Compact card | Answer text + source tag + confidence indicator |
| Coach | Answer + follow-up question + reasoning chip |
| Checklist | Visible qualification framework progress (MEDDIC / BANT / SPICED) |
| Silent | Only urgent (priority ≥ 0.8) alerts surface |

**Rep actions (all keyboard-shortcutable):**

| Action | Default shortcut |
|--------|------------------|
| Start session | ⌘⇧A |
| Pause/resume listening | ⌘⇧P |
| End session | ⌘⇧E |
| Expand/collapse overlay | ⌘⇧Space |
| Copy current answer | ⌘⇧C |
| Pin current answer | ⌘⇧⌥P |
| Dismiss | Esc |
| Mark useful | ⌘↑ |
| Mark not useful | ⌘↓ |
| Ask custom question | ⌘⇧Q |

**Data in:** `suggestion.generated` events from F5.

**Data out (feedback event):**

```json
{
  "type": "suggestion.feedback.recorded",
  "suggestion_id": "sug_01HSTU...",
  "meeting_id": "mtg_01HXYZ...",
  "rep_user_id": "usr_01HDEF...",
  "feedback": "useful",
  "displayed_at": "2026-04-27T14:08:15.500Z",
  "acknowledged_at": "2026-04-27T14:08:16.100Z",
  "action": "copy"
}
```

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | A suggestion is generated with confidence ≥ display threshold | Event reaches the desktop app | The overlay updates within 200ms; previous suggestion is replaced (unless pinned) |
| AC2 | Rep presses ⌘⇧P | Capture is active | Capture pauses immediately; overlay shows "Paused" badge; no further suggestions appear until resumed |
| AC3 | Rep is in Silent mode | A normal-priority suggestion arrives | Suggestion is logged but NOT displayed; only suggestions with `priority_score ≥ 0.8` show |
| AC4 | Rep marks a suggestion "useful" | Feedback event fires | `suggestion_feedback` row is created within 1s; the suggestion is added to the rep's session "pinned-history" view |
| AC5 | Overlay opacity is set to 60% in preferences | Overlay renders | Window background uses `NSWindow` alpha 0.6; text remains legible (per WCAG AA contrast on tested backgrounds) |
| AC6 | Rep ends session via ⌘⇧E | Backend acknowledges end | Overlay closes within 500ms; "Generating summary…" toast appears in menu bar |

**Error cases:**

| Case | Expected behavior |
|------|------------------|
| Suggestion arrives after rep ended session | Discard silently; do not display |
| Overlay would render off-screen (e.g. external monitor disconnected) | Snap to default position on primary display |
| Pinned suggestion: new suggestion arrives | New suggestion goes to "stack" (max 3 unpinned in stack); pinned remains visible |
| Rep types into custom-question box | Send as synthetic `intent.detected` with `categories: ["rep_query"]`; trigger F5 retrieval |

**Dependencies:** F5.

**Out of scope:** Multiple simultaneous overlays; per-monitor overlay duplication; touch-bar UI.

---

### F7 · Knowledge ingestion + script management — P0

**User story:** As an enablement lead, I want to upload our scripts, FAQs, and battlecards, organize them by stage and persona, and publish versioned updates that all reps see immediately.

**Description:** Admins upload supported file types via the admin web app. Documents are auto-chunked, embedded, indexed in `pgvector`, and tagged. Scripts are organized in `script_collections` with explicit versioning — only one published version is "live" per workspace at a time.

**Supported uploads:** PDF, DOCX, Markdown, plain text, CSV, web URLs (scraped at ingestion time).

**Document categories:** `script`, `faq`, `battlecard`, `pricing`, `implementation`, `security`, `case_study`, `product_notes`.

**Happy path (upload):**

1. Admin navigates to Knowledge → Upload.
2. Admin selects file(s), assigns category, persona/region/language tags.
3. Worker job: extract text → clean → chunk (target ~500 tokens, 50-token overlap) → embed → write `knowledge_documents`, `knowledge_document_versions`, `knowledge_chunks`.
4. Admin sees job status: `processing` → `indexed` → `published` (manual publish step).

**Happy path (script publish):**

1. Admin opens a `script_collection`, edits stage blocks.
2. Saves as draft → creates new `script_version` (status: `draft`).
3. Clicks "Publish" → previous published version is archived; new version becomes live.
4. Within 30s, all active and new sessions in the workspace use the new version.

**Data in (upload):**

```json
{
  "workspace_id": "ws_01HABC...",
  "file_name": "security-faq-q2-2026.pdf",
  "category": "security",
  "tags": { "persona": ["enterprise_it"], "language": "en-US", "region": ["us", "eu"] },
  "approved_by_user_id": "usr_01HDEF..."
}
```

**Data out (chunk record):**

```json
{
  "id": "chk_01HVW...",
  "workspace_id": "ws_01HABC...",
  "document_version_id": "dvr_01HZZ...",
  "chunk_text": "Athena retains transcripts for 30 days by default. Admins can configure...",
  "embedding": "<vector(1536)>",
  "chunk_order": 12,
  "tags_json": { "persona": ["enterprise_it"], "category": "security" },
  "visibility_scope": "workspace",
  "language": "en-US",
  "active": true
}
```

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Admin uploads a 50-page PDF | Upload completes | Document is chunked, embedded, and queryable within 60s (P95) |
| AC2 | Admin publishes a new script version | Publish succeeds | All sessions started after the publish event use the new version; in-flight sessions complete on the prior version |
| AC3 | Admin uploads a duplicate file (same content hash) | Ingestion runs | System detects duplicate, surfaces a warning, does not create a second document |
| AC4 | A document has visibility set to `team:sdr_emea` | A rep on `team:ae_us` runs a session | Chunks from that document are excluded from retrieval for that rep |
| AC5 | Admin marks a content label as `restricted_claim` | Generator produces an answer using that chunk | Output is suppressed; generator falls back to coach mode; event logged in audit |

**Error cases:**

| Case | Expected behavior |
|------|------------------|
| File exceeds size limit (default 50MB) | Reject upload with HTTP 413; surface clear error to admin |
| Unsupported file format | Reject with HTTP 415; list supported formats |
| Embedding provider fails | Job marked `failed`; retryable from UI; no partial chunks persisted |
| URL scrape returns 404 / 403 | Job fails with descriptive error; no document created |
| Two admins try to publish different versions simultaneously | Optimistic lock on `script_collection.current_version_id`; second publish fails with `VERSION_CONFLICT` |

**Dependencies:** F8, F10.

**Out of scope:** Rich WYSIWYG content editor, learning paths, certifications. ASSUMPTION: scripts are edited as structured blocks (stage + text + tags), not free-form rich text.

---

### F8 · Workspace administration + RBAC — P0

**User story:** As a workspace owner, I want to invite my team, assign roles, and trust that reps can't access analytics meant for managers.

**Description:** Each customer company is a workspace tenant. Workspaces have users (via `user_workspace_memberships`), teams, and roles. RBAC is enforced at the API layer on every request.

**Roles and permissions:**

| Role | Can do |
|------|--------|
| `owner` | All admin actions + billing + delete workspace |
| `admin` | Manage users, teams, knowledge, scripts, integrations, retention policies |
| `manager` | Review meetings of their team's reps; access team analytics; cannot edit workspace settings |
| `rep` | Run sessions, view own meetings, give feedback |
| `analyst` | Read-only access to all analytics; no PII exposure unless granted |
| `compliance_viewer` | Read-only access to audit logs and retention settings |

**Auth model (v1):** Email + password OR Google OAuth. SSO/SAML deferred to Phase 3. JWT access tokens (15min TTL) + refresh tokens (30d).

**Data in (invite):**

```json
{
  "workspace_id": "ws_01HABC...",
  "email": "[email protected]",
  "role": "rep",
  "team_id": "tm_01HJKL...",
  "invited_by_user_id": "usr_01HOWN..."
}
```

**Data out (membership record):**

```json
{
  "id": "mbr_01HMNO...",
  "workspace_id": "ws_01HABC...",
  "user_id": "usr_01HNEW...",
  "role": "rep",
  "team_id": "tm_01HJKL...",
  "status": "invited",
  "created_at": "2026-04-27T14:30:00Z"
}
```

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Owner invites a user via email | Invite is sent | User receives email with magic link valid for 7 days; on click, account is created and added to workspace as `invited` → `active` after first login |
| AC2 | A `rep` user calls `GET /workspaces/:id/analytics` | RBAC middleware runs | Returns HTTP 403 with `{ error: "INSUFFICIENT_ROLE", required: "manager" }` |
| AC3 | A user belongs to two workspaces | They sign in | They see a workspace switcher; every API call includes resolved `workspace_id`; tokens are workspace-scoped |
| AC4 | An admin removes a user from the workspace | Removal commits | User loses access within 60s (token revocation); their historical meetings stay attributed to the workspace |

**Error cases:**

| Case | Expected behavior |
|------|------------------|
| Invite to existing user already in workspace | Return HTTP 409 `{ error: "ALREADY_MEMBER" }` |
| Invite with invalid email format | Return HTTP 400 `{ error: "INVALID_EMAIL" }` |
| Token expired | Return HTTP 401; client uses refresh token; if refresh also expired, redirect to sign-in |
| Owner attempts to demote themselves to non-owner with no other owner | Return HTTP 422 `{ error: "MUST_HAVE_AT_LEAST_ONE_OWNER" }` |

**Dependencies:** None (foundational).

**Out of scope for v1:** SAML/SCIM, custom roles, granular per-resource permissions.

---

### F9 · Post-call outputs — P0

**User story:** As a rep, I want a summary, follow-up email draft, and CRM field suggestions auto-generated when the call ends, so I save 20+ minutes of admin per call.

**Description:** When a session ends, an async job (`postcall-service`) runs Stage D (post-call summarizer) over the full meeting transcript + suggestions log. Produces structured outputs.

**Outputs:**

- Summary (3–5 paragraphs)
- Key questions asked (list)
- Objections raised (list with category)
- Answers given (paired with questions)
- Unanswered questions (flagged for follow-up)
- Next-step commitments (with owner + due date inferred where possible)
- Follow-up email draft (subject + body, in rep's voice based on workspace style guide)
- CRM field suggestions: `stage`, `next_step`, `objections[]`, `use_case`, `close_date_confidence`
- Rep adherence score against the configured sales framework (MEDDIC / BANT / SPICED)

**Data in:** all `transcript_segments`, `suggestions`, `intent_events` for the meeting.

**Data out:**

```json
{
  "meeting_id": "mtg_01HXYZ...",
  "summary": "Discovery call with Acme Corp...",
  "objections": [
    { "category": "security", "text": "concerned about data retention", "resolution": "answered with retention policy doc" }
  ],
  "next_steps": [
    { "owner": "rep", "action": "send pricing proposal", "due": "2026-05-01" }
  ],
  "followup_email": {
    "subject": "Recap: Acme <> Athena discovery",
    "body": "Hi Jane, thanks for your time today..."
  },
  "crm_suggestions": {
    "stage": "discovery",
    "next_step": "send pricing proposal",
    "objections": ["data_retention"],
    "use_case": "real-time call coaching",
    "close_date_confidence": 0.6
  },
  "adherence_score": { "framework": "MEDDIC", "score": 0.72, "missing": ["economic_buyer"] }
}
```

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | A meeting ends successfully | Post-call job runs | Outputs are available in the rep's "My meetings" view within 90s (P95) |
| AC2 | A meeting ended abruptly (rep crashed) | Backend detects no end-event | After 5min of inactivity on the session, backend auto-finalizes and runs post-call on whatever transcript exists |
| AC3 | Workspace has CRM integration enabled | Post-call completes | CRM suggestions are written to the integrated system as a draft, not auto-applied (rep must approve) |
| AC4 | Workspace has `transcript_retention=0` policy | Post-call completes | Outputs are generated, then transcript is deleted; outputs persist per `output_retention` policy |

**Error cases:**

| Case | Expected behavior |
|------|------------------|
| LLM job fails | Retry up to 3x with backoff; if all fail, surface error in UI with manual retry button |
| Transcript is <60s of content | Run a "thin summary" template instead of full structure; mark `low_signal: true` |
| CRM integration fails to write | Don't block post-call output; queue for retry; surface integration health alert to admin |

**Dependencies:** F2, F3, F5, F14.

**Out of scope:** Auto-sending follow-up emails (always draft-only in v1).

---

### F10 · Multi-tenant isolation — P0

**User story:** As an enterprise security buyer, I need a guarantee that another customer can never see my data, so I can sign the procurement contract.

**Description:** Tenant isolation is enforced at every layer. Every domain table has a `workspace_id` column and every query MUST include it. Vector index is partitioned by `workspace_id`. Object storage uses per-tenant prefixes. Caches use tenant-prefixed keys. The realtime gateway authorizes session creation against `workspace_id` from the JWT.

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | A user with workspace A's token | Calls `GET /meetings/:id` where the meeting belongs to workspace B | Returns HTTP 404 (not 403, to avoid existence leak) |
| AC2 | A retrieval query in workspace A | Runs against `pgvector` | Filter `workspace_id = 'ws_A'` is enforced server-side; chunks from workspace B are not returned even with a malicious payload |
| AC3 | Object storage path | Is generated for any tenant artifact | Path is prefixed with `s3://athena-prod/<workspace_id>/...`; cross-tenant reads are denied by IAM policy |
| AC4 | Redis cache key | Is written for session state | Key is prefixed `ws:<workspace_id>:session:<id>`; LRU eviction respects this scoping |
| AC5 | Tenant-isolation integration test suite | Runs in CI | All endpoints return 404/403 when called with the wrong workspace's token; suite must pass before deploy |

**Error cases:**

| Case | Expected behavior |
|------|------------------|
| Code path missing `workspace_id` filter | Lint rule catches it pre-commit; CI rejects the PR |
| JWT has no `workspace_id` claim | Reject with HTTP 401 `{ error: "MISSING_WORKSPACE_CLAIM" }` |
| Workspace is deleted | All tenant data is soft-deleted within 24h; hard-deleted within 30d per retention default |

**Dependencies:** F8.

**Out of scope:** Per-tenant dedicated infrastructure (single-tenant deployment is a future enterprise tier).

---

### F11 · Audit logs — P0

**User story:** As a compliance viewer, I need an immutable log of admin actions, content changes, exports, and AI suggestion visibility, so I can pass SOC 2 audits.

**Description:** Every event in the `audit_logs` table is append-only and includes `actor_user_id`, `workspace_id`, `action`, `resource_type`, `resource_id`, `metadata_json`, `ip_address`, `user_agent`, `created_at`.

**Logged actions (non-exhaustive):** user invited, role changed, knowledge document uploaded/deleted/published, script version published, retention policy changed, integration connected/disconnected, workspace settings changed, data export requested, suggestion displayed (per meeting, aggregate, not per event in v1 to control volume).

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Admin uploads a knowledge document | Upload commits | An `audit_logs` row is written within 1s with the actor, action, and document ID |
| AC2 | Compliance viewer queries audit log via UI | Query runs | Returns paginated results, filterable by actor, action, date range; never returns logs from another workspace |
| AC3 | Admin attempts to delete an audit log entry | DELETE is called | Returns HTTP 405; logs are append-only |

**Error cases:**

| Case | Expected behavior |
|------|------------------|
| Audit write fails (DB issue) | Action proceeds; audit failure is alerted to ops; backfill from event stream within 1h |

**Dependencies:** F8.

**Out of scope:** SIEM integration / real-time export to external log systems (Phase 3).

---

### F12 · Analytics dashboards — P1

**User story:** As a sales manager, I want to see which objections come up most, which reps' suggestions land best, and where our knowledge base has gaps.

**Dashboards:**

- **Adoption** — meetings/week, % reps using Athena, suggestions shown vs. used
- **Objection trends** — top 10 objection categories by count, by segment, by rep
- **Knowledge coverage** — % questions matched to high-confidence answers, gap list (questions with no good chunk)
- **Suggestion quality** — useful-rate by category, by source document, by model version
- **System health** — STT latency P50/P95/P99, suggestion latency, session drop rate

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Manager opens analytics dashboard | Page loads | First meaningful render under 2s for standard views |
| AC2 | A new meeting completes | Aggregations update | Dashboards reflect the new meeting within 10 minutes |
| AC3 | A rep is filtered out of "managed by me" | Manager queries by team | They see only their team's reps |

**Out of scope for v1:** Win-rate correlation analytics (requires CRM-deal-stage join), custom dashboards, export to BI tools.

**Dependencies:** F8, F9, F14.

---

### F13 · Coaching workflows — P1

**Manager flows:** review past meetings, listen to specific moments (timeline scrubber tied to transcript and suggestions), leave feedback on suggestions, flag low-confidence answers for enablement review, recommend knowledge updates based on recurring gaps.

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Manager opens a past meeting | Page loads | Transcript + suggestions timeline + audio (if retained) load together within 3s |
| AC2 | Manager flags a suggestion as "risky" | Flag commits | Suggestion is added to the enablement review queue; original suggestion is preserved |
| AC3 | Manager replies to a rep's suggestion feedback | Reply is sent | Rep sees the comment in their inbox; threaded conversation persists |

**Out of scope:** Auto-coaching (AI-generated coaching plans), call-scoring rubrics beyond adherence, video playback (audio only in v1).

**Dependencies:** F9.

---

### F14 · CRM integrations — P1

**Targets for v1:** Salesforce, HubSpot.

**Capabilities:**

- OAuth-based connection per workspace
- Map workspace contacts/accounts to CRM records (auto-match by email domain)
- Push post-call CRM-field suggestions as draft updates (rep approves before commit)
- Pull deal context (stage, amount, close date) for in-call use

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Admin connects Salesforce via OAuth | Auth completes | `integration_service` stores encrypted refresh token; connection status is `active` |
| AC2 | Post-call output includes CRM suggestions | Rep clicks "Send to Salesforce" | Fields are written to the linked Opportunity; success surfaced in UI |
| AC3 | CRM API rate-limits | Retry runs | Exponential backoff up to 1h; if still failing, surface degraded status to admin |

**Out of scope:** Bidirectional sync, custom field mapping UI (use sensible defaults in v1), other CRMs (Pipedrive, Zoho — Phase 4).

**Dependencies:** F9.

---

### F15 · Optional Chrome extension companion — P1

**Purpose:** Strengthens detection in F1 and provides optional caption-DOM ingestion for F2.

**Manifest V3, TypeScript + React.**

**Capabilities:**

- Detect Meet pages, send `{ meeting_url, tab_id, page_state, captions_visible }` to desktop app via native messaging
- Read Meet caption DOM nodes when `captions_visible` and user has consented
- Pass session metadata on tab activation
- Deep-link into the desktop app to start a session

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Extension is installed and desktop app is running | Rep navigates to a Meet URL | Native message is sent within 1s; desktop app shows session banner |
| AC2 | Extension is installed but desktop app is not running | Rep navigates to a Meet URL | Extension surfaces "Open Athena" prompt; clicking it launches the app |
| AC3 | User has not consented to caption reading | Captions are visible | Extension does NOT read caption DOM; only sends meeting metadata |

**Out of scope:** Firefox/Edge extensions; extension-only mode without desktop app.

**Dependencies:** F1, F2.

---

### F16 · Billing — P1

**Stripe** for self-serve plans + invoicing for enterprise.

**Metering hooks (modeled in `subscriptions` and `billing_accounts` from day one even if pricing isn't finalized):** seats, monthly active reps (MAR), meeting-hours, knowledge-base size (chunks).

**Acceptance criteria:**

| # | Given | When | Then |
|---|-------|------|------|
| AC1 | Workspace has a Pro plan with 10 seats | Owner invites 11th user | Invite is allowed but billing surfaces "1 seat over plan; you'll be charged $X/mo on next cycle" |
| AC2 | Workspace exceeds meeting-hour soft limit | Limit hit | Sessions continue; admin sees a warning banner; overage is billed per usage tier |
| AC3 | Stripe webhook fires for failed payment | Webhook received | Workspace transitions to `payment_overdue` status; sessions degrade to read-only after 7-day grace period |

**Out of scope for v1:** Custom contracts UI, prorated downgrades, multi-currency.

**Dependencies:** F8.

---

## 5. Data model

### Core entities

| Entity | Description | Key fields |
|--------|-------------|------------|
| `workspaces` | Tenant root | id, name, slug, plan_tier, region, status, created_at |
| `users` | Global identity | id, email, name, global_status, created_at |
| `user_workspace_memberships` | Tenant membership | id, workspace_id, user_id, role, team_id, status |
| `teams` | Sub-org within workspace | id, workspace_id, name, parent_team_id |
| `meetings` | A Google Meet session | id, workspace_id, external_platform, external_meeting_id, host_user_id, started_at, ended_at, status, consent_mode, retention_policy_id |
| `meeting_sessions` | Realtime session lifecycle | id, meeting_id, device_id, status, started_at, ended_at |
| `transcript_segments` | STT output | id, workspace_id, meeting_id, speaker_type, speaker_label, text, start_ms, end_ms, confidence, source_type, language |
| `turns` | Segmented turns | id, meeting_id, speaker_type, start_ms, end_ms, finalized_at |
| `intent_events` | Classifier output | id, meeting_id, turn_id, categories, stage_signal, urgency_score, confidence, model_version |
| `suggestions` | Generated coaching outputs | id, workspace_id, meeting_id, turn_id, suggestion_type, answer_text, followup_text, confidence_score, priority_score, source_chunk_ids, policy_version, displayed_at, dismissed_at, accepted_signal |
| `suggestion_feedback` | Rep feedback | id, suggestion_id, user_id, feedback, action, created_at |
| `knowledge_documents` | Uploaded source docs | id, workspace_id, name, category, status |
| `knowledge_document_versions` | Versions of a doc | id, document_id, version, content_hash, created_at |
| `knowledge_chunks` | Retrievable chunks | id, workspace_id, document_version_id, chunk_text, embedding, chunk_order, tags_json, visibility_scope, language, active |
| `script_collections` | Container for script versions | id, workspace_id, name, current_version_id |
| `script_versions` | Versioned script | id, collection_id, version, status (draft/published/archived), published_at |
| `script_stage_blocks` | Stage-organized blocks | id, version_id, stage, persona, language, body_md |
| `objection_libraries` | Curated objection sets | id, workspace_id, name, items_json |
| `answer_templates` | Canonical answers | id, workspace_id, category, body, source_chunk_ids |
| `meeting_summaries` | Post-call output | id, meeting_id, summary, objections_json, next_steps_json |
| `followup_drafts` | Email drafts | id, meeting_id, subject, body |
| `crm_sync_jobs` | CRM push jobs | id, workspace_id, meeting_id, target_system, status, payload_json |
| `audit_logs` | Append-only log | id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_json, ip_address, user_agent, created_at |
| `retention_policies` | Tenant retention | id, workspace_id, transcript_days, audio_days, summary_days, audit_days |
| `billing_accounts` / `subscriptions` | Billing | standard Stripe-mirrored fields |
| `feature_flags` | Per-workspace flags | id, workspace_id, key, value |

### Constraints & invariants

- Every row in every domain table MUST have `workspace_id` (except `users`, which is global identity, and `audit_logs` which has it but allows cross-workspace impersonation logging by Anthropic-internal staff — not in v1).
- A workspace MUST have at least one user with role `owner`.
- A `script_collection` has at most one `script_version` with `status='published'` at a time.
- `suggestions.source_chunk_ids` MUST reference chunks in the same `workspace_id`.
- `meetings.ended_at >= meetings.started_at` when both are non-null.
- Soft-delete is the default; hard-delete only via retention enforcement jobs.

### Example record (`meetings`):

```json
{
  "id": "mtg_01HXYZABCDEF",
  "workspace_id": "ws_01HABCDEFGHI",
  "external_platform": "google_meet",
  "external_meeting_id": "abc-defg-hij",
  "title": "Acme Corp <> Athena - Discovery",
  "host_user_id": "usr_01HDEFGHIJKL",
  "started_at": "2026-04-27T14:02:11Z",
  "ended_at": "2026-04-27T14:46:33Z",
  "status": "completed",
  "consent_mode": "rep_only",
  "retention_policy_id": "ret_default_30d"
}
```

---

## 6. External integrations

| Service | Purpose | Auth | Rate limits / quotas | Error mode |
|---------|---------|------|---------------------|-----------|
| STT provider (TBD: Deepgram / AssemblyAI / Speechmatics) | Streaming speech-to-text | API key per workspace policy | Provider-specific; abstract behind `packages/sdk/stt` | Fall back to alt provider; if none, degrade to caption-only or pause suggestions |
| LLM provider (Anthropic Claude / OpenAI / etc.) | Stage A/C/D inference | API key | Provider-specific | Retry 3x; circuit-break per workspace if errors >5%/min |
| Embedding provider | Knowledge ingestion | API key | Job-level batching | Retry job; partial chunks not persisted |
| Salesforce | CRM sync | OAuth 2.0 (refresh token) | 100k API calls/24h per org | Backoff to 1h; alert admin |
| HubSpot | CRM sync | OAuth 2.0 | 100/10s | Backoff; alert admin |
| Stripe | Billing | API key + webhooks | n/a | Webhook idempotency keys; retry on 5xx |
| Chrome Web Store | Extension distribution | n/a | n/a | Manual publish flow |
| Apple Developer (signing/notarization) | macOS app distribution | Apple ID + cert | n/a | CI step; fail build if signing fails |
| Sentry / Datadog | Observability | API key | n/a | Best-effort; don't block hot path |

> **TODO:** Pick STT provider after a head-to-head latency + diarization eval.
> **TODO:** Confirm primary LLM provider for Stage C generation; provider abstraction is mandatory regardless.

---

## 7. Non-functional requirements

### Performance

- Partial transcript surfaced within **800ms** (P95) of speech receipt
- Suggestion event published within **2000ms** (P95) of turn-end under normal network
- Admin dashboard first-meaningful-render **<2s** for standard views
- Knowledge chunk indexing: 50-page PDF queryable within **60s** (P95)
- Audit log write within **1s** of action

### Scalability

- Support **10,000 concurrent active meetings** in the medium-term architecture (v1 target: 500 concurrent)
- Hot-path services horizontally scalable (stateless except Redis for session state)
- Backpressure: low-priority suggestion events drop before the session stalls
- Tenant isolation must not materially degrade query performance under multi-tenant load

### Reliability

- **99.9%** monthly availability for core cloud services (post-GA target)
- Session recovery from transient disconnect within **5s**
- Graceful degradation: if STT degrades, fall back to caption-only; if generation degrades, fall back to retrieval-only "show source" mode

### Security & auth

- TLS 1.2+ in transit for all client-server communication
- Encryption at rest: PostgreSQL (AWS-managed KMS), object storage (SSE-S3), Redis (encrypted at rest where supported)
- macOS app: signed and notarized binaries; secure token storage in macOS Keychain
- RBAC: enforced at API middleware layer on every request; lint rule for `workspace_id` filter
- Service accounts: least privilege; secrets in vault (AWS Secrets Manager / GCP Secret Manager)
- JWT: 15min access token TTL, 30d refresh token, rotation on use

### Compliance (v1 baseline; SOC 2 Type I as Phase 3 milestone)

- Configurable retention per resource type (transcript, audio, summary, audit)
- Data export by meeting / user / tenant (CSV + JSON)
- Data deletion workflows (user-initiated, admin-initiated, retention-enforced)
- ASSUMPTION: GDPR-ready (data export, deletion, processing record) but not formally certified at v1
- TODO: confirm whether HIPAA / FedRAMP are needed for any pilot customer

### Privacy controls (per-workspace policy)

- Transcript-only mode (no raw audio retained)
- No-audio-retention mode
- PII redaction on exports
- Admin vs rep visibility separation
- Configurable model logging policies (whether prompts/completions are logged)

### Accessibility

- Target: **WCAG 2.1 AA** for admin web app and overlay UI
- All overlay actions keyboard-accessible
- VoiceOver-compatible labels on all controls
- Minimum text contrast 4.5:1 on overlay regardless of opacity setting

### Observability

- Distributed tracing (OpenTelemetry) across the realtime session pipeline (audio chunk → STT → intent → retrieval → suggestion → display)
- Structured logging (JSON) with `workspace_id`, `meeting_id`, `request_id` on every line
- Realtime latency dashboards by stage
- Tenant-level operational dashboards
- Alerting: session drops, queue buildup >X, transcript lag >2s sustained, error rate >1%/min

---

## 8. Success metrics

### Launch criteria (how we know v1 is "done")

- [ ] All P0 acceptance criteria pass in staging and production
- [ ] Tenant-isolation integration test suite is green
- [ ] Suggestion latency P95 < 2s in load test at 100 concurrent meetings
- [ ] Signed + notarized macOS app installs cleanly on macOS 13+ (Apple Silicon and Intel)
- [ ] Admin can complete the full happy path: create workspace → invite users → upload knowledge → publish script → run a Meet session → review post-call output
- [ ] Tenant A cannot read tenant B data in a manual penetration check on at least 5 attack vectors (URL tampering, token swap, vector query injection, S3 path traversal, Redis key probe)
- [ ] Audit log captures all P0 admin actions

### Post-launch metrics

| Metric | Target | How we measure |
|--------|--------|---------------|
| Suggestion useful-rate (rep marks "useful") | ≥ 35% in first 30 days | `suggestion_feedback` aggregation |
| Suggestion latency P95 | < 2s | Distributed traces |
| Sessions per active rep per week | ≥ 4 | `meetings` count, `MAU` denominator |
| Post-call outputs reviewed by rep within 24h | ≥ 60% | Event tracking on summary view |
| Workspace activation (≥ 5 reps × ≥ 5 sessions in week 1) | ≥ 50% of new workspaces | Cohort analysis |
| Knowledge coverage rate (questions matched to a chunk above relevance threshold) | ≥ 70% | Retrieval logs |

---

## 9. Glossary

| Term | Definition |
|------|-----------|
| Workspace | A tenant boundary equivalent to one customer company. Synonyms: tenant, org. **Never** equate to "team" — a workspace contains multiple teams. |
| Team | A sub-grouping inside a workspace, used for analytics scoping and content visibility. Reps belong to a team; managers manage one or more teams. |
| Session | One end-to-end Athena run for one meeting: capture → transcribe → suggest → post-call. Synonym: meeting session. |
| Turn | A contiguous span of one speaker's speech bounded by silence/sentence-end. Multiple `transcript_segments` may compose one turn. |
| Suggestion | A single output card from Stage C: answer / ask-next / coach / risk. Has a `suggestion_type`, confidence, priority, and source chunks. |
| Chunk | A retrievable unit of knowledge produced by ingestion. ~500 tokens. Has an embedding. |
| Script | A versioned, structured collection of stage-organized blocks (opener, qualification, demo, etc.) used to ground answer generation. |
| Battlecard | A short structured comparison/objection-handling document; a kind of `knowledge_document`. |
| Canonical answer | An admin-marked snippet treated as the preferred wording for a category. Generator prefers it over generative paraphrase. |
| Intent | A category label assigned to a customer turn (pricing, security, etc.). Distinct from `stage_signal`. |
| Stage signal | The detected sales-call stage (opener, discovery, demo, etc.). Distinct from intent. |
| Confidence score | A model-output [0..1] reflecting how well-supported a suggestion is by retrieved evidence. |
| Priority score | A [0..1] derived from urgency × confidence × non-redundancy. Drives whether a suggestion is displayed. |
| Consent mode | Per-meeting setting: `rep_only` (no participant disclosure required), `all_party` (host must announce recording). Default: `rep_only`. |
| Retention policy | Per-workspace config of how long transcripts / audio / summaries / audit logs are kept. |
| Adherence score | Per-meeting score against a sales framework (MEDDIC, BANT, SPICED) computed in post-call. |

---

## 10. Open questions

- [ ] Which STT provider wins the v1 eval (Deepgram, AssemblyAI, Speechmatics, or other)?
- [ ] Which CRM ships first — Salesforce or HubSpot — if engineering capacity forces a sequence?
- [ ] Which sales methodology view is the v1 default: MEDDIC, BANT, or SPICED?
- [ ] What's the default `transcript_retention` (7d / 30d / 90d)?
- [ ] Do we need a no-audio-retention default for EU pilot customers, or is it opt-in?
- [ ] Which plan tiers gate SSO/SAML, retention controls, and audit exports? (Implies billing tier modeling.)
- [ ] How do we handle Meet hosts who are not Athena users (i.e. rep is the guest)?
- [ ] What's the consent UX when the customer side has not been told they're being assisted by AI — surface in the rep app, force a disclosure prompt, or leave to workspace policy?
- [ ] Apple Silicon-only or universal binary? (Affects build pipeline complexity.)

---

## Appendix A — References

- Source PRD: `sales-copilot-prd.md` v1.0 (April 27, 2026) — used as input to this scaffold
- Suggested monorepo layout (from source):

```text
athena/
  apps/
    desktop-macos/
    admin-web/
    chrome-extension/
  services/
    api/
    realtime-gateway/
    transcript-service/
    orchestrator-service/
    knowledge-service/
    analytics-service/
    integration-service/
    billing-service/
  packages/
    shared-types/
    ui/
    prompts/
    policies/
    sdk/
  infra/
    terraform/
  docs/
```

- Recommended tech stack:

| Layer | Recommended |
|---|---|
| Desktop app | Swift + SwiftUI (macOS 13+) |
| Chrome extension | TypeScript + React + Manifest V3 |
| Admin web | Next.js + TypeScript + React |
| Backend | TypeScript + NestJS or Fastify |
| Realtime transport | WebSockets (gRPC as alt) |
| Primary DB | PostgreSQL |
| Vector | pgvector |
| Cache / pub-sub | Redis |
| Object store | S3-compatible |
| Queue | NATS or managed pub-sub |
| Auth | WorkOS / Clerk / custom (SAML in Phase 3) |
| Billing | Stripe + invoicing |
| Observability | OpenTelemetry + Datadog/Grafana/Sentry |
| CI/CD | GitHub Actions |
| Infra | AWS or GCP + Terraform |

## Appendix B — Build order (suggested for Claude Code)

1. Monorepo scaffold + shared types + auth + workspaces + RBAC (F8, F10)
2. Knowledge ingestion + retrieval pipeline (F7)
3. Realtime gateway + transcript persistence (F2 backend, F3)
4. Orchestrator with mocked STT + suggestion service (F4, F5)
5. Desktop overlay UI + session controls (F1 client, F2 client, F6)
6. Post-call jobs + analytics aggregations (F9, F12 backend)
7. Audit log surfaces + RBAC hardening (F11)
8. Billing + feature flags (F16)
9. Optional Chrome extension companion (F15)
10. CRM integrations (F14)
11. Coaching workflows (F13)
12. Observability hardening, load testing, tenant-isolation pen-test

## Appendix C — Changelog

| Version | Date | Change |
|---------|------|--------|
| v1 | 2026-04-27 | Initial scaffold-ready draft, derived from `sales-copilot-prd.md` v1.0. Stripped vision/marketing narrative; added testable acceptance criteria, error cases, JSON data shapes, glossary, and open questions per Claude-Code-optimized PRD format. |
