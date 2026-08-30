import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { __resetStoreForTests } from "../store";
import { insertLead, insertAgreement, getAgreement, signedArtifactsForAgreement } from "../repo";
import { makeAgreement, makeLead } from "../agreement/test-fixtures";
import { handleSignwellWebhook } from "./webhook";
import { processCompletionRetention } from "../billing/completion-retention";
import { PostgresBlobStorage } from "../billing/postgres-storage";
import { retentionStatus, type CompletedDocumentFetcher } from "../billing/retention";

const WEBHOOK_ID = "whk"; const TIME = 1787990119;
const hashFor = (type: string) => createHmac("sha256", WEBHOOK_ID).update(`${type}@${TIME}`).digest("hex");
const completion = (docId: string) => JSON.stringify({ event: { id: `e_${docId}`, type: "document_completed", time: TIME, hash: hashFor("document_completed") }, data: { object: { id: docId, status: "completed", test_mode: false, recipients: [{ id: "provider", status: "completed" }, { id: "client", status: "completed" }] } } });
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const okFetcher: CompletedDocumentFetcher = { async fetch(_id, kind) { return { bytes: PDF, kind }; } };
const failFetcher: CompletedDocumentFetcher = { async fetch() { throw new Error("down"); } };

async function prodAgreement(docId: string) {
  const lead = await insertLead(makeLead() as any);
  const a = makeAgreement({ status: "sent", leadId: lead.id, esignRequestId: docId });
  const { id, createdAt, updatedAt, ...rest } = a;
  return insertAgreement({ ...rest, esignMode: "production" } as any);
}

describe("webhook completion → retention wiring (Gate 7)", () => {
  beforeEach(() => __resetStoreForTests());

  it("fires onSigned on completion and durably retains the artifacts", async () => {
    const docId = "doc_ret_ok";
    const agreement = await prodAgreement(docId);
    let fired = 0;
    const res = await handleSignwellWebhook({
      rawBody: completion(docId), secret: WEBHOOK_ID,
      onSigned: async (agreementId) => { fired++; await processCompletionRetention(agreementId, { fetcher: okFetcher, storage: new PostgresBlobStorage() }); },
    });
    expect(res.result).toBe("applied");
    expect(fired).toBe(1);
    expect((await getAgreement(agreement.id))!.status).toBe("signed");
    expect(retentionStatus(await signedArtifactsForAgreement(agreement.id), agreement)).toBe("retained");
  });

  it("a retention failure does NOT fail the webhook and leaves billing blocked", async () => {
    const docId = "doc_ret_fail";
    const agreement = await prodAgreement(docId);
    const res = await handleSignwellWebhook({
      rawBody: completion(docId), secret: WEBHOOK_ID,
      onSigned: async (agreementId) => { await processCompletionRetention(agreementId, { fetcher: failFetcher, storage: new PostgresBlobStorage() }); },
    });
    expect(res.status).toBe(200); // completion acknowledged
    expect((await getAgreement(agreement.id))!.status).toBe("signed"); // signed persisted
    expect(retentionStatus(await signedArtifactsForAgreement(agreement.id), agreement)).not.toBe("retained");
  });

  it("does not fire onSigned for a non-completion (viewed) event", async () => {
    const docId = "doc_viewed";
    await prodAgreement(docId);
    let fired = 0;
    const viewed = JSON.stringify({ event: { id: "v", type: "document_viewed", time: TIME, hash: hashFor("document_viewed") }, data: { object: { id: docId, status: "in progress", test_mode: false } } });
    await handleSignwellWebhook({ rawBody: viewed, secret: WEBHOOK_ID, onSigned: async () => { fired++; } });
    expect(fired).toBe(0);
  });
});
