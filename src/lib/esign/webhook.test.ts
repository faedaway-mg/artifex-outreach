import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { __resetStoreForTests } from "../store";
import { insertAgreement, getAgreement, paymentsForAgreement, getLead, insertLead } from "../repo";
import { handleSignwellWebhook, verifySignwellEventHash, nextAgreementStatus, parseSignwellEvent } from "./webhook";
import { makeAgreement } from "../agreement/test-fixtures";

// The HMAC key is the SignWell WEBHOOK ID (held in SIGNWELL_WEBHOOK_SECRET).
const WEBHOOK_ID = "0a1b2c3d-webhook-id";
const TIME = "1784000000"; // unix seconds, as SignWell sends
function hashFor(type: string, time = TIME): string {
  return createHmac("sha256", WEBHOOK_ID).update(`${type}@${time}`).digest("hex");
}

async function seedAgreement(overrides = {}) {
  const a = makeAgreement({ status: "sent", esignRequestId: "doc_1", esignProvider: "signwell", ...overrides });
  const { id, createdAt, updatedAt, ...rest } = a;
  void id; void createdAt; void updatedAt;
  return insertAgreement(rest);
}

function baseLeadSeed(): any {
  return {
    googlePlaceId: null, businessName: "Copper & Oak", normalizedName: "copperoak", industry: "Restaurant",
    normalizedCategory: null, categoryGroup: null, address: "1", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: null, website: null, websiteDomain: null, publicEmail: null, contactFormUrl: null,
    socialLinks: [], locationsCount: null, rating: null, reviewCount: null, businessStatus: null, googleMapsUrl: null, hours: null,
    source: "test", retrievedAt: null, tier: null, leadScore: null, scoreBreakdown: null, pipelineStage: "Proposal Accepted",
    estimatedValueLow: null, estimatedValueHigh: null, recommendedService: null, recommendedAction: null, recommendationReason: null,
    opportunitySummary: null, strengths: [], acquisitionStrategy: null, acquisitionScore: null, acquisitionReason: null,
    acquisitionScoreBreakdown: null, acquisitionOverride: false, assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
  };
}

function payload(type: string, docId = "doc_1", eventId = "evt_1", extra: Record<string, unknown> = {}) {
  return JSON.stringify({ event: { id: eventId, type, time: TIME, hash: hashFor(type) }, data: { object: { id: docId, status: type === "document_completed" ? "completed" : "viewed", ...extra } } });
}
// A body whose event.hash is wrong (tampered).
function badHashPayload(type: string) {
  return JSON.stringify({ event: { id: "e", type, time: TIME, hash: "deadbeef" }, data: { object: { id: "doc_1", status: "viewed" } } });
}

beforeEach(() => {
  __resetStoreForTests();
});

describe("verifySignwellEventHash (HMAC-SHA256 hex over `type@time`, keyed by webhook id)", () => {
  it("accepts the correct event.hash and rejects a wrong/missing one", () => {
    expect(verifySignwellEventHash(WEBHOOK_ID, "document_signed", TIME, hashFor("document_signed"))).toBe(true);
    expect(verifySignwellEventHash(WEBHOOK_ID, "document_signed", TIME, "deadbeef")).toBe(false);
    expect(verifySignwellEventHash(WEBHOOK_ID, "document_signed", TIME, null)).toBe(false);
    // wrong key (a different webhook id) fails
    expect(verifySignwellEventHash("other-id", "document_signed", TIME, hashFor("document_signed"))).toBe(false);
  });
});

describe("nextAgreementStatus (monotonic)", () => {
  it("advances forward but never regresses or reopens a terminal", () => {
    expect(nextAgreementStatus("sent", "viewed")).toBe("viewed");
    expect(nextAgreementStatus("approved", "viewed")).toBeNull(); // don't regress to viewed from before sent
    expect(nextAgreementStatus("viewed", "signed")).toBe("signed");
    expect(nextAgreementStatus("signed", "viewed")).toBeNull(); // already signed — ignore late view
    expect(nextAgreementStatus("signed", "signed")).toBeNull();
    expect(nextAgreementStatus("voided", "signed")).toBeNull();
    expect(nextAgreementStatus("sent", "declined")).toBe("declined");
  });
});

describe("parseSignwellEvent", () => {
  it("returns null for unknown event types", () => {
    expect(parseSignwellEvent({ event: { type: "document_api_something" }, data: { object: { id: "x" } } })).toBeNull();
  });
});

describe("handleSignwellWebhook", () => {
  it("rejects a tampered event.hash when a webhook id is configured", async () => {
    await seedAgreement();
    const res = await handleSignwellWebhook({ rawBody: badHashPayload("document_viewed"), secret: WEBHOOK_ID });
    expect(res.status).toBe(401);
    expect(res.kind).toBe("invalid_signature");
  });

  it("fails closed in production when no secret is set", async () => {
    const body = payload("document_viewed");
    const res = await handleSignwellWebhook({ rawBody: body, secret: null, isProduction: true });
    expect(res.status).toBe(401);
  });

  it("applies a viewed event and dedupes a duplicate delivery", async () => {
    const agreement = await seedAgreement();
    const body = payload("document_viewed", "doc_1", "evt_view");
    const first = await handleSignwellWebhook({ rawBody: body, secret: WEBHOOK_ID });
    expect(first.result).toBe("applied");
    expect((await getAgreement(agreement.id))?.status).toBe("viewed");
    const dup = await handleSignwellWebhook({ rawBody: body, secret: WEBHOOK_ID });
    expect(dup.result).toBe("duplicate");
  });

  it("marks signed, advances the lead, and unlocks a pending deposit", async () => {
    const lead = await insertLead(baseLeadSeed());
    const a = makeAgreement({ status: "sent", esignRequestId: "doc_1", leadId: lead.id });
    const { id, createdAt, updatedAt, ...rest } = a;
    const agreement = await insertAgreement(rest);

    const body = payload("document_completed", "doc_1", "evt_sign", { completed_pdf_url: "https://signwell.example/signed.pdf", audit_page_url: "https://signwell.example/cert" });
    const res = await handleSignwellWebhook({ rawBody: body, secret: WEBHOOK_ID });
    expect(res.result).toBe("applied");

    const after = await getAgreement(agreement.id);
    expect(after?.status).toBe("signed");
    expect(after?.signedPdfUrl).toBe("https://signwell.example/signed.pdf");
    expect(after?.certificateUrl).toBe("https://signwell.example/cert");

    const deposits = await paymentsForAgreement(agreement.id);
    expect(deposits).toHaveLength(1);
    expect(deposits[0].type).toBe("deposit");
    expect(deposits[0].status).toBe("pending");
    expect(deposits[0].amountCents).toBe(after!.contentSnapshot.depositAmountCents);

    expect((await getLead(lead.id))?.pipelineStage).toBe("Agreement Signed");
    void id; void createdAt; void updatedAt;
  });

  it("acks an unmatched document without applying", async () => {
    const body = payload("document_completed", "doc_UNKNOWN", "evt_x");
    const res = await handleSignwellWebhook({ rawBody: body, secret: WEBHOOK_ID });
    expect(res.result).toBe("unmatched");
    expect(res.status).toBe(200);
  });
});
