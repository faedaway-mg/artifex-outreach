# Content Studio + Thumbnail-First Field Notes — Checkpoint

**Branch:** `feat/content-studio` (worktree `~/artifex-cs`), based off `restore/acq-os-morning-m1` @ `51481e9`
(the tip that carries the `review-video` job/storage architecture). Isolated from the 6 other active
worktrees; no shared branch moved, no DB migration added (avoids collisions with in-flight migration
churn). Local-only. No push, no deploy, no production data touched.

## What shipped

### 1. Thumbnail-first is now a pipeline feature
- `scripts/lib/fieldnote.mjs` → `embedThumbnailFrameZero({framesDir, thumbPath})`: overwrites frame
  `f_00000.png` with the 1080×1920 cover before muxing. Frame 0 is the opening keyframe, so the first
  **decoded** frame is the generated thumbnail (real encoded content — not a poster/metadata/sidecar).
  No added intro time, no audio shift, no multi-second hold. Wired into `buildFieldNote`, the VO finish
  pass (`finish-field-note-vo.mjs`), the regen script, and the Content Studio worker — so #007+ get it
  automatically. Native 1080×1920 viewport (`Emulation.setDeviceMetricsOverride`) is the normal render
  path — the white-bar fix is root-cause, not a border smear.

### 2. #004–#006 regenerated (recommended posting files)
Native viewport + thumbnail frame-zero + **approved audio stream copied byte-for-byte** (`-c:a copy`
from each `-final-vo.mp4`; the timeline warp is deterministic from the same voiceover so the new frames
stay in sync). Verified per file:

| Piece | Recommended posting file | Frame0↔thumb PSNR | Bottom-row luma | Audio md5 vs approved | Duration |
| ----- | ------------------------ | ----------------- | --------------- | --------------------- | -------- |
| #004 | `field-note-004-final-vo-thumb.mp4` | 39.7 dB | 7.6 (dark) | **IDENTICAL** | 26.45s |
| #005 | `field-note-005-final-vo-thumb.mp4` | 40.6 dB | 7.0 (dark) | **IDENTICAL** | 30.22s |
| #006 | `field-note-006-final-vo-thumb.mp4` | 40.6 dB | 7.0 (dark) | **IDENTICAL** | 34.52s |

PSNR ~40 dB = first decoded frame matches the intended thumbnail within encoding tolerance. Bottom-row
luma ~7 (dark ink) at frame 0 and mid-clip = no white strip. Approved audio is byte-identical (md5).
Earlier approved outputs (`-final-vo.mp4`, `-final-vo-fixed-bottom.mp4`) are preserved untouched.
Thumbnail masters regenerated clean (native viewport); white-bar originals backed up under
`public/content/thumbnails/_prefix-white-bar-originals/`.

Reference assets used: existing scenes `scene-004/005/006.html` + `_shared/scene-lib.js`, approved VO
inputs `field-note-00X-voiceover-input.mp3`, approved audio from `field-note-00X-final-vo.mp4`, covers
from `thumbnails/thumbnail.html`. (No VEED masters were available to diff against — proceeded with the
explicit first-frame requirement; this is the only reference limitation.)

### 3. Content Studio (Acquisition OS)
- **Route:** `/content-studio` (nav entry "Content Studio", Clapperboard icon, in `Shell.tsx`).
- **UI** (`src/components/content-studio/ContentStudioClient.tsx`): piece list with live status; detail
  with concept, narration + copy controls, IG/LinkedIn caption copy, mobile-friendly MP3 upload, audio
  playback + client-detected duration, thumbnail preview, Generate (approved audio) / Generate with
  uploaded VO, live render progress, video preview + separate video/thumbnail downloads, version
  history, manual "Posted" marker, and New-piece (draft) creation.
