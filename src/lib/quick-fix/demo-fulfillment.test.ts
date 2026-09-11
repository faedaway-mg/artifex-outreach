// ─────────────────────────────────────────────────────────────────────────────
// DEMO FULFILLMENT — SAFE isolated rehearsal jobs. Proves the HARD invariants: demo
// jobs/customers are EXCLUDED from the sprint scoreboard + fulfillment/revenue/customer
// views, cannot send/charge/mutate a site/store a credential, the isolation guard is
// fail-closed, seeding is idempotent, and all four scenarios seed into valid JobStates
// the technician workspace can render. In-memory store (mirrors fulfillment-persistence).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import * as store from "./store";
import {
  seedDemoScenarios, listDemoJobs, assertDemoIsolated, isDemoRecipient, DEMO_SCENARIOS,
  buildDemoWalkthroughs, DEMO_WALKTHROUGH_BADGES,
} from "./demo-fulfillment";
import { RESERVED_TEST_DOMAIN } from "../breakbot/isolation";
import { fulfillmentView, profitabilityView, customersView, fulfillmentWorkspaceView } from "./operator-views";
import { sprintScoreboardView } from "./sprint-view";
import type { QuickFixOffer } from "./types";
import { generateOffer } from "./offer-engine";

const VALID_JOB_STATES = new Set([
  "PAID", "WAITING_FOR_CUSTOMER_INPUT", "READY_FOR_FULFILLMENT", "IN_PROGRESS", "QA", "DELIVERED", "COMPLETE", "REFUNDED", "CANCELED",
]);

// Seed a REAL (non-demo) COMPLETE job + customer so the exclusion tests have a real
// baseline that must survive (and be the ONLY thing counted).
async function seedRealJob(state: store.JobRecord["state"] = "READY_FOR_FULFILLMENT"): Promise<{ offerId: string; priceCents: number }> {
  const raw = generateOffer({
    leadId: "real_lead_1", companyName: "Real Co",
    findings: [{ id: "f", category: "Customer Acquisition", observation: "the primary CTA button is broken on mobile", whyItMatters: "lost inquiries", confidenceLabel: "Observed", confidenceScore: 0.95, impactLevel: "High", basis: ["html"] }],
    generatedAt: "2026-01-01T00:00:00Z",
  });
  const offer = await store.upsertOffer(raw as unknown as QuickFixOffer, { recipientEmail: "real@example.com", now: "2026-01-01T00:00:00Z" });
  await store.upsertJob({ offerId: offer.offerId, leadId: "real_lead_1", state, purchasedAt: "2026-01-01T00:00:00Z", requirementsReceivedAt: "2026-01-01T00:00:00Z", fulfillmentClockStartedAt: "2026-01-01T00:00:00Z", targetDeliveryAt: "2026-01-03T00:00:00Z", subscriptionId: null, updatedAt: "2026-01-01T00:00:00Z", evidence: [{ id: "ev1", kind: "after", label: "after", demonstrates: "fixed", at: "2026-01-01T00:00:00Z" }] });
  await store.upsertCustomer({ leadId: "real_lead_1", email: "real@example.com", firstPurchaseAt: "2026-01-01T00:00:00Z", firstPurchaseType: "REPAIR", lifetimeRevenueCents: offer.priceCents, offersPurchased: [offer.offerId], maintenancePlanKey: null, lastDeliveredAt: null, nextOpportunity: null, referralSource: null });
  return { offerId: offer.offerId, priceCents: offer.priceCents };
}

beforeEach(() => { __resetStoreForTests(); });

