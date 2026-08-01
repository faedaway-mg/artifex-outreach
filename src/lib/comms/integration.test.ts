// ─────────────────────────────────────────────────────────────────────────────
// Phase 10 — end-to-end integration. Exercises the communication layer through its
// real seams (scheduler → dispatcher → provider → webhook → reply → suppression →
// conversation/monitoring) as cohesive production scenarios, not isolated units.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  insertLead, insertPlan, insertStep, getPlan, getStep, getEmailSendByKey,
  emailSendsForPlan, isSuppressed, allEmailSends,
} from "../repo";
import { runDueSends } from "./scheduler";
import { handleResendWebhook } from "./webhook";
import { ingestInboundReply } from "./reply";
import { conversationState } from "./conversation";
import { commsMetrics } from "./monitoring";
import { resetEmailProvider } from "./provider";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

const realFetch = global.fetch;
const SECRET = "whsec_" + Buffer.from("integration-secret").toString("base64");
beforeEach(() => { __resetStoreForTests(); process.env.RESEND_API_KEY = "re_test"; process.env.RESEND_FROM = "J <j@artifexlabs.tech>"; resetEmailProvider(); });
afterEach(() => { global.fetch = realFetch; resetEmailProvider(); vi.restoreAllMocks(); });

let pmidSeq = 0;
function fetchSends() {
  // Each send returns a unique provider id so webhooks can target it.
  global.fetch = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve({ ok: true, status: 200, json: async () => ({ id: `pm-${++pmidSeq}` }), text: async () => "{}" } as unknown as Response)) as unknown as typeof fetch;
}
function fetchFails(status: number) {
  global.fetch = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve({ ok: false, status, json: async () => ({}), text: async () => "e" } as unknown as Response)) as unknown as typeof fetch;
}
function signedWebhook(evtId: string, type: string, emailId: string, now: Date) {
  const body = JSON.stringify({ type, created_at: now.toISOString(), data: { email_id: emailId } });
  const key = Buffer.from(SECRET.slice("whsec_".length), "base64");
  const sig = createHmac("sha256", key).update(`${evtId}.${Math.floor(now.getTime() / 1000)}.${body}`).digest("base64");
  return { rawBody: body, headers: { id: evtId, timestamp: String(Math.floor(now.getTime() / 1000)), signature: `v1,${sig}` }, secret: SECRET, now };
}

async function seedLead(email: string): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: `Co ${email}`, normalizedName: "co" + email.replace(/\W/g, ""), industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: null, website: "https://x.example", websiteDomain: email.split("@")[1],
    publicEmail: email, contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4, reviewCount: 5,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 60,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
}
async function approvedPlan(leadId: string, steps: Array<{ n: number; at: string }>) {
  const plan = await insertPlan({
    leadId, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null,
    status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: "2026-07-01T00:00:00Z", startedAt: "2026-07-01T00:00:00Z", pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
    assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
  });
  const ids: string[] = [];
  for (const s of steps) {
    const st = await insertStep({ planId: plan.id, stepNumber: s.n, channel: "email", delayDays: 0, subject: `s${s.n}`, content: "b {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved", scheduledAt: s.at, sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });
    ids.push(st.id);
  }
  return { plan, stepIds: ids };
}

const T = (h: number) => new Date(`2026-07-15T${String(h).padStart(2, "0")}:00:00Z`);

