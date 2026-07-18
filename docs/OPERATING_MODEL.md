# Artifex Labs — Operating Model & Acquisition Playbook

> The foundation for closer / acquisition-operator training. This is the internal
> source of truth for how Artifex positions itself, qualifies leads, reaches out,
> runs discovery, prices work, and preserves trust.

---

## 1. Who we are

**Artifex Labs is a Business Technology Partner.** Tagline: *Find the friction. Build what compounds.*

We help good businesses become exceptional by finding and eliminating friction
through better technology, systems, and implementation. We begin with the
**business**, not with a website, app, automation, dashboard, or predetermined
service.

**Core promise:** Artifex helps businesses identify where technology can create the
most value, then designs and implements those improvements over time.

**Human interpretation:** We become the trusted technology partner a business can
call when something is inefficient, outdated, disconnected, hard to manage, or
ready to evolve.

## 2. The friction-finder mindset

We look for lost time, repetitive work, unnecessary complexity, revenue leakage,
weak customer journeys, poor conversion paths, disconnected tools, manual
administrative burden, delayed communication, missing visibility, scaling
constraints, outdated experiences, good ideas never implemented, and technology
that forces the business to adapt to *it* instead of the reverse.

The preferred recommendation is **the smallest, highest-impact improvement** that
meaningfully advances the business — including recommending a simpler existing
product, a process change, or *no new software at all* when that is better.

## 3. What we sell / what we don't

**We sell outcomes** (implementation methods vary): Customer Growth & Experience,
Operational Efficiency, Business Visibility & Decision-Making, Connected Systems,
Digital Products & New Ideas, Continuous Modernization. See `src/lib/positioning.ts`
(`OUTCOME_AREAS`).

**We are NOT** an AI agency, a website agency, an app shop, an automation agency, an
outsourced IT help desk, a generic digital-transformation consultancy, or a company
that sells a menu of disconnected services. We never lead with "we build websites,
apps, and automations," and never open cold outreach with "your website is bad."

**Customer-facing language policy:** lead with outcomes, craftsmanship, intelligent
analysis, adaptive systems, and better business performance. AI is at most a ~5%
footnote — never the pitch.

## 4. How the analysis system works

For each lead the system builds a **Business Technology Snapshot**
(`src/lib/snapshot.ts`) from publicly observable information only:

- **A. Business context** — industry, likely customers, service area, stage, reputation, visible channels.
- **B. Observed strengths** — always acknowledge what's working (never predatory).
- **C/D. Visible friction + hedged impact** — every item tagged with an observation type and confidence; impact is always hedged ("may…").
- **E. Hypotheses to validate** — what we suspect but cannot know from outside.
- **F. Discovery questions** — business-specific where evidence allows.
- **G. Opportunity areas** — possibilities, NOT prescriptions.
- **H. Confidence & evidence** — sources + a 0–100 confidence score; thin evidence is flagged.
- **I. Recommended outreach angle** — the strongest, most honest opener.
- **J. Human conversation strategy** — best opening, what to validate first, what NOT to assume, likely priorities, objections, signs of broader opportunity, goal of the first call.

### Evidence discipline (non-negotiable)

Every observation is one of: **Directly observed fact / Strong inference / Possible
opportunity / Open discovery question**. Only *directly-observed facts* are
`safeForOutreach`. Inferences are held for discovery and never stated to a prospect
as fact.

## 5. How lead qualification works

**Business Improvement Potential** (`src/lib/improvement.ts`) replaces the old
"can they buy an ~$8,000 website?" question. Website quality is **one signal**,
weighted at ~8% — a poor site alone does not make a lead valuable, and an acceptable
site does not disqualify a business with real operational opportunity.

Dimensions: business health, active demand, technology friction, operational
complexity, growth signals, customer experience, decision-maker access, ability to
invest, phasing potential, recurring potential, evidence confidence.

**Hard overrides → Do Not Contact:** closed/inactive business, suppressed/opted-out
contact, no reliable contact route, no credible evidence of activity.

**Treatment categories** (`positioning.ts`): Strategic Partnership Prospect,
Focused Improvement Prospect, Discovery-First Prospect, Nurture, Low-Confidence
Research, Do Not Contact. These sit over the underlying acquisition strategies
(Personal / Assisted / Light / Nurture / Manual Review / Do Not Contact), which
control automation & spend.

