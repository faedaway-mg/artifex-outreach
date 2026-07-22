# Outreach Experience v2 — a relationship operating system

Not a lead manager. Not a CRM. A calm workspace that quietly orchestrates the
relationship while the human focuses entirely on building trust.

Two promises hold the whole thing together:

- **The operator never wonders "what do I say?" or "what do I do next?"**
- **The business owner never feels "I'm being sold."**

Technology is never the conversation. Technology is only the explanation. The
conversation is always about the business — more customers, smoother days, fewer
headaches. Everything below serves those two sentences.

---

## The journey (every screen reflects this sequence)

```
Business identified
  → Business Technology Review generated
  → Decision-maker intelligence
  → Personalized introduction email
  → (optional) 45-second personal video
  → a few days of quiet
  → follow-up email
  → follow-up conversation (phone) — never a "cold call"
  → discovery conversation
  → relationship → partnership
```

The phone call is a **continuation** of a conversation the emails already
started — the guide is written that way on purpose.

---

## The engine — `src/lib/outreach/` (built, deterministic, tested)

One call returns everything for a lead: `buildOutreachKit({ lead, profile,
settings, contacts, improvement?, outreachState? }) → OutreachKit`. Every piece is
a pure function of the business's real, observed signals. Nothing is fabricated.
Nothing is sent. 20 tests cover determinism, voice, and honesty.

| Module | What it produces |
|---|---|
| `next-action.ts` | **The one thing to do now** — a progressive state machine (see below) |
| `content.ts` | Human intro email + follow-up email + subject lines + video script |
| `decision-maker.ts` | Decision-Maker Intelligence — role, confidence, source, reachable channels, preferred order — or an honest "could not be confidently identified" |
| `conversation.ts` | Adaptive phone guides (receptionist / decision-maker / voicemail, branching) + adaptive discovery |
| `confidence.ts` | Seven operator-confidence scores, each with a plain *why* and *how to improve* |
| `voice.ts` | Shared craft: cleans analyst language out of customer copy, grounds every line |
| `kit.ts` | Assembles the complete `OutreachKit` |

### Next Best Action — one action, always

`computeNextAction(state)` returns exactly one primary action; everything else is
secondary. It evolves as work completes:

```
no review        → Generate the Business Technology Review
review, hi-value → Record a 45-second personalized video
video/ready      → Send the warm introduction
just sent        → Wait (countdown; opened? viewed? — no action needed)
window passed    → Send a brief, human follow-up
followed up + engaged        → Offer a quick conversation
followed up, quiet, hi-conf  → Follow-up conversation by phone
meeting booked   → Prepare for the discovery conversation
two touches, quiet, low-fit  → Let it rest (nurture)
```

Language is deliberate: **"follow-up conversation"**, never "cold call".
Scheduling is an **invitation** ("you're welcome to grab whatever time works best
for you"), never "Book now".

### The voice (what makes it land)

- Opens with what was actually done: *"I spent about ten minutes experiencing your
  practice the same way one of your patients would."*
- Acknowledges a genuine strength before ever naming friction.
- States observations as things *noticed*, not prescriptions — and admits it might
  be wrong.
- No buzzwords, no agency/marketing/AI language, no exclamation marks, one idea per
  message. The brand's `BANNED_PHRASES` guard is enforced in tests on the email body.
- Follow-up never says "just checking in / following up / bumping" — only
  *"I just wanted to make sure this didn't get buried."*

### Decision-Maker Intelligence — never guesses

Identifies Owner / Founder / Practice Owner / Managing Partner / Office Manager /
etc. from **real** public data (Contact records + the lead's public routes),
classifies the role, scores confidence, and orders the reachable channels. A role
inbox (`info@…`) is treated as office email, never a personal address. When it
can't be confident it says so — *"Decision maker could not be confidently
identified. Use the receptionist call to find who owns the customer experience."*
Live public-source scraping plugs in behind `EnrichmentSource` (see **Operator
actions** — needs a data source/credential; not faked).

---

## The experience — momentum, not documents (spec; partial wiring in progress)

The lead page is being re-centered on **one clear next step**, Linear/Apple-calm:

1. **`NextBestActionCard`** — the hero. One imperative, one *why*, one invitation-
   style CTA, a quiet progress rail. For wait states: a status line, not a button.
2. **Everything else becomes supporting information** — the review, observations,
   intelligence, and kit collapse into expandable sections beneath the action. The
   report still exists; it *supports* the action instead of competing with it.
3. **Video-first** for high-confidence leads: "Estimated recording time: 48
   seconds," with opening / three observations / one question / close.
4. **Premium email presentation** (next slice): a refined minimal Artifex
   signature (small logo, "Jordan Jackson · Artifex Labs"), and an elegant embedded
   video thumbnail linking to the hosted VEED recording — thoughtful, never flashy.

The operator should know what to do within five seconds of opening a lead: no
reading, no decision fatigue — one thoughtful action, then the system reveals the
next.

---

## Status

**Built + green (typecheck, lint, 480 tests):** the full `src/lib/outreach/`
engine — next-action state machine, human email + follow-up + subject lines +
video script, decision-maker intelligence, adaptive phone guides + discovery, and
the seven confidence scores. Additive and safe — nothing is wired to sending; the
running app is unchanged until the UI is wired.

**Next slices (sequenced, not faked):**
- Wire `NextBestActionCard` + collapsible `OutreachKitPanel` into the lead page,
  with a `buildLeadOutreachState` server helper mapping DB records → `OutreachState`.
- Progressive collapse of the existing lead panels behind the action.
- Premium HTML email template + embedded video thumbnail.
- Calling-language sweep across existing UI ("cold call" → "follow-up conversation").
- **Operator action:** wire an `EnrichmentSource` (corporate registry / LinkedIn /
  licensing board) to raise decision-maker identification beyond Contact records.
