import { describe, it, expect } from "vitest";
import {
  quickFixProjectTemplate,
  engagementProjectTemplate,
  milestoneProgress,
  milestoneUnblocked,
  outstandingCustomerActions,
  customerTimeline,
  openChangeRequest,
  allMilestones,
  type CustomerProject,
} from "./customer-project";

const NOW = "2026-09-10T12:00:00.000Z";

describe("Quick-Fix project (lightweight subset, CP1)", () => {
  it("builds the Order Confirmed → … → Complete chain, first milestone done, rest pending", () => {
    const p = quickFixProjectTemplate({ id: "p1", orderId: "o1", customerRef: "c1", packageName: "Form Fix", now: NOW, needsAccess: true });
    const ms = allMilestones(p);
    expect(ms.map((m) => m.key)).toEqual(["order-confirmed", "access-received", "fix-in-progress", "testing", "complete"]);
    expect(ms[0].status).toBe("done");
    expect(ms.slice(1).every((m) => m.status === "pending")).toBe(true);
    // references canonical identity, never duplicates it
    expect(p.orderId).toBe("o1");
    expect(p.customerRef).toBe("c1");
  });

  it("progress is DERIVED from real milestone completion (never fabricated)", () => {
    const p = quickFixProjectTemplate({ id: "p1", orderId: "o1", customerRef: "c1", packageName: "Form Fix", now: NOW, needsAccess: false });
    let prog = milestoneProgress(p);
    expect(prog).toMatchObject({ completed: 1, total: 5, currentKey: "access-received" });
    expect(prog.fraction).toBe(0.2);
    // mark two more done → fraction tracks actual completion
    allMilestones(p)[1].status = "done";
    allMilestones(p)[2].status = "done";
    prog = milestoneProgress(p);
    expect(prog.completed).toBe(3);
    expect(prog.fraction).toBe(0.6);
    expect(prog.currentKey).toBe("testing");
  });

  it("a milestone stays gated until its dependency is done (dependency graph)", () => {
    const p = quickFixProjectTemplate({ id: "p1", orderId: "o1", customerRef: "c1", packageName: "Form Fix", now: NOW, needsAccess: false });
    expect(milestoneUnblocked(p, "fix-in-progress")).toBe(false); // access-received not done
    allMilestones(p).find((m) => m.key === "access-received")!.status = "done";
    expect(milestoneUnblocked(p, "fix-in-progress")).toBe(true);
  });

  it("surfaces outstanding customer actions (Access Center 'next step from you')", () => {
    const p = quickFixProjectTemplate({ id: "p1", orderId: "o1", customerRef: "c1", packageName: "Form Fix", now: NOW, needsAccess: true });
    const out = outstandingCustomerActions(p);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("provide-access");
    // resolving it clears the outstanding list
    p.customerActions[0].status = "resolved";
    expect(outstandingCustomerActions(p)).toHaveLength(0);
  });

  it("customer timeline projects only customer-safe events (no internal noise)", () => {
    const p = quickFixProjectTemplate({ id: "p1", orderId: "o1", customerRef: "c1", packageName: "Form Fix", now: NOW, needsAccess: false });
    p.statusHistory.push({ at: "2026-09-10T13:00:00.000Z", kind: "worker.retry", customerLabel: "internal retry 2/3", customerSafe: false });
    p.statusHistory.push({ at: "2026-09-10T14:00:00.000Z", kind: "impl.started", customerLabel: "Implementation started", customerSafe: true });
    const tl = customerTimeline(p);
    expect(tl.map((e) => e.label)).toEqual(["Order confirmed", "Implementation started"]);
    expect(tl.some((e) => e.label.includes("retry"))).toBe(false);
  });

  it("open change request = decision needed (no silent scope expansion §22)", () => {
    const p = quickFixProjectTemplate({ id: "p1", orderId: "o1", customerRef: "c1", packageName: "Form Fix", now: NOW, needsAccess: false });
    expect(openChangeRequest(p)).toBeNull();
    p.changeRequests.push({ id: "cr1", discovered: "The gallery plugin also blocks the form", insideOriginalScope: "Repair the quote form flow", outsideOriginalScope: "Replacing the gallery plugin", options: ["Proceed with form only", "Add gallery fix as a change order"], status: "open" });
    expect(openChangeRequest(p)?.id).toBe("cr1");
  });
});

describe("Engagement project (scale-ready, CP1 §21) — same model, no replacement", () => {
  it("represents Discovery→…→Completion as phases with dependencies + an approval", () => {
    const p: CustomerProject = engagementProjectTemplate({ id: "e1", orderId: "o9", customerRef: "c9", packageName: "Gov Portal Build", now: NOW });
    expect(p.phases.map((ph) => ph.key)).toEqual([
      "discovery", "design", "prototype", "development", "integration", "accessibility-qa", "customer-uat", "deployment", "completion",
    ]);
    // 9 milestones, first active, chained by dependency
    const ms = allMilestones(p);
    expect(ms).toHaveLength(9);
    expect(ms[0].status).toBe("active");
    expect(ms[1].dependsOn).toEqual(["discovery-complete"]);
    expect(milestoneUnblocked(p, "design-complete")).toBe(false);
    // it carries a UAT approval — proving approvals are first-class
    expect(p.approvals.find((a) => a.key === "uat-signoff")?.status).toBe("awaiting");
    // progress derives the same way as Quick-Fix
    expect(milestoneProgress(p).total).toBe(9);
  });
});
