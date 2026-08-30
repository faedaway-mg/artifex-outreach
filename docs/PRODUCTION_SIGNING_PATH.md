# Production Client-Signing + Payment Path — Invariants & Status

Scope: the real-client path for Acquisition OS closing (SignWell signature → deposit →
Stripe payment). Written after the 2026-08-29 `test_mode:true` rehearsal (agreement
`AL-A-2026-SW4842`). This documents the **production** invariants and, for each, whether
it is already enforced in code, was verified in the rehearsal, or is an open **GAP** to
close before any live-client use.

The rehearsal itself created NO live agreement and NO live payment — SignWell
`test_mode:true`, Stripe `sk_test_` only.

## Legend
- ✅ **Enforced** — code guarantees it today (file referenced).
- 🧪 **Verified** — exercised in the rehearsal.
- ⚠️ **GAP** — not yet enforced; required before live-client use.

## Invariants

1. **Real agreements use SignWell `test_mode:false`.**
   - `test_mode` is a per-request field (`scripts/signwell-send.ts`, `src/lib/esign/signwell.ts`).
     Production send path must set `test_mode:false`. ⚠️ GAP: production send should derive
     `test_mode` from an explicit environment/mode gate (e.g. `AGREEMENT_SENDING_ENABLED`),
     not a hand-passed flag, so a test value can't reach production.

2. **Provider identity = Artifex Labs Systems LLC d/b/a Artifex Labs.**
   - ✅ Issuer registry (`src/lib/billing/issuer.ts`, `artifex-systems` active) is frozen into
     each agreement `contentSnapshot`; rendering + account selection read the frozen value.
   - ✅ `assertAgreementConsistent` (`src/lib/agreement/consistency.ts`) binds record ↔ snapshot.
   - 🧪 Signed PDF header/panels showed the entity in the rehearsal.

3. **Provider signer uses the authorized real provider email.**
   - ⚠️ GAP: production must source the provider signer email from issuer/operator config
     (a real Artifex mailbox), not a per-call argument. The rehearsal used a `+alias` and
     that must be **prohibited** in production (see #6).

4. **Client signer uses the actual client's verified email — never an owner alias.**
   - ⚠️ GAP: production send must take the client email from the lead's **verified** contact
     and validate it (deliverable, not a `+alias` of an internal address). No such validation
     exists yet.

5. **Exact agreement, price, deposit, scope, revision, recipients, and PDF hash require
   owner approval before sending.**
   - ✅ Snapshot is the single source; `pdf_sha256` of the exact unsigned bytes is bound into
     the SignWell document metadata (`scripts/signwell-send.ts`) and the app send path.
   - ✅ `assertAgreementConsistent` blocks record/snapshot/commercial mismatch before render.
   - ⚠️ GAP: an explicit **approval record** that captures owner sign-off on
     {price, depositPct, scope, version, recipient emails, pdf_sha256} and is checked at send
     time. Today approval is a coarse status + the sending gate; recipients + hash are not part
     of a bound approval artifact.

6. **Test aliases are prohibited in production agreements.**
   - ⚠️ GAP: add a validation that rejects `+`-aliases / known internal addresses on the
     client (and provider) recipient when `test_mode:false`.

7. **Test-mode documents can NEVER unlock live payment.**
   - Partial. The Stripe adapter refuses a live key when `requireTestMode` is set
     (`src/lib/payments/stripe-invoice.ts`, `issueMilestoneInvoice`). 🧪 The rehearsal deposit
     was billed on `sk_test_` only.
   - ⚠️ GAP: the signed agreement does not yet **record whether its signature came from a
     test_mode SignWell document**, and the billing path does not read such a flag. Add
     `agreement.esignTestMode` (persisted from the SignWell doc/webhook) and make the invoice
     issuance refuse a **live** charge for a test-signed agreement.

8. **Production documents unlock live payment ONLY after an authenticated
   `document_completed` webhook confirms EVERY required signer completed the EXACT approved
   document.**
   - ✅ Webhook authenticates `event.hash` = HMAC-SHA256(webhook id, `type@time`)
     (`src/lib/esign/webhook.ts`); fails closed in production without a secret.
   - ✅ Only `document_completed`/`completed` → `signed`; per-signer `document_signed` maps to
     non-terminal `recipient_signed` and never completes or unlocks the deposit. 🧪 Verified
     live (deposit stayed blocked after 1 of 2 signers; unlocked only on `document_completed`).
   - ✅ Event matched to the exact agreement via `esignRequestId`; the unsigned `pdf_sha256`
     is bound at send time so "exact document" is provable.
   - Deposit is created **pending** on completion (`applyTransition`); it is not charged until
     the operator issues the invoice.

9. **Signed PDF and audit certificate are retained.**
   - 🧪 Signed PDF retrieved + retained (`~/acq-os-audit/signed-rehearsal/`, SignWell
     `completed_pdf` endpoint). In `test_mode` the completed PDF carried the "Not Valid"
     watermark and **no separate audit page**.
   - ⚠️ GAP/verify: in production (`test_mode:false`), retrieve `completed_pdf?audit_page=true`
     (includes the audit certificate) and persist both the signed PDF and certificate to
     durable storage bound to the agreement + `pdf_sha256`.

10. **Duplicate / replayed webhooks are idempotent.**
    - ✅ SignWell events dedupe on event id (`insertAgreementEventIfAbsent`); terminal states
      ignore later events. Stripe invoice events dedupe on Stripe event id
      (`recordPaymentEventIfAbsent`). 🧪 Both verified live (duplicate SignWell completion →
      one deposit; replayed Stripe `invoice.paid` → ledger unchanged).

11. **No live agreement or live Stripe payment during a rehearsal.**
    - 🧪 Held: SignWell `test_mode:true`, Stripe `sk_test_`, local non-prod DB, rehearsal-owned
      tunnel + webhook (deleted afterward), production/Railway config untouched.

## Open gaps to close before live-client use (summary)
- Persist `esignTestMode` on the agreement from the SignWell doc; billing refuses a live
  charge for a test-signed agreement (#7).
- Bound **approval record** over {price, deposit, scope, version, recipients, pdf_sha256},
  checked at send (#5).
- Recipient-email policy: real verified client email; reject `+aliases`/internal addresses
  when `test_mode:false`; provider email from config (#3, #4, #6).
- Derive `test_mode` from the production sending gate, not a hand-passed flag (#1).
- Production audit-certificate retrieval + durable retention of signed PDF + certificate (#9).
