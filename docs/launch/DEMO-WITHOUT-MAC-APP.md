# Recording the demo without the macOS overlay

The macOS app is the third surface; the live-coaching value shows just as well in the **admin web meeting view + chrome extension + CLI listener**. Visually it can be cleaner — everything stays in browser windows you can resize for the recording.

The local stack is **already running**. URLs and credentials are in `SMOKE-RESULTS.md`.

## The 60-second shot list (no macOS app)

You'll have these windows open before you hit record:

| Window | What it shows |
|---|---|
| **A** — browser tab on `https://meet.google.com/<id>` | The "real customer call" frame. Solo Meet works fine. |
| **B** — browser tab on `http://localhost:3030/dashboard` | Workspace home. Onboarding banner + recent meetings will be here. |
| **C** — browser tab on `http://localhost:3030/meetings/<id>/live` | Live transcript + suggestions stream into this view. |
| **D** — terminal | `athena listen --gateway --meeting "Acme Discovery"` — captures your mic, ships frames to the gateway. |
| **E** — chrome extension popup | Pinned to the toolbar. Shows DETECTED + caption-shipping toggle. |

(If the project doesn't have a `/meetings/[id]/live` view yet, the dashboard `Recent meetings` row + the `/meetings/[id]` recap view at the end of the call cover the storyline.)

| Time | Beat | What's on screen |
|---|---|---|
| 0–4 s | Hook | Public landing `http://localhost:3030/` — hero "Win more calls. Grounded answers, live." |
| 4–8 s | Sign in | Click "Get started", create the demo workspace, land on `/dashboard` with the onboarding banner. |
| 8–14 s | Knowledge auto-seeded | Switch to `/knowledge` — 3 starter docs already there. |
| 14–18 s | Meet detected | Open `meet.google.com/<id>`. Chrome popup auto-opens, "DETECTED" pill + meeting id. |
| 18–22 s | Pair | Tick **Ship Meet captions**. (No overlay step — captions go straight to the live view.) |
| 22–35 s | Live coach #1 | Speak: *"What's your pricing model? Per seat or per minute?"* — within ~1.5 s a suggestion card appears in the live meeting view. Highlight the source chip. |
| 35–45 s | Live coach #2 | Speak: *"What about data security?"* — second suggestion appears, sourced from the objections doc. |
| 45–52 s | End call | Hit ⌘C in the CLI window (or "End meeting" in the live view). Recap renders inline (summary + draft email + CRM list). |
| 52–58 s | Inbox | Cut to `/inbox` — flag/comment notification on the recap row. |
| 58–60 s | CTA | Cut back to `/` — "Get started — it's free" CTA. |

If you don't want to speak on camera, just **type captions into the CLI's `live` REPL** instead. Same loop, no audio dependency:

```bash
node apps/cli/dist/index.js live
> What's your pricing model?
[suggestion appears in the terminal AND in the admin live view]
```

## Demo workspaces

Athena auto-seeds every new workspace with the **Andres Contreras Socratic-reframe objection-handling framework** (4 markdown files, ~21 chunks). Sign up a new workspace and you'll see these on `/knowledge` immediately:

- Objection Reframer — 7-step loop (master)
- Objection Reframer — reframe library by archetype
- Objection Reframer — tonality & delivery
- Objection Reframer — source analysis

Live demo accounts already provisioned on this Mac:

| Workspace | Email | Slug | Notes |
|---|---|---|---|
| Andres v2 | `andres-v2@athena.app` | `andres-v2` | **Cleanest** — only the 4 framework docs |
| Andres Test Co | `andres-test@athena.app` | `andres-test` | Same — fresh seed |
| Demo Workspace | `demo@athena.app` | `demo` | Has the framework + 4 leftover starter/test docs (a bit noisy) |

All passwords: `DemoPassword123!`. Use `andres-v2` for the cleanest recording.

## Optional polish — proper grounded answers (highly recommended for the recording)

Without an Anthropic key the heuristic mode picks the most relevant framework chunk but returns it verbatim — so on screen you'd see something like *"Caveat from source (Reel 15): This works on older buyers…"* instead of a polished reframe line. Functional, but not demoable.

With an Anthropic key the orchestrator's system prompt explicitly walks the LLM through the 7-step loop (DISARM → ISOLATE → UNCOVER → REFRAME → JUSTIFY → CONSEQUENCE → IDENTITY CLOSE) using the framework chunks as ground truth. The output looks like a real Andres reframe.

Set the keys in:

```bash
# In services/orchestrator-service/.env
ANTHROPIC_API_KEY=sk-ant-...
LLM_PROVIDER=auto

# In services/knowledge-service/.env AND services/realtime-gateway/.env
OPENAI_API_KEY=sk-proj-...
EMBEDDING_PROVIDER=auto
```

Then restart those three services:

```bash
lsof -t -i :4010 | xargs kill ; lsof -t -i :4020 | xargs kill ; lsof -t -i :4040 | xargs kill
# Wait a beat, then re-run the boot commands for those three (see SMOKE-RESULTS.md "process map").
```

For STT:

```bash
# services/realtime-gateway/.env
DEEPGRAM_API_KEY=...
STT_PROVIDER=auto
```

Without Deepgram, the gateway's mock STT fires fixed phrases — fine for the recording if you only care about the *visual* of suggestions appearing.

## What the recording is allowed to skip

- **macOS overlay** — Mac app is "early access, install from source" until notarized. Call it out in the PH copy under "known gaps". Roadmap promise → desktop app next week.
- **Live audio capture** — type into CLI `live` mode if mic capture is fragile on your hardware. The pipeline doesn't know the difference.
- **Real Meet participants** — solo Meet is fine, even leave video off.

## After the recording

```bash
# Convert MP4 → GIF for the PH gallery
ffmpeg -i demo.mp4 -vf "fps=15,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" demo.gif

# Trim if >3 MB
ffmpeg -i demo.gif -vf "fps=12,scale=720:-1:flags=lanczos" demo-small.gif
```

Check both files into `docs/launch/` and reference them from `PRODUCTHUNT.md`.

## Tearing down the stack

```bash
# Kill every service
for p in 4000 4010 4020 4030 4040 4050 4060 4070 3030; do lsof -t -i :$p | xargs kill 2>/dev/null; done

# Stop infra
docker compose -f infra/docker-compose.yml down
```
