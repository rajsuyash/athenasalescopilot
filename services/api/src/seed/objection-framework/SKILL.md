---
name: objection-reframer
description: >
  Generates real-time, natural, persuasive responses to sales objections using a
  Socratic reframe framework reverse-engineered from high-ticket sales calls. Use
  whenever the user mentions: objection handling, sales objection, "how do I
  respond when they say X", "give me a comeback for", "what do I say when they
  say it's too expensive / I need to think about it / I have to ask my wife / let
  me speak to others first / I don't have time / I got burned before", price
  objection, partner objection, time objection, stall, reframe, rebuttal, "handle
  this pushback", "they keep stalling", "they went cold after the price", or any
  request to handle resistance on a sales call. Also trigger when the user pastes
  a call transcript and asks to fix objection handling, is prepping for a call
  and wants responses ready, or wants to train a rep or AI voice agent on
  objection handling. Even a casual "how do I close someone who keeps dodging?"
  — this is the skill.
---

# Objection Reframer

Generate ready-to-deliver responses to sales objections that sound natural, lower
resistance, and pull the prospect through their own reasoning to a new conclusion.

## The core insight

Most "objection handling" advice is feature-counter-objection ping-pong: *"It's
too expensive"* → *"But here's the ROI."* That doesn't work on resistant prospects.
They don't change their minds because of new information. They change because they
re-derive a different conclusion **in their own words**.

The framework here is **Socratic reframing**: a 7-step loop that acknowledges the
objection, isolates the real concern, installs a new mental model, and lets the
prospect close themselves through guided questions. The *loop* is universal. The
*reframe* swaps based on the objection type.

This skill was built from a pattern analysis of 50 transcripts of a high-ticket
sales operator who closes hard objections without pressure. The source quotes
behind each pattern live in `references/source-analysis.md`.

## When this skill triggers vs. when to redirect

