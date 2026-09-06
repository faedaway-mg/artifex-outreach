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
| Content Studio / Full Package (`/company/[leadId]`) | upload VO, generate, approve, share/download, nav | P (nav + scheduled card covered) | Upload/generate/share/download controls: unit-tested backend, no goal-driven UI journey |
| Activity | list, filters | — | No operator journey |
| Replies (`/meetings`, replies rows) | open reply, classify | — | No operator journey |
| Settings (`/settings`) | sending window, pause, calendar link | P (pause via safe-hold scripts) | Settings form controls untested via UI |
| Media previews / downloads | PDF view, video share, download | P | Blob/Web-Share paths unit-tested; not synthetic-user-driven |

## App-wide coverage summary
- **Scheduled: 100%** deterministic + goal-driven (this mandate).
- **Reject/Stop: complete** across surfaces (deterministic + unit, incl. concurrency).
- **Approve & schedule: strong** deterministic; **no** goal-driven synthetic user yet.
- **Remaining uncovered operator tasks (explicit):** Today tiles synthetic journey; Needs-Attention Hold/Flag;
  Blocked group expand/retry; Content Studio upload/generate/share/download goal-driven journey; Activity;
  Replies; Settings form; media download goal-driven paths.

The goal-driven synthetic-user layer (`scripts/breakbot-scheduled-goal.mjs`) is generic — its `chooseControl`
semantic discovery + per-goal understanding contract can be pointed at any of the above surfaces to close
these gaps in subsequent mandates. It is a heuristic semantic agent (no LLM); the `chooseControl(intent)`
seam is where an LLM planner drops in.
