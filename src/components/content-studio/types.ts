import type { Piece } from "@/lib/content-studio/types";

// Public-safe job shape sent to the browser (no absolute filesystem paths).
export interface SafeJob {
  id: string;
  pieceId: string;
  inputVersion: string;
  status: "queued" | "rendering" | "ready" | "failed";
  progress: number;
  stage: string;
  mode: "reuse-approved-audio" | "uploaded-vo";
  audioKind: "placeholder" | "uploaded" | "approved-master";
  audioLabel: string | null;
  outputRel: string | null;
  thumbRel: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface SafeUpload {
  name: string;
  bytes: number;
  durationSeconds: number | null;
  uploadedAt: string;
  kind: "uploaded" | "placeholder";
}

export interface Provenance {
  audioKind: "placeholder" | "uploaded" | "approved-master" | null;
  approved: boolean;
  approvalStale: boolean;
  postingAllowed: boolean;
}

export interface StudioItem {
  piece: Piece;
  postedAt: string | null;
  uploads: SafeUpload[];
  jobs: SafeJob[];
  provenance: Provenance;
}
