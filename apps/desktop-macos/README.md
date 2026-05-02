# desktop-macos

Native macOS overlay app — Swift + SwiftUI, macOS 13+. PRD F1, F2 (client), F6.

## What ships in this build

- Always-on-top borderless SwiftUI window placed near the camera notch.
- Mic capture via `AVAudioEngine`, resampled to 16 kHz mono Int16 PCM.
- **System audio capture via `ScreenCaptureKit` (toggleable)**, mixed with the
  mic in a 100 ms-aligned `AudioMixer` and shipped as one mono PCM stream.
  No BlackHole or Aggregate Device required — Deepgram's diarization separates
  rep from customer naturally.
- WebSocket session to `realtime-gateway` (`/v1/sessions`), reusing the access
  token written by the CLI to `~/.athena/config.json`.
- One suggestion card mode (Compact). Other PRD F6 modes are stubs.
- Keyboard shortcuts: `⌘⇧A` start, `⌘⇧E` end, `⌘⇧P` pause/resume.
- **Custom URL scheme `athena://`** — the Chrome extension's "Open in Athena"
  button fires `athena://start?meeting_id=…&title=…`, which auto-creates a
  meeting (with the Meet ID as `externalMeetingId`) and starts the WS session
  without typing. Buffers + replays if invoked before bootstrap.
- Tenant isolation enforced server-side: the gateway pulls `workspace_id` out
  of the JWT; the app never names a workspace.

## Run

```bash
# install + run via Swift Package Manager (no Xcode required)
cd apps/desktop-macos
swift run AthenaOverlay
```

The first launch prompts for **microphone permission**. macOS will not surface
the permission dialog reliably from a `swift run` binary that is not signed
or bundled — for a polished install, build into a real `.app`:

```bash
swift build -c release
mkdir -p AthenaOverlay.app/Contents/MacOS
cp .build/release/AthenaOverlay AthenaOverlay.app/Contents/MacOS/AthenaOverlay
cp Resources/Info.plist AthenaOverlay.app/Contents/Info.plist
open AthenaOverlay.app
```

## Prereqs

1. Sign in with the CLI first (`athena signup` or `athena login`). The overlay
   reads tokens from `~/.athena/config.json`.
2. The realtime-gateway must be running (`pnpm --filter @athena/realtime-gateway dev`).
3. The api service must be running so the overlay can `POST /v1/meetings`.

## Architecture (sequence)

```
launch
  → Settings.load() reads ~/.athena/config.json
  → bootstrap: validate accessToken
user clicks Start
  → AthenaClient.createMeeting(title) → POST /v1/meetings
  → AthenaClient.openSessionWebSocket() → wss://gateway/v1/sessions?token=...
  → server: { type: hello.required }
  → client: { type: hello, meetingId, sampleRate, language }
  → server: { type: ready }
  → AudioCapture.start() — AVAudioEngine tap → resampled to 16kHz s16le → ws.send(binary)
  → server emits transcript.partial / transcript.final / suggestion.generated
  → SwiftUI re-renders the suggestion card
user clicks End (or ⌘⇧E)
  → ws.send({ type: bye })
  → engine.stop(), task.cancel()
  → POST /v1/meetings/:id/end
```

## What's NOT in this build

- System audio capture (PRD F2). We capture mic only. To transcribe the
  customer side of a Meet call, route Meet's output through BlackHole into
  the system mic, per `docs/runbooks/personal-call-setup.md`.
- Five window modes (Micro / Coach / Checklist / Silent) — only Compact today.
- Pin / copy / mark-useful interactions.
- Native Keychain token storage — we share `~/.athena/config.json` with the
  CLI for v1 and rely on POSIX `0600` mode.
- Code signing + notarization — required for a public binary; out of scope here.

## Tests

XCTest scaffold lands later. The Node services have integration coverage that
exercises the same gateway protocol the overlay speaks.
