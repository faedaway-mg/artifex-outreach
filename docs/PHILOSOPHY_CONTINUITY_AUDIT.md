# Philosophy Continuity Audit — Acquisition OS

**Date:** 2026-07-24 · **Standard:** [ES-009 — Philosophy Continuity & Surface Integrity](~/.claude/docs/engineering-standards/ES-009-philosophy-continuity-and-surface-integrity.md) · **Scope:** the operator's core journey

**Governing philosophy:** *One decision. One action. Next business.* The software should disappear until the operator feels they are simply talking to businesses while the product quietly handles everything else. This audit scores the **transitions**, not the screens — drift lives at the seams.

**Surface types (ES-009):** `WORK` (one decision, everything supports it, reference collapses) · `REFERENCE` (answers questions, entered intentionally, carries a return-to-work path) · `MIXED` = design defect.

---

## The journey

```
Today ──▶ Batch runner ──▶ [per-kind action] ──▶ Decision ──▶ Done ──▶ Next business
                                     │
                     understand·call·video (inline)   email·follow-up (EmailDecision)
                     report ▶ Review (ref+return)      send ▶ Send page
                     discovery ▶ Conversation
                                     │
                         Lead page (entered for depth)
```

## Per-transition scorecard (D1 · D2)

| # | Transition | Surface (B) | Preserves state? | Notes |
|---|-----------|-------------|------------------|-------|
| 1 | Today → Batch runner | WORK | ✅ | 2 taps; batch is fixed to its run; one decision = "which batch." |
| 2 | Runner → **email/follow-up** (`EmailDecision`) | WORK | ✅ | Summary-first, sticky approve, auto-advance. The exemplar. |
| 3 | Runner → **call** | WORK | ✅ | Inline opener + first question + `tel:` link. No eject. |
| 4 | Runner → **video** | WORK | ✅ | Inline script; record on phone; stays in loop. |
| 5 | Runner → **understand** | WORK | ✅ *(fixed 07-24)* | Was: ejected to the 15-panel lead page as its *primary* action. Now: concise brief is the work, depth is secondary, "Done — next" carries forward. |
| 6 | Runner → **report** → Review | REFERENCE + return | ✅ *(fixed 07-24)* | A consulting document can't live in a card. Now carries the batch's next stop; Review shows a sticky "Next business →" bar. Legitimately Reference, with a return path. |
| 7 | Runner → **discovery** → Conversation | WORK | ✅ | Live conversation is the correct primary action. |
| 8 | Lead page → **Send** | WORK | ✅ *(fixed 07-24)* | Was: opened a 520px email iframe, non-sticky button, no forward motion (drift). Now: summary-first, sticky send, auto-advance to Today. |
| 9 | Any → **Lead page** | WORK | ✅ *(fixed 07-24)* | Was: MIXED defect (workflow hero on a 15-panel document). Now: decision spine (who · why · what stood out · next) + progressive disclosure; the section the current action needs opens itself. |
| 10 | Decision → Done → Next business | WORK | ✅ | `BatchAdvance` / auto-advance persist completion and move on. No dashboard in between. |

**Result:** every transition in the core loop now preserves momentum, cognitive calm, and emotional state. The three MIXED/drift surfaces found on 07-24 are remediated.

## D3 — Philosophy Drift ledger (Acquisition OS)

```json
[
  {"ts":"2026-07-24","product":"acquisition-os","transition":"lead page (self)","surface_class":"MIXED",
   "claimed_philosophy":"one decision · one action · next business",
   "observed_behavior":"workflow hero atop a 15-panel, 3-column reference document; 'why it matters' shown 3x; 10 competing sub-nav tabs",
   "operator_cost":"cognitive-load|forces-reading","severity":"high",
   "remediation":"recompose as Work Surface: decision spine + progressive disclosure; decision-driven auto-expand","status":"fixed"},

  {"ts":"2026-07-24","product":"acquisition-os","transition":"lead page → send","surface_class":"MIXED",
   "claimed_philosophy":"surface only what matters first",
   "observed_behavior":"opened with a 520px rendered-email iframe; non-sticky send button; no advance after sending",
   "operator_cost":"momentum|forces-reading","severity":"high",
   "remediation":"summary-first (who·why·what stood out·subject+opening+read time); collapse exact email; sticky send; auto-advance","status":"fixed"},

  {"ts":"2026-07-24","product":"acquisition-os","transition":"runner → understand","surface_class":"WORK",
   "claimed_philosophy":"the runner never leaves the loop",
   "observed_behavior":"primary action ejected the operator into the full lead page",
   "operator_cost":"momentum","severity":"medium",
   "remediation":"keep understand inline; demote depth to a secondary link; 'Done — next' is the forward motion","status":"fixed"},

  {"ts":"2026-07-24","product":"acquisition-os","transition":"lead sub-pages (discovery·reasoning·roadmap·outcomes·relationship·meeting·command)","surface_class":"UNAUDITED",
   "claimed_philosophy":"reference is entered intentionally and exits to the loop",
   "observed_behavior":"7 separate pages, not yet classified; now tucked behind 'Manage & go deeper' so they no longer compete, but each page's own surface integrity is unverified",
   "operator_cost":"unknown","severity":"low",
   "remediation":"classify each WORK/REFERENCE/MIXED; ensure each carries a return-to-work path","status":"open"},

  {"ts":"2026-07-24","product":"acquisition-os","transition":"Today → 'Everything else today' (expanded)","surface_class":"REFERENCE",
   "claimed_philosophy":"calm entry screen","observed_behavior":"expanded view re-renders the same task cards already shown as batch cards (20-50 elements)",
   "operator_cost":"cognitive-load","severity":"low","remediation":"de-duplicate the task list; it is reference, keep it collapsed and lean","status":"open"}
]
```

