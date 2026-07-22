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

## Phase III — Discovery Workspace + Mission Brief (built this phase)

- **Discovery Mission Brief** — `src/lib/outreach/mission-brief.ts` → `buildMissionBrief`.
  A deterministic, voice-clean one-pager: executive summary, meeting goal (never
  "sell"), a natural recommended opening, five discovery questions that build,
  assumptions-to-avoid (what we DON'T know, deduped + cleaned of analyst language),
  likely priorities with confidence (only where observations support them), and a
  "if we leave today knowing ___, then this was a success" criterion. Rendered by
  `MissionBriefCard` at the top of the Discovery Workspace — quiet, one-page,
  printable. Tested (answers the seven questions, names what it doesn't know,
  confidence-bounded priorities, passes the voice engine).

- **Discovery Workspace** — `/leads/[id]/discovery` now leads with the Mission
  Brief, above the existing company summary, opportunities, maturity, growth, root
  constraints, evolution preview, discovery questions, hypotheses-to-validate, and
  notes. The `prepare-discovery` Next Best Action already routes here once a
  meeting is booked, so it becomes the primary surface after a booking.

**Still to build (architected above, unchanged):** the live Meeting Workspace
(lightweight notes/decisions/actions/parking-lot — extend `ConversationMode`),
Relationship Memory (the structured knowledge model in §8/§9 that discovery
updates rather than isolated notes), the auto-drafted Proposal (§10), and the
Conversation-Capture provider interface (§8) for Fathom/Fireflies/Teams/Zoom/Meet
that feeds Relationship Memory rather than dumping raw transcripts.

## Phase IV — Live consulting layer (built this phase)

- **Consulting read** — `src/lib/outreach/consulting-read.ts` → `buildConsultingRead`.
  Judgment, not data: exactly **three things that matter** (start from trust; is the
  top friction deliberate or evolved; relationships likely matter more than tech),
  the **biggest unknown** to validate early (one sentence), the **meeting objective**
  (one calm sentence, never "sell"), and the **one risk** worth naming ("talking
  about solutions before you understand their priorities"). Deterministic, voice-
  clean, tested. Rendered by `ConsultingReadCard` atop the Discovery Workspace,
  above the Mission Brief — the quiet co-pilot for the room.

### Relationship Memory + evolving timeline (architecture, next build)
Meeting notes should update **structured knowledge**, not become static text. Model:
`RelationshipMemory { decisionMaker; communicationStyle; goals[]; priorities[];
constraints[]; systems[]; importantDates[]; decisions[]; followupStyle;
openQuestions[] }`, stored per lead and **updated** (not replaced) after each
conversation. A `MemoryEvent { at; kind: "observed"|"verified"|"changed"|"resolved"|
"new-priority"|"decision"|"followup"; note; source }` stream becomes the relationship
*story* (extends the existing `collectTimeline`). Jordan never rediscovers the same
thing twice. Storage: additive `relationship_memory` (jsonb) + `memory_events`
tables; the meeting-workspace save action writes structured deltas, not free text.

### Opportunity lifecycle (architecture)
Every `ModernizationOpportunity` gains a `stage: "observed"|"validated"|"discussed"|
"accepted"|"implemented"|"measured"` (additive column, defaults "observed"). The
discovery/meeting workspace advances the stage; the operator sees at a glance where
each recommendation stands. Feeds the timeline and the proposal.

### Proposal intelligence (architecture)
`buildProposalDraft(lead)` assembles from accumulated knowledge — each recommendation
carries its provenance chain: **observation → validation (memory) → conversation
(memory event) → expected outcome (investment model)**. "Why are we recommending
this?" is answered from stored evidence, never invented. The Business Technology
Review pipeline already proves the render path; this adds the citation model so
nothing is retyped and every claim is grounded.

### Conversation capture (architecture — one interface, all providers)
`CaptureSource` provider interface (mirroring `EmailProvider`/`EnrichmentSource`):
Fathom / Fireflies / Teams / Zoom / Google Meet / voice memo / manual all normalize
to a `ConversationRecord { transcript?; summary; actionItems[]; decisions[];
openQuestions[]; concerns[]; opportunities[] }` that feeds **Relationship Memory** —
never provider-specific logic in the UI, never raw transcripts dumped on screen.

## Phase V — Relationship Memory (built this phase — the first PERSISTENT layer)

Real persistence, not a generator. Migration `0013` adds `relationship_memory`
(id, leadId, category, title, value, status, confidence, source,
supportingContext, operatorNotes, timestamps), with repo functions
(`memoryForLead`/`insertMemoryItem`/`updateMemoryItem`/`deleteMemoryItem`,
dual-backend), server actions (`src/lib/memory-actions.ts`), and a calm
knowledge-base UI (`RelationshipMemory`) on `/leads/[id]/relationship`.

- **Model** — 11 categories (Decision Makers, Business Goals, Current Priorities,
  Known Constraints, Existing Systems, Communication Style, Business Philosophy,
  Preferred Follow-up Style, Important Dates, Open Questions, Previous Decisions);
  each item is independently editable, never one summary blob.
- **Provenance + confidence** — every item carries a `source` (Discovery Meeting /
  Operator Note / Business Technology Review / Public Website / Email Conversation
  / Manual Confirmation) and `confidence` (High/Medium/Low). "Why do we believe
  this?" is always answerable.
- **Knowledge is earned** — nothing auto-promotes. A discovery starts **Proposed**;
  only an explicit **Manual Confirmation** starts Verified. The operator verifies,
  supersedes, or resolves by hand. (Tested: 6 cases incl. the no-auto-promote rule.)
- **Promote workflow** — a "Promote a discovery to memory" form turns a note into a
  structured, provenance-carrying item.

**Clearly still architected (NOT built this phase):** the live Meeting Workspace
(interactive notes → Review Queue → promote), memory *timeline event types*
(Memory Added/Verified/Updated/Resolved — the model exists; wiring into
`collectTimeline` is next), opportunity-stage persistence (needs a stage store),
`buildProposalDraft` (the memory model is now its foundation — recommendations can
cite verified memory items), and the capture-provider interface. These write into
Meeting Notes → Review Queue → Relationship Memory, never directly into memory.

## Phase VI — Live Meeting Workspace + memory detection (built this phase)

Relationship Memory (Phase V) is the foundation and is untouched. This phase makes
it come alive *during* the conversation.

- **Memory detection engine** — `src/lib/memory-detect.ts`. A small, honest
  extraction layer (NOT keyword matching): structured sentence patterns per concept
  — named tools after "we use/run/switched to" → Existing Systems; "the owner is X"
  / "X runs it" → Decision Makers; "we're trying to hire/grow/open…" → Business
  Goals; "we never … after 2pm" → Known Constraints; "we don't like subscriptions"
  → Business Philosophy; phone-first → Communication Style; dates/priorities too.
  **Every detection preserves the exact original quote** as evidence, dedupes by
  fact keeping the highest confidence, and returns the operator's natural concepts
  (People/Goals/Systems/Constraints/Preferences/Decisions/History/Questions).
  `missingConcepts()` powers the adaptive assistant. Deterministic, runs in the
  browser. Tested (12 cases incl. all five Phase VI examples + no-hallucination).

- **Live Meeting Workspace** — `/leads/[id]/meeting` + `LiveMeetingWorkspace`
  (client). A distraction-free notes surface (autofocus, browser auto-save so a
  refresh mid-call loses nothing) with a running meeting clock. As the operator
  types, detection surfaces candidate memories with **Approve / Edit / Dismiss** —
  edit the title/value/category/confidence before committing. A "Still worth
  learning" panel gently names concepts that haven't come up (never a script). An
  in-session conversation timeline records what was committed and when. The meeting
  objective (from the Phase IV consulting read) sits quietly in the corner.

- **Approve → memory** — `saveDetectedMemoryAction` reuses the Phase V persistence:
  an approved detection lands as **Proposed** (never auto-verified), source
  "Discovery Meeting", the original quote stored as `supportingContext`. Knowledge
  is still earned; the operator verifies it later on the Relationship tab. Wired
  from a new "Meeting" sub-nav tab and a "Start the live meeting" link on Discovery.

**Clearly still architected (NOT built this phase):**
- *Persistent conversation timeline* — the in-meeting timeline is session-only
  (in-memory). Persisting `memory_events` (Added/Verified/Updated/Resolved) and
  folding them into `collectTimeline` is the next storage step (model exists).
- *Memory-drives-everything* — verified memory does not yet bias downstream copy
  (e.g. "uses Square → never propose replacing without evidence"). The read path is
  in place; the generators don't consume memory yet.
- *Opportunity lifecycle persistence* (Observed→Validated→Accepted→Implemented→
  Measured) still needs a stage store.
- *Proposal intelligence* — `buildProposalDraft` citing verified memories remains
  architected; the memory model is its foundation.
- *Capture-provider interface* (Fathom/Fireflies/Teams) unchanged from Phase V —
  notes are typed by the operator; no transcript ingestion is fabricated.

## Phase VII — Relationship Reasoning (built this phase)

Memory stores facts; this phase *connects* them. A deterministic reasoning layer in
`src/lib/reasoning/` that never fabricates, never overstates, and cites its evidence
for every conclusion. `buildReasoning(memories, ctx, now)` returns the whole read.

- **Confidence engine** (`confidence.ts`) — measured, never invented. Score from
  five transparent factors (count · verification · operator confirmation · agreement ·
  recency), each explained in one line. A single unverified observation can never
  reach High. Superseded/Resolved memories stop supporting a claim. `now` is passed
  in for determinism.
- **Reasoning engine** (`engine.ts`) — pattern rules that fire only when the
  supporting memories exist (manual-scheduling, capacity-bound growth, integration-
  over-replacement, values-resist-recurring, relationships-carry-work). Every
  inference cites ≥2 memory ids; confidence is scored from that same evidence.
- **Business narrative** (`narrative.ts`) — a living account ("Over the last three
  conversations we've learned…"), eight sections (Current State / Goals / Constraints
  / Systems / People / Risks / Opportunities / Unknowns), each linking to its
  memories, naming gaps as Unknowns. Voice-clean (asserted against the voice engine).
- **Contradiction detection** (`contradiction.ts`) — flags opposite polarity on a
  shared topic (handles negated problems) and rival named decision-makers. Never
  auto-resolves; asks the operator which stands.
- **Opportunity graph** (`opportunity-graph.ts`) — cause→effect chains rooted in a
  grounded inference; downstream nodes marked "observed" vs "projected" honestly.
- **Relationship health** (`health.ts`) — seven evidence-explained milestones, no
  arbitrary scores.
- **Proposal intelligence** (`proposal.ts`) — `reasonedRecommendations` carry
  evidence, related inference, observed impact, expected outcome, dependencies,
  effort, and confidence.
- **Adaptive follow-up** (`follow-up.ts`) — natural, memory-grounded opening lines
  ("You mentioned…"), only from confirmed memory, never "our system detected".

- **Strategist surface** — `/leads/[id]/reasoning` + `StrategistView`. Renders the
  full read with an **EvidenceTrail** on every claim (open it to see the exact
  memories, when learned, who confirmed, confidence factors — click backward through
  the reasoning). Contradictions resolve inline via the existing
  `setMemoryStatusAction` (operator supersedes). New "Strategist" sub-nav tab.
  Tested: 24 cases (confidence bounds, no-evidence→no-inference, citation integrity,
  contradiction flag-not-resolve, voice-clean narrative, empty-business honesty).

**Clearly still future work (NOT built this phase):**
- *Reasoning → the actual proposal document* — `reasonedRecommendations` is the
  reasoning object; rendering it into the Business Technology Review PDF (with the
  citation chain) still reuses/extends the existing PDF pipeline and is not wired.
- *Follow-up references → the live email generator* — `memoryReferences` produces
  the grounded lines; they're surfaced on the Strategist page but not yet auto-woven
  into `content.ts`/the send pipeline.
- *Persisted reasoning history* — reasoning is recomputed per view (deterministic);
  a stored `memory_events`/inference-history stream (Phase VI item) is still pending.
- *Opportunity-stage persistence* — chain nodes are derived, not yet a stored
  lifecycle (Observed→…→Measured).

## The end-to-end spine
Lead → Review → Email (voice + quality gated) → Reply/stop → Booking → Discovery
(workspace + prep brief) → Conversation (capture) → Proposal (from captured
observations) → Partnership. Each step reuses the prior step's data; the operator
hits the marks, the system carries the craft.
