// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE TRUTH (PART S) — ONE EVIDENCE TRUTH, staleness model.
//
// A single offer has ONE canonical body of evidence (the EvidencePackage: real
// screenshots + evidence-graded findings). Every DEPENDENT artifact — the diagnostic
// PDF, a personalized video, any screenshot-derived asset — is a PRESENTATION of that
// one truth, generated against a specific SNAPSHOT of it. When the underlying evidence
// materially changes (a finding is added/removed/regraded, a screenshot is recaptured),
// any dependent artifact generated against the OLD snapshot is now STALE: it may show
// the customer something that is no longer what we actually observed.
//
// This module is PURE + READ-ONLY. It computes a canonical, deterministic evidence
// VERSION (hash) for an offer's package, detects which bound assets were generated
// against an older version (STALE), and answers whether an approval must be invalidated
// because the evidence changed materially. It NEVER mutates the package, the store, or
// any external state, performs NO sends and NO charges.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import type { EvidencePackage, EvidenceFinding, EvidenceScreenshot, AssetStatus } from "./evidence-package";

/** Bump when the canonicalization rule for the evidence hash changes. */
export const EVIDENCE_TRUTH_VERSION = "evidence-truth.v1";

/**
 * The MATERIAL evidence a dependent artifact depends on. Deliberately narrow: only the
 * facts that, if changed, would make an already-generated PDF/video/derivative wrong.
 * We intentionally EXCLUDE volatile/cosmetic fields (imageRoute, detail strings,
 * generatedAt, offer.confidence rollup) so re-reading the same real evidence yields the
 * SAME hash (idempotent) and only a real content change bumps the version.
 */
function canonicalFinding(f: EvidenceFinding): Record<string, unknown> {
  return {
    id: f.id,
    // plain restatement carries the actual claim shown to the customer
    plain: (f.plain ?? "").trim(),
    whyItMatters: (f.whyItMatters ?? "").trim(),
    confidenceLabel: f.confidenceLabel,
    // round the score so trivial float jitter never bumps the hash
    confidenceScore: Math.round((f.confidenceScore ?? 0) * 1000) / 1000,
    screenshotId: f.screenshotId ?? null,
  };
}

function canonicalScreenshot(s: EvidenceScreenshot): Record<string, unknown> {
  return {
    id: s.id,
    viewport: s.viewport,
    // the pixel identity of the captured image — a recapture changes this
    sha256: s.sha256 ?? null,
    sourceUrl: s.sourceUrl ?? null,
    status: s.status,
  };
}

/**
 * Build the canonical, order-stable object the evidence hash is taken over. Findings
 * and screenshots are sorted by id so ordering never affects the version.
 */
export function canonicalEvidence(pkg: EvidencePackage): Record<string, unknown> {
  const findings = [...pkg.findings]
    .map(canonicalFinding)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const screenshots = [...pkg.screenshots]
    .map(canonicalScreenshot)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    v: EVIDENCE_TRUTH_VERSION,
    offerId: pkg.offerId,
    leadId: pkg.leadId,
    evidenceGrade: pkg.evidenceGrade,
    findings,
    screenshots,
  };
}

/**
 * The canonical evidence VERSION for an offer's package: a deterministic hash of the
 * material evidence. Two packages built from the SAME real evidence produce the SAME
 * version; any material change (finding added/removed/regraded, screenshot recaptured)
 * produces a DIFFERENT version. Prefixed so it is self-describing when stamped onto a
 * stored asset binding (store.evidenceVersion).
 */
export function evidenceVersion(pkg: EvidencePackage): string {
  const canon = JSON.stringify(canonicalEvidence(pkg));
  const hash = createHash("sha256").update(canon).digest("hex").slice(0, 16);
  return `ev1_${hash}`;
}

/** A dependent artifact and the evidence version it was generated against. */
export interface DependentAsset {
  /** Which asset this is — the customer-facing artifact kind. */
  kind: "diagnosticPdf" | "personalizedVideo" | "screenshotDerivative";
  /** The evidence version stamped when this asset was generated. Null ⇒ never stamped. */
  generatedEvidenceVersion: string | null;
  /** Whether a real artifact currently exists (vs merely renderable). */
  present: boolean;
}

export type StaleReason =
  | "OK"           // asset current: stamped version == current version
  | "STALE"        // stamped against an OLDER evidence version — must regenerate
  | "UNSTAMPED"    // an artifact exists but carries no evidence version — cannot prove currency
  | "NOT_PRESENT"; // no artifact to be stale

