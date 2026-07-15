// Determines which assets each acquisition strategy needs, and whether they
// already exist. Surfaced in the Approval Center so Jordan instantly knows if a
// lead is actually ready.
import type { AcquisitionStrategy } from "../types";

export type AssetKind = "brief" | "concept" | "video" | "research" | "message" | "content";

export const ASSET_LABELS: Record<AssetKind, string> = {
  brief: "Modernization Brief",
  concept: "Concept Website",
  video: "Personalized Video",
  research: "Research Notes",
  message: "Personalized Message",
  content: "Educational Content",
};

const REQUIRED: Record<AcquisitionStrategy, AssetKind[]> = {
  Personal: ["brief", "concept", "video", "research"],
  Assisted: ["brief", "concept"],
  Light: ["message"],
  Nurture: ["content"],
  "Manual Review": [],
  "Do Not Contact": [],
};

export function requiredAssetsFor(strategy: AcquisitionStrategy): AssetKind[] {
  return REQUIRED[strategy];
}

export interface AssetPresence {
  brief?: boolean;
  concept?: boolean;
  video?: boolean;
  research?: boolean;
  content?: boolean;
}

export interface AssetReadiness {
  required: AssetKind[];
  present: AssetKind[];
  missing: AssetKind[];
  ready: boolean;
}

export function assetReadiness(strategy: AcquisitionStrategy, presence: AssetPresence): AssetReadiness {
  const required = requiredAssetsFor(strategy);
  const isPresent = (a: AssetKind): boolean => {
    if (a === "message") return true; // generated as part of the sequence
    return Boolean((presence as Record<string, boolean | undefined>)[a]);
  };
  const present = required.filter(isPresent);
  const missing = required.filter((a) => !isPresent(a));
  return { required, present, missing, ready: missing.length === 0 };
}
