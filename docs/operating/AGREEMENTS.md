# Client Agreements — Operator Guide

The agreement system turns an **accepted proposal** into a signed Professional
Services Agreement, then unlocks the deposit and kickoff. It is intentionally
small: one master template, generated per project, signed through SignWell, with
a Stripe deposit link. It is **not** a contract editor, clause builder, or
invoicing system.

> ⚠️ **LEGAL REVIEW REQUIRED.** The master agreement (`src/lib/agreement/template.ts`)
> is a **DRAFT** and has **not** been reviewed by counsel. Live sending is **OFF**
> by default. Do not send to a real client until (1) an attorney has reviewed the
> template, (2) the sending domain is verified for Resend, and (3) you set
> `AGREEMENT_SENDING_ENABLED=true`.

## Lifecycle

```
Proposal Accepted → Generate Agreement → Internal Preview → Operator Approval
→ Send (SignWell) → Signed (webhook) → Deposit unlocked → Deposit sent
→ Paid (Stripe webhook / manual) → Kickoff → Implementation → Ongoing Partnership
```

Operate it from the **lead's Relationship view → Agreement panel**.

## Internal review procedure

1. **Accept the proposal** (Agreement panel → *Accept*). Stage → `Proposal Accepted`.
2. **Generate agreement.** Fields prefill from the lead, contact, brief, and
   proposal. Use *Review / edit fields* to adjust scope, timeline, deposit %,
   monthly partnership, signer, etc. Generation refuses if a critical field is
   missing (client/signer name, signer email, project summary, scope, price,
   timeline, accepted proposal) and lists exactly what's missing.
3. **Preview the PDF** (opens `/api/agreement/<id>/pdf`). While sending is off it
   carries a **DRAFT — REQUIRES LEGAL REVIEW** banner on every page.
4. **Verify the key terms** shown in the panel: client, signer, proposal ref,
   scope/deliverables/exclusions, timeline, price, deposit, balance, monthly,
   governing law, version.
5. **Approve.** This **freezes the snapshot** (`approvedAt` recorded). Ordinary
   editing is then blocked — a material change requires a **new version**.

## Regenerating before approval vs. replacing after approval

- **Before approval** (status `generated`): use *Edit & regenerate*. It rewrites
  the same agreement in place.
- **After approval / after signing** (material correction): use *Create a new
  version*. It issues version N+1, links `supersedes`/`supersededBy`, and marks
  the old one voided (a signed original is preserved, not rewritten). History is
  never overwritten.

## SignWell setup

1. Create a SignWell account; get the API key. Set `SIGNWELL_API_KEY`.
2. Configure a webhook → `POST https://<host>/api/webhooks/signwell`; set
   `SIGNWELL_WEBHOOK_SECRET`. **Confirm SignWell's current signature scheme and
   event names** against their docs and adjust `src/lib/esign/webhook.ts` if
   needed (verification is HMAC-SHA256 over the raw body; event names are matched
   tolerantly).
3. The agreement PDF embeds `{{sig_client}}`, `{{date_client}}`, `{{sig_artifex}}`,
   `{{date_artifex}}` text-tag anchors; SignWell auto-detects them. SignWell emails
   the signer the request. Embedded signing is **not** used in Phase 1.
4. **Test-mode rehearsal:** the *Send in SignWell test mode* button works even
   while `AGREEMENT_SENDING_ENABLED` is off, so you can exercise the integration
   without a live/legally-binding send.

## Stripe deposit setup

- A deposit record (status `pending`) is created automatically when the agreement
  is signed. Sending it is a separate, gated action.
- Provide a payment link one of two ways: paste a Stripe link in the deposit
  card, or set `STRIPE_SECRET_KEY` and leave it blank to auto-create a Checkout
  Session link.
- Webhook → `POST https://<host>/api/webhooks/stripe`; set `STRIPE_WEBHOOK_SECRET`.
  A verified `checkout.session.completed` marks the deposit **paid** and advances
  the lead to `Deposit Paid`.

## The deposit hard gate

A deposit is **never** sendable before a signed, current agreement. Enforced at
three layers: the domain (`checkDepositAllowed`), the server action, and the UI.
It rejects: no agreement, unsigned/declined/voided/superseded agreement, and any
cross-lead or cross-agreement mismatch.

## Downloading signed records

Once signed, the panel links the **signed agreement** and **completion
certificate** (from SignWell's webhook payload — keep the certificate; it is the
ESIGN/UETA audit trail). The internally-generated PDF remains at
`/api/agreement/<id>/pdf`.

## Emergency manual fallback

If a client pays outside Stripe (bank transfer, etc.), use **Mark paid (manual)**
on the deposit card. It requires confirmation and writes an audit record
(`deposit.mark_paid_manual`). Use only for genuinely-confirmed payments.

## Safe production enablement (checklist)

1. Attorney reviews `src/lib/agreement/template.ts`; apply edits; bump
   `AGREEMENT_TEMPLATE_VERSION`.
2. Verify the Resend sending domain (SPF/DKIM/DMARC) — see the email activation
   runbook. Client emails use the Artifex identity only (`artifexlabs.tech`).
3. Set `SIGNWELL_API_KEY` + `SIGNWELL_WEBHOOK_SECRET`; register the SignWell
   webhook; run a **test-mode** rehearsal end to end.
4. Set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`; register the Stripe webhook;
   test with Stripe **test mode** (never a real card).
5. Run the migration (below).
6. Only then set `AGREEMENT_SENDING_ENABLED=true`.

## Database migration

`drizzle/0010_bumpy_flatman.sql` adds the `agreements`, `agreement_events`, and
`payments` tables, three `pipeline_stage` enum values, and `number`/`version`
columns on `proposals`. Apply with `pnpm db:migrate` against the target database.
The enum `ADD VALUE` statements are safe on PostgreSQL 12+ (the new values are not
used within the same migration).

## Rehearsal

`npx tsx scripts/agreements/rehearsal.ts` drives the full lifecycle in-memory
(no live sends, no charge) and asserts every gate. Use it after any change.

## Numbering

Proposals: `AL-P-<year>-<seq>`. Agreements: `AL-A-<year>-<seq>`. Sequence is
per-kind, per-year. A new agreement version keeps the same agreement number and
increments its `version`.
