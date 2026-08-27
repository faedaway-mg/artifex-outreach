# Morning Readiness — Acquisition OS Restoration M1

Purpose: get the email-first + Quick-Review-video loop operable for the morning.
Diagnosis, fixes, and the exact operator sequence. **AUTOSEND stays OFF** — every
send is approved by the operator in the UI.

## What was actually wrong (evidence, not assumptions)

The system is healthy: 1556 tests green, production `outreach-web` ● Online, both
autosend gates OFF. The lead-supply problem had one root cause and one keystone:

- **Root cause — the email reservoir was never kept full.** 71% of leads were
  phone-only (63 of 89). The same-domain email-harvest mechanism *exists and works*
  (the one sweep that ever ran harvested **8 emails from 24 leads, ~40% yield**),
  but it stopped running.
- **Keystone — migration drift.** `business_intelligence.surface_package`
  (migration `0020`) is **not applied on production**. Any BI read/upsert hits that
  column, so `allBusinessIntelligence()` throws — which is exactly what the email-prep
  sweep (materialize cron) and the review-video surface persistence both call. One
  missing column silently disabled the whole reservoir.

Of the 63 email-less active leads: **20 have a website and were never analyzed**
(crawling should harvest ~8 emails), 22 were analyzed with no same-domain email
(phone-first is correct), 21 have no website (phone-first is correct). There is **no
quality problem** — the fix is to run the existing harvest, not to lower standards.

## Fixes delivered (branch `restore/acq-os-morning-m1`, all NEW files)

- `scripts/diag-email-supply.ts` — read-only Gate-1 email-supply funnel (works even
  before the migration; derives "analyzed" from the audit log).
- `scripts/enrich-email-reservoir.ts` — on-demand reservoir fill; reuses the tested
  `prepareEmailInventory` + `runWebsiteAnalysisAction`. Read-only crawl, no sends.
- `src/lib/review-video/capture-guard.ts` (+ test, 6 green) — pure white-strip guard
  for Gate 6 (detects a bottom band from capture dimensions → atmospheric cover-crop
  or `CAPTURE_BLOCKED`, so a broken video is never emitted).

Not committed (waiting on your go). The pre-existing review-video M1.1 WIP was left
untouched.

## Operator sequence (run in order)

All commands from `~/artifex-outreach`. Nothing here sends anything.

1. **Apply the keystone migration (production DB write — additive, reversible).**
   ```
   railway run pnpm db:migrate
   ```
   Adds the nullable `surface_package` column. Idempotent (drizzle tracks applied
   migrations). Rollback if ever needed:
   `ALTER TABLE business_intelligence DROP COLUMN surface_package;`

2. **Verify supply state (read-only).**
   ```
   pnpm exec tsx scripts/diag-email-supply.ts
   ```

3. **Fill the email reservoir now (read-only crawl, no sends).**
   ```
   pnpm exec tsx scripts/enrich-email-reservoir.ts            # dry-run: shows ~20 eligible
   pnpm exec tsx scripts/enrich-email-reservoir.ts --apply    # harvest (~8 new email-first)
   ```

4. **Recover stranded leads + surface the queue (read-only until --apply).**
   ```
   pnpm exec tsx scripts/replenish-queue.ts            # dry-run
   pnpm exec tsx scripts/replenish-queue.ts --apply    # materialize tasks for stranded leads
   pnpm exec tsx scripts/queue-accounting.ts           # confirm email/call/video surfacing
   ```

5. **Keep it filled automatically.** Set on the `outreach-web` service so the daily
   materialize cron runs the harvest going forward (read-only crawl, gated, capped):
   ```
   EMAIL_PREP_ENABLED=1
   EMAIL_PREP_MAX=32          # optional; default 32
   ```

6. **Quick Review videos (top-3).** In the review board, the candidates are ranked
   STRONG → READY; pick at most the strongest 3 (fewer if fewer genuinely pass — do
   not force three). Before enabling surface capture in the renderer, wire the guard:
   in `renderReviewVideoCore` (step 3, after the `magick -trim`), call
   `assessCapture(dims(png))` and, on `atmospheric-only`, use a cover-crop treatment;
   on `capture-blocked`, return `CAPTURE_BLOCKED` instead of emitting the video.

## Guardrails — must stay true

- **Do NOT set** `OUTREACH_SENDING_ENABLED` or `COMMS_AUTOSEND_ENABLED`. Every email
  is approved by the operator in the UI. Materialize ≠ send.
- The enrichment/discovery steps only crawl public pages and write contact data; they
  never contact anyone.
- Guessed emails are never marked verified; only same-domain published addresses are
  adopted as a send route.
