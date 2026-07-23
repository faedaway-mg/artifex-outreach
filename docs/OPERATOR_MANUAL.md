# Acquisition OS — Operator Manual v1

The playbook for running Artifex Labs outreach using Acquisition OS **as it exists
today**. It describes reality, not roadmap. Read it once; keep it open for the first
few weeks.

Companion docs: `SIGNATURE.md` (email signature + Outlook setup), `FIELD_LOG.md`
(the operating journal), `OPERATIONS.md` (deploy/health/recovery).

---

## 0. What the system is, in one paragraph

Acquisition OS organizes **work**, not businesses. You open it, it tells you today's
mission and the batches of work that exist, and you move through them one business at a
time. It writes the first-contact emails in Jordan's voice, checks them against an
authenticity bar, and (when you approve) sends them threaded from `hello@artifexlabs.tech`.
It does **not** yet read replies — those come back to your Outlook inbox and you handle
them there. Its job is to start good conversations with the least friction. Yours is to
turn those conversations into relationships.

---

## 1. Two things to know before you start

1. **Sending is off by default, on purpose.** Live email only goes out when
   `OUTREACH_SENDING_ENABLED=1`. Turn it on deliberately at the start of a real session,
   confirm the send queue is clean (see §9), operate, and turn it back off when you're
   done unless you're sending every day. With it off, you can still research, review, and
   approve — "Approve & send" will simply tell you sending is off.
2. **Replies are manual today.** A reply lands in the `hello@` Outlook mailbox, not in
   Acquisition OS. The app can't see it, so it won't auto-stop a sequence. When someone
   replies, you pause that lead's follow-up yourself (see §4). This is the single biggest
   thing to internalize.

---

## 2. The daily operating rhythm

Not a rigid schedule — a shape for the day.

**Morning (10–15 min)**
- Open **Today**. Read the mission ("Create N new conversations · ~T min").
- Let the morning warming settle (the businesses in today's queue get their intelligence
  ready in the background).
- If the queue is thin, open **Discover** and research a few new businesses to fill it.

**Execution block (the core, ~30–60 min)**
- Pick the batch that matters most today — usually **Initial emails ready** or
  **Follow-ups due** if there are any, otherwise **New businesses to understand**.
- Work the batch business-by-business: brief → one action → **Done — next**. Don't return
  to the dashboard between businesses; the loop carries you.
- Each completed business lights a node in the mission and drops off the queue.

**Breaks** — the loop is interruption-safe. Your place is held in the URL; close the app
and reopen to exactly where you were.

**Reply processing (whenever replies arrive)** — in Outlook (§4).

**Discovery preparation** — before any booked call (§7).

**Proposal / report work** — when a conversation has earned it (§6).

**End of day (5 min)** — fill in the **Field Log** session block (§8). Turn sending off if
you're not running again today.

---

## 3. Running an outreach session (the execution block)

1. **Today → pick a batch.** The batches are: Discovery calls today, Follow-ups due,
   Initial emails ready, Reports waiting, Calls to make, Videos to record, New businesses
   to understand. They're already sorted by urgency.
2. **You drop into the batch runner.** One business at a time: who it is, why it's worth a
   touch, what stood out, and one primary action.
3. **For emails**, you're deciding, not reading: business · why · top observations ·
   subject · opening line · reading time, with **Approve & send / Edit / Skip**. The full
   email is collapsed behind **Expand email** — open it only if you want to see exactly
   what the prospect receives. Approve to send + auto-advance. Edit opens the full editor.
   Skip moves on without sending.
4. **For videos**, the script is on screen — read it, record on your phone, then **Done**.
5. **For calls**, the brief + a natural opener + the first question are on screen, with a
   tap-to-dial "Call now". After the call, **Done**.
6. **Keep going** until the batch is done. The completion screen tells you you're clear.

That's the whole loop. Research and analysis live behind the tabs (Understand, Strategist,
Roadmap) — open them only when you deliberately want more depth.

---

## 4. When a business replies (exactly what happens today)

```
Reply arrives → your hello@ Outlook inbox
     ↓
Read it in Outlook
     ↓
Reply in Outlook (same thread — see §5)
     ↓
Open that business in Acquisition OS
     ↓
Complete / skip its follow-up task so no more automated email goes out
     ↓
Move the relationship forward (book a call, send the review, etc.)
```

The app will not know about the reply and will not stop the sequence for you. **You** stop
it by clearing the follow-up. Do this the moment you reply, so a scheduled follow-up never
talks over a live conversation. (Integrated inbox + auto-stop is the top of the Phase Two
roadmap — not built yet.)

---

## 5. Working in Outlook

Replies happen in Outlook. Keep it consistent with the app so the prospect experiences
one person, not two systems:

