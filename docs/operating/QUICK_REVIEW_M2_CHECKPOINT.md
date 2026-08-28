# Quick Review M2 — Operator Editing / Version-Bound Approval · Checkpoint

**Verdict: PARTIAL — safety-critical core delivered and tested; named gaps remain (below). NOT full M2 acceptance.**

## SHAs / branch
- Start: `4c4502a` (M1). End: `b36dd8a`. Branch: `feat/quick-review-editorial` (worktree `~/artifex-outreach-qr`).
- Commits this milestone: `fc9965e` (core), `a9de22d` (artifact binding + send wiring), `b36dd8a` (server-actions + AAS rehearsal).
- Not pushed / merged / deployed. No production writes. Autosend OFF (unchanged).

## DELIVERED + TESTED (mock store / in-memory; 18 M2 tests, full suite 152 files / 1587 green)
- **Overlay** (`review-revisions.ts`): presentation-only overrides (hook, category, finding title/body/action/textHook, start). Evidence objects (URLs, basis, confidence, capture dates, observation) are NEVER editable — proven by test.
- **Revision fingerprint** = sha256(customer-facing surface + evidence digest + template version). Changes when copy OR evidence OR template changes.
- **Version-bound approval + readiness**: DELIVERY_READY requires eligibility, evidence satisfied, required fields, editorial pass, renderable, **preview of the current revision**, and **approval of the current revision** — all bound to one fingerprint. A later edit nulls preview + approval; readiness drops.
- **PDF-byte artifact binding (Gate 5)**: `sendGate()` renders the approved review, hashes the exact bytes into a manifest (revisionId + evidence digest + template version + pdfSha256), and re-verifies at the FINAL dispatch boundary. Wired into BOTH `send-actions` (operator) and `comms/dispatch` (send). Edited-but-unapproved / stale / template-drift / corrupted → whole send FAILS (never a bare email). Unedited reviews defer to the legacy gate unchanged (existing send tests green).
- **Evidence protection**: unsupported numeric claims and UNSCOPED absence claims block approval; supported numbers + crawl-scoped absence pass.
- **Targeted regeneration**: deterministic MOCK — propose-not-replace, shows current vs proposed, stale-base rejection, never injects an unsupported number, audited.
- **Audit**: every action (save/preview/check/approve/regen.*) appends to the established append-only audit log; actor is server-derived (`currentActor()`).
- **Server actions** (`review-editor-actions.ts`, `"use server"`): actor ALWAYS server-derived (never client-supplied); approval requires a signed-in operator.
- **All About Smiles rehearsal** (Gate 8, in-memory against the REAL record/evidence, no prod write): redundant draft blocked → operator copy applied via the editing path → checks pass → preview → test-operator approves → exact bytes bound → later edit invalidates approval AND old artifact rejected as stale. Durable artifacts in `docs/artifacts/quick-review-m2/` (final PDF, manifest, desktop + phone PNGs — visually inspected: operator copy applied, evidence lines preserved, "4.8/5" unwrapped, no clipping).

## HONEST LIMITS / OUTSTANDING (required by M2, NOT completed this turn)
1. **Atomic DB concurrency — NOT done.** The concurrency guard is an OPTIMISTIC read-then-write on `expectedBaseRevisionId`, proven only on the single-writer MOCK store. There is **no DB-level compare-and-set / row-lock / db-function**, and **no real-adapter integration test** (the only reachable DB is production, which is off-limits for test writes; no isolated test Postgres is provisioned). A concurrent multi-writer race on the real jsonb column is NOT yet protected. Recommended fix: a dedicated `review_revisions` table (or a CAS column) with a conditional UPDATE, delivered as a LOCAL migration + rollback; do not apply to prod.
2. **Evidence validation depth — PARTIAL.** Only numeric + absence-scope heuristics exist. Qualitative / comparative / customer-behavior / unsupported-outcome-promise claims are NOT yet validated. This is a keyword/number heuristic, **not comprehensive semantic validation** — unresolved qualitative edits should route to an explicit operator evidence-review step (not built).
3. **Operator editor UI — NOT built.** The server-action API is complete and the rendered PDF was visually inspected on desktop + phone widths, but the interactive React editor page and a live browser/mobile walkthrough were NOT built or run.
4. **Production regeneration adapter — NOT implemented.** Regeneration is MOCK only; live/paid generation was NOT executed or verified. Do not represent canned output as live generation.
5. **Audit durability — best-effort.** Audit events are appended after the state write; they are NOT transactionally coupled and there is NO outbox. No tamper-protection against a privileged database administrator.
6. **Some Gate 9 tests deferred**: real-DB simultaneous-save conflict, audit-failure-during-transition, template/visual-asset-change invalidation, HTTP-layer forged-actor. (Covered at the mock/logic level: post-approval invalidation, stale-artifact rejection, unauthorized approval, evidence-change-after-approval, blocked-cannot-bare-send.)

