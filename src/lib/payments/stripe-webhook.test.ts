import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { __resetStoreForTests } from "../store";
import { insertLead, insertAgreement, insertPayment, getPayment, getLead } from "../repo";
import { verifyStripeSignature, handleStripeWebhook } from "./stripe-webhook";
import { makeAgreement } from "../agreement/test-fixtures";

const SECRET = "whsec_stripe_test";

function stripeSig(body: string, ts: number): string {
  const v1 = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${v1}`;
}

function leadSeed(): any {
  return {
    googlePlaceId: null, businessName: "Copper & Oak", normalizedName: "copperoak", industry: "Restaurant",
    normalizedCategory: null, categoryGroup: null, address: "1", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: null, website: null, websiteDomain: null, publicEmail: null, contactFormUrl: null,
    socialLinks: [], locationsCount: null, rating: null, reviewCount: null, businessStatus: null, googleMapsUrl: null, hours: null,
    source: "test", retrievedAt: null, tier: null, leadScore: null, scoreBreakdown: null, pipelineStage: "Agreement Signed",
    estimatedValueLow: null, estimatedValueHigh: null, recommendedService: null, recommendedAction: null, recommendationReason: null,
    opportunitySummary: null, strengths: [], acquisitionStrategy: null, acquisitionScore: null, acquisitionReason: null,
    acquisitionScoreBreakdown: null, acquisitionOverride: false, assignedTo: "jordan", note: null, lastContactAt: null, nextFollowUpAt: null,
  };
}

beforeEach(() => __resetStoreForTests());

describe("verifyStripeSignature", () => {
  it("accepts a valid t/v1 signature and rejects tampering / stale timestamps", () => {
    const body = JSON.stringify({ hello: "world" });
    const now = 1_800_000_000;
    expect(verifyStripeSignature(SECRET, body, stripeSig(body, now), { nowSec: now })).toBe(true);
    expect(verifyStripeSignature(SECRET, body, stripeSig(body + "x", now), { nowSec: now })).toBe(false);
    expect(verifyStripeSignature(SECRET, body, stripeSig(body, now - 10_000), { nowSec: now })).toBe(false);
  });
});

describe("handleStripeWebhook", () => {
  it("rejects an unsigned request when a secret is set", async () => {
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
    const res = await handleStripeWebhook({ rawBody: body, signature: "bad", secret: SECRET });
    expect(res.status).toBe(401);
  });

  it("marks the matching deposit paid and advances the lead to Deposit Paid", async () => {
    const lead = await insertLead(leadSeed());
    const { id, createdAt, updatedAt, ...rest } = makeAgreement({ status: "signed", leadId: lead.id });
    const agreement = await insertAgreement(rest);
    const payment = await insertPayment({
      leadId: lead.id, agreementId: agreement.id, type: "deposit", amountCents: 725000, currency: "usd",
      status: "link_sent", stripePaymentLinkUrl: "https://buy.stripe/x", stripeSessionId: "cs_1", sentAt: null, paidAt: null,
    });
    void id; void createdAt; void updatedAt;

    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
    const ts = Math.floor(Date.now() / 1000);
    const res = await handleStripeWebhook({ rawBody: body, signature: stripeSig(body, ts), secret: SECRET });
    expect(res.result).toBe("applied");
    expect((await getPayment(payment.id))?.status).toBe("paid");
    expect((await getLead(lead.id))?.pipelineStage).toBe("Deposit Paid");
  });

  it("ignores an unmatched session id", async () => {
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_UNKNOWN" } } });
    const ts = Math.floor(Date.now() / 1000);
    const res = await handleStripeWebhook({ rawBody: body, signature: stripeSig(body, ts), secret: SECRET });
    expect(res.result).toBe("unmatched");
  });
});
