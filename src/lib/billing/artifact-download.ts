// ─────────────────────────────────────────────────────────────────────────────
// Authorized signed-artifact download (Gate 8). Server-authorized, agreement-scoped
// retrieval of durably-retained artifact bytes. No public URL, no raw object-id
// enumeration, no cross-agreement/test↔prod crossover, integrity-checked (sha256), with
// safe headers. The route handler wraps this with the existing operator session auth.
// ─────────────────────────────────────────────────────────────────────────────
import { getAgreement, signedArtifactsForAgreement, getSignedArtifactBlob } from "../repo";
import { closingCan } from "./authz";
import { sha256 } from "./retention";
import type { ArtifactKind } from "./retention";
import type { Role } from "../operators/roles";

export interface DownloadResult {
  ok: boolean;
  status: number; // HTTP-style status for the route
  contentType?: string;
  filename?: string;
  bytes?: Uint8Array;
  sha256?: string;
  auditPageEmbedded?: boolean;
  reason?: string;
}

const safeName = (s: string) => (s || "agreement").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);

/**
 * Resolve an artifact for download. Returns 403 (unauthorized), 404 (no such retained
 * artifact — indistinguishable from unknown agreement, so we don't leak existence), or 200
 * with bytes. Integrity is verified against the stored SHA-256 before returning.
 */
export async function getArtifactForDownload(input: {
  agreementId: string;
  kind: ArtifactKind;
  actorRole: Role;
}): Promise<DownloadResult> {
  // Money/legal-scoped download requires a closing-capable role.
  if (!closingCan(input.actorRole, "reconcile")) return { ok: false, status: 403, reason: "not authorized" };

  const agreement = await getAgreement(input.agreementId);
  if (!agreement) return { ok: false, status: 404, reason: "not found" };

  const artifacts = await signedArtifactsForAgreement(input.agreementId);
  const artifact = artifacts.find((a) => a.kind === input.kind && a.status === "retained");
  if (!artifact) {
    // If the audit page is embedded in the signed PDF, there is no separate certificate.
    if (input.kind === "audit_certificate" && artifacts.some((a) => a.kind === "signed_pdf" && a.status === "retained")) {
      return { ok: false, status: 409, auditPageEmbedded: true, reason: "audit page is embedded in the signed PDF; no separate certificate" };
    }
    return { ok: false, status: 404, reason: "artifact not retained" };
  }

  const blob = await getSignedArtifactBlob(artifact.storageKey);
  if (!blob || blob.data.byteLength === 0) return { ok: false, status: 404, reason: "artifact bytes missing" };

  // Integrity: the durable bytes must match the recorded hash.
  if (sha256(blob.data) !== artifact.sha256) return { ok: false, status: 409, reason: "artifact integrity check failed" };

  const label = input.kind === "signed_pdf" ? "signed" : "certificate";
  return {
    ok: true, status: 200,
    contentType: blob.contentType || "application/pdf",
    filename: `${safeName(agreement.agreementNumber)}-${label}.pdf`,
    bytes: blob.data,
    sha256: artifact.sha256,
  };
}
