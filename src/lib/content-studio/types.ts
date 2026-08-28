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
  audioFile: string | null; // absolute path to the VO mp3 used (uploaded), or null when reusing approved
  audioLabel: string | null; // display name of the audio used
  outputFile: string | null; // absolute path to the rendered mp4 (recommended posting file)
  outputRel: string | null; // public URL of the rendered mp4 (/content/...)
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
}

export interface AudioUpload {
  pieceId: string;
  file: string; // absolute path (private, under .data)
  name: string; // original filename
  bytes: number;
  durationSeconds: number | null;
  uploadedAt: string;
  kind: "uploaded" | "placeholder"; // explicit — set by the caller, never inferred from the name
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
