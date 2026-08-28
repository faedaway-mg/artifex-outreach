# Content Studio — Cloud Deployment Plan (PREPARED, not provisioned)

Everything here is local prep + a single consolidated request. No services were created, no migrations
applied, no secrets set. Nothing is deployed.

## What runs today vs. what production needs

| Capability | Local (this pass) | Production needs |
| --- | --- | --- |
| Render engine (Chrome+ffmpeg) | macOS Chrome, spawned by the Next dev server | A **worker service** with Chromium+ffmpeg (Linux). Next request handlers must NOT fork Chrome. |
| Job/upload store | file-backed `.data/content-studio/` (survives refresh + restart) | `content_studio_jobs` Postgres table + object storage (keys, not local paths) |
| Artifact + upload storage | local `public/content` + private `.data` | **Cloudflare R2** (S3-API) bucket; uploads private, finished videos served via signed/public keys |
| Mobile access | `next dev` on your Mac (localhost only) | The already-deployed Railway web app (authenticated) — reachable from your phone |

## Inventory of existing infra we reuse (no new copies)

- **Railway**: the Next.js web + Postgres are already deployed. Add ONE worker service in the same
  project — Railway bills per-usage, no per-service surcharge.
- **Storage adapter**: `src/lib/storage.ts` already speaks S3/R2 (`STORAGE_PROVIDER=s3` + `S3_*`). Reuse it
  for CS uploads/artifacts — no new storage code, just a bucket + creds.
- **Job discipline**: the file store shapes mirror `review_video_jobs` 1:1 → the migration is mechanical.

## Prepared artifacts (in this repo, inert)

- `deploy/content-studio-worker.Dockerfile` — Chromium+ffmpeg worker image (Playwright base). Launch
  flags `--no-sandbox --disable-dev-shm-usage`. The renderer now reads `CHROME_PATH` (macOS fallback),
  so the identical code runs on Linux.
- `deploy/field_note_jobs.sql` — `content_studio_jobs` table + indexes + an active-job unique index
  (DB-level dedup). Move into `drizzle/` with the next sequential number at deploy time (unnumbered here
  to avoid colliding with the other worktrees' in-flight migrations).
- Still needed before deploy (one code change): a small `scripts/worker-loop.mjs` queue drainer, and
  swapping the file store's local paths for R2 keys via `src/lib/storage.ts`.

## Incremental cost estimate (official pricing, researched 2026-08-28)

Assumptions: worker **2 GB RAM / 2 vCPU**; each render ≈ 1.5 min; **R2** for storage (free egress);
50 GB stored; 200 GB/mo downloads. Swap in your real volume.

- **Railway worker (scale-to-use / cron, billed only while rendering)** — RAM $10/GB-mo, vCPU $20/vCPU-mo,
  per-minute:
  - ~1,000 renders/mo ≈ **$2/mo** · ~5,000 ≈ **$10/mo** · ~20,000 ≈ **$42/mo**
  - (An always-on 2 GB/2 vCPU worker ≈ **$60/mo** — only cheaper above ~28k renders/mo.)
- **Cloudflare R2** — storage $0.015/GB-mo (first 10 GB free), **egress $0 (free)**, ops within free tiers:
  50 GB stored ≈ **$0.60/mo**.
- **Postgres**: the `content_studio_jobs` rows are tiny — negligible on the existing instance.

**Typical small deployment ≈ $11/mo incremental** (5k renders + R2). Heavy/always-on ≈ ~$61/mo.
(S3 instead of R2 would add ~$10/mo at 200 GB egress and scale badly — R2's free egress is the reason to
prefer it. AWS S3 egress ≈ $0.09/GB after 100 GB free.)

Flagged as not fully verified in research: Railway per-hour figures are converted from official
per-month rates; Railway one-off-job billing wasn't documented; S3's $0.09/GB egress tier is standing
but its live table is JS-rendered. R2 free egress + Railway per-month compute rates ARE verified.

## The one consolidated request (needs your explicit go — nothing done without it)

Provision, in the existing Railway project:
1. **One render-worker service** from `deploy/content-studio-worker.Dockerfile` (2 GB / 2 vCPU,
   scale-to-use).
2. **One Cloudflare R2 bucket** + credentials, set as `STORAGE_PROVIDER=s3` + `S3_*` on web + worker.
3. **Apply** `deploy/field_note_jobs.sql` (as the next drizzle migration) to the production DB.

Est. **≈ $11/mo** at ~5k renders/mo. After that, Generate works from your phone against the deployed web
app, jobs survive restarts in Postgres, and uploads/artifacts live privately in R2. Reply
“provision the Content Studio worker” to authorize exactly this; I will not create paid infra otherwise.
