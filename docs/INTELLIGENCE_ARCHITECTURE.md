# Artifex Business Intelligence Engine — Architecture

> The framework that makes every future source of business information contribute
> to one coherent understanding. Artifex thinks like an intelligent business
> technology consultant: every input answers **"How can this business operate
> better?"** — never "What can we sell?"
>
> Status: **architecture + working local implementation shipped. No external API
> is integrated yet** — providers are declared and stubbed, ready for adapters.
> All code lives in `src/lib/intelligence/`. 216 tests green, build green.

---

## 1. The pipeline

```
Lead Discovery
   ↓
Identity Resolution        ← (lead-facts provider; future: OpenCorporates/OSM)
   ↓
Business Enrichment        ← providers emit normalized Evidence
   ↓
Business Intelligence Engine   (engine.ts — owns understanding)
   ↓
Friction Analysis          ← friction-taxonomy.ts (classify observations)
   ↓
Opportunity Graph          ← opportunity-graph.ts (connect into a story)
   ↓
Technology Maturity        ← maturity.ts (repeatable benchmark)
   ↓
Business Technology Snapshot   ← snapshot.ts (PRESENTS the understanding)
   ↓
Business Improvement Potential ← improvement.ts (treatment + relationship value)
   ↓
Outreach Strategy          ← acquisition/sequences.ts (already live)
   ↓
Discovery Preparation      ← snapshot.conversationStrategy + operator-briefing.ts
   ↓
Business Evolution Plan     ← evolution.ts (immediate → near-term → future)
   ↓
Implementation
   ↓
Learning Engine            ← learning.ts (outcomes → priors → better recs)
```

**Key principle:** the **engine owns business understanding**; the Snapshot and the
Operator Briefing merely *present* it. Adding a data source never changes engine
behavior — it only adds Evidence.

`analyzeBusiness(input)` (`engine.ts`) runs the whole flow and returns a
`BusinessIntelligence` object containing evidence, friction domains, opportunity
graph, maturity, evolution, improvement, snapshot, and the operator briefing.

---

## 2. Subsystems

### 2.1 Evidence model (`evidence.ts`)
The single currency. Every provider emits `Evidence { providerId, kind, field,
value, statement, observationType, confidence, sourceUrl }`. The engine consumes
**only** normalized evidence and is blind to which provider produced it.
- `mergeEvidence()` — dedupes by field, higher confidence wins (provider order = trust order).
- `evidenceConfidenceScore()` — 0–100 overall confidence, rewarding breadth of evidence *kinds*.

### 2.2 Provider architecture (`providers.ts`)
`EnrichmentProvider { id, name, capability, ready(), enrich(input) }` + a registry.
- **Local adapters shipped (offline, $0):** `lead-facts` (Places-sourced fields we hold) and `findings` (website signals + findings → friction evidence). They prove the pipeline end-to-end with no network calls.
- **Planned providers declared, `ready()===false`:** OpenStreetMap, OpenCorporates, tech-detection, review-intelligence, Foursquare, search-enrichment. `enrich()` skips them until an adapter + credentials land.
- `enrich(input)` runs all *ready* providers concurrently and collects results; a provider that throws degrades to `ok:false` and is skipped.

### 2.3 Friction taxonomy (`friction-taxonomy.ts`)
17 standardized domains (Customer Acquisition → Information Visibility). Each entry is
a small knowledge base: description, symptoms, likely impact, root causes, discovery
questions, implementation approaches, base priority, and classification keywords.
`classify(text, findingCategory)` maps any observation to one or more domains.
Extensible: add an entry and the whole pipeline picks it up.

### 2.4 Opportunity graph (`opportunity-graph.ts`)
Turns independent friction into a connected causal story via a canonical causal
model between domains. Computes **root causes**, **downstream effects**, a readable
**story** (`journey → conversion → follow-up → visibility → reporting → growth`), and
the **highest-leverage intervention** — the smallest fix that resolves the most
downstream issues. This is what prevents disconnected project lists.

