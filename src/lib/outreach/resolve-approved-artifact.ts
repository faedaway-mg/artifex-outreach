// ─────────────────────────────────────────────────────────────────────────────
// THE single canonical resolver for "the exact approved Quick Review PDF to attach for this lead".
// Every cold/prospect send path — Layer A dispatch, Layer B scheduled runner, the send-authorization
// policy, the operator send, the controlled test, and the dry-run preview — obtains its attachment
// through THIS function, and only through it. It NEVER renders: it returns bytes that were frozen once
// (at approval, or on first materialization) from the durable blob store, with integrity verified.
//
// Two approval schemes converge here behind ONE contract (ResolvedFrozenReview):
//   • unedited reviews  → the version-keyed approval artifact (quick-review-freeze).
//   • M2 edited reviews → an ADAPTER that resolves the revision MANIFEST into the SAME immutable
//     artifact identity + integrity checks: it loads the revision-keyed frozen bytes and verifies their
//     SHA against the manifest. Historical manifests stay readable; historical artifacts are untouched.
// Because authorization AND send both call this resolver for the same lead+state, their SHAs match by
// construction — there is no separate "authorize renders / send re-renders" divergence.
// ─────────────────────────────────────────────────────────────────────────────
import { sendGate, type ArtifactManifest } from "./review-revisions";
import { ensureFrozenReviewForSend, type ResolvedFrozenReview, type FreezeDeps } from "./quick-review-freeze";
import { loadFrozenPdfAtKey, frozenRevisionPdfKey, sha256OfBase64 } from "./frozen-review-pdf";

/**
 * ADAPTER: resolve an M2 revision manifest into the canonical ResolvedFrozenReview by LOADING the frozen
 * revision bytes from the durable store and verifying their SHA against the manifest. Fails closed on a
 * missing blob or any SHA mismatch (tamper). It never renders — the bytes were frozen at first use.
 */
export async function resolveFrozenReviewFromManifest(leadId: string, manifest: ArtifactManifest): Promise<ResolvedFrozenReview> {
  const blob = await loadFrozenPdfAtKey(frozenRevisionPdfKey(leadId, manifest.revisionId));
  if (!blob) return { ok: false, blocked: true, reason: "frozen revision artifact missing (blob not found)" };
  if (blob.sha256 !== manifest.pdfSha256 || sha256OfBase64(blob.pdfBase64) !== manifest.pdfSha256) {
    return { ok: false, blocked: true, reason: "frozen revision artifact tampered (SHA mismatch)" };
  }
  return { ok: true, pdfBase64: blob.pdfBase64, sha256: blob.sha256, byteSize: blob.byteSize, filename: manifest.filename, version: 0 };
}

/**
 * The one resolver. Dispatches on editorial state: an EDITED review must carry a version-bound approval
 * matching the current content (sendGate), whose frozen revision bytes are resolved via the adapter; an
 * UNEDITED review resolves the version-keyed approval/materialized artifact. Fails closed otherwise.
 */
export async function resolveApprovedArtifactForSend(leadId: string, deps: FreezeDeps = {}): Promise<ResolvedFrozenReview> {
  const gate = await sendGate(leadId);
  if (gate.edited) {
    if (!gate.allowed || !gate.manifest) return { ok: false, blocked: true, reason: gate.reason ?? "edited review not delivery-ready" };
    return resolveFrozenReviewFromManifest(leadId, gate.manifest);
  }
  return ensureFrozenReviewForSend(leadId, deps);
}
