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

## MEASURED cost plan (supersedes the earlier ~$11/mo guess)

**Measured render (macOS, real pipeline, 2026-08-28):** ~124 s wall, **~1.08 GB peak combined RSS**
(node+Chrome+ffmpeg), 1.9 MB output for a ~32 s clip. → size the worker at **2 GB RAM / 2 vCPU**
(1.08 GB peak + headroom). Linux/Railway numbers UNVERIFIED — Docker isn't installed locally, so the
container wasn't built/run; expect broadly similar CPU-bound behaviour, re-measure on Railway.

**Worker start/receive/sleep/wake — the important correction (verified against Railway docs 2026-08-28):**
A **polling worker CANNOT scale to zero** on Railway. Idle detection keys off *outbound* packets, so a
loop that polls Postgres keeps the service awake → billed continuously. Two real options:
- **A) Railway Cron** (recommended): a service on a `*/5 * * * *` (min 5-min) schedule that starts,
  drains queued jobs, and **exits**. Between runs the container is stopped → per-minute billing charges
  only for execution. Cost ≈ (renders × ~2.5 billed min) × rate. Trade-off: up to ~5 min latency before
  a queued render starts (fine for outreach). Overlapping runs are skipped, so add a per-job timeout.
- **B) Always-on worker** (low latency, no waiting): 2 GB + 2 vCPU × 730 h = **~$60/mo continuous**
  (RAM $10/GB-mo + vCPU $20/vCPU-mo). Only worth it at high, steady volume.

Per-render compute (2 GB/2 vCPU, ~2.5 billed min): RAM 2×$0.000231×2.5 + CPU 2×$0.000463×2.5 ≈
**$0.0035/render**.

| Scenario (Cron worker + R2) | Worker compute | Storage+delivery | Incremental vs the existing $20 Pro plan |
| --- | --- | --- | --- |
| **Idle** (no renders) | $0 (stopped between runs) | ~$0 | $0 — within plan |
| **30 renders/mo** | ~$0.10 | ~$0 (R2 free egress) | ~$0 — absorbed by the $20 included usage |
| **100 renders/mo** | ~$0.35 | ~$0 | ~$0 — absorbed by included usage |
| Always-on variant (any volume) | ~$60/mo | ~$0 | ~$60/mo |

**Media DELIVERY PATH — the egress correction (important):** R2's free egress ONLY applies if video
bytes are served DIRECTLY from R2 to the viewer. The current local implementation PROXIES the mp4 through
the Next/Railway route `/api/v/[token]/video` (Range-streamed from the web service) — in production that
path means the bytes leave Railway and are billed at **$0.05/GB egress**, NOT free. At ~1.9 MB/view:
100 views ≈ 0.19 GB ≈ $0.01; 10,000 views ≈ 19 GB ≈ ~$0.95/mo. Small, but NOT zero, and it scales with
views. To get genuinely free delivery, the production design must **issue a short-lived presigned R2 URL
per authorized page load** and point the `<video>` at it (bytes go R2→viewer, $0 egress) — the stable
`/v/[token]` page URL stays constant while the underlying media URL is regenerated each load ONLY while
the share is live (revoked → no presign). That's a deploy-time change (needs R2 configured); the code is
structured for it (the token route is the single access point to swap). **Decision for the trial: proxy
through Railway (simplest, tiny egress at trial volume) OR presigned R2 (free egress, a bit more wiring).**

**Hosting the viewing pages** (`/v/[token]`) is served by the EXISTING web service (no new service,
negligible). Frozen share mp4s (~1.9 MB each — 100 shares ≈ 190 MB), VO uploads (~1 MB each), posters
(~24 KB) and email thumbnails live in **R2**: storage under the 10 GB free tier (< $0.10/mo). Postgres
rows (content_studio_jobs + shares + drafts) are tiny → negligible on the existing instance.
NOTE: the render worker itself also incurs **build/startup overhead per Cron run** (container pull +
Node/Chromium cold start, est. 5–15 s billed on top of the ~2 min render) — folded into the ~2.5 billed
min/render assumption above; re-measure on Railway.

**Spend controls:** Railway's HARD usage limit IS enforceable (suspends services at 100%), but it is
**workspace-wide** (min $10), not per-service — setting it affects ALL services in the workspace. A soft
limit is email-alert only. Recommend a workspace soft alert + a hard limit set with the whole workspace
in mind; plus an app-level `CONTENT_STUDIO_MAX_CONCURRENCY`=1–2 and a share/upload retention window.

## Earlier estimate (kept for reference; polling-scale-to-zero assumption was wrong)

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

## The one consolidated request (covers social + client videos + hosted outreach links)

Provision, in the EXISTING Railway project + workspace (no new platform, no video SaaS):
1. **One render worker** from `deploy/content-studio-worker.Dockerfile` (2 GB / 2 vCPU). Choose
   **Cron mode** (`*/5 * * * *`, near-$0 idle, ≤5-min latency) OR **always-on** (~$60/mo, instant).
   Needs the `CHROME_PATH` env (already read by the code) + a small `scripts/worker-loop.mjs` queue
   drainer (to write at deploy time).
2. **One Cloudflare R2 bucket** + credentials → `STORAGE_PROVIDER=s3` + `S3_*` on web + worker. Holds:
   private VO uploads, private frozen share mp4s (immutable per link), and public email thumbnails.
   Free egress covers viewing-page video delivery.
3. **Apply** `deploy/field_note_jobs.sql` as the NEXT drizzle migration on the production DB (mirrors the
   file store: jobs + an active-job unique index; a `shares` table follows the same shape).
4. **Deploy the integration branch** `integration/content-studio` (already prepared off the manual-email
   release `dc3f093`, clean cherry-pick, manual-email/Quick-Review/migrations untouched) — NOT the older
   `feat/content-studio` base.
5. **Spend guard:** set a workspace usage limit (note: workspace-wide, min $10) + app concurrency cap.

**Estimated incremental cost:** ~**$0/mo absorbed by the existing $20 Pro plan** at 30–100 renders/mo with
a Cron worker + R2 (idle = $0; compute ≈ $0.10–$0.35; R2 storage < $0.10; egress $0). Always-on worker ≈
**$60/mo** if you want zero render latency. Viewing-page hosting adds ~$0 (served by the existing web app).

After this: approved videos publish to branded `/v/<token>` links, the manual-email workflow attaches a
clickable thumbnail (no MP4), Generate runs from your phone against the deployed app, and jobs survive
restarts in Postgres. Reply **“provision the Content Studio worker”** to authorize exactly this; nothing
paid is created otherwise. (No sending-provider change — hosting a video doesn't alter email policy.)
