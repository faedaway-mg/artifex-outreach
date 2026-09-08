# Quick-Fix Engine — Activation Boundary

Everything that can be completed in the codebase now is complete. The remaining steps
are **configuration / account setup you must perform**, not new engineering. This
document is the exact hand-off list. Nothing here sends outreach, charges a card, or
deploys.

## 1. Stripe (customer checkout + credit)

**Code status:** complete. Checkout uses inline `price_data` sessions (no SDK, no
per-offer Product/Price catalog). The credit is a controlled inline discount, so **no
account-side coupon is required**. The webhook is the only source of "paid".

**What still requires you (account-side):**
1. Create the Quick-Fix webhook endpoint in the Stripe dashboard pointing at
   `https://<app-domain>/api/webhooks/stripe-quickfix`, subscribed to:
   `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
   `invoice.payment_failed`.
2. Copy its signing secret into the deploy env as **`STRIPE_QUICKFIX_WEBHOOK_SECRET`**
   (falls back to `STRIPE_WEBHOOK_SECRET` if unset).
3. Ensure **`STRIPE_SECRET_KEY`** is set. Until it is, checkout returns a clear
   "checkout unavailable" state (never a fake success). Use a **test** key + Stripe CLI
   (`stripe listen --forward-to .../api/webhooks/stripe-quickfix`) to exercise a real
   test-mode purchase; no test key was available in this environment, so the rehearsal
   used a fake client + a locally-signed webhook (see `scripts/quickfix-e2e-rehearsal.ts`).

## 2. Legal review

**Code status:** terms UI, versioned click-accept, scope snapshot, audit record, and the
production eligibility gate are complete. `LEGAL_REVIEW_REQUIRED = true`.

**What still requires you:** hand `docs/quick-fix/QUICK_FIX_TERMS_FOR_LEGAL_REVIEW.md` to
counsel. When finalized, bump `TERMS_VERSION` and set **`QUICKFIX_LEGAL_APPROVED=true`**
in production. Until then `legalGateBlocked()` blocks live purchases in production.

## 3. Google Workspace (outbound mail) — integration boundary

The Quick-Fix engine **does not send email itself** — it composes copy and hands it to the
existing compliant transport (`submitCompliantDispatch` → Resend today), which keeps all
send-gating (safe-hold, recipient gates, suppression, footer/unsubscribe). Adding Google
Workspace is a **transport/config swap behind that boundary**, not a new architecture.

Once your Workspace is ready, connecting it requires:
- **Sender mailbox(es):** the Workspace address(es) you want as the From (e.g.
  `hello@artifexlabs.tech`), matching `ARTIFEX_IDENTITY.publicEmail`.
- **Auth:** a Google Workspace OAuth client (or a domain-wide-delegation service account)
  authorized to send as those mailboxes — or, if you keep sending via Resend/SMTP relay,
  a Workspace SMTP credential.
- **Env vars (names to be finalized when you pick the path):** e.g.
  `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET`, `GOOGLE_WORKSPACE_SENDER`,
  (or `WORKSPACE_SMTP_HOST/USER/PASS`). Plus `PUBLIC_BASE_URL` for absolute links.
- **Domain authentication:** SPF, DKIM, and DMARC for the sending domain, verified in Workspace.
- **Sender health:** warm the domain, verify DKIM alignment, confirm deliverability before volume.
- **Switch-over:** add a `workspace` transport route alongside the existing Resend route in the
  transport layer and select it via env — the compliance/safe-hold spine is untouched.
- **Test delivery:** send a single seed message to your own inbox via the existing test harness
  and confirm DKIM/DMARC pass before enabling any real recipients.
- **Remaining code after account setup:** only the thin transport adapter + env wiring above.
  No offer/checkout/fulfillment code depends on the mail provider.

## 4. Evergreen trust video

**Code status:** the model, versioning, activate/retire/attach, offer-page reference, and the
management UI (`/revenue/trust-asset`) are complete. The canonical 60–120s script is seeded.

**What still requires you:** the standard Content Studio render pipeline needs a **manual
voiceover upload** (MP3/WAV) — there is no external TTS. Record the voiceover, render via the
existing pipeline (ffmpeg + headless Chrome), then **attach the MP4 URL** on the trust-asset
page and **Activate**. Offer pages pick it up automatically; no offers are regenerated.

## 5. Production posture (unchanged, by design)

- Automation default **ASSISTED**; `AUTO_ELIGIBLE` allow-list **empty**. No autonomous selling.
- No live outreach, no live charges, no deploy performed by this mandate.
- Deploy remains operator-gated and requires your explicit authorization.
