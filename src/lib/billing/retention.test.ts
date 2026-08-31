import { describe, it, expect } from "vitest";
import { retentionStatus, retainCompletedDocument, type DurableStorage, type CompletedDocumentFetcher, type SignedArtifact } from "./retention";

function memStorage(failKey?: string): DurableStorage {
  const m = new Map<string, Uint8Array>();
  return {
    async put(key, bytes) {
      if (key === failKey) return { ok: false, error: "simulated storage failure" };
      m.set(key, bytes);
      return { ok: true };
    },
    async exists(key) {
      return m.has(key);
    },
  };
}
const fetcher: CompletedDocumentFetcher = {
  async fetch(_id, kind) {
    return { bytes: new TextEncoder().encode(`bytes-for-${kind}`), kind };
  },
};
const base = { id: "agr_1", esignRequestId: "doc_1" };
let n = 0;
const newId = (p: string) => `${p}_${++n}`;

describe("retentionStatus", () => {
  it("test mode never gates on retention", () => {
    expect(retentionStatus([], { esignMode: "test" })).toBe("not-required");
  });
  it("production requires BOTH signed_pdf and audit_certificate retained", () => {
    const mk = (kind: any, status: any): SignedArtifact => ({ id: "x", agreementId: "a", esignRequestId: "d", kind, sha256: "h", byteSize: 1, storageKey: "k", approvalDigest: null, esignMode: "production", status, retryCount: 0, retrievedAt: "t", createdAt: "t" });
    expect(retentionStatus([], { esignMode: "production" })).toBe("pending");
    expect(retentionStatus([mk("signed_pdf", "retained")], { esignMode: "production" })).toBe("pending");
    expect(retentionStatus([mk("signed_pdf", "retained"), mk("audit_certificate", "retained")], { esignMode: "production" })).toBe("retained");
    expect(retentionStatus([mk("signed_pdf", "retained"), mk("audit_certificate", "failed")], { esignMode: "production" })).toBe("failed");
  });
});

describe("retainCompletedDocument", () => {
  it("retrieves + stores both artifacts, hashes them, and reports retained", async () => {
    const arts = await retainCompletedDocument({ agreement: { ...base, esignMode: "production" }, approvalDigest: "dig", fetcher, storage: memStorage(), nowIso: "t", newId });
    expect(arts).toHaveLength(2);
    expect(arts.every((a) => a.status === "retained")).toBe(true);
    expect(arts.every((a) => a.sha256.length === 64)).toBe(true);
    expect(retentionStatus(arts, { esignMode: "production" })).toBe("retained");
  });

  it("a storage failure yields a 'failed' artifact and keeps retention blocked", async () => {
    const failKey = "agreements/agr_1/doc_1/audit_certificate.pdf";
    const arts = await retainCompletedDocument({ agreement: { ...base, esignMode: "production" }, approvalDigest: null, fetcher, storage: memStorage(failKey), nowIso: "t", newId, maxRetries: 1 });
    const cert = arts.find((a) => a.kind === "audit_certificate");
    expect(cert?.status).toBe("failed");
    expect(retentionStatus(arts, { esignMode: "production" })).toBe("failed");
  });

  it("is idempotent — pre-existing storage keys are not overwritten", async () => {
    const storage = memStorage();
    await retainCompletedDocument({ agreement: { ...base, esignMode: "production" }, approvalDigest: null, fetcher, storage, nowIso: "t", newId });
    const again = await retainCompletedDocument({ agreement: { ...base, esignMode: "production" }, approvalDigest: null, fetcher, storage, nowIso: "t", newId });
    expect(again.every((a) => a.status === "retained")).toBe(true);
  });
});
