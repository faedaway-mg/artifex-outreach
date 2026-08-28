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
