# Artifex Outreach — Deployment (Railway)

Internal production app. Host: **Railway**. DNS: **Cloudflare**. Target URL:
`https://outreach.artifexlabs.tech`.

## Railway project

- Project: **artifex-outreach** (`ae7e4133-1582-45da-83ad-9d82350c838a`), workspace
  *faedaway-mg's Projects*. Isolated from AshMap and the artifex-labs marketing site.
- Services:
  - **Postgres** — managed Postgres 18 (durable volume).
  - **outreach-web** — the Next.js app (multi-stage Dockerfile, standalone output).

## Deploy — one gated command

```bash
cd ~/artifex-outreach
pnpm deploy:production                      # gated: guard → checks → migrations → up → smoke test
pnpm deploy:production --apply-migrations    # also apply pending migrations first
```

`scripts/deploy-production.sh` fails closed at every gate: it verifies the linked
Railway target (`artifex-outreach` / `production` / `outreach-web`) and refuses to
run if `RAILWAY_TOKEN` is set; prints the intended git SHA; runs
`typecheck → lint → test → build`; blocks on pending DB migrations; runs
`railway up --service outreach-web --ci`; then smoke-tests `/api/health` (+ DB
connected), `/login`, an authenticated lead page, conversation page, and PDF
route; and prints the local SHA, deployment ID, timestamp, and smoke result. No
secrets are printed.

Verify the target without deploying:

```bash
pnpm railway:verify     # ✓ project=artifex-outreach env=production service=outreach-web, or fails closed
pnpm db:migration-status # number of pending migrations (0 = up to date)
```

Manual fallback (discouraged — bypasses the gates):

```bash
env -u RAILWAY_TOKEN railway up --service outreach-web --ci
```

The Dockerfile builds Next.js standalone, runs as non-root, binds `0.0.0.0:$PORT`,
and has a HEALTHCHECK against `/api/health`. `railway.json` sets the healthcheck path.

## RAILWAY_TOKEN hazard (resolved 2026-07-21)

A globally-exported `RAILWAY_TOKEN` overrides Railway's per-directory project links
so `railway` in ANY directory targeted that token's project (`ashmap-api`). The
`export` in `~/.zshrc` was disabled (backup `~/.zshrc.bak-predeploy`); projects now
resolve from per-directory links + account login (`~/AshMap` and
`~/Documents/AshMap` are linked to `ashmap-api`). `scripts/railway-guard.sh` refuses
to run while `RAILWAY_TOKEN` is set, so a stray token can never silently redirect a
deploy. If a command targets the wrong project, open a new terminal and run
`pnpm railway:verify`.

## Intelligence backfill (existing leads)

After changing the intelligence/investment/QC engines, recompute existing leads
(idempotent; regenerates draft deliverables in place, never sends email):

```bash
AI_PROVIDER=mock STORAGE_PROVIDER=mock pnpm db:backfill-intelligence   # match prod; --dry to preview
```

## Source backup (no git remote configured)

No git remote exists yet. A full backup bundle (all branches) lives at
`~/artifex-outreach-backups/artifex-outreach-all.bundle`; recreate with
`git bundle create ~/artifex-outreach-backups/artifex-outreach-all.bundle --all`.
See `docs/OPERATOR_ACTIONS.md` to push to GitHub once a repo exists.

## Migrations

Schema lives in `src/db/schema.ts`; SQL migrations in `drizzle/`.

```bash
pnpm db:generate                 # regenerate SQL after schema changes
DATABASE_URL=... pnpm db:migrate # apply (uses .env.local locally)
```

On Railway, run migrations as a one-off against the service env:

```bash
env -u RAILWAY_TOKEN railway run --service outreach-web pnpm db:migrate
```

## Required env (production)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres. On Railway: `${{Postgres.DATABASE_URL}}` (private URL). |
| `OUTREACH_PASSWORD` | Operator login. ≥8 chars, non-default. Startup fails otherwise. |
| `AUTH_SECRET` | Session HMAC key. ≥16 chars, non-default. |
| `NEXT_PUBLIC_APP_URL` | `https://outreach.artifexlabs.tech` |
| `NODE_ENV` | `production` (set by Railway). |

