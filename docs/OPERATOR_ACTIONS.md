# Operator actions required

Status as of 2026-07-21 production-hardening pass. Production is live, current
(deployment `cbacf675`, SHA `9754bd3`), all 12 migrations applied, 20 leads
recomputed, and the operator can log in and review leads / run conversations /
open Business Technology Reviews today. The items below are what remains.

---

## A. Required before outreach can begin

### A1. Real AI provider key (unblocks QC-passing briefs)
- **Why:** Production runs `AI_PROVIDER=mock`. Mock generation produces repetitive
  copy, so the 3 draft Business Technology Reviews fail the QC `repeated-content`
  blocker and cannot be approved (`approveDeliverableAction` refuses on blockers).
  Lead review + conversations already work in mock; only approvable briefs are blocked.
- **Account / website:** OpenAI — https://platform.openai.com → **API keys** →
  *Create new secret key*. (Anthropic — https://console.anthropic.com → **API Keys** — also supported.)
- **Railway target:** project **artifex-outreach** → service **outreach-web** →
  **Variables**.
- **Exact variables to set:**
  - `AI_PROVIDER=openai`
  - `OPENAI_API_KEY=sk-…`
  - `OPENAI_MODEL=gpt-4o-mini` (optional; this is the default — cost-conscious, reliable)
  - (Anthropic instead: `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=…`, optional `ANTHROPIC_MODEL=claude-sonnet-4-6`)
- **Billing:** Yes — usage-based, roughly a few cents per brief at gpt-4o-mini. Set a
  low monthly usage limit in the provider dashboard.
- **Safety:** Changing the provider CANNOT auto-send anything — brief generation only
  inserts `draft` deliverables; sending is a separate manual operator action.
- **Verify complete:** `curl -s https://outreach.artifexlabs.tech/api/health` shows
  `"ai":{"mode":"openai"}`.
- **Resume the automated work afterward:** regenerate the 3 drafts with the real
  provider and confirm QC passes (drafts only, no email):
  ```bash
  cd ~/artifex-outreach
  AI_PROVIDER=openai OPENAI_API_KEY=sk-… STORAGE_PROVIDER=mock pnpm db:backfill-intelligence
  pnpm db:migration-status   # sanity
  ```
  Then open each brief in the UI — QC should show passed. (Or ask the assistant to
  "re-run the intelligence backfill with the real AI provider and verify QC.")

### A2. Confirm live email sending path (Resend domain + DNS)
- **Why:** Actually *sending* outreach requires a verified sending domain. The
  `RESEND_API_KEY` / `RESEND_FROM` / `RESEND_WEBHOOK_SECRET` variables are already set
  on outreach-web, but domain SPF/DKIM verification must be confirmed or mail will be
  quarantined. (Lead review, conversations, and brief approval do **not** need this.)
- **Account / website:** https://resend.com → **Domains** (verify `artifexlabs.tech`
  or a dedicated `mail.artifexlabs.tech`) → publish SPF/DKIM in the Cloudflare
  `artifexlabs.tech` zone. Point delivery + inbound webhooks at
  `/api/webhooks/resend` and `/api/webhooks/inbound`.
- **Railway target:** outreach-web (vars already present; confirm `PUBLIC_BASE_URL=https://outreach.artifexlabs.tech`).
- **Billing:** Resend has a free tier; volume plans are paid.
- **Verify complete:** `curl -s -H "Authorization: Bearer $CRON_SECRET" https://outreach.artifexlabs.tech/api/comms/status`
  reports the provider enabled; run `pnpm exec tsx scripts/comms/preflight.ts` (exit 0 = READY).
- Detailed runbook: see the "Production Email Activation" notes; this pass did not
  send any email.

---

## B. Optional production improvements (do not block lead review)

### B1. GitHub remote (source preservation)
- **Why:** No git remote exists; work is preserved only in the local backup bundle
  `~/artifex-outreach-backups/artifex-outreach-all.bundle`.
- **Steps:** install GitHub CLI (`brew install gh`), `gh auth login`, then:
  ```bash
  gh repo create faedaway/artifex-outreach --private --source ~/artifex-outreach --push
  # or, with an existing empty repo:
  cd ~/artifex-outreach && git remote add origin git@github.com:<owner>/<repo>.git
  git push -u origin feat/pdf-investment-integration
  ```
- **Verify:** `git ls-remote origin` lists the branch; commit `9754bd3` is present.

### B2. Persisted PDF storage (S3 / Cloudflare R2)
- **Why:** `STORAGE_PROVIDER=mock` — PDFs render on demand (works fine) but are not
  stored. Only needed if you want durable PDF URLs.
- **Railway (outreach-web):** `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION`,
  `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`
  (Cloudflare R2 recommended; S3-compatible). **Billing:** R2 has a free tier.
- **Verify:** `/api/health` shows `"storage":{"provider":"s3","configured":true}`;
  approve a deliverable and confirm `pdfUrl` populates.

### B3. Screenshot worker (QC screenshot warnings)
- **Why:** The QC `missing-screenshots` check is a **warning, not a blocker** — it only
  fires when brief evidence text references a visual. Real screenshots require a
  separate Playwright worker service.
- **Steps:** deploy the worker per `docs/DEPLOYMENT.md` ("Screenshot worker") and set
  `SCREENSHOT_WORKER_URL` + `SCREENSHOT_WORKER_TOKEN` on outreach-web.

### B4. Automated deploy / monitoring
- Once B1 is done, connect the GitHub repo to Railway for auto-deploy, or keep using
  the gated `pnpm deploy:production`. Consider uptime monitoring on `/api/health`.
