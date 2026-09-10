// Customer Portal lifecycle proofs (mandate 6f · §16-19/§22/§12). Drives REAL canonical fulfillment
// transitions and re-resolves the portal after each one, proving the customer-facing projection updates
// automatically (no manual portal edits, no duplicate state). No real customer / charge / external email.
import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { listAudit } from "../repo";
import { generateOffer } from "./offer-engine";
import * as store from "./store";
import { PRODUCTION_RETEST_STEP } from "./fulfillment-gates";
import { buildRunbook, normalizePlatform } from "./fulfillment-center";
import { buildCustomerPortalView, stageForJobState } from "./customer-portal";
import { advanceJobState, ensureFulfillmentProject } from "./fulfillment-advance";
import { renderCustomerEmail } from "./customer-emails";
import type { OfferFinding, QuickFixOffer } from "./types";

const CTA: OfferFinding = {
  id: "f1", title: "Booking button broken on mobile", category: "cta-conversion",
  observation: "The primary booking button does not work on phones.", severity: "high",
  whyItMatters: "Visitors can't book.", confidence: "Verified", approved: true,
} as unknown as OfferFinding;

// __resetStoreForTests clears the general store but NOT the quickFix settings namespace (jobs/offers) —
// wipe it via the store's own path so each fixture starts from a genuinely empty fulfillment store.
beforeEach(async () => { __resetStoreForTests(); await store.__resetQuickFixForTests(); });

// offerId == qfo_<offerVersion>, and offerVersion hashes the PRICE/DELIVERABLE fields (not leadId/text).
// Varying the finding CATEGORY changes the bundled capability → a genuinely distinct offerId per test, so
// no test's job can collide with another's.
const CATEGORIES = ["cta-conversion", "mobile-responsive", "accessibility", "seo-metadata", "contact-form-lead-capture", "analytics-tracking"];
let seq = 0;
async function seedOffer(): Promise<{ offerId: string; offer: QuickFixOffer }> {
  const cat = CATEGORIES[seq % CATEGORIES.length];
  seq += 1;
  const finding = { ...CTA, id: `f_${seq}`, category: cat, observation: `${CTA.observation} (#${seq})` } as unknown as OfferFinding;
  const raw = generateOffer({ leadId: `lead_${seq}`, companyName: `a2z Health ${seq}`, findings: [finding], generatedAt: null });
  const stored = await store.upsertOffer(raw as unknown as QuickFixOffer, { recipientEmail: `c${seq}@x.com`, now: "2026-09-09T00:00:00Z" });
  return { offerId: stored.offerId, offer: stored as unknown as QuickFixOffer };
}

async function platformOf(offer: QuickFixOffer) {
  return normalizePlatform(null);
}

/** Persist everything the server-side delivery gate requires so DELIVERED/COMPLETE are legitimately reachable. */
async function passDeliveryGate(offerId: string, offer: QuickFixOffer) {
  const platform = await platformOf(offer);
  for (const item of buildRunbook(offer, platform).qaChecklist) await store.setQaItem(offerId, item, true);
  await store.setRunbookStep(offerId, PRODUCTION_RETEST_STEP, { done: true });
  await store.addEvidence(offerId, { kind: "before", storageKey: "before-key", label: "before", demonstrates: "pre-change state" });
  await store.addEvidence(offerId, { kind: "after", storageKey: "after-key", label: "after", demonstrates: "post-change state" });
}

describe("CP7 — purchase → portal automation is idempotent", () => {
  it("creates the fulfillment project once; retrying never duplicates the job/token", async () => {
    const { offerId, offer } = await seedOffer();
    const first = await ensureFulfillmentProject(offer, { needsIntake: false, now: "2026-09-09T00:00:00Z" });
    const second = await ensureFulfillmentProject(offer, { needsIntake: false, now: "2026-09-09T00:05:00Z" });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);            // idempotent
    expect(second.job.offerId).toBe(first.job.offerId);
    expect((await store.listJobs()).filter((j) => j.offerId === offerId)).toHaveLength(1); // no duplicate
    // portal resolves immediately from the created project — no operator step
    const portal = await buildCustomerPortalView(offerId);
    expect(portal).not.toBeNull();
    expect(portal!.stage).toBe("WORKING"); // needsIntake:false → READY_FOR_FULFILLMENT → WORKING
  });
});

