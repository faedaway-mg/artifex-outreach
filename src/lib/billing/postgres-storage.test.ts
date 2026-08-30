import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { PostgresBlobStorage } from "./postgres-storage";
import { getSignedArtifactBlob, signedArtifactBlobExists } from "../repo";
import { sha256, retentionStatus, retainCompletedDocument, type CompletedDocumentFetcher } from "./retention";

const KEY = "agreements/agr_1/doc_1/signed_pdf.pdf";
const BYTES = new TextEncoder().encode("the-signed-pdf-bytes");

const fetcher: CompletedDocumentFetcher = {
  async fetch(_id, kind) {
    return { bytes: new TextEncoder().encode(`bytes-for-${kind}`), kind };
  },
};
let n = 0;
const newId = (p: string) => `${p}_${++n}`;

describe("PostgresBlobStorage", () => {
  beforeEach(() => {
    __resetStoreForTests();
    n = 0;
  });

  it("put then exists is true; a fresh key exists is false", async () => {
    const storage = new PostgresBlobStorage();
    expect(await storage.exists(KEY)).toBe(false);
    const put = await storage.put(KEY, BYTES);
    expect(put.ok).toBe(true);
    expect(await storage.exists(KEY)).toBe(true);
    expect(await signedArtifactBlobExists("agreements/other/none/x.pdf")).toBe(false);
  });

  it("get returns identical bytes with matching sha256 + byteSize", async () => {
    const storage = new PostgresBlobStorage();
    await storage.put(KEY, BYTES);
    const blob = await getSignedArtifactBlob(KEY);
    expect(blob).not.toBeNull();
    expect(Array.from(blob!.data)).toEqual(Array.from(BYTES));
    expect(blob!.byteSize).toBe(BYTES.byteLength);
    expect(blob!.sha256).toBe(sha256(BYTES));
    expect(blob!.contentType).toBe("application/pdf");
  });

  it("repeated put is idempotent — no duplicate row, same bytes", async () => {
    const storage = new PostgresBlobStorage();
    await storage.put(KEY, BYTES);
    // A second put with DIFFERENT bytes must be a no-op (the key already exists).
    const put2 = await storage.put(KEY, new TextEncoder().encode("different-bytes"));
    expect(put2.ok).toBe(true);
    const blob = await getSignedArtifactBlob(KEY);
    expect(Array.from(blob!.data)).toEqual(Array.from(BYTES));
    expect(blob!.sha256).toBe(sha256(BYTES));
  });
});

describe("retainCompletedDocument with PostgresBlobStorage", () => {
  beforeEach(() => {
    __resetStoreForTests();
    n = 0;
  });

  it("a production agreement yields retained + retentionStatus retained, and re-running is idempotent", async () => {
    const storage = new PostgresBlobStorage();
    const agreement = { id: "agr_1", esignRequestId: "doc_1", esignMode: "production" as const };

    const arts = await retainCompletedDocument({ agreement, approvalDigest: "dig", fetcher, storage, nowIso: "t", newId });
    expect(arts).toHaveLength(2);
    expect(arts.every((a) => a.status === "retained")).toBe(true);
    expect(retentionStatus(arts, { esignMode: "production" })).toBe("retained");

    // Both artifact kinds are durably stored under their retention keys.
    expect(await storage.exists("agreements/agr_1/doc_1/signed_pdf.pdf")).toBe(true);
    expect(await storage.exists("agreements/agr_1/doc_1/audit_certificate.pdf")).toBe(true);

    // Re-running does not rewrite and still reports retained.
    const again = await retainCompletedDocument({ agreement, approvalDigest: "dig", fetcher, storage, nowIso: "t", newId });
    expect(again.every((a) => a.status === "retained")).toBe(true);
    expect(retentionStatus(again, { esignMode: "production" })).toBe("retained");

    const pdf = await getSignedArtifactBlob("agreements/agr_1/doc_1/signed_pdf.pdf");
    expect(Array.from(pdf!.data)).toEqual(Array.from(new TextEncoder().encode("bytes-for-signed_pdf")));
  });
});
