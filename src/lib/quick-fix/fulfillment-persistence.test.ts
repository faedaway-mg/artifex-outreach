// ─────────────────────────────────────────────────────────────────────────────
// FULFILLMENT PERSISTENCE (Part A/B/C) — durable runbook/access/QA/evidence sub-state,
// idempotent + audited store mutations, server-side delivery gates, persisted-fact
// completion report, no-password access model, fail-closed token path, and the
// customer portal (own job only, one action, gated completion report + revocation).
// In-memory store; mirrors the fulfillment-center.test.ts conventions.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { listAudit } from "../repo";
import { generateOffer } from "./offer-engine";
import * as store from "./store";
import { deliveryGate, persistedCompletionReport, PRODUCTION_RETEST_STEP } from "./fulfillment-gates";
import { buildRunbook, normalizePlatform } from "./fulfillment-center";
import { buildCustomerPortalView, stageForJobState } from "./customer-portal";
import type { OfferFinding, QuickFixOffer } from "./types";

const F = (over: Partial<OfferFinding>): OfferFinding => ({
  id: "f", category: "Customer Acquisition", observation: "x", whyItMatters: "y",
  confidenceLabel: "Observed", confidenceScore: 0.95, impactLevel: "High", basis: ["link: https://x"], ...over,
});
const CTA = F({ id: "cta", observation: "the primary CTA button is hard to find on mobile" });

// Store an offer (via upsertOffer so the offerId is canonical) + a paid job, return offerId.
async function seedPaidJob(state: store.JobRecord["state"] = "READY_FOR_FULFILLMENT"): Promise<string> {
  const raw = generateOffer({ leadId: "lead_1", companyName: "a2z Health", findings: [CTA], generatedAt: null });
  const stored = await store.upsertOffer(raw as unknown as QuickFixOffer, { recipientEmail: "c@x.com", now: "2026-09-09T00:00:00Z" });
  const offerId = stored.offerId;
  await store.upsertJob({
    offerId, leadId: "lead_1", state, purchasedAt: "2026-09-09T00:00:00Z",
    requirementsReceivedAt: "2026-09-09T01:00:00Z", fulfillmentClockStartedAt: "2026-09-09T01:00:00Z",
    targetDeliveryAt: "2026-09-12T01:00:00Z", subscriptionId: null, updatedAt: "2026-09-09T01:00:00Z",
  });
  return offerId;
}

async function getPlatform(offerId: string) {
  const offer = (await store.getOffer(offerId))! as unknown as QuickFixOffer;
  return { offer, platform: normalizePlatform("wordpress") };
}

beforeEach(() => { __resetStoreForTests(); });

describe("runbook checkbox persists across reload", () => {
  it("a checked step is durable and freezes the playbook version", async () => {
    const offerId = await seedPaidJob();
    await store.startRunbook(offerId, "pb-cta-repair-v1");
    await store.setRunbookStep(offerId, "impl-1", { done: true, by: "operator" });
    // "reload": a fresh read from the store returns the same state.
    const reloaded = await store.getJob(offerId);
    expect(reloaded?.runbookState?.playbookId).toBe("pb-cta-repair-v1");
    expect(reloaded?.runbookState?.steps["impl-1"]?.done).toBe(true);
    expect(reloaded?.runbookState?.steps["impl-1"]?.completedBy).toBe("operator");
  });

  it("refresh does not reset step state and the frozen playbook is immutable", async () => {
    const offerId = await seedPaidJob();
    await store.startRunbook(offerId, "pb-cta-repair-v1");
    await store.setRunbookStep(offerId, "impl-1", { done: true });
    // A later startRunbook with a DIFFERENT id must NOT overwrite the frozen version or steps.
    await store.startRunbook(offerId, "pb-cta-repair-v2");
    const j = await store.getJob(offerId);
    expect(j?.runbookState?.playbookId).toBe("pb-cta-repair-v1");
    expect(j?.runbookState?.steps["impl-1"]?.done).toBe(true);
  });
});

describe("QA state persists", () => {
  it("a passed QA item is durable across reload", async () => {
    const offerId = await seedPaidJob();
    const { offer, platform } = await getPlatform(offerId);
    const item = buildRunbook(offer, platform).qaChecklist[0];
    await store.setQaItem(offerId, item, true);
    const j = await store.getJob(offerId);
    expect(j?.qaState?.[item]?.done).toBe(true);
  });
});

