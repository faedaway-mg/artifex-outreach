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

- **Gate 5 (weekday scheduler + shared cap + pause) DONE + TESTED.** `outreach-scheduler.ts`
  (`runScheduledOutreach`): processes candidate leadIds in order; at the dispatch boundary for EACH it
  (1) checks pause-all (`QR_OUTREACH_PAUSED=1`), (2) re-counts the shared **20/LA-day** cap from the
  `email_sends` ledger (`countSentToday()`, so follow-ups + manual + automated all draw the same pool;
  re-counted before every dispatch so a burst/concurrent tick can't exceed it), (3) enforces the
  **weekday 08:00–10:00** window in the recipient's tz (LA fallback when tz unknown; no weekend/
  afternoon/overnight; no catch-up burst), (4) calls `authorizeForSend`, (5) re-verifies via
  `authorizationValidForDispatch` (deterministic fingerprint), then hands the **exact authorized PDF
  bytes** to an INJECTED transport. Cap-accounting tz = America/Los_Angeles. Pure helpers
  (`laDayKey`, `withinMorningWindow`, `recipientWindowTz`, `outreachPaused`) unit-tested.
- **Gate 6 (deliverable queue depth) MEASURED (read-only, real DB).** Full active pool = **96** real
  leads; **30** are content-SENDABLE under the one-finding policy, but **20** SENDABLE have no valid
  email and **0** are suppressed → **10 currently DELIVERABLE** (content-eligible + valid email + not
  suppressed). That 10 is the honest first-batch size; the scheduler re-authorizes every candidate
  live at each tick, so the count drifting between now and launch cannot produce an unsafe send.
- **Gate 7 (non-delivering dry run) DONE.** `outreach-scheduler.test.ts` (10 tests, all green) drives
  the full path with a NON-DELIVERING transport (pushes to `dispatched[]`, never a provider): strong
  one-finding → sent; policy-off → held(disabled); weekend + afternoon → outside-window; **20-cap**
  (base 19 → exactly 1 sent, 2 quota-reached); pause-all → paused; suppressed + held → both held;
  ambiguous provider response → slot RETAINED, NOT counted sent (no double-send); idempotency (second
  tick at cap → no resend). Zero real emails.