describe("Phase 10 — integration scenarios", () => {
  it("full lifecycle: schedule → send once → delivered/opened/clicked → reply stops sequence", async () => {
    fetchSends();
    const lead = await seedLead("owner@life.example");
    const { plan } = await approvedPlan(lead.id, [{ n: 1, at: T(9).toISOString() }, { n: 2, at: "2026-07-30T00:00:00Z" }]);

    const s1 = await runDueSends({ now: T(10), force: true });
    expect(s1.sent).toBe(1);
    const sends = await emailSendsForPlan(plan.id);
    const pmid = sends[0].providerMessageId!;

    await handleResendWebhook(signedWebhook("e1", "email.delivered", pmid, T(10)));
    await handleResendWebhook(signedWebhook("e2", "email.opened", pmid, T(10)));
    await handleResendWebhook(signedWebhook("e3", "email.clicked", pmid, T(10)));

    let cs = await conversationState(lead.id);
    expect(cs.currentStage).toBe("Clicked");

    const reply = await ingestInboundReply({ from: "owner@life.example", subject: "re", body: "Yes, let's schedule a call!", inReplyTo: pmid });
    expect(reply.classification).toBe("Meeting Requested");
    expect((await getPlan(plan.id))!.status).toBe("stopped");
    cs = await conversationState(lead.id);
    expect(cs.currentStage).toBe("Replied");

    // The (now future/stopped) second step never sends.
    const s2 = await runDueSends({ now: T(11), force: true });
    expect(s2.sent).toBe(0);
    // Exactly one message ever left the system (now advanced to "clicked").
    expect((await allEmailSends()).filter((x) => x.sentAt != null)).toHaveLength(1);
  });

  it("batch of many leads: scheduler sends each exactly once; a second run sends nothing", async () => {
    fetchSends();
    const N = 12;
    for (let i = 0; i < N; i++) {
      const lead = await seedLead(`b${i}@batch.example`);
      await approvedPlan(lead.id, [{ n: 1, at: T(9).toISOString() }]);
    }
    const run1 = await runDueSends({ now: T(10), force: true });
    expect(run1.sent).toBe(N);
    const run2 = await runDueSends({ now: T(10), force: true });
    expect(run2.sent).toBe(0); // all deduped
    expect((await allEmailSends()).filter((s) => s.status === "sent")).toHaveLength(N);
  });

  it("duplicate scheduler execution (concurrent) sends each step once", async () => {
    fetchSends();
    const lead = await seedLead("dupe@sched.example");
    await approvedPlan(lead.id, [{ n: 1, at: T(9).toISOString() }]);
    const [a, b] = await Promise.all([runDueSends({ now: T(10), force: true }), runDueSends({ now: T(10), force: true })]);
    expect(a.sent + b.sent).toBe(1);
    expect((await allEmailSends()).filter((s) => s.status === "sent")).toHaveLength(1);
  });

  it("provider outage then recovery: queue holds, then drains with no loss/dupes", async () => {
    fetchFails(503);
    const lead = await seedLead("recover@out.example");
    const { stepIds } = await approvedPlan(lead.id, [{ n: 1, at: T(9).toISOString() }]);
    await runDueSends({ now: T(10), force: true });
    expect((await getEmailSendByKey(`step:${stepIds[0]}`))!.status).toBe("queued");

    fetchSends();
    const drain = await runDueSends({ now: T(12), force: true });
    expect(drain.sent).toBe(1);
    expect((await getStep(stepIds[0]))!.sentAt).toBeTruthy();
  });

  it("hard bounce webhook suppresses the lead and blocks the next step", async () => {
    fetchSends();
    const lead = await seedLead("bounce@sup.example");
    const { plan, stepIds } = await approvedPlan(lead.id, [{ n: 1, at: T(9).toISOString() }, { n: 2, at: "2026-07-30T00:00:00Z" }]);
    // Step 1 is due; step 2 is future so the plan stays active until the bounce.
    await runDueSends({ now: T(10), force: true });
    const pmid = (await emailSendsForPlan(plan.id)).find((s) => s.status === "sent")!.providerMessageId!;

    // Signed hard-bounce webhook.
    const body = JSON.stringify({ type: "email.bounced", created_at: T(10).toISOString(), data: { email_id: pmid, type: "hard" } });
    const key = Buffer.from(SECRET.slice("whsec_".length), "base64");
    const sig = createHmac("sha256", key).update(`eb.${Math.floor(T(10).getTime() / 1000)}.${body}`).digest("base64");
    await handleResendWebhook({ rawBody: body, headers: { id: "eb", timestamp: String(Math.floor(T(10).getTime() / 1000)), signature: `v1,${sig}` }, secret: SECRET, now: T(10) });

    expect(await isSuppressed({ email: "bounce@sup.example" })).toBe(true);
    expect((await getPlan(plan.id))!.status).toBe("stopped");
    // Step 2 never sends.
    const after = await runDueSends({ now: T(11), force: true });
    expect(after.sent).toBe(0);
    void stepIds;
  });

  it("duplicate delivery webhook is applied exactly once", async () => {
    fetchSends();
    const lead = await seedLead("dupwh@x.example");
    const { plan } = await approvedPlan(lead.id, [{ n: 1, at: T(9).toISOString() }]);
    await runDueSends({ now: T(10), force: true });
    const pmid = (await emailSendsForPlan(plan.id))[0].providerMessageId!;
    const wh = signedWebhook("same-evt", "email.opened", pmid, T(10));
    const r1 = await handleResendWebhook(wh);
    const r2 = await handleResendWebhook(wh);
    expect(r1.result).toBe("applied");
    expect(r2.result).toBe("duplicate");
    expect((await emailSendsForPlan(plan.id))[0].status).toBe("opened");
  });

  it("unsubscribe reply suppresses and stops; monitoring reflects the fleet", async () => {
    fetchSends();
    const lead = await seedLead("unsub@x.example");
    const { plan } = await approvedPlan(lead.id, [{ n: 1, at: T(9).toISOString() }, { n: 2, at: "2026-07-30T00:00:00Z" }]);
    await runDueSends({ now: T(10), force: true });
    await ingestInboundReply({ from: "unsub@x.example", subject: "re", body: "please unsubscribe me" });
    expect(await isSuppressed({ email: "unsub@x.example" })).toBe(true);
    expect((await getPlan(plan.id))!.status).toBe("stopped");

    const m = await commsMetrics({ now: T(18) });
    expect(m.volume.sentTotal).toBe(1);
    expect(m.provider.name).toBe("resend");
  });
});
