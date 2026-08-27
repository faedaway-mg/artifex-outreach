# Quick Review — Editorial Quality Gate · Checkpoint (Milestone 1)

## SHAs / branch
- Start: `61e5732` (rc/m1-plus-pagination, = deployed prod f96acc27)
- End:   `19789ad`  Branch: `feat/quick-review-editorial`  Worktree: `~/artifex-outreach-qr`
- Not pushed, not merged, not deployed. Protected M1.1 WIP (main worktree) untouched.

## Root cause of the All About Smiles redundancy (combination — mostly generation)
1. `openingHook()` returned `TOPIC_HOOK[topic](…)` — the **same string** a finding uses for its
   textHook → the masthead hook was a verbatim copy of Finding 02 ("563+ customers…").
2. `startHere().why` embedded the top finding's `whyItMatters` verbatim → "Where we'd start"
   restated Finding 01.
3. `industryLabel = deslug(industry)` → "Dentist" (no friendly-category map).
4. Template: "4.8 / 5" wrapped; a redundant "Proof ·" line repeated the evidence; small screenshot.
Only EXACT duplicate *titles* were previously checked, so this passed.

## What shipped this milestone (Phases 1, 2, 4 + partial 6)
- **Generation fix:** `TOPIC_OPENING` synthesizing hooks (never a finding's hook; regression-guarded
  so no opening collides with its topic's hook); `startHere.why` is pure prioritization;
  `friendlyCategory()` ("dentist"→"Dental practice").
- **Editorial-quality detector** `src/lib/outreach/editorial-quality.ts` — deterministic, pure.
- **Wired** into `buildQuickReview`: blocking redundancy sets `ready=false` (delivery-ready must be
  editorially ready, not merely rendered).
- **Template:** "4.8/5" one non-breaking token; removed the redundant start "Proof ·" line;
  `railShot` enlarged (132→176).

## Detector design + thresholds (Sørensen–Dice on ENTITY-MASKED tokens + asymmetric containment)
- Masking: numbers, business-name tokens, and domain labels are removed before comparison, so shared
  metrics/name/domain NEVER false-block. Stopwords removed. Roles within one finding are never compared.
- Codes & severities: `exact-repeat`(block), `hook-copies-finding`(block, sim ≥ **0.85**),
  `duplicate-title`(block, ≥ **0.80**), `restated-body`/`recommendation-restates-finding`
  (block, Dice ≥ **0.70** OR containment ≥ **0.85**), `similar-body`(warn, ≥ **0.55**),
  `repeated-evidence`(warn), `placeholder-language`(block, true stubs only).
- `checkReview()` / `editorialBlocks()` are the public entry points.

## Schema / migration / state-machine changes
- **None** this milestone. No DB migration. The DRAFT→OPERATOR_REVIEW→EDITORIAL_CHECK→
  APPROVED_PRIVATE→DELIVERY_READY state machine is **deferred to Milestone 2** (below).

## Tests + visual verification
- Full suite **151 files / 1569 tests green**. New: `editorial-quality.test.ts` (9, incl. the real
  All About Smiles original→detected and revised→passes, shared-entity no-false-block) + opening-hook
  regression guard (1). Updated 2 obsolete opening-hook assertions + 1 send-workflow fixture that
  lazily reused one `whyItMatters` (the gate correctly flagged it).
- Rendered the real All About Smiles PDF (`/tmp/aas-review.pdf`) and inspected it: distinct hook,
  "DENTAL PRACTICE", no restatement, no Proof line, "4.8/5" unwrapped, no clipping.

## Remaining limitations → Milestone 2 (operator editing layer)
The generation fix removes the observed defect at the source, and the detector is enforced. Still to build:
1. **Operator editing overlay** (Phase 3): a per-lead `review_editorial` overlay (presentation copy
   overrides kept SEPARATE from evidence) applied in `buildQuickReview`; Save Draft / Preview /
   Approve; unsaved-change indication; audit of who/what/when/from-what.
2. **Targeted regeneration** (Phase 3): propose a replacement for ONE section; show before accept;
   never overwrite until accepted; audit request/proposal/accept/reject.
3. **State machine + versioning** (Phase 5): the DRAFT→…→DELIVERY_READY states; post-approval edits
   invalidate the prior approval; stale previews cannot be delivered.
4. **Apply the operator's exact All About Smiles copy** (finding titles/bodies + start title) via the
   overlay — the current generated copy is clean and non-redundant but is not yet the operator's
   authored wording.
5. Remaining Phase-6 tests (editing creates a version + audit; evidence cannot be silently altered;
   regeneration needs acceptance; post-approval invalidation; stale-preview; override-with-reason).

## Exact next operator action
Review branch `feat/quick-review-editorial` (`19789ad`). Nothing is deployed. To apply the exact
All About Smiles wording and give operators in-app editing, proceed to Milestone 2 (operator editing
overlay). No email/contact was sent; autosend remains OFF.
