# Founder OS — Field Log (RC1 → v1.0 validation)

The Founder OS is at **Release Candidate 1**. From here, **reality is the only source of
product direction.** This file is the instrument for that: a structured place to record
what actually happens when the OS is used on real engagements. It is deliberately not
code — it is the evidence that decides what code comes next (if any).

**Rule:** nothing gets built from this log until a friction point appears across
**multiple** engagements. One annoyance is an anecdote; a repeated pattern is a signal.

---

## Operator session journal

One block per outreach session. Numbers over impressions; hesitations over opinions.

```
### Session: <date>

Businesses reviewed: __
Emails sent: __         Replies received: __
Discovery calls booked: __   Proposals sent: __   Clients won: __
Time spent: __ min

Points of hesitation ("I had to stop and think"): 
Moments of confusion ("I couldn't tell / I forgot what came next"):
Times I left the app (and why):
Ideas that surfaced during real work:
```

---

## Go-live gate — controlled live send log

- **2026-07-23** — First controlled production send through the real pipeline.
  - Mechanism: `scripts/comms/send-one.ts` (isolated internal lead, never touches real
    leads; does **not** open the global `OUTREACH_SENDING_ENABLED` gate).
  - Result: `dispatch outcome: sent`, Resend `providerMessageId a8910a5f-6a73-433f-9b30-63b4aa0fa972`,
    ledger `sent`. From `Jordan <hello@artifexlabs.tech>` → `jordant.jackson@gmail.com`.
  - **Caveat (important):** this was the built-in **plaintext deliverability probe**
    ("If you received it, delivery works"), NOT the branded/authentic outreach email.
    It proves the pipeline + From + provider acceptance; it does **not** validate the
    branded HTML shell or the authentic voice in a real inbox.
  - Isolated test lead left in prod: `lead_8-92-bi301` (source "Internal test") — safe to delete.
  - **Still to verify by a human (inbox side — I have no inbox access):** delivered to
    inbox not spam; reply from Gmail lands in the `hello@` M365 inbox; reply from `hello@`
    stays in-thread (References/In-Reply-To); sequence stop / lead-state change. And a
    **branded** test (the real outreach email, not the probe) if you want the shell/voice
    confirmed in-inbox.

---

## How to use this log

- Use the Founder OS for **every** Artifex engagement. Do not bypass it (Stage 1).
- The moment you reach for another tool — a doc, a spreadsheet, a note app — **stop and
  record why here.** That reach is the most valuable signal in the whole process.
- Log the small stuff. "I couldn't find the evidence for this recommendation in under
  10 seconds" is exactly the kind of friction that decides the roadmap.
- Review this log only when deciding what (if anything) to change. Do not fix single
  entries reactively.

---

## Per-engagement record

Copy this block per engagement.

```
### Engagement: <business name>  ·  <date started>

Stage reached: Discovery / Meeting / Reasoning / Roadmap / Implementation / Outcome / Partnership

Friction points (where the software got in the way):
- [ ] <what happened> · <which surface> · reached for another tool? (y/n, what)

Timing (Stage 3 — only if actually measured, never estimated):
- Time to prepare the Business Technology Review: __
- Time from discovery meeting to proposal: __
- Time to update the roadmap: __
- Time to complete an outcome review: __

Consultant feedback (Stage 5):
- What confused me: __
- What felt unnecessary: __
- What created trust / felt magical: __

Client feedback (Stage 5):
- What confused the client: __
- What built the client's trust: __

Outcome delivered to client:
- BTR delivered? (y/n)  ·  Living proposal used? (y/n)  ·  Outcome review completed? (y/n)
```

---

## Cross-engagement pattern board

Promote a friction point here only once it appears in **≥2** engagements. This is the
actual, reality-fed backlog. It starts empty by design.

| Pattern (repeated across N engagements) | Engagements | Severity | Can it be solved in the current architecture? |
|---|---|---|---|
| _(none yet — fills from real use)_ | | | |

- If **yes** (solvable in the current architecture): it's a normal, evidence-justified
  improvement. Fix it, measure that the friction is gone.
- If **no** (a recurring problem the architecture genuinely cannot absorb): that — and
  only that — is the trigger for **Version 2.0** work. Interesting ideas are not.

---

## v1.0 launch checklist (Stage 6 — leave RC status only when ALL are true)

- [ ] Founder OS used across **multiple** real consulting engagements (not simulations).
- [ ] Business Technology Reviews **delivered to real clients**.
- [ ] Living proposals have **guided real implementations**.
- [ ] Outcome reviews **completed** on delivered work.
- [ ] No **major** workflow change emerges from repeated customer feedback.
- [ ] The software feels **boring** — reliable, predictable, invisible.

When every box is checked and the pattern board holds no unaddressed cross-engagement
friction, promote RC1 → **v1.0**. Until then, it stays RC1, honestly.