describe("Fixture A — simple success: drive the full lifecycle, portal updates automatically", () => {
  it("Order Confirmed → In Progress → Testing → Complete, each transition changes the customer portal", async () => {
    const { offerId, offer } = await seedOffer();
    await ensureFulfillmentProject(offer, { needsIntake: false, now: "2026-09-09T00:00:00Z" });

    let p = await buildCustomerPortalView(offerId);
    expect(p!.stage).toBe("WORKING");
    expect(p!.completionReport).toBeNull();

    // → IN_PROGRESS
    expect((await advanceJobState(offerId, "IN_PROGRESS")).ok).toBe(true);
    p = await buildCustomerPortalView(offerId);
    expect(p!.timeline.some((e) => e.label === "Implementation started")).toBe(true);

    // → QA (Testing)
    expect((await advanceJobState(offerId, "QA")).ok).toBe(true);
    p = await buildCustomerPortalView(offerId);
    expect(p!.stage).toBe("TESTING");
    expect(p!.timeline.some((e) => e.label === "Testing started")).toBe(true);

    // → DELIVERED (needs the gate satisfied) → completion report appears
    await passDeliveryGate(offerId, offer);
    const del = await advanceJobState(offerId, "DELIVERED");
    expect(del.ok).toBe(true);
    p = await buildCustomerPortalView(offerId);
    expect(p!.stage).toBe("COMPLETE");
    expect(p!.completionReport).not.toBeNull();
    // before/after evidence surfaces on the completion report (verification depends on the platform's
    // QA checklist, which is empty for a generic platform — the evidence refs are the reliable proof).
    expect(p!.completionReport!.beforeRef).toBe("before-key");
    expect(p!.completionReport!.afterRef).toBe("after-key");

    // → COMPLETE
    expect((await advanceJobState(offerId, "COMPLETE")).ok).toBe(true);
    p = await buildCustomerPortalView(offerId);
    expect(p!.timeline.some((e) => e.label === "Project completed")).toBe(true);
    // timeline is customer-safe — no internal noise
    const labels = p!.timeline.map((e) => e.label.toLowerCase()).join(" ");
    for (const noise of ["retry", "runbook", "qa item", "evidence", "worker", "breakbot"]) expect(labels).not.toContain(noise);
  });
});

describe("Fixture B — waiting for access: NEXT STEP changes automatically", () => {
  it("Waiting for Access → (access received) → In Progress, driven by fulfillment", async () => {
    const { offerId, offer } = await seedOffer();
    await ensureFulfillmentProject(offer, { needsIntake: true, now: "2026-09-09T00:00:00Z" });

    let p = await buildCustomerPortalView(offerId);
    expect(p!.stage).toBe("ACCESS_NEEDED");
    expect(p!.currentAction?.headline.toLowerCase()).toMatch(/access|confirm|details/); // customer owes an action

    // simulate secure access receipt (native invite — never a password) + advance
    await store.setAccessItem(offerId, p!.access[0]?.key ?? "website-admin", { status: "RECEIVED" });
    expect((await advanceJobState(offerId, "READY_FOR_FULFILLMENT")).ok).toBe(true);

    p = await buildCustomerPortalView(offerId);
    expect(p!.stage).toBe("WORKING");
    expect(p!.currentAction?.headline.toLowerCase()).not.toMatch(/grant access/); // nothing needed from you now
    expect(p!.timeline.some((e) => e.label === "Access received")).toBe(true);
  });
});

