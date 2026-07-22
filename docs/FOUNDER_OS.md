# Founder Operating System — architecture

The goal: guide Jordan from the first business identified through a trusted client
relationship, every interaction reflecting Artifex craftsmanship. This documents
what's built and the architecture for what's next. Nothing here optimizes for
volume or spam tactics — only thoughtful relationship building.

---

## Built this phase (production, tested, deployed)

### 1. Artifex Voice engine — `src/lib/outreach/voice-engine.ts`
A reusable voice layer, not templates. Encodes the nine principles (founder-
written, humble, observant, calm, specific, conversational, respectful, curious,
confident-without-ego) and the tells that make writing feel automated
(`our analysis…`, `our platform…`, `leverage`, hype, robotic transitions,
manufactured urgency, exclamation marks) on top of the approved `BANNED_PHRASES`.
`voiceViolations(text)` / `isCleanVoice(text)` are the gate; `readingSeconds`,
`sentenceStats`, `hasFounderSignals` are shared measures. **Every generated email
passes through this layer** (asserted in tests). Follow-ups, discovery summaries,
and proposal copy inherit the same layer.

### 2. Communication Quality Scoring — `src/lib/outreach/quality.ts`
`scoreEmailQuality(email, ctx)` returns eight human dimensions — Founder
Authenticity, Specificity, Curiosity, Professionalism, Personalization, Clarity,
Reading Time, Respectfulness — each a 1–5 read with one plain sentence, plus
reading time, a 0–100 composite, `whyItWorks`, and concrete `suggestedEdits`.
Deterministic; replaces technical confidence with a read on the writing.

### 5. Approval experience — `EmailQualityPanel`
The Review & Send screen now leads with "Would I send this?" — the quality panel
above the letter, so Jordan judges representativeness in seconds. No LLM/impl
details exposed.

Phases 3 (reading optimization → ~30s) and 4 (personalization → 2–3 grounded
observations, "one thing that stood out") were largely completed in the prior
humanization pass and are now enforced/measured by the voice + quality layers.

---

## Architecture for the next slices (designed, not yet built)

### 6. Discovery Workspace — `/leads/[id]/discovery` (enhance existing route)
A single surface a booked lead flips into. Data already exists in the repo;
compose it: business overview (`BusinessProfile`), full interaction timeline
(`collectTimeline`), email history (`email_sends`/`inbound_messages`), review
highlights + website observations (`profile.opportunities`/`strengths`),
recommended topics + discovery questions (`kit.discovery`), potential
implementation paths (`profile.evolution`), personal + meeting notes
(`meetings.notes`), follow-up tasks (`tasks`). No new data model — an aggregation
view + a notes/tasks editor.

### 7. Discovery Preparation Brief — `buildPrepBrief(lead, profile, kit, interactions)`
A deterministic one-printable-page briefing generated before every scheduled
conversation, answering: who is this company · why we reached out · what resonated
(engagement signals from the ledger) · the observations that matter most · what to
ask first (`kit.discovery.questions[0..2]`) · what not to assume (`conversation
avoid` + "could be wrong") · what success looks like. Renders to the existing PDF
pipeline (`src/lib/pdf`) for a clean printable page. **High-value, bounded — the
recommended next build.**

### 8. Conversation Capture — interface, not transcription
Define `ConversationRecord { source: "teams"|"fathom"|"fireflies"|"manual";
transcript; summary; actionItems[]; decisions[]; openQuestions[]; concerns[];
opportunities[] }` and a `CaptureSource` provider interface (mirroring the existing
`EnrichmentSource`/`EmailProvider` seams). A webhook route per integration
(`/api/webhooks/{fathom|fireflies}`) ingests into the lead's permanent
relationship history. Build the interface + storage now; wire a real provider when
credentials exist. Never fabricate a transcript.

### 9. Learning System — anonymous outcome metrics
Aggregate from the existing ledger + inbound + meetings: open rate, reply rate,
positive-reply rate, booked conversations, closed partnerships — keyed by
communication *pattern* (presence profile, opener variant, observation category),
never by tactics. A `communication_outcomes` rollup feeds a "what's resonating"
read that biases the voice engine's opener selection over time. Optimize for
thoughtful relationship building, not send volume.

### 10. Proposal Foundation — observations flow through
The data already lines up: outreach/discovery `ModernizationOpportunity[]` +
`investmentModel` (effort → deliverables → outcome, already reconciled) →
recommendations → phased roadmap (`profile.evolution`) → proposal draft
(`deliverables`). The design goal is that nothing is retyped: a `buildProposalDraft`
that reads the captured observations + discovery notes and assembles the draft the
operator edits — the Business Technology Review already proves this pipeline.

---

## The end-to-end spine
Lead → Review → Email (voice + quality gated) → Reply/stop → Booking → Discovery
(workspace + prep brief) → Conversation (capture) → Proposal (from captured
observations) → Partnership. Each step reuses the prior step's data; the operator
hits the marks, the system carries the craft.