- **Gate 8 (reply / reminder / sender readiness) VERIFIED (read-only).** Reply capture + follow-up
  STOP + suppression already exist and are launch-critical-satisfied (`comms/reply.ts`; reply-to =
  hello@artifexlabs.tech → Outlook MX). **Sender auth (DNS):** SPF includes outlook + amazonses;
  DKIM (Resend selector) present; DMARC `p=quarantine` (relaxed); MX → Outlook. Final Resend-dashboard
  "verified" is a pre-launch console check. **One-hour reminder = the single NARROWLY-BLOCKED item:**
  it needs a signal that Jordan replied from Outlook (Resend handles OUTBOUND; the inbound webhook
  captures INBOUND to hello@; detecting Jordan's own SENT reply is not confirmed available). Proposed
  substitute: cancel the reminder on an explicit operator "handled" action instead of sent-items
  polling. Nothing else blocks launch.

### DURABLE LOCATIONS (Gate 8)
- Code (git-backed @ `cc0edb3`): `src/lib/outreach/{outreach-scheduler,review-send-policy,
  review-revisions,review-evidence}.ts` + their `.test.ts`.
- Read-only harnesses: `scripts/{diagnose-yield,eval-generation,queue-accounting,morning-queue}.ts`.
- **NOT git-backed (gitignored):** generated PDFs and `docs/artifacts/quick-review-m2/**` manifests —
  they are reproducible from the deterministic builder, not durable artifacts. Do not treat their
  presence as evidence of a send.

---

## LAUNCH-VERIFICATION + EMAIL-FIRST/CTA PASS (this session)

Deep verification (4 read-only investigations) corrected several claims and drove real fixes. All
below is committed and tested; nothing deployed; autosend OFF.

### VERIFIED RUNTIME FACTS (corrections to the prior package)
- **The scheduler is NOT wired to any runner.** `railway.json` = ONE web service (`node server.js`,
  replicas 1). The only recurring runner is `railway-functions/daily-prospecting.mjs`
  (cron `30 12,13,17,20,23 * * *` UTC) which calls `/api/cron/materialize` + `/api/cron/prospect`
  ONLY. A separate `/api/cron/send` (→ `runDueSends`, gated by `COMMS_AUTOSEND_ENABLED`, window
  08:00–17:00 LA, NO cap) exists but the cron does NOT call it. `runScheduledOutreach` has ZERO
  production callers. → Activation REQUIRES new wiring + a deploy (enumerated in the package).
- **The daily cap was NOT concurrency-safe** (plain read-then-send; two ticks could both pass).
  The ledger's unique idempotency key only prevents duplicate SAME-step sends.
- **Pause was env-only** (`QR_OUTREACH_PAUSED`) → a Railway env change needs a redeploy (NOT instant).
- **Recipient-local scheduling is dormant**: no per-lead timezone is stored (`inferZone` is derive-
  only, never wired to the scheduler) → the active schedule is Mon–Fri 08:00–10:00 **America/Los_
  Angeles for every recipient**. DST is correct (Intl, not offset math).
- **Provider/reply infra confirmed**: Resend; From/Reply-To `hello@artifexlabs.tech` (reply-to = from,
  → M365 inbox); List-Unsubscribe + one-click + CAN-SPAM footer with physical address; signed inbound
  webhook (`/api/webhooks/inbound`, Svix, `RESEND_WEBHOOK_SECRET`) → classify → stop-sequence +
  suppress, idempotent by provider event id. **One-hour reminder does NOT exist** (only a UI meetings
  filter). Provider **permitted-use** for cold prospecting is a Resend-policy + console check (NOT
  established by DNS/public-email alone) — a pre-launch operator action.

### FIXES LANDED + TESTED
- **Atomic shared daily cap** (`comms/send-quota.ts`, commit `1d070e0`). `reserveDailySlot()`
  serializes count+insert per LA day behind a Postgres **advisory lock** over the SHARED `email_sends`
  ledger (follow-ups + manual + automated draw one pool). Idempotent per (lead, day). release /
  consume / countSlotsUsed. **Real-Postgres concurrency tests** (`send-quota.db.integration.test.ts`,
  7): 2 workers racing final slot → exactly 1; 12 racing cap-5 → exactly 5; crash-after-reserve holds
  1; LA-day boundary correct. Scheduler rewired to reserve→send→consume|release; ambiguous RETAINS
  the slot; `already-sent` idempotency skip (no double-send). 12 mock scheduler tests.
- **DB-backed runtime pause** (`outreach-pause.ts`). `setOutreachPaused` (audited) is observed on the
  NEXT tick with NO redeploy; env `QR_OUTREACH_PAUSED` kept as a secondary control. Scheduler pause is
  async + fresh each tick. Tested both paths.
- **Clickable PDF CTA + aligned email + artifact integrity** (commit `114da6f`). Real `<Link>`
  annotation "Book a conversation" → canonical `settings.calendarLink` (defaults/heals to
  `ARTIFEX_IDENTITY.bookingUrl = https://cal.com/artifex-labs-ob2qbv/30min`, HTTP 200 verified) +
  email-thread reply fallback (no mailto). The email offers the SAME destination (personal mode).
  `TEMPLATE_VERSION qr-m2-1 → qr-m3-cta-1` and the CTA URL folded into `revisionFingerprint`: EVERY
  prior approval/authorization is invalidated, and any later destination change fails closed at
  dispatch. Tests: link annotation across 1/3-finding, long-name, operator-override, INSUFFICIENT-none;
  email/PDF alignment; CTA-in-fingerprint invalidation.
- **Email-first, calls-after-engagement** (`work-queue.callWithheld` + `call-priority.isEngaged`).
  The queue now SURFACES a call only after ENGAGEMENT (booked / in-conversation stage) — never cold,
  never off an unanswered email, never for a no-email lead, never for opt-out/lost. Numbers/history
  preserved; operator can still initiate a call by hand. No "call-to-obtain-email" task generator
  exists (confirmed). Tests: `email-first-policy.test.ts` (5) + updated call-priority/work-queue.

### DELIVERABLE COUNT (unchanged)
First-batch DELIVERABLE = **10** (content-SENDABLE + valid email + not suppressed), last measured
against the real 96-lead pool. The CTA/template/policy changes do NOT alter sendability or email
validity, so 10 stands; every one of the 10 now carries the booking CTA. The scheduler re-authorizes
each candidate live at dispatch, so drift cannot cause an unsafe send.

### NOT DONE THIS PASS (honest)
- **Nationwide discovery expansion** — discovery already rotates national metros via `geo-pools`, but
  a true nationwide crawl is a config + BUDGET decision the addendum says needs explicit authorization;
  NOT run. Email-required is already enforced on the send side (no valid email → not authorized).
- **Dashboard emphasis (metrics vs goal of 5)** — NOT built. Paying-client evidence would have to be
  operator-recorded/labeled-unavailable (no verified billing signal exists to count from).
- **Wiring `runScheduledOutreach` to a cron runner + a production transport that records to
  `email_sends`** — deploy-scope; enumerated in the activation package, not performed here.

### DURABLE LOCATIONS (updated)
- Git-backed @ current HEAD: `src/lib/comms/send-quota.ts` (+`.db.integration.test.ts`),
  `src/lib/outreach/{outreach-scheduler,outreach-pause,review-send-policy,review-revisions,
  review-evidence,quick-review,call-priority}.ts`, `src/lib/pdf/QuickReviewDocument.tsx`,
  `src/lib/outreach/email-render.ts`, `src/lib/work-queue.ts` + their tests.
- **NOT git-backed (gitignored):** generated PDFs / `docs/artifacts/**`. Reproducible, not evidence.

### Exact next action
Present the corrected multi-step activation package (deploy-disabled → verify runner → enable). Await
ONE explicit authorization. Nothing deployed; autosend OFF; no real sends.

---

## TRANSPORT / PROVIDER RESEARCH (this pass — research only, no code, no signup)

**Resend is CONFIRMED prohibited for cold outreach.** AUP fetched 2026-08-27: "prohibited from
sending unsolicited messages of any kind, including cold outreach, purchased lists, or scraped contact
data … all mail must be sent to recipients who have explicitly opted in." Keep Resend for its existing
TRANSACTIONAL uses (agreements/receipts); do NOT route cold prospecting through it.

**Key finding: NO mainstream provider gives explicit written permission for cold outreach.**
- Transactional ESPs (Resend, Amazon SES, and by extension SendGrid/Postmark/Mailgun) explicitly
  PROHIBIT unsolicited/cold email and suspend on it. Amazon SES: AWS AUP prohibits unsolicited mass
  email; SES is "for messages specifically requested by the recipient" (retrieved 2026-08-27). REJECT.
- Cold-email PLATFORMS (Instantly/Smartlead, $39–$97/mo + mailbox) send THROUGH your own M365/Google
  mailbox, so the SAME mailbox anti-spam terms apply — the tool's marketing grants no permission. They
  also introduce their OWN queue/scheduler (would OWN sending → our shared 20/day cap, pause,
  suppression, engagement rules, revision-bound authorization, and exact-authorized-PDF-bytes could no
  longer be enforced — the addendum forbids two schedulers) and per-recipient PDF attachments are not a
  core feature. REJECT for our architecture.
- Mailbox providers (Microsoft 365 / Google Workspace) prohibit "spam" = unsolicited BULK/commercial,
  enforced by COMPLAINT-RATE (<0.10% in 2026), engagement signals, and domain-age/ramp — NOT a
  categorical per-message ban. This is the operational channel the compliant low-volume B2B ecosystem
  uses. It is a COMPLIANCE-OBLIGATION channel, not an explicit blessing.

**RECOMMENDATION: send via the EXISTING Microsoft 365 mailbox (hello@artifexlabs.tech) through the
Microsoft Graph `sendMail` API**, behind the existing `EmailProvider` interface.
- Cost: **$0 additional** (mailbox already licensed; Graph included). ~20 emails/day ≈ 400/mo, far
  under limits (safe cold range 20–50/mailbox/day).
- Fit: Graph `sendMail` supports `fileAttachment` base64 (our PDF, exact bytes) + reply-to +
  List-Unsubscribe header — a 1:1 match to our `EmailMessage`. Replies land NATIVELY in Outlook.
- Preserves EVERYTHING: generator, PDF+CTA, scheduler, atomic quota, suppression, pause, audit,
  revision-bound authorization, and Resend (transactional). Only the TRANSPORT swaps — and because
  quota/pause/suppression live ABOVE the transport, they stay fully effective (the decisive reason to
  swap the transport, not adopt an external platform).
- Auth: OAuth 2.0 app (client-credentials) with `Mail.Send` APPLICATION permission scoped to the one
  mailbox via an Application Access Policy (Basic-Auth SMTP was deprecated 2026-03-01). Config by NAME:
  `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER`, `EMAIL_OUTREACH_PROVIDER`.

**Real tradeoffs to flag (Graph vs Resend webhooks):**
- Auto follow-up-STOP on reply currently rides the Resend inbound webhook; via Graph it needs a Graph
  change-notification SUBSCRIPTION on the inbox (small new integration) or an operator-driven stop —
  do NOT silently substitute a "handled" workflow without Jordan's decision.
- Bounces = NDR messages in the inbox (parse) — weaker than a structured webhook. Complaints have NO
  sender feedback-loop event on M365 → rely on one-click unsubscribe + manual/complaint suppression.
- Graph has NO native idempotency-key header (Resend does) and returns `202` with no body id → set a
  self-generated Message-Id header + read Sent Items to make an ambiguous 202 safe (confirm-before-
  retry). Our reservation + `email_sends` unique key already prevent ledger double-rows / cap breaches.
- Legacy `/api/cron/send` (`runDueSends`) has NO cap → cold outreach must flow ONLY through the capped
  scheduler; that legacy route must never carry cold sends.

**NOT legal clearance.** US cold B2B email must satisfy CAN-SPAM (accurate headers, non-deceptive
subject, valid physical postal address, honored opt-out ≤10 business days) — already implemented; any
non-US recipients invoke separate rules (CASL/GDPR). Jordan should confirm with counsel. Sources:
Resend AUP, AWS AUP + SES enforcement FAQ, Microsoft Anti-Spam Policy + Services Agreement (eff.
2026-09-30), Graph `sendMail` reference — all retrieved 2026-08-27.

**Decision for Jordan:** approve Microsoft 365 Graph as the outreach transport ($0 extra, sends as
hello@ from the mailbox we already own) + create the Entra app with `Mail.Send` scoped to hello@? No
adapter will be built until the provider + cost are approved. One-hour reminder REMAINS outstanding.

---

## RECONCILE + AUDIT + DEPLOY-BLOCKER PASS (this session — no code changed; no send)

**Production (verified read-only):** Railway project `artifex-outreach` / service `outreach-web` at
`https://outreach.artifexlabs.tech`. `/api/health` 200 (DB connected), `/login` 200. Deploy is run via
`pnpm deploy:production` from `~/artifex-outreach` (the LINKED worktree, branch
`restore/acq-os-morning-m1`) — NOT from this `~/artifex-outreach-qr` worktree (unlinked). No git remote.

**DEPLOYMENT IS BLOCKED (unsafe cross-session integration).** 8 active worktrees on divergent branches,
no integration branch:
- My `feat/quick-review-editorial` = `rc/m1-plus-pagination` + my 20 QR commits (superset of the RC).
- The DEPLOYED/linked branch `restore/acq-os-morning-m1` DIVERGES from mine: 2 commits are on it that
  are NOT in mine → deploying my branch would DROP them.
- `feat/acq-os-closing-m3` (Stripe/closing) is a separate line: 19 commits not in mine.
Deploying my isolated branch from another writer's linked worktree would drop deployed commits and
touch a live session's checkout. Per directive → STOP. Needs a human integration decision (merge my 20
QR commits into the release line + reconcile morning-m1's 2 + closing-m3), then deploy from
`~/artifex-outreach`. NOT a code problem.

**Prior-sends audit (prod `email_sends`, read-only, 2026-07-18 → 2026-08-14):** 23 messages; 22
submitted to Resend; **20 delivered**, **2 bounced**, **1 queued with NO provider id = UNKNOWN**
(submission unconfirmed — not proof of non-delivery; do NOT resend); 0 complaints; 0 inbound replies
captured; 0 suppressions. History is visible in-app via the per-lead conversation/relationship view.

**Automation state (verified in code):** the ONLY recurring runner (cron `daily-prospecting.mjs`)
calls `/api/cron/materialize` + `/api/cron/prospect` ONLY — never a send endpoint. `/api/cron/send`
(`runDueSends`) is unwired from cron AND gated by `COMMS_AUTOSEND_ENABLED`. `runScheduledOutreach`
remains unwired. The MANUAL path (`sendIntroductionAction`→`dispatchStep`) is NOT gated by any autosend
flag → manual send works with automation off; approval does NOT queue an automatic send. → automated
outbound is OFF by architecture; scheduler code preserved with no active outbound runner.

**Morning pool (read-only prod):** 107 leads / 104 active / 33 with valid email / 19 already emailed /
**14 active + valid-email + never-emailed** (first-touch pool, before content-quality + suppression
filters — actual ready drafts will be FEWER). Draft preparation is GATED on deployment (must run with
the deployed code, not undeployed local logic) — NOT performed this pass. Do not promise 20.

**Resend cold-outreach restriction STILL STANDS.** 20/day + manual clicking do NOT establish
permission. The deployed/undeployed manual workflow is READY as infrastructure, but is NOT "ready for
permitted cold outreach" through Resend — that remains blocked pending the M365-Graph transport
decision (above) and counsel.
