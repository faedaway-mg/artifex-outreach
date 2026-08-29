import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, insertAgreement, insertSignedArtifact } from "../repo";
import { makeAgreement, makeLead } from "../agreement/test-fixtures";
import { PostgresBlobStorage } from "./postgres-storage";
import { getArtifactForDownload } from "./artifact-download";
import { sha256, type SignedArtifact } from "./retention";

const BYTES = new TextEncoder().encode("%PDF-1.7 signed bytes");

async function agreementWithArtifact(kinds: Array<"signed_pdf" | "audit_certificate">) {
  const lead = await insertLead(makeLead() as any);
  const a = makeAgreement({ status: "signed", leadId: lead.id, esignRequestId: "doc_dl" });
  const { id, createdAt, updatedAt, ...rest } = a;
  const agreement = await insertAgreement({ ...rest, esignMode: "production" } as any);
  const storage = new PostgresBlobStorage();
  for (const kind of kinds) {
    const key = `agreements/${agreement.id}/doc_dl/${kind}.pdf`;
    await storage.put(key, BYTES);
    const art: SignedArtifact = { id: `art_${kind}`, agreementId: agreement.id, esignRequestId: "doc_dl", kind, sha256: sha256(BYTES), byteSize: BYTES.byteLength, storageKey: key, approvalDigest: null, esignMode: "production", status: "retained", retryCount: 0, retrievedAt: "t", createdAt: "t" };
    await insertSignedArtifact(art);
  }
  return agreement;
}

describe("getArtifactForDownload (Gate 8)", () => {
  beforeEach(() => __resetStoreForTests());

  it("returns bytes + integrity sha for an authorized operator", async () => {
    const a = await agreementWithArtifact(["signed_pdf"]);
    const r = await getArtifactForDownload({ agreementId: a.id, kind: "signed_pdf", actorRole: "founder" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(Buffer.from(r.bytes!).toString()).toBe("%PDF-1.7 signed bytes");
    expect(r.sha256).toBe(sha256(BYTES));
    expect(r.filename).toMatch(/-signed\.pdf$/);
    expect(r.contentType).toBe("application/pdf");
  });

  it("403 for an unauthorized role", async () => {
    const a = await agreementWithArtifact(["signed_pdf"]);
    expect((await getArtifactForDownload({ agreementId: a.id, kind: "signed_pdf", actorRole: "engineering" })).status).toBe(403);
  });

  it("404 for an unknown agreement and a non-retained artifact (no existence leak)", async () => {
    expect((await getArtifactForDownload({ agreementId: "nope", kind: "signed_pdf", actorRole: "founder" })).status).toBe(404);
    const a = await agreementWithArtifact([]);
    expect((await getArtifactForDownload({ agreementId: a.id, kind: "signed_pdf", actorRole: "founder" })).status).toBe(404);
  });

  it("409 'embedded' when the audit page is inside the signed PDF (no separate certificate)", async () => {
    const a = await agreementWithArtifact(["signed_pdf"]);
    const r = await getArtifactForDownload({ agreementId: a.id, kind: "audit_certificate", actorRole: "founder" });
    expect(r.status).toBe(409);
    expect(r.auditPageEmbedded).toBe(true);
  });

  it("serves a separate certificate when one is actually retained", async () => {
    const a = await agreementWithArtifact(["signed_pdf", "audit_certificate"]);
    const r = await getArtifactForDownload({ agreementId: a.id, kind: "audit_certificate", actorRole: "founder" });
    expect(r.ok).toBe(true);
    expect(r.filename).toMatch(/-certificate\.pdf$/);
  });
});
