// ─────────────────────────────────────────────────────────────────────────────
// ACCEPT A NARRATION REVISION (mandate 25 §B8). Pure, deterministic ContentTemplate → ContentTemplate
// transform, mirroring stale-content.ts. Accepting an expanded/edited draft:
//   • archives the CURRENT narration into revisionHistory (preserved, never shown as current),
//   • installs the accepted narration as the active script,
//   • bumps `revision` and marks ownerEdited,
//   • clears the per-line evidence receipts + storyboard (they described the OLD script; the evidence-gate
//     rebuilds them on the next Generate).
//
// AUDIO / RENDER SAFETY is a CONSEQUENCE, not extra bookkeeping: the render's inputVersion is a hash of the
// script (see runner.ts scriptVersion → narration.join). Changing the narration changes scriptVersion →
// changes inputVersion → the previously-READY render becomes STALE (isOutputStale) and the prior approval no
// longer matches (provenance.approved=false, approvalStale=true). So existing audio can no longer satisfy the
// new script, a NEW upload + NEW render are required, and an older render can never become canonical again.
//
// A FROZEN / approved-committed package is IMMUTABLE: canAcceptRevision() refuses before any mutation.
// ─────────────────────────────────────────────────────────────────────────────
import type { ContentTemplate } from "./template-schema";

const clamp200 = (s: string) => String(s).slice(0, 200);

/** Split accepted narration text into schema-valid narration lines (2..12), preferring sentence boundaries. */
export function toNarrationLines(text: string): string[] {
  const bySentence = (text ?? "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  let lines = bySentence.length ? bySentence : [String(text ?? "").trim()].filter(Boolean);
  if (lines.length < 2) {
    // Ensure at least two lines (schema minimum) without inventing content: keep the script + a neutral brand line.
    lines = [lines[0] ?? "A focused review from Artifex Labs.", "A focused review from Artifex Labs."];
  }
  if (lines.length > 12) {
    // Collapse the tail into the 12th line rather than dropping content.
    lines = [...lines.slice(0, 11), lines.slice(11).join(" ")];
  }
  return lines.map(clamp200);
}

export interface AcceptRevisionResult {
  template: ContentTemplate;
  priorRevision: number;
  newRevision: number;
  archivedLines: number;
  scriptChanged: boolean; // true when the narration actually differs (→ inputVersion will advance)
}

/** Pure transform: install the accepted narration as a NEW revision. The caller persists via saveTemplate
 *  and clears the piece's approval. `now` is injected for determinism. */
export function acceptNarrationRevision(template: ContentTemplate, acceptedNarration: string, now: string): AcceptRevisionResult {
  const priorRevision = template.revision ?? 0;
  const priorNarration = (template.narration ?? []).slice(0, 12).map(clamp200);
  const nextNarration = toNarrationLines(acceptedNarration);
  const scriptChanged = priorNarration.join("¶") !== nextNarration.join("¶");

  const history = [
    ...(template.revisionHistory ?? []),
    { revision: priorRevision, archivedAt: now, reason: "Replaced by an accepted expand-and-personalize revision.", evidenceState: template.evidenceState, narration: priorNarration },
  ].slice(-20);

  // Rebuild minimal, schema-valid beats bound to the new narration (title over line 0, brand over the last
  // line). The rich storyboard is rebuilt by the evidence-gate on the next Generate.
  const lastLine = nextNarration.length - 1;
  const next: ContentTemplate = {
    ...template,
    narration: nextNarration,
    beats: [
      { type: "title", lines: [0], mood: "problem", eyebrow: "REVIEW", headline: (template.businessName || "This business"), sub: "A focused, evidence-backed review" },
      { type: "brand", lines: [lastLine], mood: "resolve", tagline: "A focused review from Artifex Labs." },
    ],
    narrationEvidence: [],
    storyboard: undefined,
    revision: priorRevision + 1,
    revisionHistory: history,
    ownerEdited: true,
    ownerEditedAt: now,
  };
  return { template: next, priorRevision, newRevision: priorRevision + 1, archivedLines: priorNarration.length, scriptChanged };
}

/** The committed package states that make a proposal IMMUTABLE. Accepting a revision is refused for these. */
export type PackageStateLike = "NONE" | "INCOMPLETE" | "READY_TO_APPROVE" | "FROZEN" | "SCHEDULED" | "SENT";
const IMMUTABLE_STATES: PackageStateLike[] = ["FROZEN", "SCHEDULED", "SENT"];

export interface AcceptGuard { ok: boolean; reason: string | null }

/** Guard the accept action: a FROZEN / SCHEDULED / SENT package (or an approved one) must never be mutated.
 *  READY_TO_APPROVE is still a DRAFT (bidirectional) and may be re-opened into a new revision. */
export function canAcceptRevision(state: PackageStateLike, approved: boolean): AcceptGuard {
  if (IMMUTABLE_STATES.includes(state)) return { ok: false, reason: `package is ${state} — immutable; accepting a revision is not allowed` };
  if (approved) return { ok: false, reason: "package is approved — re-open it before revising the narration" };
  return { ok: true, reason: null };
}
