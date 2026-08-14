// ─────────────────────────────────────────────────────────────────────────────
// Inbound reply capture — a genuine prospect reply must never be lost, must match the RIGHT
// business (fail-closed), must be classified (incl. the high-value REFERRAL), and screenshot/manual
// imports must converge on the SAME canonical InboundMessage event. Nothing here sends email.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, insertEmailSendIfAbsent, inboundForLead, listSuppressions } from "../repo";
import { classifyReply, ingestInboundReply, ingestImportedReply, matchInboundToLead } from "./reply";
import type { Lead } from "../types";

beforeEach(() => __resetStoreForTests());

const lead = (email: string, over: Partial<Lead> = {}) => insertLead({
  googlePlaceId: null, businessName: "Acme Dental", normalizedName: "acme", industry: "Dental", normalizedCategory: "dentist",
  categoryGroup: "Health", address: "1 St", city: "Columbus", state: "OH", postalCode: "43004", latitude: null, longitude: null,
  phone: null, website: "https://acme.com", websiteDomain: "acme.com", publicEmail: email, contactFormUrl: null, socialLinks: [],
  locationsCount: 1, rating: 4.5, reviewCount: 40, businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "Google Places",
  retrievedAt: null, tier: "B", leadScore: 60, scoreBreakdown: {} as any, pipelineStage: "Contacted", estimatedValueLow: 5000, estimatedValueHigh: 9000,
  recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [], acquisitionStrategy: "Assisted",
  acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false, assignedTo: "jordan", assignedAt: null,
  assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null, ...over,
} as any);
async function seedSend(leadId: string, providerMessageId: string) {
  await insertEmailSendIfAbsent({
    idempotencyKey: `k:${providerMessageId}`, stepId: "st1", planId: "pl1", leadId, toAddr: "x@acme.com", fromAddr: "j@artifexlabs.tech",
    subject: "s", status: "sent", provider: "resend", providerMessageId, attempts: 1, lastError: null, lastErrorCode: null, nextAttemptAt: null,
    queuedAt: null, sendingAt: null, sentAt: "2026-08-14T00:00:00Z", deliveredAt: null, openedAt: null, clickedAt: null, bouncedAt: null,
    complainedAt: null, unsubscribedAt: null, failedAt: null,
  } as any);
}

describe("F — REFERRAL is a first-class, high-value classification", () => {
  it("classifies a value-first referral, not a generic yes/no", () => {
    expect(classifyReply({ subject: "", body: "This isn't for us, but my friend runs a clinic and has been looking for exactly this — happy to introduce you." }).classification).toBe("Referral");
    expect(classifyReply({ subject: "", body: "You should reach out to my colleague at Downtown Vet, they need this." }).classification).toBe("Referral");
  });
});

describe("A — a real reply matches the correct original send by thread id", () => {
  it("In-Reply-To → our send → the right lead", async () => {
    const l = await lead("owner@acme.com");
    await seedSend(l.id, "msg-original-1");
    const r = await ingestInboundReply({ from: "owner@acme.com", subject: "Re: hi", body: "Interested, tell me more", inReplyTo: "msg-original-1" });
    expect(r.leadId).toBe(l.id);
    expect(r.matchedBy).toBe("thread");
    expect(r.needsConfirmation).toBe(false);
    expect(r.classification).toBe("Interested");
  });
});

describe("G / J — FAIL CLOSED: an unidentifiable reply is captured but never mis-attached", () => {
  it("unknown sender + no thread → matchedBy none, needsConfirmation, unattached (leadId empty)", async () => {
    const r = await ingestInboundReply({ from: "stranger@nowhere.com", subject: "", body: "who is this?" });
    expect(r.matchedBy).toBe("none");
    expect(r.needsConfirmation).toBe(true);
    expect(r.leadId).toBeNull();      // never guessed a business
    expect(r.inboundId).not.toBeNull(); // but captured — not lost
  });
  it("matchInboundToLead prefers confirmed > thread > sender > none", async () => {
    const l = await lead("owner@acme.com");
    await seedSend(l.id, "msg-x");
    expect((await matchInboundToLead({ confirmedLeadId: "L9" })).matchedBy).toBe("confirmed");
    expect((await matchInboundToLead({ inReplyTo: "msg-x" })).matchedBy).toBe("thread");
    expect((await matchInboundToLead({ from: "owner@acme.com" })).matchedBy).toBe("sender");
    expect((await matchInboundToLead({ from: "nobody@x.com" })).matchedBy).toBe("none");
  });
});

describe("C / D — auto-replies and bounces are recognized (they don't become founder work)", () => {
  it("out-of-office and bounce classify as non-human", () => {
    expect(classifyReply({ subject: "", body: "I am out of the office until Monday." }).classification).toBe("Out Of Office");
    expect(classifyReply({ subject: "", body: "mailer-daemon: delivery failed, user unknown" }).classification).toBe("Bounce");
  });
});

describe("E — unsubscribe is honored safely", () => {
  it("an unsubscribe reply suppresses the business", async () => {
    const l = await lead("owner@acme.com");
    await ingestInboundReply({ from: "owner@acme.com", subject: "", body: "please unsubscribe me" });
    expect(classifyReply({ subject: "", body: "please unsubscribe me" }).classification).toBe("Unsubscribe");
    expect((await listSuppressions()).length).toBeGreaterThan(0);
  });
});

describe("H — duplicate provider delivery is idempotent", () => {
  it("the same provider message id ingested twice yields one event", async () => {
    const l = await lead("owner@acme.com");
    const a = await ingestInboundReply({ from: "owner@acme.com", subject: "", body: "interested", providerMessageId: "pm-1" });
    const b = await ingestInboundReply({ from: "owner@acme.com", subject: "", body: "interested", providerMessageId: "pm-1" });
    expect(b.duplicate).toBe(true);
    expect(b.inboundId).toBe(a.inboundId);
    expect((await inboundForLead(l.id)).length).toBe(1);
  });
});

describe("I / K — screenshot import converges on the SAME canonical event, idempotently", () => {
  it("a screenshot becomes a canonical InboundMessage (provider=screenshot), matched by sender", async () => {
    const l = await lead("owner@acme.com");
    const r = await ingestImportedReply({ from: "owner@acme.com", body: "Interested — can you send pricing?" });
    expect(r.leadId).toBe(l.id);
    const rows = await inboundForLead(l.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("screenshot");
    expect(rows[0].bodyRef).toContain("pricing");
  });
  it("importing the SAME reply again does not duplicate the conversation event", async () => {
    const l = await lead("owner@acme.com");
    await ingestImportedReply({ from: "owner@acme.com", body: "Interested — can you send pricing?" });
    const again = await ingestImportedReply({ from: "owner@acme.com", body: "Interested — can you send pricing?" });
    expect(again.duplicate).toBe(true);
    expect((await inboundForLead(l.id)).length).toBe(1);
  });
  it("J — an ambiguous screenshot (no match, no confirmation) needs confirmation, stays unattached", async () => {
    const r = await ingestImportedReply({ from: "unknown@stranger.com", body: "hello" });
    expect(r.needsConfirmation).toBe(true);
    expect(r.leadId).toBeNull();
  });
  it("a confirmed business attaches the imported reply to exactly that lead", async () => {
    const l = await lead("owner@acme.com");
    const r = await ingestImportedReply({ from: "someoneelse@gmail.com", body: "referral: my friend needs this", confirmedLeadId: l.id });
    expect(r.leadId).toBe(l.id);
    expect(r.matchedBy).toBe("confirmed");
    expect(r.classification).toBe("Referral");
  });
});