export interface StaleAssetResult {
  kind: DependentAsset["kind"];
  status: StaleReason;
  /** True when the customer must NOT be shown this asset as-is (STALE or UNSTAMPED). */
  stale: boolean;
  expected: string;   // the current evidence version
  observed: string | null; // the asset's stamped version
  detail: string;
}

export interface StaleDetection {
  /** The current canonical evidence version for this offer. */
  currentVersion: string;
  assets: StaleAssetResult[];
  /** True when ANY present artifact is stale/unstamped (cannot be safely presented). */
  anyStale: boolean;
}

/**
 * Detect which dependent assets are stale relative to the offer's CURRENT evidence.
 * An asset is STALE when it was generated against a different (older) evidence version;
 * UNSTAMPED when it exists but has no version to compare (we cannot prove it current, so
 * we fail closed and treat it as not-presentable); NOT_PRESENT when there is no artifact.
 *
 * Pure: reads the package + the supplied asset stamps only. Mutates nothing.
 */
export function detectStaleAssets(pkg: EvidencePackage, assets: DependentAsset[]): StaleDetection {
  const currentVersion = evidenceVersion(pkg);
  const results: StaleAssetResult[] = assets.map((a) => {
    if (!a.present) {
      return {
        kind: a.kind,
        status: "NOT_PRESENT" as StaleReason,
        stale: false,
        expected: currentVersion,
        observed: a.generatedEvidenceVersion,
        detail: "No generated artifact — nothing to be stale.",
      };
    }
    if (!a.generatedEvidenceVersion) {
      return {
        kind: a.kind,
        status: "UNSTAMPED" as StaleReason,
        stale: true,
        expected: currentVersion,
        observed: null,
        detail: "Artifact carries no evidence version — cannot prove it matches current evidence; regenerate with a stamp.",
      };
    }
    if (a.generatedEvidenceVersion !== currentVersion) {
      return {
        kind: a.kind,
        status: "STALE" as StaleReason,
        stale: true,
        expected: currentVersion,
        observed: a.generatedEvidenceVersion,
        detail: "Generated against an older evidence version — the underlying findings/screenshots changed; regenerate before showing the customer.",
      };
    }
    return {
      kind: a.kind,
      status: "OK" as StaleReason,
      stale: false,
      expected: currentVersion,
      observed: a.generatedEvidenceVersion,
      detail: "Current: generated against the offer's present evidence.",
    };
  });
  return { currentVersion, assets: results, anyStale: results.some((r) => r.stale) };
}

/**
 * Whether an approval taken against `approvedEvidenceVersion` must be INVALIDATED
 * because the offer's current evidence changed materially. A prior sign-off can never
 * carry over to a message built on different evidence. Returns a small verdict object;
 * the caller (store/route) performs any actual invalidation — this stays pure.
 *
 * `approvedEvidenceVersion == null` ⇒ approval predates evidence stamping; we fail
 * closed and require re-approval (invalidate=true) so an unstamped approval can never
 * silently authorize changed evidence.
 */
export interface ApprovalInvalidation {
  invalidate: boolean;
  reason: string;
  approvedVersion: string | null;
  currentVersion: string;
}

export function approvalInvalidatedByEvidenceChange(
  pkg: EvidencePackage,
  approvedEvidenceVersion: string | null,
): ApprovalInvalidation {
  const currentVersion = evidenceVersion(pkg);
  if (approvedEvidenceVersion == null) {
    return {
      invalidate: true,
      reason: "Approval carries no evidence version — cannot prove it was taken against the current evidence; re-approval required.",
      approvedVersion: null,
      currentVersion,
    };
  }
  if (approvedEvidenceVersion !== currentVersion) {
    return {
      invalidate: true,
      reason: "Evidence changed materially since approval — the prior sign-off cannot authorize a message built on different evidence.",
      approvedVersion: approvedEvidenceVersion,
      currentVersion,
    };
  }
  return {
    invalidate: false,
    reason: "Evidence unchanged since approval — the sign-off still applies.",
    approvedVersion: approvedEvidenceVersion,
    currentVersion,
  };
}

/**
 * Convenience: is a bound asset (holding its own stamped evidenceVersion + status)
 * currently presentable? A READY asset that is stale/unstamped must be downgraded —
 * this returns the effective status a presenter should use.
 */
export function effectiveAssetStatus(current: AssetStatus, generatedEvidenceVersion: string | null, currentVersion: string): AssetStatus {
  if (current !== "READY") return current;
  if (!generatedEvidenceVersion) return "UNVERIFIED";
  if (generatedEvidenceVersion !== currentVersion) return "STALE";
  return "READY";
}