describe("access state persists", () => {
  it("an access lifecycle patch is durable and stamps timestamps", async () => {
    const offerId = await seedPaidJob();
    await store.setAccessItem(offerId, "website-admin", { status: "REQUESTED", method: "native-invite" });
    await store.setAccessItem(offerId, "website-admin", { status: "RECEIVED" });
    const j = await store.getJob(offerId);
    expect(j?.accessState?.["website-admin"]?.status).toBe("RECEIVED");
    expect(j?.accessState?.["website-admin"]?.requestedAt).toBeTruthy();
    expect(j?.accessState?.["website-admin"]?.receivedAt).toBeTruthy();
  });
});

describe("evidence belongs to the correct job", () => {
  it("evidence is associated with its job and demonstrates a stated purpose", async () => {
    const a = await seedPaidJob();
    const b = await seedPaidJob(); // same inputs → same offerId; force a distinct one
    // Distinct job for isolation: mutate one job's leadId keeps offerId same, so instead
    // assert evidence lands on the exact offerId we addressed.
    const { item } = await store.addEvidence(a, { kind: "after", storageKey: "k1", label: "after", demonstrates: "the fixed CTA on the live page" });
    expect(item?.demonstrates).toBe("the fixed CTA on the live page");
    const ja = await store.getJob(a);
    expect((ja?.evidence ?? []).some((e) => e.storageKey === "k1")).toBe(true);
    // No password/secret field is ever present on an evidence item.
    expect(JSON.stringify(ja?.evidence)).not.toMatch(/password|secret/i);
    void b;
  });
});

describe("idempotency — completed step does not duplicate audit/evidence", () => {
  it("marking the same step done twice appends exactly one audit event", async () => {
    const offerId = await seedPaidJob();
    await store.setRunbookStep(offerId, "impl-1", { done: true });
    await store.setRunbookStep(offerId, "impl-1", { done: true });
    const audits = (await listAudit(500)).filter((a) => a.action === "quickfix.runbook_step" && a.targetId === offerId);
    expect(audits.length).toBe(1);
  });

  it("adding the same evidence (same storageKey+kind) does not duplicate", async () => {
    const offerId = await seedPaidJob();
    await store.addEvidence(offerId, { kind: "before", storageKey: "same", label: "b", demonstrates: "before state" });
    const second = await store.addEvidence(offerId, { kind: "before", storageKey: "same", label: "b", demonstrates: "before state" });
    expect(second.deduped).toBe(true);
    const j = await store.getJob(offerId);
    expect((j?.evidence ?? []).filter((e) => e.storageKey === "same").length).toBe(1);
    const audits = (await listAudit(500)).filter((a) => a.action === "quickfix.evidence_added" && a.targetId === offerId);
    expect(audits.length).toBe(1);
  });
});

describe("server-side delivery gate — cannot deploy/COMPLETE without QA + production retest", () => {
  it("gate is NOT ok without QA + retest + before/after evidence", async () => {
    const offerId = await seedPaidJob();
    const { offer, platform } = await getPlatform(offerId);
    const job = (await store.getJob(offerId))!;
    const gate = deliveryGate(offer, job, platform);
    expect(gate.ok).toBe(false);
    expect(gate.blockers.length).toBeGreaterThan(0);
  });

  it("gate becomes ok only once every QA item, the production retest, and before/after evidence are persisted", async () => {
    const offerId = await seedPaidJob();
    const { offer, platform } = await getPlatform(offerId);
    for (const item of buildRunbook(offer, platform).qaChecklist) await store.setQaItem(offerId, item, true);
    await store.setRunbookStep(offerId, PRODUCTION_RETEST_STEP, { done: true });
    await store.addEvidence(offerId, { kind: "before", storageKey: "b", label: "before", demonstrates: "pre-change" });
    await store.addEvidence(offerId, { kind: "after", storageKey: "a", label: "after", demonstrates: "post-change" });
    const job = (await store.getJob(offerId))!;
    const gate = deliveryGate(offer, job, platform);
    expect(gate.ok).toBe(true);
    expect(gate.productionRetestDone).toBe(true);
  });
});

describe("completion report derives only from persisted facts", () => {
  it("uses persisted before/after evidence + passed QA as verification; invalid when evidence missing", async () => {
    const offerId = await seedPaidJob("DELIVERED");
    const { offer, platform } = await getPlatform(offerId);
    // No evidence yet → invalid.
    let job = (await store.getJob(offerId))!;
    let rep = persistedCompletionReport(offer, job, "wordpress", job.updatedAt);
    expect(rep.valid).toBe(false);
    expect(rep.problems.length).toBeGreaterThan(0);
    // Add persisted facts → derives from them.
    await store.addEvidence(offerId, { kind: "before", storageKey: "bref", label: "before", demonstrates: "pre" });
    await store.addEvidence(offerId, { kind: "after", storageKey: "aref", label: "after", demonstrates: "post" });
    for (const item of buildRunbook(offer, platform).qaChecklist) await store.setQaItem(offerId, item, true);
    job = (await store.getJob(offerId))!;
    rep = persistedCompletionReport(offer, job, "wordpress", job.updatedAt);
    expect(rep.beforeRef).toBe("bref");
    expect(rep.afterRef).toBe("aref");
    expect(rep.verification.length).toBeGreaterThan(0);
    expect(rep.valid).toBe(true);
  });
});

