# Demo recording script — 60 seconds

Goal: capture one continuous loop that proves the live-coaching value in under a minute. Save as `docs/launch/demo.mp4` (≤10 MB) and `docs/launch/demo.gif` (≤3 MB, 800px wide).

## Setup (do once, on a clean macOS user)

1. Sign up at the staging URL with a fresh workspace ("Acme Sales").
2. Knowledge — keep the 3 starter docs **and** drop one extra: a one-page PDF of *your* company's pricing. This proves the "your own playbook" claim.
3. Open Chrome, install the extension (unpacked from `apps/chrome-extension/dist`), paste the access token from `~/.athena/config.json`, tick **Ship Meet captions**.
4. Build + run the macOS overlay (`cd apps/desktop-macos && swift build -c release && .build/release/AthenaOverlay`).
5. Open a real `meet.google.com/<id>` (you can use a personal account — solo Meet is fine for the demo).

## Shot list

| Time | Beat | What's on screen |
|---|---|---|
| 0–4 s | Hook | Public landing at `https://athena.app/` — hero text, CTA. |
| 4–8 s | Detection | Chrome popup opens; "DETECTED" pill + meeting id. |
| 8–14 s | Pair | Click "Open in Athena" → macOS overlay appears near the notch. |
| 14–28 s | Live coach | Speak the line: "What's your pricing model? Per seat or per minute?" Wait ~1.5 s — suggestion card appears in the overlay with a grounded quote from the pricing FAQ. Highlight the source pill. |
| 28–40 s | Second turn | Speak: "What about data security?" — second suggestion appears, this time from the objections doc. |
| 40–48 s | End call | Hit ⌘⇧E to end. Overlay swaps to "Generating recap…" then renders the recap card with summary + 'Copy email' button. |
| 48–58 s | Inbox | Cut to admin web `/dashboard` — onboarding banner + "Recent meetings" with the new entry. Click into `/meetings/[id]` to show recap. |
| 58–60 s | CTA | Cut back to landing — fade-in CTA "Get started — it's free". |

## Capture

```bash
# QuickTime → New Screen Recording → record the macOS desktop area covering
# Chrome + the overlay. ~60 seconds.

# Convert to GIF (ffmpeg required):
ffmpeg -i demo.mp4 -vf "fps=15,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" demo.gif

# Trim file size if needed:
ffmpeg -i demo.gif -vf "fps=12,scale=720:-1:flags=lanczos" demo-small.gif
```

## Sanity check before upload

- Cursor visible the whole time? (PH viewers need to track clicks.)
- No private info on screen? (Workspace name, real customer names, real emails — scrub all.)
- Audio? — strip it. The animation has to read silently for autoplay on PH cards.
- File size — GIF ≤3 MB, MP4 ≤10 MB.
