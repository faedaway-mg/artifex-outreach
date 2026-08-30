// ─────────────────────────────────────────────────────────────────────────────
// Completion orchestration (Gate 10). On an authenticated document_completed, the
// agreement is signed (webhook) and retention becomes PENDING. This idempotent job
// retrieves the completed PDF + audit certificate and durably stores them; only then is
// retention RETAINED. It never creates or executes a payment — live payment remains a
// separate explicit authorization gate. Safe to run from the webhook after a durable
// enqueue, or from a controlled worker/retry.
// ─────────────────────────────────────────────────────────────────────────────
import { getAgreement, getAgreementApproval, signedArtifactsForAgreement, insertSignedArtifact } from "../repo";
import { nowIso, newId } from "../store";
import { esignModeOf } from "./firewall-gate";
import { retainCompletedDocument, retentionStatus, REQUIRED_PRODUCTION_ARTIFACTS, type CompletedDocumentFetcher, type DurableStorage, type SignedArtifact } from "./retention";
import { approvalDigest } from "../agreement/approval";

export interface RetentionResult {
  status: "not-required" | "pending" | "failed" | "retained";
  artifacts: SignedArtifact[];
  skipped?: boolean;
  reason?: string;
}

/**
 * Retrieve + durably retain the signed artifacts for a completed agreement. Idempotent:
 * kinds already retained are not re-retrieved; a re-run after a partial failure only
 * retries the missing kinds. Returns the resulting retention status.
 */
export async function processCompletionRetention(
  agreementId: string,
  deps: { fetcher: CompletedDocumentFetcher; storage: DurableStorage },
): Promise<RetentionResult> {
  const agreement = await getAgreement(agreementId);
  if (!agreement) return { status: "failed", artifacts: [], skipped: true, reason: "agreement not found" };
  if (agreement.status !== "signed") return { status: "pending", artifacts: [], skipped: true, reason: `agreement is '${agreement.status}', not signed` };

  const existing = await signedArtifactsForAgreement(agreement.id);
  const retainedKinds = new Set(existing.filter((a) => a.status === "retained").map((a) => a.kind));
  // Idempotent short-circuit: all required kinds already retained.
  if (REQUIRED_PRODUCTION_ARTIFACTS.every((k) => retainedKinds.has(k))) {
    return { status: retentionStatus(existing, agreement), artifacts: existing };
  }

  const approval = await getAgreementApproval(agreement.id, agreement.version);
  const fresh = await retainCompletedDocument({
    agreement,
    approvalDigest: approval ? approvalDigest(approval.binding) : null,
    fetcher: deps.fetcher,
    storage: deps.storage,
    nowIso: nowIso(),
    newId,
  });

  // Persist only kinds not already retained (idempotency across retries).
  const persisted: SignedArtifact[] = [];
  for (const art of fresh) {
    if (art.status === "retained" && retainedKinds.has(art.kind)) continue;
    await insertSignedArtifact(art);
    persisted.push(art);
  }
  const all = await signedArtifactsForAgreement(agreement.id);
  void esignModeOf(agreement);
  return { status: retentionStatus(all, agreement), artifacts: all };
}
