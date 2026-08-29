# Content Studio storage wiring map (Gate 5 inventory) — before/after

Every artifact touchpoint, its current storage behavior, and the required `getArtifactStore()` operation +
object-key class. Foundation done: cs-storage-pg (engine), storage-factory (ArtifactStore), env-guard,
cs-object-key (buildObjectKey). REMAINING = wire each caller below onto the store (Gates 7–15).

| Caller | Current behavior | Required ArtifactStore op | Key class | Auth | Limit/accounting |
| --- | --- | --- | --- | --- | --- |
| `api/content-studio/upload/route.ts` | writes MP3 to `.data/…/uploads` (private local) | `put()` | `upload` | operator | reserve + source-byte cap |
| `store.ts latestUpload / uploadsDirFor` | local file paths in job state | resolve by object key | `upload` | — | — |
| `content-studio-render.mjs` (worker) reads VO | reads local `audioFile` path | `readFull()` by input key | `render-input` | ownership | hash/size validate |
| worker output (`field-note-*-final*.mp4`) | writes to `public/content/field-note-*` | `put()` (ownership-fenced) | `render-output` | lease/ownership | output-byte cap + consume reservation |
| worker poster (frame-zero cover) | local png | `put()` | `poster` | lease/ownership | poster-byte cap |
| `store.ts getPieces recommendedRel` | resolves local mp4 path | serve via media route by output key | `render-output` | operator | — |
| `api/content-studio/audio/[pieceId]` | streams local upload file | `getMeta()`+`readRange()` | `upload` | operator | — |
| `api/v/[token]/video` | Range-streams `shareMediaPath` local mp4 | `getMeta()`+`readRange()` | `share-media`/`render-output` | share token | max-range cap |
| `api/v/[token]/poster` | serves `sharePosterPath` local jpg | `getMeta()`+`readFull()` | `poster` | share token | — |
| `share.ts createShare` | copies mp4 + poster to `.data/shares/media` | reference approved output key (avoid copy unless needed) | `share-media` | — | no double-count |
| NEW: download route | (none — uses recommendedRel) | `getMeta()`+`readFull()`+Content-Disposition | `render-output` | operator | — |
| NEW: storage meter | (accounting view exists) | `storageUsagePg()` + reservations | — | operator | authoritative |

## Remaining code gates (7–19), in order
7 upload→store · 8 worker input→store · 9 worker output/poster→store (ownership-fenced, reconcile) ·
10 media/Range routes→store · 11 download/poster routes · 12 hosted shares (reference, not copy) ·
13 reservations table + hard limits (content_studio_storage_reservations) · 14 cleanup/expiry ·
15 operator storage meter · 16 env-guard at web/worker/enqueue boundaries · 17 legacy-storage removal +
structural test that production paths use getArtifactStore() · 18 full acceptance · 19 handoff.

Foundation ready to build on: `buildObjectKey`/`isValidObjectKey` (cs-object-key.ts), `getArtifactStore`/
`resolveStorageMode` (storage-factory.ts), `assertStagingAcceptanceSafe`/`assertProductionRuntimeSafe`
(env-guard.ts), and the PG adapter (cs-storage-pg.ts) — all tested.
