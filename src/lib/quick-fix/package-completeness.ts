// ─────────────────────────────────────────────────────────────────────────────
// PACKAGE COMPLETENESS / MATERIALIZATION CHAIN (Active Inventory Integrity mandate
// §4–§9, §34, §38).
//
// A package is NOT "ready" merely because some pieces exist. It progresses through a
// dependency chain: finding → subject → evidence(screenshots) → email copy →
// diagnostic PDF → offer page → personalized video (when eligible) → evergreen
// explainer. This module reports which links are MISSING or STALE and whether the
// only remaining gap is PAID media (personalized production, gated by #202 + capacity)
// — which is "Waiting for paid production", NOT "Blocked".
//
// The cheap layers (§6) should be complete broadly behind the outbound gate; the
// expensive media layer (§7) stays behind existing authorization. This function tells
// the "Complete Package" (§38) and "Repair All Eligible" (§9) actions exactly what to
// build, and in what order, without spending anything itself. PURE.
// ─────────────────────────────────────────────────────────────────────────────

export type DependencyKey =
  | "finding"
  | "subject"
  | "evidence-screenshots"
  | "email-copy"
  | "diagnostic-pdf"
  | "offer-page"
  | "personalized-video"
  | "evergreen-explainer";

export type DependencyStatus = "READY" | "MISSING" | "STALE" | "WAITING_FOR_PAID" | "NOT_REQUIRED";

export interface Dependency {
  dep: DependencyKey;
  status: DependencyStatus;
  detail: string;
  /** Repairing this link requires PAID media (TTS / render) → route via #202 + capacity. */
  paid: boolean;
  /** Repairing this link is a cheap, deterministic regeneration (safe to do broadly). */
  cheap: boolean;
}

// The canonical order the materialization pipeline builds in (§5).
export const DEPENDENCY_ORDER: DependencyKey[] = [
  "finding",
  "subject",
  "evidence-screenshots",
  "email-copy",
  "diagnostic-pdf",
  "offer-page",
  "personalized-video",
  "evergreen-explainer",
];

export interface CompletenessInput {
  hasFinding: boolean;
  hasSubject: boolean;
  /** READY only when ≥1 durable screenshot exists; STALE when captured against old evidence. */
  screenshotStatus: "READY" | "MISSING" | "STALE";
  /** Email/customer copy passed the safety + plain-language guard. */
  emailSafe: boolean;
  /** The diagnostic PDF can render truthfully from current evidence. */
  pdfRenderable: boolean;
  /** The offer page is purchasable (approved + requirements + copy-safe + trust video). */
  offerPageReady: boolean;
  /** Canonical evergreen explainer for the scope. */
  evergreenStatus: "READY" | "MISSING" | "STALE";
  /** Personalized diagnostic video. `required` reflects #202 finalist eligibility. */
  personalizedVideo: { required: boolean; status: "READY" | "MISSING" | "STALE" };
  /** Dependent assets were stamped against an older evidence version (§4 STALE). */
  evidenceStale: boolean;
  /** The offer was prepared under an older persuasion-policy version (§4 STALE). */
  policyStale: boolean;
}

export interface PackageCompleteness {
  dependencies: Dependency[];
  missing: Dependency[];
  stale: Dependency[];
  /** Cheap, deterministic repairs available now (no paid media). */
  cheapRepairs: Dependency[];
  /** The only remaining gaps are PAID media → "Waiting for paid production". */
  waitingForPaidOnly: boolean;
  /** Every required non-paid link is READY and fresh. */
  cheapComplete: boolean;
  /** Fully complete (including any required paid media). */
  complete: boolean;
}

function dep(dep: DependencyKey, status: DependencyStatus, detail: string, opts?: { paid?: boolean; cheap?: boolean }): Dependency {
  return { dep, status, detail, paid: !!opts?.paid, cheap: opts?.cheap ?? !opts?.paid };
}

/**
 * Assess the materialization state of a package. Deterministic + pure. STALE is treated
 * as a gap (must be reconciled), not as "present". Paid personalized video is separated
 * so the queue can show "Waiting for paid production" instead of "Blocked".
 */