Optional integrations activate only when their keys are present — see `.env.example`
(`AI_PROVIDER`+keys, `GOOGLE_PLACES_API_KEY`, `GOOGLE_PAGESPEED_API_KEY`,
`STORAGE_PROVIDER`+`S3_*`, `SCREENSHOT_WORKER_URL`). Without them the app runs and
clearly labels those features as disabled/mock rather than faking real results.

## Custom domain (Cloudflare)

Railway custom domain `outreach.artifexlabs.tech` requires these DNS records in the
`artifexlabs.tech` Cloudflare zone (retrieve current values with
`railway domain --service outreach-web outreach.artifexlabs.tech`):

| Type | Name | Value | Proxy |
|---|---|---|---|
| CNAME | `outreach` | `5az3eu23.up.railway.app` | DNS only (grey cloud) |
| TXT | `_railway-verify.outreach` | `railway-verify=…` | n/a |

Do **not** touch the root `@` / `www` records (the marketing site). Railway issues
the TLS certificate automatically once the CNAME resolves and the TXT verifies.

## Screenshot worker (optional, separate service)

Headless-browser capture is intentionally kept out of the web service. To enable
real screenshots, deploy a small Playwright worker (its own Railway service) that
exposes `POST /capture { leadId, pages[] }`, stores images via the same S3/R2
bucket, and returns `{ screenshots: [{ storageUrl, storageKey, ... }] }`. Point the
web app at it with `SCREENSHOT_WORKER_URL` (+ `SCREENSHOT_WORKER_TOKEN`). Until then
the app uses deterministic placeholder captures.

## Health

`GET /api/health` (public) returns app status, DB connectivity, storage/AI mode,
auth-config status, and version — no secrets. Used by the Docker/Railway healthcheck.

## Read-only Railway preflight (step 4.5 of `pnpm deploy:production`)

Runs automatically after the target guard, quality gates, and the fail-closed
migration check — and **before** the first mutating command (`railway up`). It is
strictly read-only and answers one question: *is there any known, trustworthy
evidence that should block or caution this deployment attempt?*

Checks → states (PASS · CAUTION · UNKNOWN · BLOCK, precedence BLOCK > UNKNOWN >
CAUTION > PASS):
1. **Target identity** — consumed from `railway-guard.sh` (fail-closed; RAILWAY_TOKEN
   rejected). Not re-derived, not overridable.
2. **Deployment visibility** — `railway deployment list` (documented informational).
   In-progress deployment → CAUTION; unreadable → UNKNOWN.
3. **Public platform status** — status.railway.com, 10s timeout, no credentials. The
   page's visible current state is authoritative ("Fully Operational" → PASS); an
   active incident explicitly pausing deployments → **BLOCK (not overridable)**;
   other incidents → CAUTION; unreachable → UNKNOWN. The page covers only
   significant, widespread incidents — it is **not exhaustive** for account/plan/
   workspace restrictions.
4. **Current application health** — GET /api/health, 10s timeout. `status:"ok"` →
   PASS; degraded → CAUTION (shipping a fix over broken production remains allowed —
   existing policy preserved); unreachable → UNKNOWN.
5. **Migration readiness** — result consumed from the earlier fail-closed check;
   pending migrations reaching the preflight → BLOCK (belt-and-suspenders).

**Policy:** UNKNOWN warns loudly and continues — it is *recorded as UNKNOWN*, never
rewritten as PASS (a status-page outage doesn't prove Railway is down, and a broken
CLI will fail `railway up` safely by itself). There are **no override flags**: the
only preflight BLOCK (a confirmed official deploy-pause incident) must never be
overridable, and everything else warns rather than blocks.

**What a PASS means:** only that nothing observed by these read-only checks blocks
*attempting* the deploy. It does **not** prove Railway availability, deployment
success, account restrictions, database safety, or new-build health. An Active
Railway deployment still requires the post-deploy authenticated smoke test, and
rollback remains migration-sensitive (a rollback restores image+variables — never
assume it reverses migrations).

**Evidence:** each run writes a redacted JSON artifact (atomic write) to
`artifacts/deploy-preflight/<timestamp>-railway-production-preflight.json`
(gitignored). No secrets, tokens, variable values, or connection strings are ever
recorded. No automatic retry or recovery exists — recovery actions are separate,
operator-authorized decisions.