## Files changed
`src/lib/outreach/review-revisions.ts` (+ .test.ts), `review-editor-actions.ts`, `editorial-quality.ts` (surface: drop removed proof line), `comms/dispatch.ts` + `outreach/send-actions.ts` (send-gate wiring), `pdf/*` (M1), `scripts/rehearse-aas-m2.ts`, `vitest.config.ts` + `quick-review.test.ts` (render-timeout headroom). No schema/migration changes. No prod DB writes.

## Exact next action
Decide the persistence hardening: authorize a LOCAL `review_revisions` migration (with CAS + integration tests against an isolated test DB) for true atomic concurrency, then build the React editor page + browser/mobile walkthrough and the production regeneration adapter. Until then, M2 is functionally proven for a single-writer flow but NOT accepted for concurrent multi-writer production use. Nothing is deployed; autosend OFF.

---

## M2-SIMPLIFIED addendum (scope corrected: reliable generation + lightweight controls, NOT a full editor)

Full field-by-field editor DEFERRED (per scope correction). Backend revision/approval/artifact work preserved and reused.

### Gate 2 — generation quality (the priority): DONE, with real evidence
Harness `scripts/eval-generation.ts` ran the UNTOUCHED generator (no overlay, no per-prospect fixes)
across **20 diverse real records** (79 in the BI pool, 41 categories). Predefined criteria.
- **0 DEFECTS** — every review: coherent, opening hook DISTINCT from finding hooks/titles, no repeated
  sentences, evidence-scoped, renders clean. The M1/M2 safeguards generalize beyond All About Smiles.
- **11 PASS** (all `NEEDS_REVIEW`, 1 evidence-backed finding → operator-approvable) · **9 BLOCKED**
  (`INSUFFICIENT_EVIDENCE`, 0 findings → fail-closed, correct).
