// ─────────────────────────────────────────────────────────────────────────────
// Frozen Quick Review PDF store. The exact one-page Quick Review PDF is rendered ONCE
// at operator approval and persisted here; preview, authorization, attachment download,
// and the real send all reuse THESE bytes instead of re-rendering. This is required for
// correctness: the PDF renderer (@react-pdf) is not byte-deterministic — it embeds a
// random font-subset tag — so re-rendering the same review yields a different SHA-256
// every time (the observed 82bd4c5e/9a448dc3 discrepancy). Freezing the artifact makes
// "the exact PDF the operator approved" a real, stable, verifiable object.
//
// It reuses the SAME durable blob infrastructure as the closing frozen unsigned PDF
// (signed_artifact_blobs) — content-addressable bytes + contentType + byteSize + sha256.
// No schema change is required. Keyed per (leadId, reviewVersion) so a reapproval after
// source-content drift produces a NEW immutable artifact and never mutates an old one.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { getSignedArtifactBlob, insertSignedArtifactBlob, signedArtifactBlobExists } from "../repo";

export const FROZEN_REVIEW_CONTENT_TYPE = "application/pdf";

/** Stable, deterministic, immutable blob key for a lead's frozen Quick Review PDF version. */
export function frozenReviewPdfKey(leadId: string, version: number): string {
  return `quick-review-pdf:${leadId}:v${version}`;
}

/** Immutable blob key for an M2 edited-revision artifact (keyed by the content revision fingerprint).
 *  Distinct namespace from the version key so the two approval schemes never collide. */
export function frozenRevisionPdfKey(leadId: string, revisionId: string): string {
  return `quick-review-pdf:${leadId}:rev:${revisionId}`;
}

/** SHA-256 (hex) of raw PDF bytes. */
export function sha256OfBytes(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 (hex) of a base64-encoded PDF. */
export function sha256OfBase64(pdfBase64: string): string {
  return createHash("sha256").update(Buffer.from(pdfBase64, "base64")).digest("hex");
}

export interface FrozenReviewPdf {
  pdfBase64: string;
  sha256: string;
  byteSize: number;
  contentType: string;
}

/**
 * Persist the frozen Quick Review PDF for this lead's review version (idempotent — a
 * second call with the same key + identical bytes is a no-op). Returns the SHA-256 of the
 * stored bytes. Refuses to silently overwrite a DIFFERENT artifact under the same key: an
 * immutable version key must map to exactly one byte-sequence (fail closed on collision).
 */
export async function storeFrozenReviewPdf(leadId: string, version: number, pdfBase64: string): Promise<string> {
  const { sha256 } = await storeFrozenPdfAtKey(frozenReviewPdfKey(leadId, version), pdfBase64);
  return sha256;
}

/** Load the frozen Quick Review PDF for this lead version, or null if none exists yet. */
export async function loadFrozenReviewPdf(leadId: string, version: number): Promise<FrozenReviewPdf | null> {
  return loadFrozenPdfAtKey(frozenReviewPdfKey(leadId, version));
}

/** True when a frozen artifact already exists for this lead version. */
export async function frozenReviewPdfExists(leadId: string, version: number): Promise<boolean> {
  return signedArtifactBlobExists(frozenReviewPdfKey(leadId, version));
}

// ── Generic key-based core (shared by the version + revision schemes) ──────────────────────────────
/**
 * Persist frozen PDF bytes at an arbitrary immutable key (idempotent for identical bytes; refuses a
 * DIFFERENT byte-sequence under the same key — an immutable artifact never changes). Returns SHA + size.
 */
export async function storeFrozenPdfAtKey(key: string, pdfBase64: string): Promise<{ sha256: string; byteSize: number }> {
  const bytes = Buffer.from(pdfBase64, "base64");
  const sha256 = sha256OfBytes(bytes);
  const existing = await getSignedArtifactBlob(key);
  if (existing) {
    if (existing.sha256 !== sha256) throw new Error(`frozen artifact ${key} already exists with a different SHA (immutable collision)`);
    return { sha256: existing.sha256, byteSize: existing.byteSize };
  }
  await insertSignedArtifactBlob({ artifactId: key, contentType: FROZEN_REVIEW_CONTENT_TYPE, byteSize: bytes.byteLength, sha256, data: new Uint8Array(bytes) });
  return { sha256, byteSize: bytes.byteLength };
}

/** Load frozen PDF bytes at an arbitrary key, or null. */
export async function loadFrozenPdfAtKey(key: string): Promise<FrozenReviewPdf | null> {
  const blob = await getSignedArtifactBlob(key);
  if (!blob) return null;
  return { pdfBase64: Buffer.from(blob.data).toString("base64"), sha256: blob.sha256, byteSize: blob.byteSize, contentType: blob.contentType };
}