## 6. How outreach is selected

Outreach earns a **conversation**, not a sale. Copy (`src/lib/acquisition/sequences.ts`,
mock generators in `providers/ai.ts`) is: respectful, specific, curious, humble,
concise, evidence-based, low-pressure, and never prescriptive before discovery.

The opener is chosen from the lead's strongest observable angle (operational
complexity, multi-location, customer-journey friction, growth readiness, or — if no
strong signal — a humble "compare notes" opener). Every message acknowledges that
**public information shows only part of the picture**, keeps hard max touches, and
carries an `{{unsubscribe}}` token + postal address.

## 7. How videos are used

Video is reserved for high-value / high-fit leads with strong visual evidence. Format
is a 3–4 minute **outside-in Business Technology Snapshot**: personal intro → what
appears to be working → what we observed → why it may matter → what we can't see →
two or three tailored questions → invitation. It must never feel like a disguised
website sales pitch. Lower-priority leads get a concise written snapshot instead.

## 8. How discovery is conducted

The system prepares a personalized call brief; the closer does **not** recite the
external analysis — it exists to help them ask better questions. Confirm what's
working, how customers discover/evaluate/contact/buy/schedule, where time is lost,
which tasks repeat, where tools don't connect, what's still manual, what's been
postponed, what breaks as they grow, and whether there's a product idea.

## 9. How commercial models are chosen

Three engagement models (`src/lib/pricing.ts`):

| Model | Billing | Range | When |
|---|---|---|---|
| **Focused Improvement** | one-time | ~$1,000–$3,000 | A tightly scoped, high-impact fix. |
| **Phased Modernization** | monthly | ~$2,000–$4,000/mo | Connected improvements over 3–6 months against a roadmap. |
| **Ongoing Technology Partnership** | monthly | ~$1,000–$4,000/mo | Continuous prioritization, implementation, guidance. |

Pipeline tracks **relationship value** (entry / 3-month / 6-month / 12-month,
confidence-adjusted) and partnership likelihood — not a uniform one-time project.
A retainer is a defined amount of **implementation capacity**, never unlimited labor
(`RETAINER_BOUNDARIES`). The system may recommend a focused fix, phased engagement,
ongoing partnership, paid diagnostic, prototype, referral, nurture, or **no
engagement**.

## 10. What humans own vs. what the system owns

**System:** research, initial analysis, evidence gathering, scoring, opportunity
synthesis, drafting, personalization, video structure, follow-up drafting, meeting
prep, summarization, CRM updates, roadmap/proposal drafting, monitoring, suppression,
next-step recommendations.

**Human:** review evidence, detect weak assumptions, approve strategy, understand
the business, build trust, ask intelligent questions, prioritize, negotiate, close,
protect the client from unnecessary work, and verify that implemented changes
genuinely help. The human may always reject the system's strategy.

## 11. How to detect a poor system recommendation

Red flags: an observation stated as fact when confidence is Unknown; a retainer
pushed at a clearly one-off lead; a big build recommended before discovery; website
friction driving the whole case; outreach angle that ignores the evidence; a
relationship value that assumes internal facts we can't see. When in doubt, downgrade
to Discovery-First and ask questions.

## 12. How we preserve trust

Never invent facts, present inference as certainty, claim access to private data,
shame a prospect, manufacture urgency, promise guaranteed revenue, recommend
unnecessary custom development, ignore existing tools, contact the suppressed,
duplicate outreach, continue sequences after a meaningful reply, hide uncertainty
from the operator, or inflate pipeline. Always: preserve evidence, show confidence,
separate observation from hypothesis, keep opt-out easy, log overrides, and measure
whether the work actually helped.

## 13. How the engagement becomes a partnership

Start with the smallest useful improvement, deliver it well, and earn the next one.
The initial visible issue is usually only the beginning of the diagnosis — a website
concern reveals broken intake; scheduling friction reveals a disconnected workflow;
a reporting gap reveals a missing dashboard; a founder's idea becomes a phased
product. Success is measured by outcomes delivered and trust retained over time.
