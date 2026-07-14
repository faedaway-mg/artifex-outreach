# Artifex Outreach — Deployment (Railway)

Internal production app. Host: **Railway**. DNS: **Cloudflare**. Target URL:
`https://outreach.artifexlabs.tech`.

## Railway project

- Project: **artifex-outreach** (`ae7e4133-1582-45da-83ad-9d82350c838a`), workspace
  *faedaway-mg's Projects*. Isolated from AshMap and the artifex-labs marketing site.
- Services:
  - **Postgres** — managed Postgres 18 (durable volume).
  - **outreach-web** — the Next.js app (multi-stage Dockerfile, standalone output).

## Deploy

```bash
cd ~/artifex-outreach
# always strip the ambient project token so account auth + the linked project are used
env -u RAILWAY_TOKEN railway up --service outreach-web --ci
```

The Dockerfile builds Next.js standalone, runs as non-root, binds `0.0.0.0:$PORT`,
and has a HEALTHCHECK against `/api/health`. `railway.json` sets the healthcheck path.

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
