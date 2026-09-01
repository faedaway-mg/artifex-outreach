// Content Studio — STALE narration invalidation (narration-quality mandate, section A).
//
// When a client project becomes NEEDS_EVIDENCE, any previously approved/generated narration is now
// obsolete and MUST NOT keep presenting itself as recordable/approved content (the Purple "271+ reviews"
// defect). This module performs that invalidation, purely and deterministically:
//   • archives the current narration into revisionHistory (preserved, never shown as current),
//   • sets evidenceState = "needs-evidence" and a specific evidenceDeficiency to display,
//   • replaces the active narration with a NEUTRAL placeholder (never the stale script),
//   • strips the storyboard + per-line receipts (they described the withdrawn finding),
//   • bumps the revision.
// The output is a schema-valid ContentTemplate (two narration lines, one trailing brand beat) so it round-
// trips through parseTemplate/saveTemplatePg. Clearing the piece's APPROVAL is done by the caller.

import type { ContentTemplate } from "./template-schema";

// The neutral active script shown while a project waits on evidence — deliberately generic-but-honest and
// NEVER a stale sales line. The UI hides even this when evidenceState is needs-evidence; it exists only so
// the stored doc stays schema-valid and carries no obsolete claim.
const PLACEHOLDER_NARRATION = [
  "This project is waiting on a directly-observed website finding before a script is written.",
  "A focused review from Artifex Labs.",
];

export interface InvalidateResult {
  template: ContentTemplate;
  changed: boolean;         // false when it was already invalidated (idempotent no-op)
  archivedLines: number;    // how many narration lines were moved to history
}

/** Invalidate a template's active narration because its evidence no longer supports a script. Idempotent:
 *  re-invalidating an already-neutralized template does not re-archive the placeholder. `now` is passed in
 *  (deterministic/testable). */
export function invalidateNarration(template: ContentTemplate, deficiency: string, now: string): InvalidateResult {
  const alreadyNeutral =
    template.evidenceState === "needs-evidence" &&
    template.narration.length === PLACEHOLDER_NARRATION.length &&
    template.narration[0] === PLACEHOLDER_NARRATION[0];

  if (alreadyNeutral) {
    // Keep the deficiency current, but don't re-archive the placeholder.
    return { template: { ...template, evidenceDeficiency: deficiency }, changed: false, archivedLines: 0 };
  }

  const priorNarration = (template.narration ?? []).slice(0, 12).map((l) => String(l).slice(0, 200));
  const history = [
    ...(template.revisionHistory ?? []),
    {
      revision: template.revision ?? 0,
      archivedAt: now,
      reason: "Invalidated on flip to needs-evidence — script no longer supported by evidence.",
      evidenceState: template.evidenceState,
      narration: priorNarration,
    },
  ].slice(-20);

  const next: ContentTemplate = {
    ...template,
    narration: [...PLACEHOLDER_NARRATION],
    beats: [
      { type: "title", lines: [0], mood: "problem", eyebrow: "NEEDS EVIDENCE", headline: (template.businessName || "This business"), sub: "Awaiting a directly-observed finding" },
      { type: "brand", lines: [1], mood: "resolve", tagline: "A focused review from Artifex Labs." },
    ],
    narrationEvidence: [],
    storyboard: undefined,
    evidenceState: "needs-evidence",
    evidenceDeficiency: deficiency,
    revision: (template.revision ?? 0) + 1,
    revisionHistory: history,
    // A stale invalidation is not an owner hand-edit.
    ownerEdited: false,
  };
  return { template: next, changed: true, archivedLines: priorNarration.length };
}
