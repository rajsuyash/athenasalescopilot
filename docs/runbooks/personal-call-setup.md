# Personal call setup (macOS)

The fastest path to using Athena on your own Google Meet calls today, without the desktop app.

## Prereqs

- macOS 13+
- Node 20+, pnpm 9+, Docker Desktop, Postgres on `:5432` via the bundled docker-compose
- ffmpeg (`brew install ffmpeg`)
- A Deepgram account + `DEEPGRAM_API_KEY`
- Optional: Anthropic API key for grounded generation (Stage C). Without it the orchestrator falls back to top-chunk + heuristic.

## One-time setup

```bash
# 1. infra
docker compose -f infra/docker-compose.yml up -d
pnpm install
pnpm --filter @athena/db prisma:migrate:dev --name init
psql "$DATABASE_URL" -f packages/db/prisma/migrations/manual/01_pgvector_chunk_embedding.sql

# 2. services (each in its own terminal; share the same JWT_ACCESS_SECRET)
pnpm --filter @athena/api dev                    # :4000
pnpm --filter @athena/knowledge-service dev      # :4010
pnpm --filter @athena/orchestrator-service dev   # :4020

# 3. CLI
pnpm --filter @athena/cli build
ln -s "$(pwd)/apps/cli/dist/index.js" /usr/local/bin/athena
```

## First call (mic-only)

```bash
athena signup       # one-time
athena kb add --file ./security-faq.pdf --category security
athena kb add --file ./pricing-2026.md --category pricing
athena kb add --text "Implementation usually takes 2 weeks for ≤50 reps." --category implementation

export DEEPGRAM_API_KEY=dg_...
athena listen
```

Mic-only mode catches what *you* say. The first speaker you talk over becomes
the "rep". Anyone else (customer) triggers a grounded suggestion. This is
useful for solo practice but limited — the customer side won't transcribe
because their voice arrives via Meet output, not your mic.

## System audio + mic (recommended)

To transcribe the customer side too, route Meet's output back into a virtual
mic so ffmpeg can grab it.

1. Install [BlackHole 2ch](https://existential.audio/blackhole/) (free).
2. Open **Audio MIDI Setup** → **+** → **Aggregate Device**. Tick your real mic
   AND `BlackHole 2ch`. Name it e.g. `Athena-Capture`.
3. In **System Settings → Sound → Output**, create a Multi-Output Device that
   includes your speakers/headphones AND `BlackHole 2ch` so you can still hear
   the meeting while it's also being routed to the virtual mic.
4. List devices to find the index:
   ```bash
   ffmpeg -f avfoundation -list_devices true -i ""
   ```
   Look for `[N] Athena-Capture` under `AVFoundation audio devices`.
5. Run:
   ```bash
   athena listen --device :N --vocab "MEDDIC,SPICED,RevOps"
   ```

Now Deepgram's diarization separates rep from customer. The first speaker is
auto-classified as the rep; if it picks wrong, run `/rep "Speaker 1"` mid-call
to reassign.

## During the call

- The terminal shows each customer turn followed by a colored suggestion box:
  - **green** = answer (sourced from your knowledge base)
  - **cyan** = ask_next (orchestrator wants you to clarify before answering)
  - **yellow** = coach (low confidence — defer or route to follow-up)
  - **red** = risk (low signal or policy violation)
- The "source" line names the document. If you don't recognize it, you may
  want to revoke that document via the admin web app (when it lands) or
  delete it from the DB.
- `/ctx` shows the last 6 turns. `/quit` cleanly tears down ffmpeg + Deepgram.

## After the call

Post-call summary + follow-up email + CRM suggestions live in the
`postcall-service` (PRD F9). That ships in the next phase. For now, scrolling
the terminal log gives you a structured trace of every customer turn + the
suggestion fired.

## Privacy notes

- Audio is streamed to Deepgram. It is NOT persisted by default (PRD F2 — raw
  audio is dropped after STT). Final transcripts are persisted only when a
  `meetingId` is supplied to the orchestrator, which `athena listen` does not
  do today.
- Suggestion rows are persisted only when a `meetingId` is supplied (same
  reason). For pure personal use, leave the `meetingId` flag off.
- The CLI never prints your access token. `~/.athena/config.json` is `0600`.
