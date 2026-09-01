// Content Studio — Social / Field Notes video workflow types.
// A "piece" is one Field Note (concept + narration + generated thumbnail + rendered video).
// A "job" is one render of a piece bound to a specific script/audio/template version. Jobs are
// persisted (survive browser refresh) and de-duplicated so repeated clicks never double-render.

export type JobStatus = "queued" | "rendering" | "ready" | "failed";

// Audio provenance — tracked EXPLICITLY, never inferred from a filename. "placeholder" = a demo/TTS
// stand-in (never postable/approvable); "uploaded" = an operator-provided real voiceover (review →
// approve); "approved-master" = reused byte-for-byte from a previously-approved final (#004–#006).
export type AudioKind = "placeholder" | "uploaded" | "approved-master";

export interface RenderJob {
  id: string; // "csjob_..."
  pieceId: string; // "004"
  inputVersion: string; // deterministic hash of {scriptVersion, audioSig, templateVersion}
  status: JobStatus;
  progress: number; // 0..1
  stage: string; // human-facing label ("Rendering frames 240/635")
  mode: "reuse-approved-audio" | "uploaded-vo"; // how the audio is sourced
  audioKind: AudioKind; // explicit provenance of the audio in this render
  audioFile: string | null; // LEGACY absolute path to the VO mp3 (dev fallback), or null when reusing approved
  audioKey: string | null; // canonical ArtifactStore key for the uploaded VO — the cross-process reference
  audioSha: string | null; // integrity of the uploaded VO bytes (worker validates before rendering)
  audioLabel: string | null; // display name of the audio used
  outputFile: string | null; // LEGACY absolute path to the rendered mp4 (dev fallback / ffmpeg scratch)
  outputRel: string | null; // LEGACY public URL of the rendered mp4 (/content/...) — dev only
  outputKey: string | null; // canonical ArtifactStore key for the rendered mp4 (durable, ownership-fenced)
  posterKey: string | null; // canonical ArtifactStore key for the frame-zero poster (durable)
  screenshotKey?: string | null; // canonical key of the verified website screenshot consumed by this render (I-C)
  screenshotSha?: string | null; // integrity of that screenshot's bytes — bound into inputVersion (reproducible)
  storyboard?: import("./template-schema").StoryboardScene[] | null; // evidence-led scenes: which shot composites into which interior scene (F addendum)
  thumbRel: string | null; // public URL of the thumbnail
  error: string | null;
  attempt: number;
  pid: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

// A piece as presented to the UI. Seeded pieces (#001–#006) come from the catalog; the mutable
// bits (posted marker, jobs, uploads) come from the persistent store.
export interface Piece {
  id: string;
  title: string;
  concept: string; // the on-screen hook / secondary line
  narration: string[]; // narration lines (empty when VEED-authored without a timing sheet)
  captionIG: string | null;
  captionLI: string | null;
  sceneBasename: string | null; // scene HTML wired into the renderer (null = pre-rendered / VEED)
  renderable: boolean; // true when the real renderer can (re)generate this piece
  targetSeconds: number | null;
  thumbRel: string; // public URL of the generated 1080×1920 cover
  recommendedRel: string | null; // public URL of the current recommended posting file
  hasThumbnailFirst: boolean; // whether the recommended file embeds the cover as frame zero
  // ── Client videos (section F/G): the business binding, per-line evidence, and its live screenshot. ──
  businessId?: string | null; // lead id for a client-<leadId> piece
  narrationEvidence?: import("./template-schema").NarrationEvidence[]; // receipt per material narration line
  evidenceState?: "evidence-backed" | "needs-evidence";
  evidenceDeficiency?: string | null; // exact deficiency to show when needs-evidence (stale script hidden)
  hasArchivedNarration?: boolean;     // a prior script is preserved in revision history
  revision?: number;
  ownerEdited?: boolean;
  screenshotRel?: string | null; // authenticated route to the business's captured website screenshot
  screenshotReady?: boolean;      // a verified capture exists (client videos) — gates the one Generate action
}

export interface AudioUpload {
  pieceId: string;
  file: string; // absolute path (LEGACY — dev fallback; production reads via objectKey)
  objectKey?: string; // canonical ArtifactStore key — the cross-process reference (web↔worker)
  sha256?: string; // integrity of the stored bytes
  name: string; // original filename
  bytes: number;
  durationSeconds: number | null;
  uploadedAt: string;
  kind: "uploaded" | "placeholder"; // explicit — set by the caller, never inferred from the name
  detectedType?: "mp3" | "m4a" | "aac" | "wav" | null; // real container detected from the bytes (I-A)
}

// A recorded approval — an explicit operator action, bound to the EXACT render it approved. It goes
// stale automatically when the piece's inputs change (a newer job with a different inputVersion exists).
export interface Approval {
  pieceId: string;
  jobId: string;
  inputVersion: string;
  outputRel: string;
  audioSig: string; // the audio that was approved
  approvedAt: string;
}
