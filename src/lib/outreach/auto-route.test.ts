import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { __resetStoreForTests } from "../store";
import { insertLead, insertTask, getLead, allTasks } from "../repo";
import { makeLead } from "../test-lead";
import type { Lead, Task } from "../types";
import { routeDestinationFor, materializeLeadRoute, materializeRouting, routeNewLead } from "./auto-route";
import { channelReadiness, channelDeficits } from "../work-queue";

// Owner-accessible = a non-gatekeeper business an owner picks up for (motel/trades/retail).
const ownerAccessible = (over: Partial<Lead> = {}) =>
  makeLead({ industry: "Auto repair", normalizedCategory: "auto-repair", ...over });

async function seed(over: Partial<Lead>): Promise<Lead> {
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = makeLead(over);
  return insertLead(rest);
}
const openTasks = async (leadId: string) => (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open");
const openOfType = async (leadId: string, type: Task["type"]) => (await openTasks(leadId)).filter((t) => t.type === type);

// ─────────────────────────────────────────────────────────────────────────────
// routeDestinationFor — the pure routing decision (no side effects).
// ─────────────────────────────────────────────────────────────────────────────
describe("routeDestinationFor — where a sufficiently-understood business goes", () => {
  it("owner-accessible business with a phone and no email is a CALL (Electrician Max Burbank)", () => {
    const lead = ownerAccessible({ businessName: "Electrician Max Burbank", industry: "Electrical contractors", normalizedCategory: "electrician", publicEmail: null, phone: "(818) 555-0100", website: null });
    expect(routeDestinationFor(lead)).toBe("call");
  });

  it("a business with a verified public email is an EMAIL — including gatekeeper dental/legal", () => {
    expect(routeDestinationFor(makeLead({ publicEmail: "hello@dentist.com" }))).toBe("email"); // dental default
    expect(routeDestinationFor(makeLead({ industry: "Law firm", normalizedCategory: "law-firm", publicEmail: "hi@firm.com" }))).toBe("email");
    expect(routeDestinationFor(ownerAccessible({ publicEmail: "shop@auto.com" }))).toBe("email");
  });

  it("a gatekeeper practice with only a phone is NEEDS-ATTENTION, never a cold call", () => {
    const dentist = makeLead({ publicEmail: null, phone: "(213) 555-0199", website: null, contactFormUrl: null, socialLinks: [] });
    expect(routeDestinationFor(dentist)).toBe("needs-attention");
  });

  it("a business with no verifiable channel at all is NEEDS-ATTENTION", () => {
    const none = ownerAccessible({ publicEmail: null, phone: null, website: null, websiteDomain: null, contactFormUrl: null, socialLinks: [] });
    expect(routeDestinationFor(none)).toBe("needs-attention");
  });

  it("a terminal (disqualified/closed) lead routes to NONE — no work", () => {
    expect(routeDestinationFor(ownerAccessible({ pipelineStage: "Disqualified" }))).toBe("none");
    expect(routeDestinationFor(makeLead({ pipelineStage: "Won" }))).toBe("none");
  });

  it("a high-value personal-walkthrough lead (non-email motion) is VIDEO", () => {
    const lead = ownerAccessible({ publicEmail: null, phone: "(818) 555-0100", recommendedAction: "Prepare video" });
    expect(routeDestinationFor(lead)).toBe("video");
  });

  it("video never overrides an email route — an emailable walkthrough lead still EMAILS", () => {
    const lead = ownerAccessible({ publicEmail: "shop@auto.com", recommendedAction: "Prepare video" });
    expect(routeDestinationFor(lead)).toBe("email");
  });

  it("form-only → contact-form; instagram-only → instagram-dm", () => {
    expect(routeDestinationFor(ownerAccessible({ publicEmail: null, phone: null, website: null, contactFormUrl: "https://x.com/contact" }))).toBe("contact-form");
    expect(routeDestinationFor(ownerAccessible({ publicEmail: null, phone: null, website: null, contactFormUrl: null, socialLinks: ["https://instagram.com/x"] }))).toBe("instagram-dm");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// materializeLeadRoute — idempotent conversion of the "review" placeholder.
// ─────────────────────────────────────────────────────────────────────────────
describe("materializeLeadRoute — no human 'Done' needed to route a understood lead", () => {
  beforeEach(() => __resetStoreForTests());

  async function seedWithReview(over: Partial<Lead>): Promise<Lead> {
    const lead = await seed(over);
    await insertTask({ leadId: lead.id, type: "review", title: `Review new lead — ${lead.businessName}`, dueAt: new Date().toISOString(), status: "open", priority: 30, snoozedUntil: null });
    return lead;
  }

  it("a dentist with an email is routed to EMAIL work and the review placeholder is retired", async () => {
    const lead = await seedWithReview({ publicEmail: "hello@dentist.com" });
    const res = await materializeLeadRoute(lead.id);
    expect(res?.destination).toBe("email");
    expect(res?.created).toBe(true);
    expect(res?.superseded).toBe(1);
    expect(await openOfType(lead.id, "review")).toHaveLength(0); // left the understand queue
    expect(await openOfType(lead.id, "review_and_send")).toHaveLength(1);
  });

  it("an owner-accessible no-email business is routed to CALL work (as review_and_send re-bucketed by strategy)", async () => {
    const lead = await seedWithReview(ownerAccessible({ publicEmail: null, phone: "(818) 555-0100", website: null }));
    const res = await materializeLeadRoute(lead.id);
    expect(res?.destination).toBe("call");
    expect(await openOfType(lead.id, "review_and_send")).toHaveLength(1); // work queue buckets this to Calls
    expect(await openOfType(lead.id, "review")).toHaveLength(0);
  });

  it("is idempotent — a second pass creates nothing and supersedes nothing", async () => {
    const lead = await seedWithReview({ publicEmail: "hello@dentist.com" });
    await materializeLeadRoute(lead.id);
    const second = await materializeLeadRoute(lead.id);
    expect(second?.created).toBe(false);
    expect(second?.superseded).toBe(0);
    expect(await openOfType(lead.id, "review_and_send")).toHaveLength(1); // still exactly one
  });

  it("a no-channel lead KEEPS its review task (genuine Needs attention) and gets no outreach work", async () => {
    const lead = await seedWithReview(ownerAccessible({ publicEmail: null, phone: null, website: null, websiteDomain: null, contactFormUrl: null, socialLinks: [] }));
    const res = await materializeLeadRoute(lead.id);
    expect(res?.destination).toBe("needs-attention");
    expect(res?.created).toBe(false);
    expect(await openOfType(lead.id, "review")).toHaveLength(1); // stays as the human question
    expect(await openOfType(lead.id, "review_and_send")).toHaveLength(0);
  });

  it("never duplicates: a lead that already has a call task just gets its stale review retired", async () => {
    const lead = await seedWithReview(ownerAccessible({ publicEmail: null, phone: "(818) 555-0100", website: null }));
    await insertTask({ leadId: lead.id, type: "call", title: `Call — ${lead.businessName}`, dueAt: new Date().toISOString(), status: "open", priority: 55, snoozedUntil: null });
    const res = await materializeLeadRoute(lead.id);
    expect(res?.created).toBe(false); // did not add a second first-touch
    expect(res?.superseded).toBe(1);
    expect(await openOfType(lead.id, "call")).toHaveLength(1);
    expect(await openOfType(lead.id, "review")).toHaveLength(0);
  });

  it("a terminal lead gets no execution task, and its stale review is retired", async () => {
    const lead = await seedWithReview(ownerAccessible({ pipelineStage: "Disqualified" }));
    const res = await materializeLeadRoute(lead.id);
    expect(res?.destination).toBe("none");
    expect(await openTasks(lead.id)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// materializeRouting — bounded batch pass that drains the backlog (and migrates legacy).
// ─────────────────────────────────────────────────────────────────────────────
describe("materializeRouting — drains the understand backlog into execution streams", () => {
  beforeEach(() => __resetStoreForTests());

  async function seedWithReview(over: Partial<Lead>) {
    const lead = await seed(over);
    await insertTask({ leadId: lead.id, type: "review", title: `Review — ${lead.businessName}`, dueAt: new Date().toISOString(), status: "open", priority: 30, snoozedUntil: null });
    return lead;
  }

  it("routes email/call leads, leaves no-channel ones as Needs attention, and reports the split", async () => {
    const em = await seedWithReview({ businessName: "Dentist A", publicEmail: "a@d.com" });
    const call = await seedWithReview(ownerAccessible({ businessName: "Shop B", publicEmail: null, phone: "(818) 555-0100", website: null }));
    const na = await seedWithReview(ownerAccessible({ businessName: "Ghost C", publicEmail: null, phone: null, website: null, websiteDomain: null, contactFormUrl: null, socialLinks: [] }));
    const dq = await seedWithReview(ownerAccessible({ businessName: "Closed D", pipelineStage: "Disqualified" }));

    const summary = await materializeRouting();
    expect(summary.processed).toBe(4);
    expect(summary.routed.email).toBe(1);
    expect(summary.routed.call).toBe(1);
    expect(summary.needsAttention).toBe(1);

    expect(await openOfType(em.id, "review_and_send")).toHaveLength(1);
    expect(await openOfType(call.id, "review_and_send")).toHaveLength(1);
    expect(await openOfType(na.id, "review")).toHaveLength(1); // still needs a human
    expect(await openTasks(dq.id)).toHaveLength(0); // terminal, retired
  });

  it("is idempotent — rerun after the backlog is drained changes nothing", async () => {
    await seedWithReview({ businessName: "Dentist A", publicEmail: "a@d.com" });
    await materializeRouting();
    const second = await materializeRouting();
    expect(second.processed).toBe(0); // no review placeholders left to route
    expect(second.superseded).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// routeNewLead — discovery routes a brand-new lead directly, no placeholder tap.
// ─────────────────────────────────────────────────────────────────────────────
describe("routeNewLead — new businesses skip the understand queue", () => {
  beforeEach(() => __resetStoreForTests());

  it("a routable new lead gets execution work and NO review placeholder", async () => {
    const lead = await seed({ publicEmail: "hello@dentist.com" });
    const dest = await routeNewLead(lead);
    expect(dest).toBe("email");
    expect(await openOfType(lead.id, "review")).toHaveLength(0);
    expect(await openOfType(lead.id, "review_and_send")).toHaveLength(1);
  });

  it("a no-channel new lead gets ONE Needs-attention review task (a real question)", async () => {
    const lead = await seed(ownerAccessible({ publicEmail: null, phone: null, website: null, websiteDomain: null, contactFormUrl: null, socialLinks: [] }));
    const dest = await routeNewLead(lead);
    expect(dest).toBe("needs-attention");
    expect(await openOfType(lead.id, "review")).toHaveLength(1);
    expect(await openOfType(lead.id, "review_and_send")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Active supply goals — readiness vs target, deficit-aware but never fabricated.
// ─────────────────────────────────────────────────────────────────────────────
describe("channelReadiness / channelDeficits — targets are supply goals, not caps", () => {
  const task = (leadId: string, type: Task["type"]): Task => ({ leadId, type } as Task);

  it("counts DISTINCT businesses per stream (a lead with two email tasks is one)", () => {
    const emailLead = makeLead({ id: "e1", publicEmail: "a@d.com" });
    const callLead = makeLead({ id: "c1", industry: "Auto repair", normalizedCategory: "auto-repair", publicEmail: null, phone: "(818) 555-0100", website: null });
    const leads = new Map<string, Lead>([[emailLead.id, emailLead], [callLead.id, callLead]]);
    const tasks = [task("e1", "review_and_send"), task("e1", "follow_up"), task("c1", "review_and_send"), task("c1", "prepare_video")];
    const ready = channelReadiness(tasks, leads);
    expect(ready.email).toBe(1); // one distinct emailable business (two tasks)
    expect(ready.call).toBe(1);
    expect(ready.video).toBe(1);
  });

  it("deficits are target − ready and never negative; a full stream pulls no replenishment", () => {
    expect(channelDeficits({ call: 10, email: 1, video: 0 }, { call: 10, email: 10, video: 3 })).toEqual({ call: 0, email: 9, video: 3 });
    // over-target never goes negative
    expect(channelDeficits({ call: 12, email: 0, video: 0 }, { call: 10, email: 10, video: 3 }).call).toBe(0);
  });

  it("one stream being full does not consume another stream's deficit", () => {
    const d = channelDeficits({ call: 10, email: 1, video: 0 }, { call: 10, email: 10, video: 3 });
    expect(d.call).toBe(0); // calls satisfied
    expect(d.email).toBe(9); // emails still short — independent
    expect(d.video).toBe(3);
  });
});
