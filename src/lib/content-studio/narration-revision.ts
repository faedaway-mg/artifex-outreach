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

/** The committed package states that make a proposal IMMUTABLE. Accepting a revision in place is refused for
 *  these — instead the operator forks a NEW unapproved draft ("Create improved version", mandate 26 §1C). */
export type PackageStateLike = "NONE" | "INCOMPLETE" | "READY_TO_APPROVE" | "FROZEN" | "SCHEDULED" | "SENT";
const IMMUTABLE_STATES: PackageStateLike[] = ["FROZEN", "SCHEDULED", "SENT"];

const STATE_LABEL: Record<PackageStateLike, string> = {
  NONE: "a new draft", INCOMPLETE: "an in-progress draft", READY_TO_APPROVE: "ready to approve",
  FROZEN: "frozen", SCHEDULED: "scheduled", SENT: "sent",
};

/** Stable reason codes returned to the client so the UI can react without string-matching (mandate 26 §1). */
export type NarrationReasonCode =
  | "OK" | "IMMUTABLE_PACKAGE" | "NOT_PROPOSAL" | "UNSUPPORTED_CLAIMS" | "NO_TEMPLATE"
  | "NARRATION_REQUIRED" | "INSUFFICIENT_EVIDENCE" | "NO_SAFE_ALTERNATIVE" | "IDEMPOTENT_NOOP";

export interface AcceptGuard { ok: boolean; reason: string | null; code: NarrationReasonCode }

/** Guard the ACCEPT-IN-PLACE action: a FROZEN / SCHEDULED / SENT package must never be mutated.
 *  A not-yet-frozen draft (NONE / INCOMPLETE / READY_TO_APPROVE) may be re-opened into a new revision even
 *  when it is quick-review-approved — accepting simply invalidates that pending approval + render (mandate 26
 *  §1B). (The old rule that blocked an approved-but-not-frozen draft was the reported "package is approved"
 *  bug: it exposed Regenerate/Accept and then refused them. Approval is not immutability.) */
export function canAcceptRevision(state: PackageStateLike, _approved: boolean): AcceptGuard {
  if (IMMUTABLE_STATES.includes(state)) return { ok: false, reason: `package is ${state} — immutable; accepting a revision in place is not allowed`, code: "IMMUTABLE_PACKAGE" };
  return { ok: true, reason: null, code: "OK" };
}

// ── TRUTHFUL, STATE-SPECIFIC PERMISSIONS (mandate 26 §1) ───────────────────────
export type NarrationActionMode = "editable" | "committed-fork";
export interface NarrationPermissions {
  mode: NarrationActionMode;
  state: PackageStateLike;
  approved: boolean;
  frozen: boolean;                    // committed/immutable (FROZEN/SCHEDULED/SENT)
  canAccept: boolean;                 // accept a revision in place (draft only)
  canRegenerate: boolean;             // read-only regenerate — always available
  canCreateImprovedVersion: boolean;  // fork a NEW unapproved draft from a committed package
  headline: string;                   // short state description for the operator
  detail: string;                     // truthful explanation of what is allowed and why
  acceptBlockedReason: string | null;
  acceptBlockedCode: NarrationReasonCode | null;
}

/** Decide, for a given package state + approval, exactly which narration actions are honest to show. The UI
 *  must render Accept/Regenerate ONLY when allowed, and "Create improved version" ONLY for committed states —
 *  never a control the canonical backend would predictably refuse. */
export function narrationPermissions(state: PackageStateLike, approved: boolean): NarrationPermissions {
  const frozen = IMMUTABLE_STATES.includes(state);
  if (frozen) {
    const scheduledOrSent = state === "SENT" ? "sent" : "scheduled";
    return {
      mode: "committed-fork", state, approved, frozen: true,
      canAccept: false, canRegenerate: true, canCreateImprovedVersion: true,
      headline: `This proposal is ${STATE_LABEL[state]}.`,
      detail: `The ${STATE_LABEL[state]} package, its approval, and any ${scheduledOrSent} send stay exactly as they are. “Create improved version” starts a NEW unapproved draft from the same evidence — it never replaces what's already ${scheduledOrSent}, and it needs fresh narration approval, new audio, and a new render before it can go out.`,
      acceptBlockedReason: `package is ${state} — immutable; accepting a revision in place is not allowed`,
      acceptBlockedCode: "IMMUTABLE_PACKAGE",
    };
  }
  return {
    mode: "editable", state, approved, frozen: false,
    canAccept: true, canRegenerate: true, canCreateImprovedVersion: false,
    headline: approved ? "This proposal is approved but not yet scheduled." : `This proposal is ${STATE_LABEL[state]}.`,
    detail: approved
      ? "You can still improve the narration. Accepting a new revision re-opens it: the prior approval and any pending render are invalidated, and the item returns to the narration → audio → render workflow."
      : "Analyze, expand, regenerate, compare, and accept a revision. Accepting installs a new script and requires new narration audio and a new render.",
    acceptBlockedReason: null, acceptBlockedCode: null,
  };
}

export interface ForkResult extends AcceptRevisionResult {
  forkedFromState: PackageStateLike;
}

/** Fork a NEW unapproved draft revision from a committed (frozen/scheduled/sent) package. This is a PURE
 *  template transform: it produces the next draft revision and tags its provenance. It NEVER touches the
 *  frozen package snapshot or its scheduled binding (those are separate, immutable records) — the caller
 *  simply saves the new template revision and clears any stale approval so the fork is unapproved. */
export function forkImprovedVersion(template: ContentTemplate, candidateNarration: string, state: PackageStateLike, now: string): ForkResult {
  const base = acceptNarrationRevision(template, candidateNarration, now);
  const next: ContentTemplate = {
    ...base.template,
    ...( { forkedFrom: { state, atRevision: base.priorRevision, at: now } } as Partial<ContentTemplate> ),
  };
  return { ...base, template: next, forkedFromState: state };
}

/** Idempotency probe: true when the template already holds exactly this candidate as its active script.
 *  Used to make double-tap accept/fork a no-op (no duplicate revisions). */
export function sameNarration(template: ContentTemplate, candidateNarration: string): boolean {
  const cur = (template.narration ?? []).slice(0, 12).map(clamp200).join("¶");
  const next = toNarrationLines(candidateNarration).join("¶");
  return cur === next;
}