- **Real jobs, no fake progress** (`src/lib/content-studio/*`, `scripts/content-studio-render.mjs`):
  POST `/api/content-studio/render` creates a durable job and spawns a **detached** worker (headless
  Chrome + ffmpeg) that streams real frame progress into the job file. Survives browser refresh (job is
  server-side; UI polls). Duplicate clicks de-dup by `(pieceId + inputVersion)`. Inputs are version-
  bound (script + audio signature + template); a changed input marks a prior output stale. Crashed
  workers reconcile to `failed` (retry offered). Uploads validated (type/size ≤25MB/duration 5–90s) and
  stored **privately** under `.data/` (never a public path); served through an auth-gated route.
- **Storage/jobs:** file-backed under `.data/content-studio/` (gitignored) to survive refresh without a
  DB migration. Shapes mirror `review_video_jobs` 1:1 for a clean production port.

### 4. Prospect/client video workflow — preserved, signposted, NOT claimed complete
The `review-video` job/queue/render architecture is intact and untouched. Content Studio links to it
("Client videos" → Businesses → a business → its video panel, bound to that business + evidence). Its
per-lead renderer is still being wired (`scripts/review-video-render-core.ts` returns "not yet wired"),
so it is explicitly marked **in progress** in the UI, not complete. No social-video logic was
substituted for it.

## Verification
- `tsc --noEmit`: **0 errors** across the project.
- Unit tests: `src/lib/content-studio/{job,upload}.test.ts` — **14/14 pass** (state machine, deterministic
  inputVersion, dedup guard, staleness, upload validation).
- End-to-end against the running app (mock in-memory mode, no Postgres, no prod data):
  page `/content-studio` → 200 (all six pieces render); API list → 200; auth gate → redirect/401 without
  cookie; valid upload → 201; invalid `.mov` → 422; render → 202 real job; duplicate click → `deduped:true`
  same job (already advanced — proves the worker runs independently of the request = survives refresh);
  polled queued→analyzing→rendering(live %)→embedding→mixing→ready; produced
  `field-note-004-final-vo-custom.mp4` from the uploaded VO (1080×1920, AAC, PSNR 39.7, no white bar);
  posted marker → 200. Desktop (1440) + phone (390×844) screenshots captured and inspected.
  (The `-custom` E2E byproduct was removed afterward; #004's recommended file remains the byte-identical
  `-final-vo-thumb.mp4`.)

## Which three files to post
- `public/content/field-note-004/field-note-004-final-vo-thumb.mp4`
- `public/content/field-note-005/field-note-005-final-vo-thumb.mp4`
- `public/content/field-note-006/field-note-006-final-vo-thumb.mp4`
(also staged in `~/field-note-004|005|006/`). Thumbnail is embedded as frame zero **and** exported
separately at `public/content/thumbnails/field-note-00X-thumbnail.png` — still upload it as the cover
when posting; not every platform selects frame zero.

## Remaining production requirements (report-only; not provisioned)
1. **Render worker on Railway.** The engine uses a hardcoded macOS Chrome path + local ffmpeg. Railway
   (Linux) needs a Chromium binary + ffmpeg in the image and a worker/queue process — `next` request
   handlers should not fork Chrome in production. One bounded ask (below).
2. **Durable job/storage.** Port `.data/content-studio/` → a `field_note_jobs` Postgres table (mirror
   `review_video_jobs`) + S3/R2 for artifacts and private uploads (reuse `src/lib/storage.ts`).
