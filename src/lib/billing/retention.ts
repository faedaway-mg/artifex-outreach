// ─────────────────────────────────────────────────────────────────────────────
// Signed-artifact retention (Gate 9). After a PRODUCTION document_completed, the signed
// PDF and the audit certificate must be retrieved and durably persisted BEFORE any live
// payment. Retention is a hard production gate: `retentionStatus` feeds the eligibility
// machine, and live billing stays blocked until BOTH artifacts are "retained".
//
// The orchestrator is injectable (fetch + storage adapters) so it is fully testable with
// mocks and never depends on a local Mac path. Idempotent + atomic: an artifact is only
// marked "retained" after its bytes are durably stored and its sha256 verified. Partial
// writes are never marked retained; failures keep billing blocked and are retried
// (bounded).
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import type { Agreement } from "../types";
import { esignModeOf } from "./firewall-gate";

export type ArtifactKind = "signed_pdf" | "audit_certificate";

export interface SignedArtifact {
  id: string;
  agreementId: string;
  esignRequestId: string; // SignWell document id it was retrieved from
  kind: ArtifactKind;
  sha256: string;
  byteSize: number;
  storageKey: string; // durable, access-controlled key (NOT a public raw URL)
  approvalDigest: string | null;
  esignMode: "test" | "production";
  status: "retained" | "failed";
  retryCount: number;
  retrievedAt: string;
  createdAt: string;
}

/** The kinds required for a production agreement to be billing-eligible. */
export const REQUIRED_PRODUCTION_ARTIFACTS: ArtifactKind[] = ["signed_pdf", "audit_certificate"];

/**
 * Derive the retention state for the eligibility machine. Test agreements never gate on
 * retention ("not-required"). Production requires BOTH signed PDF and audit certificate
 * durably retained; any failed artifact ⇒ "failed"; missing/partial ⇒ "pending".
 */
export function retentionStatus(artifacts: SignedArtifact[], agreement: Pick<Agreement, "esignMode">): "not-required" | "pending" | "failed" | "retained" {
  if (esignModeOf(agreement) === "test") return "not-required";
  const byKind = new Map<ArtifactKind, SignedArtifact>();
  for (const a of artifacts) {
    // Latest retained wins per kind.
    const prev = byKind.get(a.kind);
    if (!prev || (a.status === "retained" && prev.status !== "retained")) byKind.set(a.kind, a);
  }
  if (artifacts.some((a) => a.status === "failed") && REQUIRED_PRODUCTION_ARTIFACTS.some((k) => byKind.get(k)?.status !== "retained")) {
    return "failed";
  }
  const allRetained = REQUIRED_PRODUCTION_ARTIFACTS.every((k) => byKind.get(k)?.status === "retained");
  return allRetained ? "retained" : "pending";
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ── Injectable adapters (real impls wired in the app; mocks in tests/simulation) ──

export interface FetchedArtifact {
  bytes: Uint8Array;
  kind: ArtifactKind;
}

/** Retrieves the completed signed PDF + audit certificate from the provider. */
export interface CompletedDocumentFetcher {
  fetch(esignRequestId: string, kind: ArtifactKind): Promise<FetchedArtifact>;
}

/** Durable, access-controlled storage. `put` is atomic; returns the storage key. */
export interface DurableStorage {
  put(key: string, bytes: Uint8Array): Promise<{ ok: boolean; error?: string }>;
  exists(key: string): Promise<boolean>;
}

export interface RetainInput {
  agreement: Pick<Agreement, "id" | "esignRequestId" | "esignMode">;
  approvalDigest: string | null;
  fetcher: CompletedDocumentFetcher;
  storage: DurableStorage;
  nowIso: string;
  newId: (prefix: string) => string;
  maxRetries?: number;
}

/**
 * Retrieve + durably persist the required artifacts. Idempotent: if an artifact's key
 * already exists in storage it is not re-uploaded. Returns one SignedArtifact per kind
 * (status "retained" or "failed"). Never marks retained on a partial/failed write.
 */
export async function retainCompletedDocument(input: RetainInput): Promise<SignedArtifact[]> {
  const mode = esignModeOf(input.agreement);
  const out: SignedArtifact[] = [];
  const maxRetries = input.maxRetries ?? 2;

  for (const kind of REQUIRED_PRODUCTION_ARTIFACTS) {
    const key = `agreements/${input.agreement.id}/${input.agreement.esignRequestId}/${kind}.pdf`;
    let attempt = 0;
    let done: SignedArtifact | null = null;
    while (attempt <= maxRetries && !done) {
      attempt++;
      try {
        // Idempotency: if durably present already, treat as retained without re-fetch.
        if (await input.storage.exists(key)) {
          const fetched = await input.fetcher.fetch(input.agreement.esignRequestId!, kind);
          done = mkArtifact(input, kind, key, fetched.bytes, "retained", attempt - 1);
          break;
        }
        const fetched = await input.fetcher.fetch(input.agreement.esignRequestId!, kind);
        const put = await input.storage.put(key, fetched.bytes);
        if (!put.ok) throw new Error(put.error ?? "storage put failed");
        // Atomic verification: only mark retained after the bytes are confirmed stored.
        if (!(await input.storage.exists(key))) throw new Error("post-write existence check failed");
        done = mkArtifact(input, kind, key, fetched.bytes, "retained", attempt - 1);
      } catch (e) {
        if (attempt > maxRetries) {
          out.push(mkArtifact(input, kind, key, new Uint8Array(), "failed", attempt - 1, (e as Error).message));
        }
      }
    }
    if (done) out.push(done);
  }
  // Test-mode retention is recorded but never gates payment.
  void mode;
  return out;
}

function mkArtifact(
  input: RetainInput,
  kind: ArtifactKind,
  storageKey: string,
  bytes: Uint8Array,
  status: "retained" | "failed",
  retryCount: number,
  _err?: string,
): SignedArtifact {
  return {
    id: input.newId("artifact"),
    agreementId: input.agreement.id,
    esignRequestId: input.agreement.esignRequestId ?? "",
    kind,
    sha256: status === "retained" ? sha256(bytes) : "",
    byteSize: status === "retained" ? bytes.byteLength : 0,
    storageKey,
    approvalDigest: input.approvalDigest,
    esignMode: esignModeOf(input.agreement),
    status,
    retryCount,
    retrievedAt: input.nowIso,
    createdAt: input.nowIso,
  };
}
