# Athena — ProductHunt launch copy

Pre-flight checklist for the 2026-04-30 PH launch. All copy below is final unless flagged TODO.

## Tagline (60 chars max)

> Real-time coach for your sales calls.

(56 chars)

## Description (260 chars max)

> Athena listens to your Google Meet calls and surfaces grounded answers, the next-best question, and risk flags in under 2 seconds — pulled from your own playbook. When the call ends, it ships a recap, a draft follow-up email, and CRM updates.

(254 chars)

## Topics

- Sales
- Productivity
- Artificial Intelligence
- Meetings
- SaaS

## Maker comment (first pinned reply)

> Hi Hunters — I built Athena because every rep I talked to had the same complaint: they get coached *after* the call ends, by which point the deal is already half lost. I wanted a coach in the room, on every call, with the patience to listen and the speed to actually help.
>
> The two design choices that surprised me:
>
> **Grounding over generation.** Most "AI sales tools" hallucinate pricing and policy. Athena will only surface text that maps back to a real chunk in a document you uploaded. The trade-off: on day one your suggestions are only as good as your playbook. The upside: you can trust the output and your CFO won't kill the rollout.
>
> **Sub-2-second loop.** From the moment the prospect finishes a sentence to the moment a suggestion appears in the overlay, the budget is 2000 ms P95. That's tight enough that you can use it during the conversation rather than reading it after.
>
> Free tier is permanently free for solo reps — three seats, five meeting hours per month, no credit card. Self-host if you'd rather: docker-compose + a single domain, instructions in the repo.
>
> Three things I'd love your feedback on:
> 1. The Chrome extension flow vs. the macOS overlay — which felt more natural?
> 2. Suggestion quality vs. competitors you've tried.
> 3. What's missing from the recap that would make it a forward-and-forget for your CRM workflow?
>
> Thanks for taking a look. AMA.

## Gallery (priority order)

1. **demo.gif** — 60-sec loop: open Meet → Chrome popup detects → captions stream → suggestion appears in overlay → recap renders post-call.
2. **screenshot-overlay.png** — macOS overlay near camera notch with a live suggestion card.
3. **screenshot-knowledge.png** — `/knowledge` page with 3 starter docs + 1 user upload.
4. **screenshot-recap.png** — `/meetings/[id]` page rendering the Stage D recap (summary + email + CRM list).
5. **screenshot-inbox.png** — `/inbox` archive view with filter tabs and mark-all-read.

## Schedule

- **Post time**: 12:01 AM PST (3:01 AM EST). Auto-schedule via PH dashboard.
- **Hunter**: TBD — DM the top 3 hunters on PH the day before with a preview link.
- **Promo channels** (post-launch, in this order):
  1. Personal Twitter/LinkedIn at 9 AM PST.
  2. Indie Hackers post at 10 AM PST.
  3. Email list (if any) at 11 AM PST.
  4. Reply to every PH comment within 30 min for the first 4 hours.

## Pre-launch sanity check (the hour before)

- [ ] `https://athena.app/` loads in incognito, no auth wall.
- [ ] Sign-up flow works end-to-end on a throwaway address.
- [ ] Chrome extension installs cleanly from the Web Store (or unpacked install GIF is linked).
- [ ] `/privacy` and `/terms` resolve.
- [ ] `support@athena.app` and `hello@athena.app` deliver.
- [ ] Sentry receiving events from prod (trigger one on purpose).
- [ ] Demo GIF embeds in the PH preview.
- [ ] Pin maker comment immediately after launch goes live.

## Day-2 follow-up

- Capture top 5 questions from comments and turn them into a `docs/launch/RESPONSES.md` so the answer is consistent across PH, Twitter, email.
- If we hit top 5 of the day: write a thank-you tweet thread quoting the funniest user feedback.
- If we don't: write a "what we learned" post for the blog.

## Known gaps to call out (don't get caught lying)

- macOS app is **early access** — must build from source today; notarized DMG ships next week.
- Email verification + password reset are manual (email support@) for week 1.
- Stripe paid tiers are mocked for the launch — Pro is "coming soon" on the pricing page.
- CRM integrations (Salesforce, HubSpot) are on the roadmap, not in v1.
