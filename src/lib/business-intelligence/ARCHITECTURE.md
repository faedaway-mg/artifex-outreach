# Business Intelligence Engine — Architecture

The Business Intelligence Engine turns everything the system observes about a
business into **one structured, confidence-scored profile** — the single source
of truth consumed by the Conversation Engine, the Business Technology Review PDF,
investment recommendations, the partnership roadmap, the CRM, and follow-ups.

It is an **organizer, not a re-analyzer.** It reads analysis the intelligence
engine already produced (presence detection, normalized Evidence, technology
maturity, improvement potential) and arranges it into four dimensions plus
categorized opportunities. No raw analysis is duplicated here.

---

## Two invariants

1. **Determinism.** Every function is pure — no clocks, no randomness, no I/O.
   The same inputs produce byte-identical output. `generatedAt` is always `null`
   until a caller stamps it when persisting. Enforced by `determinism.test.ts`.

2. **No fabrication.** A reading exists only when something real supports it.
   Every `SignalReading` and every `ModernizationOpportunity` carries a non-empty
   `basis` (its provenance). `reading()` throws if constructed without one. When a
   thing is expected but not observable (e.g. page speed with no speed signal, or
   review recency with no dates), the engine either stays silent or emits an
   explicit `Unknown` reading — it never guesses. Enforced by
   `no-fabrication.test.ts`.

---

## Data flow

```
ProfileInput ─► buildContext() ─► ProfileContext
  { lead, presence?,               { lead, presence, evidence(index),
    evidence?, websiteSignals?,       websiteSignals, maturity, improvement }
    maturity?, improvement? }
                                        │
        ┌───────────────────────────────┼──────────────────────────────┐
        ▼                                ▼                              ▼
  ALL_SIGNALS (registry)          OPPORTUNITY_RULES (registry)    executive summary
  each ProfileSignal.evaluate()   each rule.evaluate(ctx,readings)  (deterministic)
        │                                │
        ▼                                ▼
  SignalReading[] per dimension    ModernizationOpportunity[]
        │                                │
        └──────────────► buildBusinessProfile() ◄────────────────┘
                                   │
                                   ▼
                            BusinessProfile
        (dimensions, strengths, opportunities, headline,
         executiveSummary, evidenceConfidence, conversationInput,
         provenance, coverage)
```

`buildBusinessProfile()` is called once inside `analyzeBusiness()`
(`src/lib/intelligence/engine.ts`) and attached to `BusinessIntelligence.businessProfile`,
which is persisted as JSON and read by every downstream consumer.

---

## The four dimensions

Each dimension is a group of **signals**. A signal reads the context and returns a
`SignalReading` (status + summary + confidence + basis) or `null` when it has
nothing to say.

| Dimension | Signals |
|---|---|
| **Digital Presence** | website quality, mobile friendliness, page speed *(when measurable)*, navigation quality, contact friction, booking friction, accessibility |
| **Discovery** | Google Business completeness, SEO strength, local visibility, directory consistency, social completeness, content activity |
| **Customer Experience** | first impression, trust signals, review quality, review recency, response activity, calls-to-action, ease of contact |
| **Operations** *(inference)* | multiple locations, appointment workflow, hiring activity, technology maturity, operational maturity, communication maturity |

Operations signals are explicitly **inferences** — the inside of a business can't
be seen from outside — so each carries honest confidence and, where the
intelligence engine already produced a Technology Maturity assessment, **reuses
it** rather than re-deriving.

### Reading status → health

`strong (1.0) · adequate (0.66) · weak (0.33) · absent (0) · unknown (excluded)`

A dimension score is the mean health of its *measurable* readings (unknowns don't
drag it down); `null` when nothing was measurable.

---

## Confidence

Every reading and inference carries **both a label and a 0..1 score**
(`confidence.ts`, one canonical mapping):

| Label | Score | Meaning |
|---|---|---|
| Observed | 0.95 | Directly seen in public data |
| Reported | 0.70 | Asserted by a third party (e.g. a review theme) |
| Likely | 0.60 | Strong inference from converging signals |
| Inferred | 0.40 | Plausible, not established |
| Unknown | 0.15 | Expected but not determinable — never a guess |

Dimension-level confidence aggregates by **mean score**, snapped to the nearest
*strength tier* (`Reported` is excluded from aggregates — it's a provenance
nuance, not a tier).

---

## Modernization opportunities

Instead of generic advice, opportunities are **classified** into ten categories:
Customer Acquisition, Customer Retention, Scheduling, Communication, Automation,
Reporting, Operations, Brand Experience, Analytics, Internal Workflow.

Each is produced by a modular `OpportunityRule` that reads the readings and emits
at most one opportunity with `{ observation, whyItMatters, estimatedImpact
(level + rationale), confidence, basis }`. Opportunities are ordered
strongest-first (impact → confidence → id). A rule never invents a gap; it only
promotes a reading that was itself built from real evidence.

---

## Extensibility — add a signal without rewriting anything

The registries are the only thing to touch:

1. **New signal:** write a `ProfileSignal` in the right `signals/*.ts` module and
   add it to that dimension's array. Return `null` when there's no basis. Done —
   the assembler, scoring, coverage, and UI pick it up automatically.
2. **New opportunity:** write an `OpportunityRule` in `opportunities.ts` and add
   it to `OPPORTUNITY_RULES`. Pick a category from `OPPORTUNITY_CATEGORIES`.
3. **New category:** add it to `OPPORTUNITY_CATEGORIES` in `types.ts`.
4. **New evidence source:** nothing here changes — a new intelligence provider
   emits normalized `Evidence`, and any signal that reads its field benefits.

No hard-coded per-business branching lives in the engine; behavior is driven by
signals over normalized evidence and presence.

---

## Consuming the profile (single source of truth)

Consumers read the profile through pure projections in `adapters.ts` rather than
re-analyzing a business:

- **Conversation Engine** — `openingFromProfile(profile)` builds the call opening
  from `profile.conversationInput` (one analytical source for the opening).
- **Business Technology Review PDF / Investment model** —
  `toDeliverableOpportunities(profile)` projects into the
  `DeliverableContent["opportunities"]` shape those systems already price on.
- **Operator briefing / CRM summary** — `toExecutiveDigest(profile)`.

Adding a consumer means adding a projection here — the analysis stays in one place.

---

## Files

```
business-intelligence/
  types.ts          — dimensions, statuses, categories, all interfaces
  confidence.ts     — the one label⇄score mapping + aggregation
  context.ts        — buildContext() + the guarded reading() constructor
  signals/
    digital-presence.ts, discovery.ts, customer-experience.ts, operations.ts
    index.ts        — SIGNALS_BY_DIMENSION + ALL_SIGNALS (the registry)
  opportunities.ts  — OPPORTUNITY_RULES + deriveOpportunities()
  profile.ts        — buildBusinessProfile() (assembler + executive summary)
  adapters.ts       — projections for conversation / PDF / investment / CRM
  index.ts          — public surface
  fixtures.ts       — diverse business types shared by tests
  *.test.ts         — confidence, signals, opportunities, profile,
                      determinism, no-fabrication, engine-integration
```

## Testing

`npx vitest run src/lib/business-intelligence` covers registry integrity, every
signal's honesty (absence handling, "when measurable" gating, inference
confidence), opportunity categorization and ordering, profile assembly and
adapters, **determinism** (identical + order-independent output), and
**no-fabrication** (provenance on everything, no invented capabilities).