describe("seedDemoScenarios", () => {
  it("seeds all four scenarios as isDemo jobs under the reserved test domain, in valid JobStates", async () => {
    const results = await seedDemoScenarios();
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.key).sort()).toEqual(["ready-for-qa", "scope-exception", "unknown-platform", "wordpress-happy"]);

    for (const r of results) {
      const job = await store.getJob(r.offerId);
      expect(job).not.toBeNull();
      expect(job!.isDemo).toBe(true);                        // (invariant) flagged demo
      expect(VALID_JOB_STATES.has(job!.state)).toBe(true);   // seeds a valid JobState
      const offer = await store.getOffer(r.offerId);
      expect(isDemoRecipient(offer!.recipientEmail)).toBe(true); // reserved non-deliverable domain
      expect(offer!.recipientEmail!.endsWith(RESERVED_TEST_DOMAIN)).toBe(true);
    }
  });

  it("seeds the intended state per scenario (READY / WAITING / READY / QA)", async () => {
    const results = await seedDemoScenarios();
    const byKey = Object.fromEntries(results.map((r) => [r.key, r]));
    expect(byKey["wordpress-happy"].state).toBe("READY_FOR_FULFILLMENT");
    expect(byKey["unknown-platform"].state).toBe("WAITING_FOR_CUSTOMER_INPUT");
    expect(byKey["scope-exception"].state).toBe("READY_FOR_FULFILLMENT");
    expect(byKey["ready-for-qa"].state).toBe("QA");
    // Platform resolves per scenario (unknown → NEEDS TECHNICAL REVIEW path).
    expect(byKey["wordpress-happy"].platformLabel).toBe("wordpress");
    expect(byKey["unknown-platform"].platformLabel).toBe("unknown");
  });

  it("is idempotent — re-seeding does not create duplicate demo jobs", async () => {
    const first = await seedDemoScenarios();
    const second = await seedDemoScenarios();
    expect(second.map((r) => r.offerId).sort()).toEqual(first.map((r) => r.offerId).sort());
    const demoJobs = (await store.listJobs()).filter((j) => j.isDemo === true);
    expect(demoJobs).toHaveLength(4);
  });

  it("every seeded scenario renders in the SAME technician workspace real jobs use", async () => {
    await seedDemoScenarios();
    for (const r of await listDemoJobs()) {
      const view = await fulfillmentWorkspaceView(r.offerId);
      expect(view).not.toBeNull();
      expect(view!.packet.offerId).toBe(r.offerId);
      expect(view!.packet.jobState).toBe(r.state);
    }
  });

  it("the unknown-platform scenario resolves to NEEDS TECHNICAL REVIEW (no hallucinated deploy)", async () => {
    const results = await seedDemoScenarios();
    const unk = results.find((r) => r.key === "unknown-platform")!;
    const view = await fulfillmentWorkspaceView(unk.offerId);
    expect(view!.platform).toBe("unknown");
    expect(view!.packet.runbook.supported).toBe(false); // NEEDS TECHNICAL REVIEW
  });

  it("the ready-for-qa scenario stages before/after evidence but leaves the delivery gate open", async () => {
    const results = await seedDemoScenarios();
    const qa = results.find((r) => r.key === "ready-for-qa")!;
    const view = await fulfillmentWorkspaceView(qa.offerId);
    expect(view!.evidence.some((e) => e.kind === "before")).toBe(true);
    expect(view!.evidence.some((e) => e.kind === "after")).toBe(true);
    // Production retest + QA remain for the operator to exercise → gate NOT yet satisfied.
    expect(view!.gate.ok).toBe(false);
  });
});