export function assessPackageCompleteness(input: CompletenessInput): PackageCompleteness {
  const deps: Dependency[] = [];

  deps.push(input.hasFinding
    ? dep("finding", "READY", "primary evidence-backed finding chosen")
    : dep("finding", "MISSING", "no primary evidence-backed finding", { cheap: false }));

  deps.push(input.hasSubject
    ? dep("subject", "READY", "specific subject present")
    : dep("subject", "MISSING", "no specific subject", { cheap: true }));

  // Evidence screenshots — cheap to (re)capture via the screenshot worker.
  if (input.screenshotStatus === "READY" && !input.evidenceStale) deps.push(dep("evidence-screenshots", "READY", "supporting screenshots captured"));
  else if (input.screenshotStatus === "STALE" || (input.screenshotStatus === "READY" && input.evidenceStale)) deps.push(dep("evidence-screenshots", "STALE", "screenshots captured against older evidence — recapture", { cheap: true }));
  else deps.push(dep("evidence-screenshots", "MISSING", "no supporting screenshots captured", { cheap: true }));

  // Email copy — cheap deterministic regeneration from the canonical frame.
  if (input.emailSafe && !input.policyStale) deps.push(dep("email-copy", "READY", "email copy safe + current"));
  else if (input.policyStale) deps.push(dep("email-copy", "STALE", "copy prepared under an older policy — regenerate", { cheap: true }));
  else deps.push(dep("email-copy", "MISSING", "email copy fails the safety/plain-language guard", { cheap: true }));

  // Diagnostic PDF — renders on demand from current evidence.
  if (input.pdfRenderable && !input.evidenceStale) deps.push(dep("diagnostic-pdf", "READY", "diagnostic PDF renders truthfully"));
  else if (input.evidenceStale && input.pdfRenderable) deps.push(dep("diagnostic-pdf", "STALE", "PDF bound to older evidence — rebuild", { cheap: true }));
  else deps.push(dep("diagnostic-pdf", "MISSING", "diagnostic PDF has no renderable evidence", { cheap: true }));

  // Offer page — cheap regeneration (scope/copy).
  deps.push(input.offerPageReady
    ? dep("offer-page", "READY", "offer page complete + purchasable")
    : dep("offer-page", "MISSING", "offer page not yet purchasable", { cheap: true }));

  // Personalized video — PAID when required. STALE also needs a paid re-render.
  if (!input.personalizedVideo.required) deps.push(dep("personalized-video", "NOT_REQUIRED", "no personalized video required for this package"));
  else if (input.personalizedVideo.status === "READY") deps.push(dep("personalized-video", "READY", "personalized diagnostic video ready"));
  else if (input.personalizedVideo.status === "STALE") deps.push(dep("personalized-video", "WAITING_FOR_PAID", "personalized video is stale — re-render (paid)", { paid: true }));
  else deps.push(dep("personalized-video", "WAITING_FOR_PAID", "personalized video not yet produced (paid)", { paid: true }));

  // Evergreen explainer — a MISSING one BLOCKS (must be produced, not cheaply regenerated).
  if (input.evergreenStatus === "READY") deps.push(dep("evergreen-explainer", "READY", "canonical evergreen explainer bound"));
  else if (input.evergreenStatus === "STALE") deps.push(dep("evergreen-explainer", "STALE", "evergreen explainer stale — reconcile", { cheap: false }));
  else deps.push(dep("evergreen-explainer", "MISSING", "no canonical evergreen explainer for this scope", { cheap: false }));

  const missing = deps.filter((d) => d.status === "MISSING");
  const stale = deps.filter((d) => d.status === "STALE");
  const cheapRepairs = [...missing, ...stale].filter((d) => d.cheap);
  const openNonPaid = deps.filter((d) => (d.status === "MISSING" || d.status === "STALE") && !d.paid);
  const openPaid = deps.filter((d) => d.status === "WAITING_FOR_PAID");
  const cheapComplete = openNonPaid.length === 0;
  const complete = cheapComplete && openPaid.length === 0;
  const waitingForPaidOnly = cheapComplete && openPaid.length > 0;

  return { dependencies: deps, missing, stale, cheapRepairs, waitingForPaidOnly, cheapComplete, complete };
}