describe("Fixture C — scope complication: frozen scope + Additional Decision Needed", () => {
  it("complication → decision needed → simulated decision → resume, original scope UNCHANGED throughout", async () => {
    const { offerId, offer } = await seedOffer();
    const frozenScope = JSON.stringify(offer.scope); // capture the purchased promise
    await ensureFulfillmentProject(offer, { needsIntake: false, now: "2026-09-09T00:00:00Z" });
    await advanceJobState(offerId, "IN_PROGRESS");

    // complication discovered — raise it (offer.scope must NOT change)
    await store.raiseScopeException(offerId, {
      discovered: "While implementing, we found the checkout flow is also broken.",
      insideScope: "Repair the booking button on mobile",
      outsideScope: "Rebuilding the broken checkout flow",
      options: ["Proceed with the booking button fix only", "Discuss a separate fix for checkout"],
      recommendedRoute: "DIFFERENT_SKU",
    }, { now: "2026-09-09T02:00:00Z", actor: "operator" });

    let p = await buildCustomerPortalView(offerId);
    expect(p!.decisionNeeded).not.toBeNull();
    expect(p!.decisionNeeded!.outsideScope).toContain("checkout");
    expect(p!.currentAction?.headline).toBe("Additional decision needed");
    // frozen scope preserved — never silently expanded
    const offerNow = await store.getOffer(offerId);
    expect(JSON.stringify(offerNow!.scope)).toBe(frozenScope);

    // simulated customer decision → resolve → work resumes
    await store.resolveScopeException(offerId, "Proceed with the booking button fix only", { now: "2026-09-09T03:00:00Z", actor: "customer" });
    p = await buildCustomerPortalView(offerId);
    expect(p!.decisionNeeded).toBeNull();

    // resume → testing → complete, scope STILL unchanged
    await advanceJobState(offerId, "QA");
    await passDeliveryGate(offerId, offer);
    await advanceJobState(offerId, "DELIVERED");
    const offerFinal = await store.getOffer(offerId);
    expect(JSON.stringify(offerFinal!.scope)).toBe(frozenScope);

    // audit trail shows the full arc
    const actions = (await listAudit(500)).filter((a) => a.targetId === offerId).map((a) => a.action);
    expect(actions).toContain("quickfix.scope_exception_raised");
    expect(actions).toContain("quickfix.scope_exception_resolved");
  });
});

describe("§12 regression — the portal can NEVER drift from canonical job state", () => {
  it("portal.stage always equals stageForJobState(job.state) across the whole lifecycle", async () => {
    const { offerId, offer } = await seedOffer();
    await ensureFulfillmentProject(offer, { needsIntake: false, now: "2026-09-09T00:00:00Z" });
    const path: store.JobRecord["state"][] = ["IN_PROGRESS", "QA", "DELIVERED", "COMPLETE"];
    // assert BEFORE any transition, then after each
    for (const target of [null, ...path]) {
      if (target) {
        if (target === "DELIVERED") await passDeliveryGate(offerId, offer);
        const r = await advanceJobState(offerId, target);
        expect(r.ok, `advance → ${target}`).toBe(true);
      }
      const job = (await store.getJob(offerId))!;
      const portal = await buildCustomerPortalView(offerId);
      expect(portal!.jobState).toBe(job.state);
      expect(portal!.stage).toBe(stageForJobState(job.state));
    }
  });
});

describe("§24 transactional templates — render only, secure portal link, no secrets", () => {
  const input = { portalToken: "qfo_abc123", company: "a2z Health", serviceName: "Booking button repair", accessSummary: "WordPress editor access" };

  it("order-confirmed / access-needed / project-complete each link to the customer's portal and never send", () => {
    for (const kind of ["order-confirmed", "access-needed", "project-complete"] as const) {
      const m = renderCustomerEmail(kind, input);
      expect(m.sent).toBe(false);                                   // render-only
      expect(m.portalUrl).toContain("/offer/qfo_abc123/portal");    // customer's capability token
      expect(m.subject.length).toBeGreaterThan(0);
      expect(m.text).toContain(m.portalUrl);
      // never leak a secret; access-needed reassures we don't ask for a password
      expect(m.text.toLowerCase()).not.toMatch(/api[_-]?key|bearer |secretkey/);
    }
    expect(renderCustomerEmail("access-needed", input).text.toLowerCase()).toContain("never ask for your password");
  });
});