### 2.5 Technology maturity (`maturity.ts`)
10 dimensions, human-language levels **Emerging → Developing → Established → Advanced
→ Strategic**. Each dimension reports current level, confidence, evidence,
improvement potential (0–100), and a concrete next step. Built to power **quarterly
re-assessments** for long-term clients — the same input shape produces comparable
results over time.

### 2.6 Business evolution (`evolution.ts`)
Projects the improvement arc: **immediate** (the graph's high-leverage fix),
**near-term** (its downstream effects), **future** (growth/scale/innovation).
Produces dependencies and a dependency-respecting `recommendedSequence`, plus a
plain-language narrative. Each step is optional and justified by the previous one.

### 2.7 Learning engine (`learning.ts`)
Data structures + scoring pathways only (no ML). Captures `FrictionOutcome`,
`RecommendationOutcome`, `EngagementOutcome`. Aggregates into `DomainPrior`
(confirmation rate, success rate, sample size) per (industry, domain).
`adjustConfidence(base, industry, domain)` biases future recommendation confidence
toward what we've actually observed — capped at 50% influence, neutral with no data.
`LearningStore` is an interface; the in-memory implementation can be swapped for a
Postgres-backed one without touching the engine.

### 2.8 Operator briefing (`operator-briefing.ts`)
The one-screen decision surface: why it matters, strongest opportunities, greatest
uncertainty, best outreach angle, top discovery questions, likely priorities,
maturity, improvement potential + treatment, recommended engagement, relationship
potential, risks, and the single next action. Reduces cognitive load to one glance.

---

## 3. How future APIs plug in

1. Write an adapter implementing `EnrichmentProvider` that maps the API's raw
   response to `Evidence[]` (normalize to standard `field` names).
2. `registerProvider(myProvider)` (or add to a startup list). Gate `ready()` on the
   credential/env being present so it stays inert until configured.
3. Done. The engine consumes the new evidence automatically — no engine, snapshot,
   scoring, or UI change required. Higher-confidence evidence supersedes lower on
   merge; new evidence *kinds* raise the overall confidence score.

No provider ever calls into the engine; data flows one way (provider → evidence →
engine). This is the invariant that keeps the system coherent as sources multiply.

---

## 4. What to build next (recommended order)

1. **Persist `BusinessIntelligence`** (additive schema) + surface the Operator
   Briefing on the lead page. *Highest operator value; unlocks everything visible.*
2. **Tech-detection provider** (e.g. inspect site HTML/headers) — cheap, no paid
   API, directly enriches Integration/Automation maturity, which are currently
   "Unknown" from outside. **Best ROI.**
3. **OpenStreetMap / Nominatim** — free, improves Identity Resolution & geo/service
   area. Zero cost, low risk.
4. **Review-intelligence** over existing review data — turns reputation into
   friction evidence (response latency, complaint themes). High signal, no new
   vendor if reviews are already fetched.
5. **OpenCorporates** — entity status/age for credibility & ability-to-invest.
   Free tier; good for hard-override quality.
6. **Foursquare / search-enrichment** — later; incremental signal, added cost.

## 5. ROI summary

| Addition | Cost | Effort | Return |
|---|---|---|---|
| Persist BI + operator briefing UI | $0 | Med | **Very high** — makes the whole engine usable |
| Tech-detection provider | $0 | Low | **High** — fills the biggest evidence gap (integration/automation) |
| OpenStreetMap | $0 | Low | Medium — identity/geo confidence |
| Review-intelligence | $0* | Med | High — reputation → friction |
| OpenCorporates | $0* | Low | Medium — credibility / override quality |
| Foursquare / search | $ | Med | Low–Med — incremental |

\*free tier / already-held data.

**Do first:** persist + surface (so humans see it), then the tech-detection provider
(so the engine stops guessing on the dimensions it currently can't observe).