- **Systemic finding: the binding constraint is EVIDENCE DEPTH, not generator coherence.** Almost no
  lead yields ≥2 findings (AAS's 2-finding SENDABLE review is an outlier). Reviews fail CLOSED on thin
  evidence — no incoherent document ships. There is NO generator/template defect to fix.
- Visual: single-finding NEEDS_REVIEW PDFs inspected desktop + phone — clean layout, no clipping/overlap.
- Artifacts: `docs/artifacts/quick-review-m2/gen-eval/` (results.json, per-lead PDFs, desktop/phone PNGs).

### Gate 3/4 — lightweight controls
Backend for all four controls exists: preview (`recordPreview`), approve (`approveRevision`, version-bound),
regenerate (`propose/acceptRegeneration`, MOCK), skip/hold (`skipReview`/`revisitReview`, reason-required,
blocks the send gate). Server actions in `review-editor-actions.ts` (actor server-derived). **The React UI
page is still NOT built** — controls are API-complete and PDF-verified, but no interactive page / browser
walkthrough this turn.

### Still OUTSTANDING (unchanged from above, precise)
- Production regeneration adapter (MOCK only). · Real-DB atomic concurrency + isolated-test-DB integration
  (optimistic read-then-write on mock store only). · Legacy/unedited reviews still defer to the legacy gate
  (Gate 7 "universal enrollment" not applied — low practical risk since 0 reviews are auto-SENDABLE).
- Evidence validation depth (numbers + absence only; qualitative/comparative/outcome NOT validated).

### Next action
Given evidence depth (not coherence) is the constraint, the highest-leverage next step is upstream evidence
enrichment + the lightweight review UI so operators can approve/skip the NEEDS_REVIEW reviews. Real-DB
atomicity + production regeneration remain gated. Nothing deployed; autosend OFF.

---

## M2-SIMPLIFIED — completion pass (2026-08-27)

**Verdict: ACCEPTED for the simplified scope, with two named gates left open (live-provider regen quality;
UI live-browser visual). No production writes, no send, autosend OFF, nothing pushed/merged/deployed.**

Start `a586d87` → work is uncommitted in worktree `~/artifex-outreach-qr` (branch `feat/quick-review-editorial`).
Full editor stays DEFERRED. All prior M1/M2 backend work preserved.

### Delivered this pass
- **Gate 3 — Lightweight operator UI** (NEW files under `src/app/(app)/leads/[id]/operator-review/`): a
  page + client panel with exactly the four controls (Preview → opens `/api/quick-review/[id]/pdf` after
  recording the preview; Approve → version-bound, disabled until every readiness check passes; Regenerate
  → propose/accept a new draft via the adapter, never auto-approve; Skip/Hold → reason-required, excludes
  from delivery, Revisit to return). Reuses existing server actions; typecheck + lint clean; mobile-first.
- **Gate 6 — Real DB-level atomicity + transactional audit** (`commitReviewEditorial` in `repo.ts`;
  `review-revisions.ts` refactored so every mutation funnels through it): editorial state carries a
  monotonic `rev`; each write is a conditional `UPDATE … WHERE rev = <read>` (true CAS under the row lock),
  and the state write + its audit event commit in ONE transaction. **6 integration tests PASS on real
  Postgres** (concurrent→one wins; stale/duplicate→conflict; loser writes no audit; unrelated data preserved).
- **Gate 7 — Universal delivery protection** (`comms/dispatch.ts`): any review-bearing initial send whose
  PDF isn't attachable now FAILS CLOSED (legacy/unedited included) — no bare email in place of the review;
  internal-test exempt. **3 dispatch tests PASS**.
- **Gate 4 — Regeneration adapter** (`outreach/review-regen-provider.ts` on the `providers/ai.ts` infra):
  evidence-constrained, succeeded/failed states, server-authorized, audited with the ACTUAL provider (mock
  never mislabeled as live). Live/paid path code-complete but GATED behind `REGEN_LIVE_ENABLED=1`; **no spend
  this pass** → provider-tested = NO. **5 contract tests PASS**.
- **Gate 8 — E2E acceptance on real Postgres**: **5 tests PASS** (clean approve→bytes+manifest; blocked
  skip/hold; edit-invalidates-approval; concurrent-edit CAS; propose-not-replace).

### Test posture
- `npm test` (in-memory): **1595 passing**, the two `.db.integration` files SKIP by design. One known
  environmental flake — `quick-review.test.ts` "renders a valid PDF WITH an embedded data-URI logo" — a
  react-pdf render that times out only under heavy concurrent load; it PASSES in isolation (~36s).
- Real-Postgres integration: **11/11 PASS** (Gate 6 + Gate 8). Isolated test DB `artifex_outreach_test`;
  production never touched.

### Open gates (honest)
1. Live (paid) regeneration output quality — UNVERIFIED (no spend). Gate open behind `REGEN_LIVE_ENABLED=1`.
2. UI live-browser + real-device visual verification — NOT run (typecheck + lint clean; PDF artifacts were
   visually inspected in the earlier pass). Requires running app + operator session + browser tooling.
3. Evidence validation depth — numeric + absence-scope heuristics only (qualitative/comparative/outcome
   claims fail-closed at approval, not deep-semantically validated).

Artifacts: `docs/artifacts/quick-review-m2/m2-simplified-results.md` + `db-integration-results.txt`.

---

## SEND-READY YIELD DIAGNOSIS (Gates 5 + 6) — the readiness decision

Harness `scripts/diagnose-yield.ts` (read-only, no new collection) over the frozen 20-record batch.
Full data: `docs/artifacts/quick-review-m2/gen-eval/yield-diagnosis.json`.

### Gate 5 — the two-finding rule
- **Origin: a CODE HEURISTIC**, not an approved external policy. `reviewStatus()` (review-evidence.ts:314):
  `>=2 findings → SENDABLE · 1 → NEEDS_REVIEW · 0 → INSUFFICIENT`. The second finding adds no evidence
  guarantee — each finding is already independently evidence-gated by `isSendable()` (Observed/Reported
  confidence + non-empty basis + observable category + non-speculative).
- **Current vs proposed on the frozen batch** (proposed = a single Observed finding with score ≥ 0.45 qualifies):
  - CURRENT: 0 SENDABLE · 11 NEEDS_REVIEW · 9 INSUFFICIENT.
  - PROPOSED: **11 SENDABLE(1-strong)** · 9 INSUFFICIENT (unchanged).
  - The 11 are NOT weak: each has exactly ONE surviving finding at **Observed confidence, score 0.80–0.96**,
    held back ONLY by the ≥2 count. Qualifying them needs **no lowering of evidence standards and no padded
    second finding**. This is a POLICY decision for Jordan (auto-send eligibility stays OFF regardless).

### Gate 6 — evidence-depth root cause (per record, no new collection)
- **9 INSUFFICIENT**: genuinely thin — every opportunity was rejected because its confidence is INFERRED/Likely
  (not Observed/Reported) or the observation used hedging language. Correctly fails CLOSED. (7 "all-inferred
  confidence", 2 "speculative-language".)
- **11 NEEDS_REVIEW**: "only-one-defensible-issue (policy-threshold)" — a strong Observed finding exists; the
  other 3–5 opportunities are inferred → dropped → 1 survives.
- **Dominant rejection reason across the batch: 71 weak-confidence** (BI engine emits most opportunities at
  INFERRED confidence) + 3 speculative-language. So ≥2 findings is rarely met because the engine rarely
  produces ≥2 OBSERVED opportunities — an EXTRACTION/enrichment depth limit, not a generator-coherence defect.
- **Fixable from existing evidence?** Not by relabeling (that would lower standards — the inferred labels are
  by design). Real lift requires better OBSERVATION EXTRACTION/scoping upstream (proposed new work: state the
  missing data + cost; NOT executed here). "Not observed" is correctly distinguished from "does not exist".

### Readiness decision
Generation is SAFE and coherent (0 defects/20). Zero auto-SENDABLE is explained by (a) a ≥2-finding HEURISTIC
that holds back 11 single-strong-finding reviews, and (b) genuinely inferred evidence on the other 9. A future
controlled auto-send milestone is viable IF Jordan (1) approves the one-strong-finding policy (no rigor lost),
and/or (2) authorizes upstream extraction improvements to raise Observed-opportunity depth. Until then, the
correct operator model is the lightweight preview→approve/skip flow over the 11 NEEDS_REVIEW reviews.

### Build gates still OUTSTANDING (honest, unchanged)
- Interactive UI page (backend/API complete; page not built). · Real-DB atomicity + transactional audit
  (local Postgres IS available at /opt/homebrew — initdb/pg_ctl; NOT yet provisioned/migrated/tested this turn).
  · Universal legacy enrollment (Gate 4). · Production regeneration adapter (mock only; also note: generation is
  largely DETERMINISTIC, so "regenerate" on identical inputs is not a correction mechanism — a genuine
  correction path needs changed inputs or a provider adapter).

---

## SINGLE-WRITER INTEGRATION → LAUNCH (this pass)

- **Gate 1 (handoff) DONE.** Parallel session committed its work at `cb56676` (lightweight
  OperatorReviewPanel UI, real-DB CAS `commitReviewEditorial`, regen provider adapter, universal
  dispatch protection, 2 DB integration tests). Verified it: provisioned an isolated local Postgres
  (initdb/pg_ctl, socket+TCP 55432, throwaway) and ran the **11/11 real-DB integration tests green**
  (incl. the concurrency race — exactly one of two edits lands). Base for launch = `d322559` (adds a
  render-timeout bump). I am sole writer.
- **Gate 2 (one-finding policy) DONE + VALIDATED.** `reviewStatus`: a single **Observed + High/
  Foundational** finding → SENDABLE (explicit, evidence-grounded — NOT the 0.45 cutoff). Threaded
  `impactLevel` through `ReviewFinding`. Frozen batch under the live policy: **11 SENDABLE / 0
  NEEDS_REVIEW / 9 INSUFFICIENT** (the 9 correctly fail closed). SENDABLE = content eligibility only.
- **Gate 3 (test failures) RESOLVED CORRECTLY (investigated, not blanket-rewritten).** dispatch
  Gate-7: fixture made genuinely INSUFFICIENT so the never-bare-send block is still exercised. Video:
  "thin" fixture → Observed+Moderate → stays NEEDS_REVIEW; **video eligibility unchanged**. Added
  explicit regressions (strong→SENDABLE, Moderate/Reported→NEEDS_REVIEW). Full suite 154/1604 green.
- **Gate 4 (automated authorization) DONE.** `review-send-policy.ts`: `authorizeForSend` records a
  DISTINCT authorization (type policy|operator) bound to revision + evidence digest + PDF sha256 +
  recipient + campaign, only when every gate passes (content-SENDABLE or version-bound approval,
  editorial/render/artifact, valid+unsuppressed recipient, not held); audited; OFF unless
  `QR_AUTOSEND_ENABLED=1`. `authorizationValidForDispatch` re-verifies via the deterministic revision
  fingerprint (drift → fail closed). 7 tests.

### OUTSTANDING toward the dry run + activation (Gates 5–10) — NOT built this pass
- **Gate 5 scheduler/quota**: weekday 08:00–10:00 (recipient tz; fallback America/Los_Angeles;
  cap-accounting tz America/Los_Angeles), **20/weekday** total, atomic quota reservation across
  workers, staggered, persisted, no weekend/catch-up burst, pause-all at the dispatch boundary.
- **Gate 6/7 suppression + reply/reminder**: much EXISTS (suppression re-check at dispatch, dedup,
  reply capture, follow-up stop). Needs: verify sender SPF/DKIM/DMARC (read-only), one-hour reminder
  logic, inbox integration confirmation. NOT yet verified/built this pass.
- **Gate 8 queue replenishment**, **Gate 9 non-delivering dry run**, **Gate 10 activation package**.

### Exact next action
Build Gate 5 (scheduler + atomic quota + pause-all) wiring `authorizeForSend` → a persisted daily
queue, then the non-delivering dry run (Gate 9). Activation package (Gate 10) is NOT ready until the
scheduler + dry run pass. Nothing deployed; autosend OFF; no real sends.
