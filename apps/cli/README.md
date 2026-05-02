# cli

`athena` — drive auth, knowledge ingest, and live coaching from the terminal. PRD F6 (rep surface, terminal flavor).

## Install

From the monorepo root:

```bash
pnpm --filter @athena/cli build
node apps/cli/dist/index.js --help
# or symlink:
ln -s "$(pwd)/apps/cli/dist/index.js" /usr/local/bin/athena
athena --help
```

## Commands

### Auth

```bash
athena signup       # create user + workspace; prompts for email, password, slug
athena login        # email + password; supports multiple workspaces via slug
athena whoami       # show signed-in identity + workspace + role
athena logout       # revokes refresh token + clears local state
```

Tokens land in `~/.athena/config.json` (mode `0600`).

### Knowledge

```bash
athena kb add --file ./security-faq.pdf --category security
athena kb add --url https://example.com/pricing --category pricing
athena kb add --text "We retain transcripts for 30 days by default." --category security --name retention-snippet

athena kb list
athena kb search "data retention" --topK 5
```

Supported file extensions: `.pdf .md .markdown .txt .csv .docx`.

Default category: `product_notes`. Use one of: `script faq battlecard pricing implementation security case_study product_notes`.

### Listen — live audio capture

```bash
brew install ffmpeg     # required for audio capture
export DEEPGRAM_API_KEY=dg_...

# default mic, auto rep detection (first speaker = rep)
athena listen

# explicit device + boost vocab + force a rep label
athena listen --device :1 --vocab "MEDDIC,Athena,RevOps" --rep "Speaker 0"
```

What it does:

1. spawns `ffmpeg -f avfoundation -i :0` → 16 kHz mono PCM s16le
2. streams PCM to Deepgram's `/v1/listen` WebSocket with diarization on
3. on each final transcript, classifies speaker (rep/customer)
4. **customer turns trigger `/v1/orchestrator/suggest`** and render a grounded box
5. rep turns are appended to rolling context but don't fire suggestions
6. while a suggestion is in flight, only the latest pending customer turn is queued

In-session commands (typed at the prompt):

- `/rep "Speaker 1"` — reassign which diarization label is the rep
- `/ctx` — show the last 6 turns of rolling context
- `/quit` — clean shutdown (Ctrl-C also works)

To capture **system audio + mic** (so the customer side is transcribed too),
install [BlackHole 2ch](https://existential.audio/blackhole/) and create an
Aggregate Device that routes Meet output + your mic into one input. Then
`athena listen --device :<aggregate-device-index>`. List devices with
`ffmpeg -f avfoundation -list_devices true -i ""`.

### Coach

One-shot:

```bash
athena coach "What is your data retention policy?"
```

Live REPL (run in a second terminal during a call):

```bash
athena live
customer › What's your security posture?
# ↳ box appears with the grounded answer + source + confidence
me: We retain transcripts for 30 days by default.
customer › And what about audio?
/reset    # clears rolling context
/quit     # exit
```

Each customer line is sent to `/v1/orchestrator/suggest` with the last 6 turns
of context. Rep turns (`me: …`) are appended to context but don't trigger a
suggestion.

### Config

```bash
athena config show
athena config set apiUrl http://api.athena.local
athena config set knowledgeUrl http://kb.athena.local
athena config set orchestratorUrl http://oo.athena.local
```

Defaults assume the local docker stack:

| Service          | URL                     |
| ---------------- | ----------------------- |
| api              | http://localhost:4000   |
| knowledge-service| http://localhost:4010   |
| orchestrator     | http://localhost:4020   |

## Notes

- Refresh token rotates automatically when the access token is within 30 s of expiry.
- The CLI never prints tokens.
- All requests are workspace-scoped via JWT claims (PRD F10).