- **Use this skill** when the user has a specific objection (theirs or a
  prospect's) and wants a response — for use in a live call, a voice-agent
  flow, a transcript review, or rep training.
- **Redirect to `sales-script-generator`** if the user wants a full call script
  built from a BMC. That's a different deliverable.
- **Redirect to `discovery-call-script`** if the user wants pre-objection
  questioning structure (probing, qualification).

## Step 1: Collect what you need

Before generating, gather:

1. **The objection** — verbatim if possible. Surface objections ("too expensive")
   often hide deeper ones ("I don't trust I can do this"). If the user paraphrased,
   ask for the actual quote.
2. **The offer** — what's being sold, the price, the outcome promised.
3. **The buyer context** — role, current state (e.g., "$3K/mo, 9-to-5 employee,
   wants to quit"), desired state (e.g., "$30K/mo, location-free"). The reframe
   only lands if it's grounded in their actual numbers and identity.
4. **The framing constraint** — is this for a human rep, an AI voice agent, or
   the user's own learning? Voice agents need shorter beats with explicit
   handoff conditions (see Step 5).

If any of these are missing, ask for them before generating. A reframe is only
as sharp as the specifics it grips.

## Step 2: Classify the objection

Map to one of these archetypes. Most surface objections fall cleanly into one.
Read `references/reframe-library.md` before generating — it has the full
language patterns and source quotes for each archetype.

| Surface objection | Archetype | Primary reframe |
|---|---|---|
| "Too expensive / out of budget / can't afford" | **Price** | Compared-to-What → Opportunity Cost → Acting-As-If |
| "I need to think about it / sleep on it" | **Stall** | Fake Time → "What are you wanting to go over?" |
| "I need to talk to my wife / partner / co-founder" | **Authority** | Heavy is the Crown (responsibility) |
| "I want to speak to other vendors first" | **Comparison** | Yin-Yang (perfection vs. progress) |
| "I don't have time" | **Time** | Time as Priority |
| "I got burned before / tried something like this" | **Skepticism** | "Doesn't mean there couldn't still be something out there" |
| "I'm different / I have responsibilities / I can't" | **Self-doubt** | "Has it occurred to you that belief is the reason?" |
| "You're being pushy" | **Resistance** | Flip to internal tension → Growth on the other side of comfort |
| "Just send me info" | **Avoidance** | "How will you actually know before you try?" |

If the objection doesn't fit cleanly, default to the universal 7-step loop with
**Two Kinds of People** — it works on almost any limiting belief.

## Step 3: Run the 7-step loop

Every response follows this structure. Each step has a job; skipping any step
collapses the chain.

1. **DISARM** — *"Not a problem at all."* Casual, almost detached tonality.
   The hotter the content, the colder the delivery. Optional disarm line:
   *"I don't have a gun to your head."* Never sound desperate.

2. **ISOLATE** — Move the surface objection out of the way:
   *"[Money / wife / time] aside for a second, do you actually feel this gets
   you to [their stated goal]?"*
   This separates the smokescreen from the real concern. If they say no,
   you're handling the wrong objection — go back to discovery.

3. **UNCOVER** — *"What's the real concern, between you and I?"* or
   *"What are you actually wanting to go over in your head?"*
   The first stated objection is rarely the real one. This step exposes it.

4. **REFRAME** — Install the new mental model from the reframe library. Most
   reframes use either a **binary** (two kinds of people) or a **metaphor**
   (heavy is the crown / fat person working out / king and peasants). Pick
   one — never stack two.

5. **JUSTIFY** — *"Why?"* This is the most-skipped, most-important step. Once
   they've picked the new belief in the reframe, make them defend it in their
   own words. People don't believe what they're told; they believe what they
   say.

6. **CONSEQUENCE** — *"What happens if we keep this same way of thinking for
   the next 2 days, 2 weeks, 2 months, even 2 years?"* Then:
   *"Are you willing to settle for that?"*
   Future-pace the cost of inaction until they reject it themselves.

7. **IDENTITY CLOSE** — *"What decision do you feel like you need to make to
   put yourself in the best possible position to actually [hit their goal]?"*
   The close is framed as what the *new identity* would do — never as a
   yes/no on the offer.

## Step 4: Generate the output

Use this structure:

```
# Objection Reframe: [Surface objection in quotes]

**Archetype:** [Price / Authority / Stall / etc.]
**Primary Reframe:** [Named reframe from the library]
**Offer Context:** [One line]

---

## Ready-to-Deliver Response

[Full dialogue script. Rep lines in normal text. Likely prospect responses
in italics. Tonality cues in [brackets] only where they matter.]

---

## Loop annotation

A line-by-line map of which step of the 7-step loop each rep beat is
executing. This is what makes the response teachable.

---

## If they deflect

2–3 branching paths for the most likely mid-reframe deflections, with the
recovery line for each.

---

## Tonality notes

Specific delivery cues for this response — pauses, casualness markers,
reduce-to-ridiculous moments. Pull from `references/tonality-and-delivery.md`
if needed.
```

## Step 5: Adapt for AI voice agents (if applicable)

If the user said this is for a voice agent (e.g., for an inbound complaints or
outbound qualification flow), also produce a state-machine version:

```
state: handle_<archetype>_objection
  on_enter: deliver disarm + isolate (8-12s)
  expects:
    - confirms_value           → state: install_reframe
    - deflects_to_new_concern  → state: classify_new_concern
    - asks_clarifying_question → answer in <8s, re-enter current state
    - silence > 4s             → ask: "what's coming up for you on that?"
  fallback after 2 deflections: hand off to human rep
```

Voice agents need:
- **Shorter beats** — 8–15 seconds per turn vs 30+ for humans.
- **No long analogies** — "Heavy is the Crown" takes 60+ seconds. Use the
  binary version instead.
- **Explicit handoff conditions** — when the prospect goes off-script in a
  way the agent can't recover from, route to a human.
- **Tonality flatness compensation** — voice agents lose the casual "between
  you and I" intimacy. Compensate with shorter sentences, more pauses, and
  no closer-bro language.

## Output style notes

- **Write dialogue like real speech.** Contractions, mid-sentence pivots,
  casual transition words ("man," "look," "between you and I"), and pauses.
  Not TED-talk-perfect grammar.
- **Mirror the user's register, not the source's.** The source material curses
  liberally and uses high-ticket-closer language ("you fucking poor person").
  That's the speaker's personality, not the framework. A B2B enterprise rep
  talking to a CTO at a €100M manufacturer sounds nothing like a high-ticket
  closer talking to a 22-year-old. Default to clean, conversational, and
  professional. Strip the personality; keep the moves.
- **Ground every reframe in their actual numbers.** Reframes referencing
  "the version of you doing $30K/month" are sharper than "the successful
  version of you" — but only if $30K is their stated goal. Use the buyer
  context they gave you.
- **One reframe per objection.** Stacking two reframes in the same beat
  reads as a script. Land one, make them justify it, then close.

## Common mistakes

- **Skipping the isolate step.** Going straight from disarm to reframe means
  you reframe the wrong objection. Always isolate first.
- **Not making them justify.** If you reframe and they nod, ask *"Why?"*
  before moving on. Their answer is the lock.
- **Closing on the offer instead of the identity.** *"So do you want to buy?"*
  loses. *"What decision does that [new identity] make right now?"* wins.
- **Heavy analogies on short calls.** "Heavy is the Crown" needs 60+ seconds.
  On a 5-minute call, use the binary: *"Who's actually responsible for this
  outcome — you or your partner?"*
- **Mistaking sequence for script.** The 7-step loop is the *order of moves*,
  not a memorized script. If the prospect skips ahead (e.g., admits the real
  concern in step 2), drop the uncover step and go straight to reframe.

## Worked example

**Inputs:**
- **Objection:** "It's a lot of money, I want to think about it."
- **Offer:** AI voice-agent platform for European mid-market manufacturers,
  €48K for a 6-month deployment, replaces inbound customer-service overhead.
- **Buyer:** Head of IT at a €120M consumer-durables manufacturer running SAP.
  Currently has 8 service reps handling ~3,000 inbound complaints/month with
  an 18-hour average resolution time.
- **For:** Human rep on a discovery-to-close call.

**Output:**

```
# Objection Reframe: "It's a lot of money, I want to think about it."

**Archetype:** Combined Price + Stall
**Primary Reframe:** Opportunity Cost (Price layer) + "What are you wanting
to go over?" (Stall layer) — handle Price first because it's the structural
objection; the Stall is downstream of it.
**Offer Context:** AI voice-agent platform, €48K / 6 months, replaces
inbound complaint-handling at a €120M SAP-running manufacturer.

---

## Ready-to-Deliver Response

REP: Yeah, completely fair — €48K is a real number, I'm not going to
pretend it isn't. [pause, casual]

Look, between you and I — money aside for a second — based on
everything we've covered, do you actually feel like what we're putting
together would get the resolution time down from 18 hours to under 4,
and pull the eight reps off inbound so they can do retention work?

PROSPECT: *Yeah, I think it would, that's what I keep coming back to.*

REP: Okay. So if we set the price aside as something we can figure out
on the back end, what's the real thing you'd want to think through
between now and our next conversation?

PROSPECT: *Honestly, it's just — €48K is a lot to commit to without
seeing the platform live in our environment.*

REP: Got it. And that's the actual concern — not the price itself, it's
the risk of committing before you've seen it work on your data.

PROSPECT: *Yeah, that's it.*

REP: Fair. Can I offer a different way to look at it for one second?
[wait for permission]

PROSPECT: *Sure.*

REP: So in any business there's two ways to look at an investment.
There's the spend lens — *this costs €48K* — and there's the
opportunity-cost lens — *what is it costing us right now to not have
this in place?* For your team, you're at 3,000 complaints a month, 18
hours average resolution. Eight reps fully consumed by inbound. So if
nothing changes for the next two quarters, what does that actually
cost the business — in churn, in retention work that doesn't get done,
in the reps you'll need to hire to keep up?

PROSPECT: *Honestly, probably 4–5x more than the platform.*

REP: And why do you think that is? [make them justify]

PROSPECT: *Because the cost of doing nothing compounds. We've already
been here a year and it's gotten worse, not better.*

REP: Right. So the real question isn't whether €48K is expensive — it's
which is more expensive over the next 6 months: the platform, or
another 6 months of the current setup?

PROSPECT: *…the current setup, by a long way.*

REP: Yeah. So the version of your operation 6 months from now — the
one with sub-4-hour resolution and eight reps freed up for retention —
how does that team make this decision today?

PROSPECT: *They run the pilot.*

REP: Then let's not make this a "think about it." Let's make it a
"what's the cleanest way to start." I can get you an environment-
matched pilot scoped this week — does that work?

---

## Loop annotation

| Beat | Step | What it does |
|---|---|---|
| "€48K is a real number, I'm not going to pretend it isn't" | DISARM | Removes adversarial framing; signals you're not commission-breath |
| "Money aside for a second…" | ISOLATE | Separates the smokescreen (price) from the real concern |
| "What's the real thing you'd want to think through?" | UNCOVER | Surfaces the actual hesitation (deployment risk) |
| Two-lens reframe (spend vs. opportunity cost) | REFRAME | Installs the opportunity-cost mental model |
| "Why do you think that is?" | JUSTIFY | Makes them defend the new frame in their own words |
| "What does it cost the business if nothing changes for 2 quarters?" | CONSEQUENCE | Future-paces the cost of inaction |
| "How does that 6-month-from-now team make this decision today?" | IDENTITY CLOSE | Closes on the identity of the future operation, not on yes/no |

---

## If they deflect

- **If at the isolate step they say "Actually no, I'm not sure it would
  work":** You're handling the wrong objection. The real issue is value,
  not price. Go back to discovery: *"Okay — what specifically would you
  need to see for it to feel like a yes on outcome?"*
- **If at the reframe step they push back ("Opportunity cost is a sales
  argument"):** Concede the framing, hand them the math: *"Fair. Let me
  put numbers on it instead — if your average complaint costs €X to
  resolve today and we cut resolution time by 75%, what's the saved
  rep-hours figure on 3,000 complaints/month?"*
- **If they re-stall after consequence ("I still need a few days"):**
  Don't fight it. Use the fake-time technique: *"Of course. How many
  days are you thinking — 3, 5? Let me block time on Thursday — what
  specifically would you want answered between now and then?"*

---

## Tonality notes

- **Pace the reframe slowly.** "Two ways to look at it… [pause] there's
  the spend lens… [pause] and there's the opportunity-cost lens." Pauses
  give the brain time to process. Speed kills the move.
- **Drop into a quieter, more thoughtful register at the consequence
  step.** Not aggressive. Not pleading. Just: *"What does it actually
  cost the business?"* Like you're asking a peer, not closing.
- **The identity close is delivered casually**, almost as an afterthought.
  *"How does that team make this decision today?"* — said the way you'd
  ask a colleague over coffee. Pressure here breaks the spell.
```

---

## Source

This framework was reverse-engineered from a corpus of 50 Instagram Reel
transcripts of a high-ticket sales operator. The patterns appeared with
remarkable consistency across the corpus — the same 7-step loop, the same
named reframes, the same tonality cues. The full source attribution
(which transcript each pattern was lifted from) is in
`references/source-analysis.md`.

The framework is the operator's; the abstraction, library structure, and
adaptation to other contexts (B2B enterprise, voice agents, professional
register) is the work of this skill.
