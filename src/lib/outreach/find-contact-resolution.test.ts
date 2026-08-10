import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { __resetStoreForTests } from "../store";
import { insertLead, insertTask, getLead, allTasks, todaysTasks, listAudit } from "../repo";
import { recordNoContactRouteAction, deferContactDiscoveryAction, disqualifyLeadAction, saveManualContactAction } from "./find-contact";
import { resolveNextLead } from "./next-lead";
import { determineContactStrategy } from "./contact-strategy";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";

// A no-channel lead (Glendale Plaza) with its open "review" task — how it lands in the queue.
async function seedNoChannelLead(name: string, priority: number, over: Partial<Lead> = {}) {
  const base = makeLead({ businessName: name, industry: "Boutique retail", normalizedCategory: "boutique", phone: null, publicEmail: null, website: null, websiteDomain: null, contactFormUrl: null, socialLinks: [], note: null, lastContactAt: null, pipelineStage: "Discovered", ...over });
  const { id, createdAt, updatedAt, ...rest } = base;
  const lead = await insertLead(rest);
  await insertTask({ leadId: lead.id, type: "review", title: `Review — ${name}`, dueAt: new Date().toISOString(), status: "open", priority, snoozedUntil: null });
  return lead;
}
const openTasks = async (leadId: string) => (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open");
const auditFor = async (leadId: string, action: string) => (await listAudit(500)).filter((a) => a.targetId === leadId && a.action === action);

describe("no-contact-found resolution — honest terminal state, no false disqualification", () => {
  beforeEach(() => __resetStoreForTests());

  it("records a structured resolution, removes the lead from Today, and keeps it valid", async () => {
    const g = await seedNoChannelLead("Glendale Plaza", 20);
    const res = await recordNoContactRouteAction(g.id, ["Google Business / Places listing"]);
    expect(res.ok).toBe(true);
    expect(res.resolvedTasks).toBe(1);

    // Removed from Today (task resolved), but NOT disqualified/closed, NOT contacted.
    expect(await openTasks(g.id)).toHaveLength(0);
    const after = await getLead(g.id);
    expect(after?.pipelineStage).toBe("Discovered"); // not Disqualified, not Lost
    expect((after?.businessStatus ?? "")).not.toMatch(/CLOSED/);
    expect(after?.lastContactAt).toBeNull(); // no conversation happened
    // No fabricated contact data.
    expect(after?.phone).toBeNull();
    expect(after?.publicEmail).toBeNull();
    expect(after?.website).toBeNull();
    // Structured record for analytics (not only a note).
    const ev = await auditFor(g.id, "lead.contact.exhausted");
    expect(ev).toHaveLength(1);
    expect(ev[0].meta?.result).toBe("no-verified-channel");
    expect((ev[0].meta?.sourcesChecked as string[])).toContain("Google Business / Places listing");
    expect(after?.note).toContain("Contact discovery exhausted");
  });

  it("the resolved lead is not returned by resolveNextLead; the next actionable one is", async () => {
    const g = await seedNoChannelLead("Glendale Plaza", 30);
    const b = await seedNoChannelLead("Next Co", 20);
    await recordNoContactRouteAction(g.id, ["Google Business / Places listing"]);
    const next = await resolveNextLead(g.id);
    expect(next.nextLeadId).toBe(b.id); // moves on, never back to Glendale
  });

  it("is idempotent — a double press creates exactly one resolution event", async () => {
    const g = await seedNoChannelLead("Glendale Plaza", 20);
    await recordNoContactRouteAction(g.id, ["Google Business / Places listing"]);
    const second = await recordNoContactRouteAction(g.id, ["Google Business / Places listing"]);
    expect(second.resolvedTasks).toBe(0); // no-op the second time
    expect(await auditFor(g.id, "lead.contact.exhausted")).toHaveLength(1);
  });

  it("last lead → resolveNextLead reports done (batch complete)", async () => {
    const g = await seedNoChannelLead("Glendale Plaza", 20);
    await recordNoContactRouteAction(g.id, ["Google Business / Places listing"]);
    expect((await resolveNextLead(g.id)).done).toBe(true);
  });
});

describe("defer contact discovery — revisit later, not disqualified", () => {
  beforeEach(() => __resetStoreForTests());

  it("snoozes the lead out of Today (one future task), unchanged qualification, no lastContactAt", async () => {
    const g = await seedNoChannelLead("Glendale Plaza", 20);
    const res = await deferContactDiscoveryAction(g.id, 30);
    expect(res.ok).toBe(true);
    // Out of Today (snoozed into the future) but still exactly one task, and it resurfaces.
    expect((await todaysTasks()).some((t) => t.leadId === g.id)).toBe(false); // gone from today
    const all = (await allTasks()).filter((t) => t.leadId === g.id);
    expect(all).toHaveLength(1); // exactly one future task, not deleted
    expect(all[0].snoozedUntil).toBeTruthy(); // resurfaces later
    const after = await getLead(g.id);
    expect(after?.pipelineStage).toBe("Discovered"); // not disqualified
    expect(after?.lastContactAt).toBeNull();
    expect(await auditFor(g.id, "lead.contact.deferred")).toHaveLength(1);
    // resolveNextLead does not return the deferred lead
    expect((await resolveNextLead(g.id)).nextLeadId).toBeNull();
  });
});

describe("disqualify — a deliberate decision, distinct from unreachable", () => {
  beforeEach(() => __resetStoreForTests());

  it("sets Disqualified with a persisted reason and removes it from active queues", async () => {
    const g = await seedNoChannelLead("Glendale Plaza", 20);
    const res = await disqualifyLeadAction(g.id, "Outside target market");
    expect(res.ok).toBe(true);
    const after = await getLead(g.id);
    expect(after?.pipelineStage).toBe("Disqualified");
    expect(after?.note).toContain("Outside target market");
    const ev = await auditFor(g.id, "lead.disqualify");
    expect(ev).toHaveLength(1);
    expect(ev[0].meta?.reason).toBe("Outside target market");
    expect(await openTasks(g.id)).toHaveLength(0);
    expect((await resolveNextLead(g.id)).nextLeadId).toBeNull();
  });

  it("closed/invalid, duplicate, and no-contact-found remain distinguishable in the record", async () => {
    const nc = await seedNoChannelLead("Unreachable Co", 20);
    const dq = await seedNoChannelLead("Not A Fit Co", 20);
    await recordNoContactRouteAction(nc.id, ["Google Business / Places listing"]);
    await disqualifyLeadAction(dq.id, "Duplicate");
    // no-contact-found did NOT disqualify; disqualify DID — different states, different audit actions.
    expect((await getLead(nc.id))?.pipelineStage).toBe("Discovered");
    expect((await getLead(dq.id))?.pipelineStage).toBe("Disqualified");
    expect(await auditFor(nc.id, "lead.contact.exhausted")).toHaveLength(1);
    expect(await auditFor(nc.id, "lead.disqualify")).toHaveLength(0);
    expect(await auditFor(dq.id, "lead.disqualify")).toHaveLength(1);
  });
});

describe("manual entry after no-contact still works and re-routes the strategy", () => {
  beforeEach(() => __resetStoreForTests());

  it("a manually added valid phone flips the lead off no-channel to call-first", async () => {
    const g = await seedNoChannelLead("Glendale Plaza", 20);
    expect(determineContactStrategy((await getLead(g.id))!).kind).toBe("no-channel");
    const res = await saveManualContactAction(g.id, { phone: "(213) 329-7576", source: "Storefront", verified: true });
    expect(res.ok).toBe(true);
    expect(determineContactStrategy((await getLead(g.id))!).kind).toBe("call-first");
  });
});