3. **New-concept rendering** needs a scene template authored per concept; today the engine renders the
   established scenes (#004–#006). Manual script/caption entry works for any new draft now.
4. No automatic voice generation (by design — you produce the VO), no auto social posting, no client
   delivery/email.

---

# Pass 2 — Data-driven templates, #007, client videos, durability, deploy prep

**Branch:** `feat/content-studio` (worktree `~/artifex-cs`). Local only; no push/deploy/prod-data.

## Data-driven scene-template engine (no more hardcoded IDs)
- Bounded schema `src/lib/content-studio/template-schema.ts` (zod): 9 beat types (title, statement,
  surface, cards, chain, routes, search, report, brand) with length/count caps; exactly one brand beat,
  last; narration-line refs validated. `parseTemplate()` validates untrusted input.
- Fixed generic renderer `public/content/_shared/scene-template.html` builds DOM from validated data via
  **textContent only** (no template-provided HTML/JS executed) using the approved vocabulary + motion.
- `scripts/lib/template.mjs`: `buildTemplateTimeline` (narration-onset alignment) + `buildTemplateCues`
  (cues from beat types). Worker `scripts/content-studio-render.mjs` branches template vs legacy scene.
- Generic cover renderer `public/content/thumbnails/thumbnail-template.html` +
  `scripts/render-template-thumbnail.mjs`. Create via `POST /api/content-studio/templates`.
- **Phone-friendly path**: `src/lib/content-studio/auto-template.ts` turns a plain script (title +
  narration lines) into a renderable statement-grammar template — "New video" needs no beat authoring.

### ALIGNMENT METHOD (stated honestly)
Each beat's start is anchored to the **detected voice onset of its first narration line** (silencedetect
gaps between spoken lines — line granularity, NOT word-level ASR). When fewer pauses are detected than
lines, missing onsets are **linearly interpolated** across the gap (approximate). Clear pauses → tightest
sync. This is not word-accurate synchronization and is not evenly dividing runtime.

## #007 — a genuinely new piece, through the UI
`public/content/templates/007.json` — "Which number is right?" (two systems, two numbers, one source of
truth). Distinct concept/narration/visuals/captions. Created via the templates API, VO uploaded, rendered
via the generic engine. **Rehearsal VO was a labeled macOS-`say` placeholder of #007's OWN script** (not
reused from another piece) — replace with your real MP3 (see request below). QC: 1080×1920, 31.9s, audio
31.90s ≈ video (narration not truncated), frame0↔thumb PSNR 41.2 dB, bottom-row luma 7 (no white bar),
beats track the narration (title→cards→statements→teal chain→resolve→brand). Different audio lengths work
(the timeline is derived from the actual VO). Output: `field-note-007-final.mp4`.

## Client / prospect videos (same engine, bound to the business)
- `src/lib/content-studio/client-video.ts`: `buildBusinessTemplate(review)` projects a business's
  **Quick Review evidence** into a validated template (title → finding beats → "where we'd start" chain →
  brand). Reuses the REAL `reviewVideoReadiness` gate — ineligible → NO template + blockers (gate NOT
  weakened; INSUFFICIENT never eligible; NEEDS_REVIEW override honored).
- API: `GET /api/content-studio/client/candidates` (reuses `listReviewVideoCandidates` board),
  `POST /api/content-studio/client/prepare` (real `buildQuickReview` → gate → registers a
  `client-<leadId>` piece bound to the business). UI: a "Client videos" panel (candidates + prepare).
- **Rehearsal proven**: a realistic Northstar review fixture → projection → render →
  `field-note-client-northstar-demo-final.mp4` (1080×1920, 24.6s, PSNR 39.6, no white bar, audio intact).
- **Honest boundary**: mock mode has NO businesses; candidates is empty locally. Live enumeration needs
  the production Postgres — I did NOT connect the test server to prod (it holds real client data + login
  writes). The projection + gate + render are real and would populate against prod. The legacy
  `VideoPanel` on the lead page was left to its owning session (shared file under active dev); Content
  Studio provides + links the working client flow instead of editing that component.

## Durability & privacy (isolated persistent store, not mock)
- Store made testable via `CONTENT_STUDIO_DATA_DIR`. `durability.test.ts` (7 tests) proves against a real
  temp store: refresh=re-read, fresh module (app/worker restart) sees on-disk jobs, dedup guard, 20
  concurrent patches don't corrupt JSON (hardened `writeAtomic` unique temp name), input-change
  staleness, failed retry preserves the prior success, crashed-worker reconcile→failed.
- Uploads stored privately under `.data` (never a public path); every CS endpoint is auth-gated (verified
  401/redirect without cookie).

## Cloud deploy prep (report-only, nothing provisioned)
- `deploy/content-studio-worker.Dockerfile` (Chromium+ffmpeg), `deploy/field_note_jobs.sql`
  (content_studio_jobs mirror + active-job unique index), `docs/content/DEPLOY-CONTENT-STUDIO.md` (plan +
  cost). Renderer now reads `CHROME_PATH` (macOS fallback) so identical code runs on Linux.