describe("HARD isolation invariants", () => {
  it("EXCLUDES demo jobs from the fulfillment inbox (keeps the one real job)", async () => {
    await seedRealJob();
    await seedDemoScenarios();
    const { rows } = await fulfillmentView();
    expect(rows).toHaveLength(1);
    expect(rows[0].company).toBe("Real Co");
  });

  it("EXCLUDES demo jobs from the sprint scoreboard (money loop) — only the real COMPLETE job counts", async () => {
    const real = await seedRealJob("COMPLETE"); // one real completed job WITH evidence
    await seedDemoScenarios();                   // + four demo jobs (none COMPLETE)
    const { scoreboard } = await sprintScoreboardView();
    // The four demo jobs must NOT inflate completed jobs / revenue / capability proofs.
    expect(scoreboard.completedJobs).toBe(1);
    expect(scoreboard.grossRevenueCents).toBe(real.priceCents);
    expect(scoreboard.capabilityProofs).toBe(1); // only the real delivered+evidenced job
  });

  it("seeding demo jobs adds NOTHING to the sprint scoreboard (no fabricated progress)", async () => {
    // Capture the baseline BEFORE seeding demos, then assert demos move no number.
    // (The in-memory quick-fix store is shared across tests, so we compare deltas
    // rather than asserting an absolute zero — a demonstration must add nothing.)
    const before = (await sprintScoreboardView()).scoreboard;
    await seedDemoScenarios();
    const after = (await sprintScoreboardView()).scoreboard;
    expect(after.completedJobs).toBe(before.completedJobs);
    expect(after.grossRevenueCents).toBe(before.grossRevenueCents);
    expect(after.capabilityProofs).toBe(before.capabilityProofs);
    expect(after.playbooksProven).toBe(before.playbooksProven);
  });

  it("EXCLUDES demo jobs from profitability (revenue) — only the real job's revenue counts", async () => {
    await seedRealJob();
    await seedDemoScenarios();
    const { rows } = await profitabilityView();
    const totalSales = rows.reduce((n, r) => n + r.sales, 0);
    expect(totalSales).toBe(1); // exactly the one real job
  });

  it("EXCLUDES demo-only customers from the customers/CLV view", async () => {
    await seedRealJob();
    await seedDemoScenarios();
    const customers = await customersView();
    expect(customers).toHaveLength(1);
    expect(customers[0].company).toBe("Real Co");
  });
});

describe("fail-closed isolation guard", () => {
  it("isDemoRecipient only accepts the reserved non-deliverable domain", () => {
    expect(isDemoRecipient(`demo+x@${RESERVED_TEST_DOMAIN}`)).toBe(true);
    expect(isDemoRecipient("someone@gmail.com")).toBe(false);
    expect(isDemoRecipient("owner@realbusiness.com")).toBe(false);
    expect(isDemoRecipient(null)).toBe(false);
  });

  it("assertDemoIsolated refuses a record that is not flagged isDemo", () => {
    expect(() => assertDemoIsolated({ isDemo: false, recipients: [`demo+x@${RESERVED_TEST_DOMAIN}`] })).toThrow(/isDemo/);
    expect(() => assertDemoIsolated({ isDemo: undefined as any, recipients: [] })).toThrow(/fail-closed/);
  });

  it("assertDemoIsolated refuses a real-world recipient even when isDemo is true", () => {
    expect(() => assertDemoIsolated({ isDemo: true, recipients: ["owner@realbusiness.com"] })).toThrow(/reserved/);
    // A demo record with only reserved-domain recipients is allowed.
    expect(() => assertDemoIsolated({ isDemo: true, recipients: [`demo+x@${RESERVED_TEST_DOMAIN}`, null] })).not.toThrow();
  });

  it("never stores a credential/secret — the demo access model has no secret field", async () => {
    await seedDemoScenarios();
    for (const r of await listDemoJobs()) {
      const job = await store.getJob(r.offerId);
      const blob = JSON.stringify(job!.accessState ?? {}).toLowerCase();
      expect(blob).not.toContain("password");
      // The access model exposes only status/method/notes/timestamps — no secret key exists.
      for (const item of Object.values(job!.accessState ?? {})) {
        expect(Object.keys(item)).not.toContain("secret");
        expect(Object.keys(item)).not.toContain("credential");
      }
    }
  });
});

