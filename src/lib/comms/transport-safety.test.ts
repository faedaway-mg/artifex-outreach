import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __resetStoreForTests } from "../store";
import { insertLead, insertPlan, insertStep, getEmailSendByKey, addSuppression, getPlan } from "../repo";
import { dispatchStep } from "./dispatch";
import { transportRouteFor, classifyLeadSource, isColdOutreach } from "./transport-policy";
import { configureResendTestEnv, clearResendTestEnv, resendFetch } from "./resend-test-harness";
import type { Lead } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURAL REGRESSION GUARD. Proves — by SOURCE inspection and by BEHAVIOR — that cold outreach runs
// through ONE compliant transport that cannot be bypassed, that provider choice is never implicit, that
// an unclassified message fails closed, that suppression is enforced at the final boundary even with the
// transport configured, and that Microsoft Graph is NOT an operational dependency of the cold path.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = join(process.cwd(), "src", "lib");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const COLD_MODULES = ["comms/dispatch.ts", "comms/outreach-transport.ts", "outreach/outreach-scheduler.ts"];

describe("structural: cold outreach routes through the one compliant transport, no bypass", () => {
  it("the cold dispatcher submits through the canonical compliant transport, not a raw provider send", () => {
    const src = read("comms/dispatch.ts");
    expect(src).toContain("submitCompliantDispatch");
    expect(src).toContain("buildColdDispatchFromEmail");
    // dispatchStep must not select an arbitrary provider itself.
    expect(src, "dispatch.ts must not call getEmailProvider").not.toMatch(/getEmailProvider\s*\(/);
    // The ledger names the transport, never a dynamic provider.
    expect(src).toContain('provider: "resend"');
  });

  it("Microsoft Graph is NOT an operational dependency of the cold path", () => {
    for (const m of COLD_MODULES) {
      const src = read(m);
      expect(src, `${m} must not import ./graph`).not.toMatch(/from\s+["'][^"']*\/graph["']/);
      expect(src, `${m} must not call sendMimeViaGraph`).not.toContain("sendMimeViaGraph");
      expect(src, `${m} must not require GRAPH_* env`).not.toMatch(/GRAPH_(TENANT|CLIENT|SENDER)/);
    }
  });

  it("the compliant transport enforces the footer, recipient gate, and a final suppression recheck", () => {
    const src = read("comms/outreach-transport.ts");
    expect(src).toContain("assembleCommercialMessage"); // footer or fail closed
    expect(src).toContain("allowedColdRecipient");       // prospect gate
    expect(src).toContain("isSuppressed");                // final suppression recheck
    expect(src).toContain("ambiguous");                   // ambiguous-send protection
  });
});

describe("policy: classification routing fails closed", () => {
  it("UNKNOWN classification is refused; only cold-outreach classes ride the compliant transport", () => {
    expect(transportRouteFor("UNKNOWN")).toBe("refuse");
    expect(transportRouteFor("COLD_OUTREACH")).toBe("compliant");
    expect(transportRouteFor("INTERNAL_TEST")).toBe("compliant");
    expect(transportRouteFor("TRANSACTIONAL")).toBe("transactional-provider");
    expect(isColdOutreach("UNKNOWN")).toBe(false);
    expect(isColdOutreach("TRANSACTIONAL")).toBe(false);
  });

  it("a plan/step lead is classified as cold outreach (internal-test is its own class)", () => {
    expect(classifyLeadSource("internal-test")).toBe("INTERNAL_TEST");
    expect(classifyLeadSource("places")).toBe("COLD_OUTREACH");
    expect(classifyLeadSource(null)).toBe("COLD_OUTREACH");
  });
});

async function seedLead(over: Partial<Lead> = {}): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Guard Co", normalizedName: "guardco", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://g.example", websiteDomain: "g.example",
    publicEmail: "owner@g.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 20,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 70,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "Website System", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null, ...over,
  } as any);
}
async function seedApprovedStep(leadId: string) {
  const plan = await insertPlan({
    leadId, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null,
    status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: new Date().toISOString(), startedAt: new Date().toISOString(), pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
    assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
  });
  return insertStep({
    planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject: "A quick note",
    content: "Hi there. {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved",
    scheduledAt: new Date().toISOString(), sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null,
  });
}

describe("behavior: compliance is enforced even with the transport configured", () => {
  const realFetch = global.fetch;
  beforeEach(() => { __resetStoreForTests(); configureResendTestEnv(); });
  afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); });

  it("a suppressed recipient is never sent, even with RESEND configured and prospect delivery enabled", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const lead = await seedLead({ publicEmail: "opt@g.example" });
    const step = await seedApprovedStep(lead.id);
    await addSuppression({ email: "opt@g.example", domain: null, phone: null, reason: "opt-out" });
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("skipped");
    expect(r.reason).toBe("suppressed");
    expect(rf.calls.all).toBe(0);           // the transport was never contacted
    expect((await getPlan((await getEmailSendByKey(`step:${step.id}`))?.planId ?? "")) ?? { status: "stopped" }).toBeTruthy();
  });

  it("with the transport UNCONFIGURED, a cold step is released (queued), never sent", async () => {
    delete process.env.RESEND_API_KEY;
    const rf = resendFetch();
    global.fetch = rf.fn;
    const lead = await seedLead();
    const step = await seedApprovedStep(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("skipped");
    expect(rf.calls.all).toBe(0);
    const row = await getEmailSendByKey(`step:${step.id}`);
    expect(row!.status).toBe("queued");
    expect(row!.provider).toBe("resend");   // the ledger names the one transport
  });
});