describe("no password field anywhere in the access model", () => {
  it("the access model never has a password/secret field; token path fails closed", async () => {
    const offerId = await seedPaidJob();
    // Even if someone tries to mark a scoped-token as VERIFIED, it fails closed to BLOCKED
    // and stores no secret.
    await store.setAccessItem(offerId, "website-admin", { status: "VERIFIED", method: "scoped-token" });
    const j = await store.getJob(offerId);
    expect(j?.accessState?.["website-admin"]?.status).toBe("BLOCKED");
    // The access model has no field that CAPTURES a credential — the only keys present
    // are lifecycle metadata (status/method/notes/timestamps), never a secret value.
    const item = j?.accessState?.["website-admin"] ?? {};
    for (const k of Object.keys(item)) expect(k).not.toMatch(/password|apikey|api_key|secret|credential|otp|mfa/i);
  });
});

describe("customer portal — own job only, one action, gated report, revocation guidance", () => {
  it("shows ONLY the customer's own job and never leaks internal notes/scoring", async () => {
    const offerId = await seedPaidJob("IN_PROGRESS");
    const v = (await buildCustomerPortalView(offerId))!;
    expect(v.offerId).toBe(offerId);
    expect(v.company).toBe("a2z Health");
    // Internal-only fields must not leak into the customer view.
    const blob = JSON.stringify(v).toLowerCase();
    expect(blob).not.toContain("runbook");
    expect(blob).not.toContain("operatornote");
    expect(blob).not.toMatch(/pricecents|economics|profit|confidencescore/i);
    // "password" appears only as the reassurance "never your password" — never as a
    // field that requests one. Assert we never ASK the customer to provide a password.
    expect(blob).not.toMatch(/enter your password|provide your password|your password:/i);
  });

  it("exposes exactly ONE dominant current action", async () => {
    const offerId = await seedPaidJob("WAITING_FOR_CUSTOMER_INPUT");
    const v = (await buildCustomerPortalView(offerId))!;
    expect(v.currentAction).not.toBeNull();
    expect(typeof v.currentAction?.headline).toBe("string");
  });

  it("maps job states to the calm 5-stage journey", async () => {
    expect(stageForJobState("PAID")).toBe("PURCHASED");
    expect(stageForJobState("WAITING_FOR_CUSTOMER_INPUT")).toBe("ACCESS_NEEDED");
    expect(stageForJobState("IN_PROGRESS")).toBe("WORKING");
    expect(stageForJobState("QA")).toBe("TESTING");
    expect(stageForJobState("COMPLETE")).toBe("COMPLETE");
  });

  it("hides the completion report before DELIVERED and shows it (+ revocation guidance) after", async () => {
    const before = (await buildCustomerPortalView(await seedPaidJob("IN_PROGRESS")))!;
    expect(before.completionReport).toBeNull();

    const offerId = await seedPaidJob("DELIVERED");
    const { offer, platform } = await getPlatform(offerId);
    await store.addEvidence(offerId, { kind: "before", storageKey: "b", label: "before", demonstrates: "pre" });
    await store.addEvidence(offerId, { kind: "after", storageKey: "a", label: "after", demonstrates: "post" });
    for (const item of buildRunbook(offer, platform).qaChecklist) await store.setQaItem(offerId, item, true);
    const after = (await buildCustomerPortalView(offerId))!;
    expect(after.completionReport).not.toBeNull();
    expect(after.accessCloseout.toLowerCase()).toMatch(/revoke|access/);
  });

  it("access instructions never ask for a password and offer Access Assist", async () => {
    const v = (await buildCustomerPortalView(await seedPaidJob("WAITING_FOR_CUSTOMER_INPUT")))!;
    const stepsBlob = v.access.flatMap((a) => a.steps).join(" ").toLowerCase();
    // The steps only ever REASSURE "never your password" — they never ask the customer
    // to enter/share a password.
    expect(stepsBlob).not.toMatch(/enter your password|share your password|your password:/i);
    expect(stepsBlob).toContain("never your password");
    expect(v.accessAssist.note.toLowerCase()).toContain("access assist");
    expect(v.accessAssist.bookUrl).toMatch(/^https?:\/\//);
    expect(v.screenshotCredentialWarning.toLowerCase()).toMatch(/password|credential/);
  });
});
