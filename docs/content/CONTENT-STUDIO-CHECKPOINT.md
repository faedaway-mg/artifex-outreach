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
