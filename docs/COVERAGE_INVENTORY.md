# Acquisition OS — Operator Coverage Inventory (Mandate 22)

Honest inventory of operator-visible routes and interactive controls, with test coverage status. This is
the app-wide coverage mechanism the mandate requires: it makes every untested operator action explicit so
later mandates can close the gaps systematically. **This mandate brings the Scheduled workflow to 100%
(deterministic + goal-driven synthetic user).** Other surfaces are reported truthfully, including gaps.

Legend: **D** = deterministic Playwright coverage · **S** = goal-driven synthetic-user coverage ·
**U** = unit/focused test coverage · **—** = not covered · **P** = partial.

## Scheduled workflow — 100% (this mandate)
Registry: `src/lib/breakbot/scheduled-manifest.ts` (CI fails if a Scheduled control lacks an action ID).
Deterministic: `scripts/breakbot-scheduled-journey.mjs` (42/42 × 3 widths). Synthetic: `scripts/breakbot-scheduled-goal.mjs` (12/12 × 3 widths). Unit: `scheduled-detail.test.ts`, `scheduled-manifest.test.ts`.

| Action | D | S | U |
|---|---|---|---|
| open scheduled queue · count==list | ✓ | ✓ | ✓ |
| open company (package-aware) | ✓ | ✓ | ✓ |
| inspect email / PDF / video by type | ✓ | ✓ | ✓ |
| next / previous (real ordering) | ✓ | ✓ | — |
| edge disabling (first/last) | ✓ | ✓ | — |
| close / back to list | ✓ | ✓ | — |
| refresh preserves context | ✓ | — | ✓ (URL carries `?from`) |
| invalid binding → Needs Attention + not dispatch-eligible | ✓ | ✓ | ✓ |
| cancel-reject → zero mutation | ✓ | — | ✓ |
| reject/stop → void binding + neighbor recompute | ✓ | ✓ | ✓ |
| no dead/inert controls | ✓ | — | ✓ (manifest dead-registration test) |
| switch queue filter | ✓ | ✓ | — |

## Reject / Stop-future-outreach (Mandate 21/21B) — covered
Deterministic `breakbot-reject-journey.mjs` (60/60 × 3 widths); unit `rejection.test.ts` (11) incl. 20-way
concurrency, cross-instance, restart-retry, idempotent cancel, zero-provider.

## Other surfaces — current status and GAPS (to close in later mandates)

| Route / surface | Controls | Coverage | Gap |
|---|---|---|---|
| Today (`/`) | count tiles, focus queue entry | P (D via approve/scheduled journeys enter here) | No dedicated Today synthetic journey; tile→queue links only partially asserted |
| Ready to Approve (`/queue/ready`, ReadyApproveCard) | Approve & schedule, Reject, PDF/video links, open full package | D (approve-commit 51/51; reject) | No goal-driven synthetic user for approve; PDF/video link targets not deep-verified |
| Needs Attention (`/queue/attention`, AttentionCard) | Hold, Flag, Reject | P (reject only) | Hold/Flag actions lack deterministic+synthetic postcondition coverage |
| Needs Evidence / Blocked (`/blocked`) | expand group, Reject per company | P (reject control present) | Group expand + retry semantics untested |
| Rendering (`/queue/rendering`) | row → company, Reject | P | Render lifecycle transitions not journey-covered |
| Content Studio / Full Package + media (`/company/[leadId]`, operator-video route) | canonical preview, player Close/Back/Escape/focus, hash-download, upload→render→ready, missing-artifact, cross-surface equality | ✅ 100% (mandate 23) | — deterministic media journey 48/48 + goal-driven 18/18 × 3 widths; studio-manifest CI enforcement; current-video unit tests |
| Activity | list, filters | — | No operator journey |
| Replies (`/meetings`, replies rows) | open reply, classify | — | No operator journey |
| Settings (`/settings`) | sending window, pause, calendar link | P (pause via safe-hold scripts) | Settings form controls untested via UI |
| Media previews / downloads | PDF view, video share, download | P | Blob/Web-Share paths unit-tested; not synthetic-user-driven |

## Content Studio — two-tab videos + expand-and-personalize (mandate 25)