// §46–§48 — the explicit, USABLE guided DEMO A/B/C walkthroughs.
describe("buildDemoWalkthroughs (guided DEMO A/B/C)", () => {
  // The canonical job lifecycle order — a walkthrough's steps must be non-decreasing along it.
  const LIFECYCLE_ORDER = [
    "PAID", "WAITING_FOR_CUSTOMER_INPUT", "READY_FOR_FULFILLMENT", "IN_PROGRESS", "QA", "DELIVERED", "COMPLETE",
  ];
  const rank = (s: string) => LIFECYCLE_ORDER.indexOf(s);

  it("returns exactly the 3 demos A/B/C mapped to the canonical scenarios", () => {
    const ws = buildDemoWalkthroughs();
    expect(ws).toHaveLength(3);
    expect(ws.map((w) => w.letter)).toEqual(["A", "B", "C"]);
    // A→wordpress-happy, B→unknown-platform, C→scope-exception.
    expect(ws.find((w) => w.letter === "A")!.scenarioKey).toBe("wordpress-happy");
    expect(ws.find((w) => w.letter === "B")!.scenarioKey).toBe("unknown-platform");
    expect(ws.find((w) => w.letter === "C")!.scenarioKey).toBe("scope-exception");
  });

  it("every walkthrough carries the DEMO + NO-CHARGE + NO-EXTERNAL (+ NO REAL CUSTOMER) badges", () => {
    for (const w of buildDemoWalkthroughs()) {
      expect(w.badges).toEqual([...DEMO_WALKTHROUGH_BADGES]);
      expect(w.badges).toContain("DEMO");
      expect(w.badges).toContain("NO CHARGE");
      expect(w.badges).toContain("NO EXTERNAL MESSAGE");
      expect(w.badges).toContain("NO REAL CUSTOMER");
    }
  });

  it("DEMO B includes an explicit waiting-for-customer-access state (WAITING_FOR_CUSTOMER_INPUT)", () => {
    const b = buildDemoWalkthroughs().find((w) => w.letter === "B")!;
    const waiting = b.steps.find((s) => s.isCustomerWaiting === true);
    expect(waiting).toBeTruthy();
    expect(waiting!.state).toBe("WAITING_FOR_CUSTOMER_INPUT");
    expect(waiting!.showsCustomerPortal).toBe(true);
  });

  it("DEMO C includes an explicit 'Additional Decision Needed' state", () => {
    const c = buildDemoWalkthroughs().find((w) => w.letter === "C")!;
    const decision = c.steps.find((s) => s.isAdditionalDecision === true);
    expect(decision).toBeTruthy();
    expect(decision!.label).toMatch(/Additional Decision Needed/i);
  });

  it("every walkthrough's step order matches the job lifecycle (non-decreasing)", () => {
    for (const w of buildDemoWalkthroughs()) {
      expect(w.steps.length).toBeGreaterThan(0);
      for (const s of w.steps) expect(rank(s.state)).toBeGreaterThanOrEqual(0); // every state is a real lifecycle state
      for (let i = 1; i < w.steps.length; i++) {
        expect(rank(w.steps[i].state)).toBeGreaterThanOrEqual(rank(w.steps[i - 1].state));
      }
      // Ends at completion, and every walkthrough reaches the customer portal + completion.
      expect(w.steps[w.steps.length - 1].state).toBe("COMPLETE");
      expect(w.steps.some((s) => s.showsCustomerPortal)).toBe(true);
    }
  });

  it("resolves workspace + customer-portal deep links from the seeded offerIds (idempotent seed)", async () => {
    const seeded = await seedDemoScenarios();
    const byKey = Object.fromEntries(seeded.map((s) => [s.key, s.offerId]));
    const ws = buildDemoWalkthroughs(byKey as any);
    for (const w of ws) {
      const offerId = byKey[w.scenarioKey];
      expect(w.workspaceHref).toBe(`/revenue/fulfillment/${offerId}`);
      expect(w.portalHref).toBe(`/offer/${offerId}/portal`);
      expect(w.resetHref).toMatch(/reset/);
    }
  });
});
