// ─────────────────────────────────────────────────────────────────────────────
// Frozen unsigned-PDF store. The exact unsigned agreement PDF is rendered ONCE at
// approval and persisted here; authorize + send reuse this frozen artifact instead of
// re-rendering. This is required for correctness: the PDF renderer (@react-pdf) is not
// byte-deterministic — it embeds a random font-subset tag — so re-rendering yields a
// different SHA-256 every time, which would permanently trip the approval /
// send-authorization PDF-binding drift guards. Freezing the artifact makes "the exact
// PDF that was approved" a real, stable object.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { getSignedArtifactBlob, insertSignedArtifactBlob, signedArtifactBlobExists } from "../repo";

const CONTENT_TYPE = "application/pdf";

/** Stable, deterministic blob key for an agreement version's frozen unsigned PDF. */
export function frozenUnsignedPdfKey(agreementId: string, version: number): string {
  return `unsigned-pdf:${agreementId}:v${version}`;
}

/** SHA-256 (hex) of the given base64-encoded PDF. */
export function sha256OfBase64(pdfBase64: string): string {
  return createHash("sha256").update(Buffer.from(pdfBase64, "base64")).digest("hex");
}

/**
 * Persist the frozen unsigned PDF for this agreement version (idempotent — a second call
 * with the same key is a no-op). Returns the SHA-256 of the stored bytes.
 */
export async function storeFrozenUnsignedPdf(agreementId: string, version: number, pdfBase64: string): Promise<string> {
  const key = frozenUnsignedPdfKey(agreementId, version);
  const bytes = Buffer.from(pdfBase64, "base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (!(await signedArtifactBlobExists(key))) {
    await insertSignedArtifactBlob({ artifactId: key, contentType: CONTENT_TYPE, byteSize: bytes.byteLength, sha256, data: new Uint8Array(bytes) });
  }
  return sha256;
}

/** Load the frozen unsigned PDF (base64 + SHA) for this agreement version, or null if none. */
export async function loadFrozenUnsignedPdf(agreementId: string, version: number): Promise<{ pdfBase64: string; sha256: string } | null> {
  const blob = await getSignedArtifactBlob(frozenUnsignedPdfKey(agreementId, version));
  if (!blob) return null;
  return { pdfBase64: Buffer.from(blob.data).toString("base64"), sha256: blob.sha256 };
}
