// ─────────────────────────────────────────────────────────────────────────────
// PERMANENT FAIL-CLOSED PACKAGE-INTEGRITY GUARD (mandate 16). One canonical validator that keeps synthetic,
// fixture, placeholder, or obviously-incomplete content OUT of readiness → approval → scheduling → dispatch.
// Pure + fully unit-tested. Used by the snapshot readiness classifier, the pre-dispatch verifier, and the
// scheduled-binding validator, so a "BreakBot test"/"t" package (Silver) can never reach Ready or send.
// ─────────────────────────────────────────────────────────────────────────────

export const PLACEHOLDER_OR_TEST_CONTENT = "PLACEHOLDER_OR_TEST_CONTENT";

// Subjects/bodies/names that mark synthetic or incomplete content. Deliberately conservative: it must catch
// obvious test/fixture/placeholder content without rejecting genuine short copy on its own.
const TEST_MARKER = /\b(breakbot|fixture|lorem ipsum|placeholder|synthetic|test[-_ ]?(only|content|lead|user|fixture)?|canary|do not send|sample copy)\b/i;
const NAME_MARKER = /\b(breakbot|fixture|canary|synthetic|test[-_ ]?(only|lead|user)?)\b/i;

function stripHtml(s: string): string { return s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " "); }

/**
 * Detect placeholder / synthetic / obviously-incomplete outreach content. Returns a specific reason string,
 * or null when the content looks like genuine outreach. `body` is optional (bindings carry only a digest);
 * the length heuristic only applies when a body is actually supplied.
 */
export function detectPlaceholderContent(input: { subject?: string | null; body?: string | null; businessName?: string | null }): string | null {
  const subject = (input.subject ?? "").trim();
  const name = (input.businessName ?? "").trim();
  if (!subject) return "empty subject";
  if (TEST_MARKER.test(subject)) return `test/placeholder subject: "${subject.slice(0, 48)}"`;
  if (NAME_MARKER.test(name)) return `test/placeholder business: "${name.slice(0, 48)}"`;
  if (input.body != null) {
    const body = stripHtml(input.body).replace(/\s+/g, " ").trim();
    if (body.length < 12) return `body too short to be real outreach ("${body}")`;
    if (TEST_MARKER.test(body)) return `test/placeholder body`;
  }
  return null;
}

export type ProspectPackageType = "EMAIL_ONLY" | "EMAIL_PDF" | "EMAIL_VIDEO" | "VIDEO_FOLLOW_UP";

export interface PackageIntegrityInput {
  type: ProspectPackageType;
  subject?: string | null;
  body?: string | null;
  businessName?: string | null;
  recipientValid: boolean;
  hasFrozenReview: boolean;   // frozen Quick Review PDF resolves (required for EMAIL_PDF/VIDEO)
  hasVideo: boolean;          // completed, verified video bound (required for EMAIL_VIDEO/VIDEO_FOLLOW_UP)
  hasShare: boolean;          // recipient-safe share reference (required for video packages)
  hasPriorReceipt?: boolean;  // required for VIDEO_FOLLOW_UP
  packageRevision?: number | null;
}

export interface IntegrityVerdict { ok: boolean; reason: string | null; code: "OK" | "PLACEHOLDER_OR_TEST_CONTENT" | "MISSING_REQUIRED_ARTIFACT" | "INVALID_RECIPIENT" | "MISSING_LINEAGE"; }

/** THE canonical completeness gate. Placeholder content ALWAYS fails first (fail-closed on synthetic copy),
 *  then per-type required artifacts. An intentionally EMAIL_ONLY package needs no video/PDF. */
export function assertDispatchable(i: PackageIntegrityInput): IntegrityVerdict {
  const ph = detectPlaceholderContent({ subject: i.subject, body: i.body, businessName: i.businessName });
  if (ph) return { ok: false, reason: ph, code: "PLACEHOLDER_OR_TEST_CONTENT" };
  if (!i.recipientValid) return { ok: false, reason: "no valid recipient", code: "INVALID_RECIPIENT" };
  if (!i.packageRevision) return { ok: false, reason: "no package revision", code: "MISSING_REQUIRED_ARTIFACT" };
  // Per-type required artifacts.
  const needsPdf = i.type === "EMAIL_PDF" || i.type === "EMAIL_VIDEO";
  const needsVideo = i.type === "EMAIL_VIDEO" || i.type === "VIDEO_FOLLOW_UP";
  if (needsPdf && !i.hasFrozenReview) return { ok: false, reason: "frozen Quick Review PDF missing/unresolved", code: "MISSING_REQUIRED_ARTIFACT" };
  if (needsVideo && !i.hasVideo) return { ok: false, reason: "completed video missing", code: "MISSING_REQUIRED_ARTIFACT" };
  if (needsVideo && !i.hasShare) return { ok: false, reason: "recipient-safe video share missing", code: "MISSING_REQUIRED_ARTIFACT" };
  if (i.type === "VIDEO_FOLLOW_UP" && !i.hasPriorReceipt) return { ok: false, reason: "prior-send receipt reference missing", code: "MISSING_LINEAGE" };
  return { ok: true, reason: null, code: "OK" };
}

/** Classify a persisted prospect package into its canonical type from its bound artifacts. */
export function classifyPackageType(pkg: { video?: unknown; review?: unknown; videoRequired?: boolean } | null | undefined): ProspectPackageType {
  if (!pkg) return "EMAIL_ONLY";
  if (pkg.video) return "EMAIL_VIDEO";
  if (pkg.review) return "EMAIL_PDF";
  return "EMAIL_ONLY";
}