- **Keep threads intact.** Reply within the existing thread (don't start a new message).
  Acquisition OS set the threading headers; Outlook continues them as long as you reply
  rather than compose fresh.
- **Use the signature.** Set up the compact Artifex Labs signature in Outlook web/desktop
  per `SIGNATURE.md`, and default it for replies. On mobile, the transport rule is the
  fallback (with the honest placement caveat documented there).
- **Keep the personal voice.** Write replies the way the outreach reads: short, human,
  specific, curious. Don't switch into formal/consulting mode just because you're in
  Outlook. The relationship continuity depends on the voice staying the same.
- **Don't over-format.** A reply is a personal email. No branded shell, no CTA stack.

---

## 6. Email principles (the philosophy, briefly)

The outreach works because it feels like Jordan noticed something and wrote personally.
Hold to it in every message, app or Outlook:

- **Observation-first.** Lead with one concrete thing you actually saw.
- **Curiosity, not authority.** "I wasn't sure how…", not "here's what to fix."
- **Short.** If a paragraph can be a sentence, make it one.
- **Natural language.** No consulting jargon, no marketing lines, no AI tells.
- **Concrete details** over vague compliments.
- **No forced CTA.** Some emails end with an offer, some with a question. A reply is the
  goal — not a booking link.
- **Conversation over conversion.** The email earns permission; the report carries depth.
  Don't compress the report into the email.

---

## 7. Delivering a Business Technology Review

- **When:** after a real exchange has shown interest — not as the first touch. The email
  starts the conversation; the review is what you bring once there's one to have.
- **How to introduce it:** plainly. "Here's the short write-up of what I noticed — no
  obligation, I just thought it'd be useful." Send it as the branded delivery (Mode 2),
  which is the appropriate place for a produced artifact.
- **What not to say:** don't oversell it, don't frame it as a diagnosis of their failings,
  don't imply they need saving. It's an outside read, offered.
- **Invite discussion:** "If any of it is worth talking through, I'm happy to." Let the
  discovery conversation come from their curiosity, not a pitch.

## 8. Preparing for a discovery call

Open the business's **Discovery** tab (and the **Strategist** read) beforehand. It gives
you the consulting read and mission brief already assembled. Before the call:

- **Review:** the observations, the strengths, and what you *don't* yet know.
- **Gather:** anything from the reply thread that changed the picture.
- **Questions:** lead with the prepared discovery questions — they build on each other.
- **Goal:** understand how the business actually runs, in their words. Not to sell.
- **Success looks like:** you leave knowing one true thing you didn't know before, and
  they feel understood. Capture what you learn in the **Meeting** workspace / Relationship
  Memory so it's never rediscovered.

---

## 9. The Field Log (why it exists, how to use it)

`FIELD_LOG.md` is the operating journal and the bridge to future intelligence.

- **Why:** the product improves from real work, not ideas. The log is the evidence base.
- **How often:** one short block per session (end of day, ~5 min). Don't write essays.
- **What to record:** the outcome metrics (contacted, replies split positive/neutral/
  negative, discovery, proposals, clients, revenue), a phrase of field notes (what slowed
  you, what surprised you, when you left the app and why), and any anecdotal pattern.
- **Anecdote vs pattern vs signal:**
  - *Anecdote* — happened once. Note it, don't act.
  - *Repeated pattern* — the same thing three, five, twenty times. Tally it on the pattern
    table.
  - *Actionable signal* — a pattern frequent enough to change the product or the playbook.
    That, and only that, becomes a roadmap item.

**Before enabling sending each session,** glance at the queue (`scripts/comms/inspect-queue.ts`
or the comms status) and confirm nothing unintended is queued.

---

## 10. The improvement rule

**No feature requests from imagination.** Every change must reference repeated operational
evidence:

> "Three different owners asked the same thing." · "I rewrote every email in this batch."
> · "I kept switching to Outlook to find X." · "I forgot why I picked this business."

One occurrence waits. A repeated one becomes a candidate. Everything else stays frozen.

---

## 11. The scoreboard

Judge the day by business outcomes, never software usage:

Businesses contacted · meaningful replies · reply rate · discovery calls · proposals ·
clients · revenue · relationship quality.

Buttons clicked and screens visited are not the score.

---

## 12. The first 100 businesses are research

The goal for the first hundred is not revenue — it's learning. Every conversation teaches
something: which openings earn replies, which observations resonate, which industries
engage, which follow-up timing works, which objections repeat. Record it. Perfection isn't
the aim; a growing base of real institutional knowledge is.

---

## Final principle

Acquisition OS succeeds when it quietly disappears — when Jordan spends the hour
understanding a business, building trust, and moving a relationship forward, and barely
notices the software that got him there. The software is not the product. The
relationships are.