## Remaining open drift (before P1 is fully closed)
1. **The 7 lead sub-pages are unaudited** (highest-value next pass). They no longer *compete* (moved behind a disclosure), but each is its own surface and may itself be MIXED or lack a return path. This is the natural P2 frontier.
2. **Today's expanded reference duplicates** the batch task cards — low-severity noise on an otherwise-calm entry surface.
3. **Base touch target** (`.btn` ≈ 32px) is below the 44px thumb minimum — a cross-cutting mobile-ergonomics fix, not a philosophy defect.
4. **Send auto-advance to Today** is new behavior; confirm with a live human pass that leaving-after-send feels right for deliberate one-off sends (vs. batch sends, where it's clearly right).

## Validation performed (07-24)
- `pnpm typecheck` — clean for all changed files (only a pre-existing `scripts/comms/inspect-queue.ts` error remains, unrelated).
- `pnpm test` — 75 files, **657/657 pass** after every change.
- Runtime (mock mode): lead pages render 200 with the hero, the "what stood out" at-a-glance, and all 7 disclosures; send page renders summary-first with a collapsed exact email; no runtime errors in the dev log.

## Verdict (ES-009)
The **core loop is philosophy-continuous end to end.** The three drift incidents that made the product "establish calm, then abandon it" are fixed. P1 is complete for the primary journey; the remaining open ledger entries (sub-pages, entry-screen dedup, touch targets) are the scoped next pass, not blockers.

---

# ES-010 — Attention Integrity (Operator Review, 2026-07-24)

ES-009 confirmed the *workflow* preserves the philosophy. The operator review then found the philosophy could be right and the operator *still* hesitated — because **visual emphasis pointed at chrome, not the decision.** Standard: [ES-010](~/.claude/docs/engineering-standards/ES-010-attention-integrity.md). Attention competition must descend: decision → context → reference → admin → navigation → decoration. Gold is reserved for the one action.

## Attention Drift ledger (all P0, observed on real rendered screens)

```json
[
  {"ts":"2026-07-24","product":"acquisition-os","surface":"Today · understand step · send page",
   "eye_lands_first":"global gold 'Add business' button (btn-primary in the header)",
   "should_be":"the screen's current action","emphasis_stolen_by":"chrome",
   "exhausted_misclick_risk":"high","severity":"P0",
   "remediation":"reserve gold for the current action only; demote 'Add business' to a ghost/icon control; 'Warm today's queue' to secondary; never two golds on one Work Surface","status":"open"},

  {"ts":"2026-07-24","product":"acquisition-os","surface":"batch runner → understand",
   "eye_lands_first":"a full-width but non-gold 'Review the business' (which ejects to reference)",
   "should_be":"'Done — next' (the real forward decision on a read step)","emphasis_stolen_by":"reference",
   "exhausted_misclick_risk":"high","severity":"P0",
   "remediation":"make 'Done — next' the gold primary on read-only steps; keep 'Review the business' quiet secondary","status":"open"},

  {"ts":"2026-07-24","product":"acquisition-os","surface":"batch runner · lead page (focus mode)",
   "eye_lands_first":"persistent search + 'Add business' + 9-item nav / bottom nav around a focused loop",
   "should_be":"only the current step","emphasis_stolen_by":"navigation",
   "exhausted_misclick_risk":"medium","severity":"P0",
   "remediation":"in batch/work mode hide or dim global chrome; collapse nav to a single Exit","status":"open"},

  {"ts":"2026-07-24","product":"acquisition-os","surface":"send page",
   "eye_lands_first":"'Would I send this? 93/100' quality scorecard, above the decision summary",
   "should_be":"the who/why/what-stood-out/subject summary","emphasis_stolen_by":"metric",
   "exhausted_misclick_risk":"low","severity":"P0",
   "remediation":"lead with the decision summary; move the quality panel below it or into a disclosure","status":"open"},

  {"ts":"2026-07-24","product":"acquisition-os","surface":"Today",
   "eye_lands_first":"mission counter '12 / 40 min left' (largest element)",
   "should_be":"the batch card's 'Start reviewing' action","emphasis_stolen_by":"metric",
   "exhausted_misclick_risk":"low","severity":"P0",
   "remediation":"make the batch card the visual hero; demote the mission counter to a quiet strip","status":"open"}
]
```

## Attention Integrity verdict
**Not yet clean.** Five P0 attention drifts are open — all the same shape (gold/metric/chrome/nav out-emphasizing the decision). None require new features; each is a re-weighting. The three that block the Monday "process 40 alone" test are entries 1, 2, and 4 (gold-on-chrome, heroless understand step, score-before-summary).