| Route / surface | Controls | Coverage | Evidence |
|---|---|---|---|
| Content Studio tabs (`/content-studio?type=proposal\|content`) | switch tab, per-group sections, select card, inspect quality, resolve-ambiguous indicator, Back/refresh, empty state | ✅ 100% | deterministic videos journey 57/57 + goal-driven 27/27 × 3 widths; server-level fixtures acceptance; studio-manifest CI (17 new controls, dead-registration guard) |
| Proposal workspace | grouped by canonical prospect state (needs-narration/rendering/needs-attention/ready/scheduled/sent); quality badge + reasons; word count + duration; next action | ✅ 100% | `video-workspace` + `studio-workspaces` unit tests; live journey counts==lists |
| Content workspace | grouped by content lifecycle; structurally barred from outreach | ✅ 100% | `assertNoContentInOutreach` (unit) + goal-driven "content can't enter outreach" (live) |
| Expand-and-personalize | analyze → expand (evidence-grounded) → compare → edit → regenerate → accept (new revision, audio/render outdated) → cancel (no mutation) | ✅ 100% | `narration-expansion` + `narration-revision` unit tests; deterministic + goal-driven journeys × 3 widths |
| Narration quality + similarity + unsupported-claims | evaluator badges/reasons; cross-company similarity; unsupported-claim refusal | ✅ 100% | `narration-quality` + `proposal-audit` unit tests; live similarity + accept-refusal |
| CONTENT outreach bar | a content/unclassified video can never become a package video | ✅ 100% | `outreach-content-bar` seam test + workspace split guard |

## Content Studio — mobile full-page workspaces + truthful narration actions (mandate 26)

| Route / surface | Controls | Coverage | Evidence |
|---|---|---|---|
| Dedicated workspace (`/content-studio/[purpose]/[leadId]?from=`) | tap-through from the tab, Back to originating tab, Prev/Next across the tab, deep-link + refresh | ✅ 100% | deterministic mobile journey (43/43 × 3 widths) + goal-driven (27/27 × 3 widths); focus-mode strips the bottom nav; no horizontal overflow asserted |
| Genuine regeneration | Regenerate returns a distinct evidence-grounded variant; no-safe-alternative reported honestly | ✅ 100% | `narration-expansion` variants unit tests; `mandate26-narration-acceptance` route test; live "regenerate changed" at 3 widths |
| Truthful state-specific actions | editable draft → Accept (approved draft re-opens); FROZEN/SCHEDULED/SENT → Create improved version (fork), no failing Accept shown | ✅ 100% | `narration-revision` permissions/fork tests; route test (accept refused 409 on SCHEDULED, fork preserves package digest); live fork at 3 widths |
| Fork safety | fork never mutates the frozen package/binding; double-tap idempotent | ✅ 100% | route test asserts package version+digest+state unchanged after fork; `sameNarration` idempotency test |
| Discovery targeting (Discover → next markets) | read-only "why this smaller market" panel | ✅ | `market-policy` tests (10); discovery sample script; goal-driven "review next market" at 3 widths |

## Discovery market policy (mandate 26 §4)
Canonical versioned policy `src/lib/market-policy.ts` (Census-sourced populations): excludes 22 major metros, targets secondary/tertiary markets (city ~40k–250k / metro ~100k–750k), regional diversity + market/category cooldown ledger. Wired into `prospecting.ts` territory selection. Unit tests `market-policy.test.ts` (10); read-only sample `scripts/mandate26-discovery-sample.ts` (100% secondary/tertiary, 6 regions, 0 provider calls).

## App-wide coverage summary
- **Scheduled: 100%** deterministic + goal-driven (mandate 22).
- **Content Studio / media: 100%** deterministic + goal-driven (mandate 23) — canonical preview, player
  Close/Back/Escape/focus, hash-verified download, upload→render→ready via fake worker, missing-artifact,
  cross-surface artifact equality; enforced by studio-manifest CI.
- **Content Studio two-tab videos + expand-and-personalize: 100%** deterministic (57/57) + goal-driven
  (27/27) × 3 widths (mandate 25) — Proposal/Content tabs, canonical grouping, quality evaluator,
  expand→compare→edit→regenerate→accept revision (audio/render safety), frozen immutability, CONTENT
  outreach bar; enforced by studio-manifest CI + server-level fixtures acceptance.
- **Reject/Stop: complete** across surfaces (deterministic + unit, incl. concurrency).
- **Approve & schedule: strong** deterministic; **no** goal-driven synthetic user yet.
- **Remaining uncovered operator tasks (explicit) — next bounded surfaces:** Needs-Attention (Hold/Flag +
  Morris VIDEO_FOLLOW_UP); Today tiles synthetic journey; Blocked group expand/retry; Activity; Replies;
  Settings form.

The goal-driven synthetic-user layer (`scripts/breakbot-scheduled-goal.mjs`) is generic — its `chooseControl`
semantic discovery + per-goal understanding contract can be pointed at any of the above surfaces to close
these gaps in subsequent mandates. It is a heuristic semantic agent (no LLM); the `chooseControl(intent)`
seam is where an LLM planner drops in.
