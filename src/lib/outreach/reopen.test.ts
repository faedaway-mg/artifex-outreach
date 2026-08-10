import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { __resetStoreForTests } from "../store";
import { insertLead, getLead, allTasks, contactsForLead, insertContact, auditForTarget } from "../repo";
import { saveCallOutcomeAction } from "./call-outcome";
import { reopenLeadAction } from "../actions";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";

async function seedLead(over: Partial<Lead> = {}) {
  const base = makeLead({ businessName: "DTLA Smile", pipelineStage: "Qualified", publicEmail: "front@dtlasmile.test", note: "Original research note.", ...over });
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = base;
  return insertLead(rest);
}
const openCalls = async (leadId: string) => (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open" && t.type === "call");

describe("reopenLeadAction — undo an accidental terminal outcome without deleting history", () => {
  beforeEach(() => __resetStoreForTests());

  it("reverses an accidental 'Permanently closed / invalid' and restores an active call lead", async () => {
    const lead = await seedLead();
    await insertContact({ leadId: lead.id, name: "Marcus", title: "Front desk", email: "front@dtlasmile.test", phone: null, linkedinUrl: null, source: "conversation", confidence: "Verified", verified: true, optedOut: false });
    await saveCallOutcomeAction(lead.id, { outcome: "business-closed" });
    const closed = await getLead(lead.id);
    expect(closed?.pipelineStage).toBe("Disqualified");
    expect(closed?.businessStatus).toBe("CLOSED_PERMANENTLY");

    const res = await reopenLeadAction(lead.id);
    expect(res).toMatchObject({ ok: true, reopened: true });
    const after = await getLead(lead.id);
    // Terminal state reversed and internally consistent (not closed while re-queued).
    expect(after?.pipelineStage).toBe("Qualified");
    expect(after?.businessStatus).not.toMatch(/^CLOSED/);
    // Exactly one actionable call task restored.
    expect(await openCalls(lead.id)).toHaveLength(1);
    // History preserved: the terminal note AND a correction note both remain.
    expect(after?.note).toContain("business appears closed or invalid");
    expect(after?.note).toContain("Operator correction: lead reopened");
    // Research preserved: the contact/email is untouched.
    expect(await contactsForLead(lead.id)).toHaveLength(1);
    expect(after?.publicEmail).toBe("front@dtlasmile.test");
    // Auditable.
    const audits = await auditForTarget("lead", lead.id);
    expect(audits.some((a) => a.action === "lead.reopened")).toBe(true);
  });

  it("does NOT guess the replacement outcome — the operator can then log Closed right now", async () => {
    const lead = await seedLead();
    await saveCallOutcomeAction(lead.id, { outcome: "business-closed" });
    await reopenLeadAction(lead.id);
    // The reopened lead is active (not closed-now); the operator explicitly logs the correct one.
    const res = await saveCallOutcomeAction(lead.id, { outcome: "closed-now" });
    expect(res.ok).toBe(true);
    const after = await getLead(lead.id);
    expect(after?.pipelineStage).toBe("Qualified"); // closed-now is non-terminal
    expect(after?.businessStatus).not.toMatch(/^CLOSED_PERMANENTLY/);
  });

  it("reopens an accidental 'Not interested' (Lost) too", async () => {
    const lead = await seedLead();
    await saveCallOutcomeAction(lead.id, { outcome: "not-interested" });
    expect((await getLead(lead.id))?.pipelineStage).toBe("Lost");
    await reopenLeadAction(lead.id);
    expect((await getLead(lead.id))?.pipelineStage).toBe("Qualified");
    expect(await openCalls(lead.id)).toHaveLength(1);
  });

  it("is idempotent — a second reset is a safe no-op and never duplicates the call task", async () => {
    const lead = await seedLead();
    await saveCallOutcomeAction(lead.id, { outcome: "business-closed" });
    const first = await reopenLeadAction(lead.id);
    const second = await reopenLeadAction(lead.id);
    expect(first.reopened).toBe(true);
    expect(second.reopened).toBe(false); // already active
    expect(await openCalls(lead.id)).toHaveLength(1); // still exactly one
    const audits = await auditForTarget("lead", lead.id);
    expect(audits.filter((a) => a.action === "lead.reopened")).toHaveLength(1); // one correction event
  });

  it("is a no-op on a lead that is already active", async () => {
    const lead = await seedLead(); // Qualified, never closed
    const res = await reopenLeadAction(lead.id);
    expect(res).toMatchObject({ ok: true, reopened: false });
    expect(await openCalls(lead.id)).toHaveLength(0); // no task fabricated
  });
});