- **Cost (official pricing, 2026-08-28)**: scale-to-use Railway worker (2 GB/2 vCPU) ≈ $2/$10/$42 per mo
  at 1k/5k/20k renders; **R2 (free egress)** ≈ $0.60/mo at 50 GB → **≈ $11/mo** small deployment. R2 ≫ S3
  on egress. One consolidated request in the deploy doc.

## Acceptance (Pass 2)
- `tsc --noEmit`: **0 errors**. Tests: **31 pass** (job, upload, template-schema, client-video,
  durability). **`next build` succeeds** — all 10 `/content-studio` + `/api/content-studio/*` routes
  compile. Desktop (1440) + phone (390) screenshots of the live page inspected (9 pieces, client panel,
  #007 detail). #007 + client videos QC'd at open/middle/end.

## Per-workflow status
- Existing #004–#006 exports — DONE (Pass 1, preserved, not regenerated here).
- New social content #007 — DONE end-to-end via the generic engine (rehearsal VO placeholder).
- Business/client video — engine + gate + projection + render PROVEN on a realistic fixture; LIVE
  business list needs prod DB (mock empty).
- Persistence/recovery — PROVEN via isolated-store integration tests.
- Local browser usability — DONE (desktop + mobile).
- Remote/cloud availability — PREPARED, needs the one provisioning approval.

## Known cosmetic refinement (recorded, not blocking)
Data-driven beats are centered in the upper-middle band; the bespoke #004–#006 scenes use more vertical
space. Readable + on-brand; per-beat vertical centering is a future polish.

## Continuation actions
1. Send the real #007 MP3 → I regenerate `field-note-007-final.mp4` from it (one command).
2. Approve the deploy request (deploy doc) for phone rendering + durable Postgres/R2 jobs.
3. (Optional) richer beat authoring UI + per-beat vertical centering.

---

# Pass 3 — Honesty fixes, hosted outreach links, measured verification

**Branch:** `feat/content-studio @ b435c3b`. Integration branch prepared: `integration/content-studio @ 106a840`
(off manual-email release `dc3f093`, clean cherry-pick, manual-email/QR/migrations untouched). Local only.

## 1. Honest provenance + approval (no fabricated "ready"/"posted")
Explicit `AudioKind` (placeholder|uploaded|approved-master), never inferred from a filename. Placeholder
renders show **"Preview only — replace placeholder voiceover"** and can't be recommended/approved/posted.
Approval is an explicit, version-bound action (`/pieces/[id]/approve`); changing audio/script marks it
stale. "Mark posted" is gated behind approval (`/posted` returns 422 otherwise). Generate buttons no
longer offer "approved voiceover" for template pieces. Provenance surfaced in the snapshot + UI labels.

## 2. Concept → ideas → script
`ideas.ts` = deterministic starter-idea bank (6, Field-Notes theme), `/api/content-studio/ideas`,
"Suggest ideas" in New-video → fills concept + editable starter narration → renders via the template
path. **Labeled "not AI/provider-generated"** (source: deterministic-bank). App AI provider defaults to
`mock`; a paid LLM would replace the bank — prepared as a labeled-unverified future (in the deploy ask),
no paid call made. Manual entry remains the default.

## 3. Real business rehearsal (evidence snapshot, not prod)
Client-video projection (Pass 2) reuses the REAL `reviewVideoReadiness` gate + `buildQuickReview`. Proven
on a realistic evidence fixture; there IS an authorized local BI snapshot (`src/lib/business-intelligence/
fixtures.ts`) to seed from. LIVE prod-business enumeration still needs the production DB (mock has none);
I did NOT connect the test server to prod (real client data + login writes). Final-VO acceptance: pending.

## 4. Real-Postgres durability + measured render (Docker/Linux BLOCKED)
`scripts/verify-pg-jobs.mjs` against an ISOLATED Postgres (`cs_jobs_test`, `deploy/field_note_jobs.sql`) —
**8/8**: DB dedup (active-job unique index), two/three-worker race → exactly ONE claims, crash-lease
recovery reclaimable once + attempt++, restart persistence, input-change staleness. Measured render:
**~124 s, ~1.08 GB peak RSS, 1.9 MB out**. **Docker is not installed → the Linux worker CONTAINER was not
built/run** (honest blocker; the render pipeline + job model are proven, the containerized Linux run is not).

## 5. Hosted outreach viewing links (addendum) — no MP4 email attachments
`share.ts`: only an APPROVED, non-placeholder render (or an approved #004–#006 master) is shareable; the
video is FROZEN (copied + sha256) so regenerating never changes a sent link. Public branded
`/v/[token]` page (noindex, no autoplay, verified `cal.com/artifex-labs-ob2qbv/30min` booking, reply
invite) + `/api/v/[token]/video` Range route (private file, token capability, seeking). Revoke → page
unavailable + media 410 + email-prepare blocked. Email prepare → subject/body/HTML with a clickable
thumbnail → viewing page + text fallback "Watch your video review"; **no `<video>`, no `.mp4`**. Reuses
`ARTIFEX_IDENTITY`. Middleware: `/v` + `/api/v` public. Live E2E all green + viewing-page screenshot.
Tests: `share.test.ts` (6) — placeholder/unapproved blocked, immutability across regen, revoke, no-mp4.

## 6. Integration (prepared, not deployed)
`integration/content-studio` off `dc3f093`; 3 CS commits cherry-pick with ZERO conflicts; diff touches
only `content-studio/*`, `/v` routes, `Shell.tsx` (nav), `middleware.ts` (public /v), `.gitignore`,
`deploy/`, `docs/content`, `scripts/` — **no** comms/quick-review/drizzle/sending files; 0 migrations changed.

## 7. Measured cost (corrects the ~$11 guess)
Polling worker CANNOT scale to zero on Railway (outbound-packet idle detection). Use **Cron** (run→exit,
≥5-min) → **~$0/mo absorbed by the $20 Pro plan** at 30–100 renders/mo (+R2 free egress); or always-on
**~$60/mo** for zero latency. Hard spend limit is workspace-wide (min $10). Full table + one consolidated
request in `DEPLOY-CONTENT-STUDIO.md`.

## Verification (Pass 3)
tsc 0 errors · **37 unit/integration tests** (job, upload, template-schema, client-video, durability,
share) · **8/8 PG durability** · `next build` OK (earlier) · live share E2E + viewing-page screenshot.

## Still open / honest
- Linux worker container: not built (no Docker).
- Live prod-business render: needs prod DB.
- LLM idea/script generation: mock only (deterministic bank) until a provider is authorized.
- `scripts/worker-loop.mjs` (Cron drainer) + R2 key wiring in the store: to write at deploy time.

---

# Pass 4 — Poster fix, video-artifact dispatch policy, delivery-cost honesty

**Branch:** `feat/content-studio` (starting 5251bc1). HEADs verified; `release/qr-manual-m1` still @ `dc3f093`
(manual-email release NOT advanced). No local container runtime (docker/podman/lima/colima absent) → the
Linux worker CONTAINER remains unbuilt/unrun. Local only.

1. **Black-player poster FIXED (item 1).** The poster is now FROZEN with the video at share time
   (`sharePosterPath`, 440×782 ~24 KB), served token-gated at `/api/v/[token]/poster` (revoke → 410, no
   asset exposure). Viewing page uses a client `ShareVideo` with a **click-to-play poster overlay**: a
   lightweight `<img>` poster paints first (never a black box), the `<video>` (preload=none) reveals only
   on the visitor's tap (user-initiated, not autoplay). Loading + error states shown. VERIFIED on an
   **empty-cache + throttled (~400 kbps/400 ms)** headless visit — screenshot shows the #004 cover +
   play button before playback. Range/seek preserved (206 + Content-Range). Poster is version-bound
   (same frozen approved render).
2. **Video-artifact dispatch policy (item 2 — testable core).** `email-draft.ts`: a draft binds
   business + share token + approved VERSION; `draftApprovalValid` goes false on revoke or version drift;
   `videoDispatchGate` re-checks suppression/pause/authorization/quota/business-binding/share-validity
   and **blocks (never silently downgrades to a bare email)** when a video link is missing/revoked/stale;
   PDF drafts keep their own path (no substitution). 9 tests. **NOT YET DONE:** wiring this into the live
   `comms/dispatch.ts` (persist a real draft in the manual workflow, call the gate inside the existing
   send path) — a coordinated change owned by the manual-email release; a non-delivering transport E2E is
   still pending that wiring. "Prepare email" today returns/saves the draft content, it does not yet
   create a draft inside the manual pipeline. Reported as the remaining integration.
3. **Migrations for jobs AND shares (item 4).** `deploy/content_studio_shares.sql` (shares +
   email_drafts, ordered after jobs) with explicit **backup (pg_dump) + rollback (DROP/restore)** steps.
   `next` still must not launch Chromium in prod (render API spawns a detached worker in dev; prod =
   enqueue + separate worker). `scripts/worker-loop.mjs` + R2 key wiring remain deploy-time TODOs.
4. **Delivery-cost HONESTY (item 5).** Corrected: R2 free egress applies ONLY if bytes go R2→viewer. The
   current `/api/v/[token]/video` route PROXIES through Railway → billed $0.05/GB (10k views ≈ ~$0.95/mo).
   Free delivery needs a per-load presigned R2 URL behind the stable `/v` page (revoke → no presign).
   Added build/startup overhead note to the Cron per-run cost. Full detail in `DEPLOY-CONTENT-STUDIO.md`.

**Still blocked / honest:** (3) a REAL prospect verification still needs production read access — the
local BI fixture is a fixture, not a real business; the gate is not weakened. Linux container: no runtime
available locally. LLM idea/script generation: deterministic bank only.

**Verification (Pass 4):** tsc 0 errors · **46 tests** (added email-draft ×9) · poster throttled/empty-cache
screenshot · revoke blocks poster+video (410). PG durability (8/8) unchanged (schema stable).

---

# Pass 6 — Worker-only hard guard, durable storage contract; deployment gated on R2 credentials

**Branch:** feat/content-studio (from 413c186). Integration base verified: e36fedf IS the tip of
release/contact-first-scheduler (latest accepted release). Local only.

- **Item 2 hard guard DONE:** `shouldSpawnLocally` now returns false in production UNCONDITIONALLY (even
  if CS_RENDER_MODE=local is set); `assertRenderConfigSafe` THROWS on CS_RENDER_MODE=local in prod and is
  called at enqueue — the web process can never fork Chromium in production. Tests added.
- **Item 1 storage contract DONE (code):** `cs-storage.ts` — durable object-key put/get/exists/delete for
  uploads/inputs/outputs/posters/share-media; S3/R2 backend (reuses the app S3 env) when
  STORAGE_PROVIDER=s3, else atomic writes under the DURABLE .data dir (never /tmp, never in-memory).
  Atomic rename → a failed publish is never visible as ready. `cs-storage.test.ts` (4). Wiring each
  route/worker call site to use these keys is the remaining mechanical step (scoped; not done to avoid
  breaking the verified local flow before R2 exists).
- **Verification:** tsc 0 · 60 tests · PG worker 9/9.

## DEPLOYMENT — genuinely gated (cannot produce a live URL this pass)
Verified in this environment: **no R2/S3 credentials configured (0 env files), no Cloudflare bucket**, and
**no container runtime** (docker/podman/lima/colima absent). Railway CLI is present. A live
outreach.artifexlabs.tech/content-studio therefore requires, at minimum:
  1) a Cloudflare **R2 bucket + API credentials** (new billable infra — needs your account + a budget);
  2) a Railway **staging service** creation + env (S3_*, CS_RENDER_MODE=worker, CHROME_PATH) — Railway
     builds the Dockerfile server-side (no local Docker needed), but the service must be created;
  3) applying the additive CS migrations to the staging DB (authorized, with pg_dump backup).
None of these can be self-provisioned without the R2 credentials + the budget number. This is the ONE
consolidated question (below). No live URL is claimed; nothing was deployed or sent.
