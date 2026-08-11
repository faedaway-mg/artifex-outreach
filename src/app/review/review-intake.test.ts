import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { __resetStoreForTests } from "@/lib/store";
import { listLeads, allTasks, listAudit } from "@/lib/repo";
import { determineContactStrategy } from "@/lib/outreach/contact-strategy";
import { acquisitionChannelOf, isFromContent001 } from "@/lib/acquisition/provenance";
import { requestReviewAction } from "./actions";

const leadByName = async (name: string) => (await listLeads()).find((l) => l.businessName === name);
const openTasks = async (leadId: string) => (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open");
const auditFor = async (leadId: string) => (await listAudit(500)).filter((a) => a.targetId === leadId && a.action === "lead.inbound.review_requested");

describe("inbound /review → Acquisition OS (one loop, no second pipeline)", () => {
  beforeEach(() => __resetStoreForTests());

  it("a real request becomes an email-first lead with Content #001 provenance and top-priority review work", async () => {
    const res = await requestReviewAction({
      businessName: "Taylor Family Dental", website: "taylordental.com", contactName: "Dr. Taylor",
      email: "hello@taylordental.com", context: "Booking takes too many steps", ref: "content-001",
    });
    expect(res.ok).toBe(true);
    expect(res.deduped).toBeUndefined();

    const lead = await leadByName("Taylor Family Dental");
    expect(lead).toBeTruthy();
    expect(lead!.publicEmail).toBe("hello@taylordental.com"); // consented send route
    expect(lead!.pipelineStage).toBe("Qualified"); // inbound intent = qualified interest
    expect(acquisitionChannelOf(lead!.source)).toBe("organic-content");
    expect(isFromContent001(lead!.source)).toBe(true);
    expect(lead!.note).toContain("Booking takes too many steps"); // their words captured

    // Email-first by construction, and a review-and-send task tops the queue (priority 80).
    expect(determineContactStrategy(lead!).kind).toBe("email-first");
    const tasks = await openTasks(lead!.id);
    const send = tasks.find((t) => t.type === "review_and_send");
    expect(send).toBeTruthy();
    expect(send!.priority).toBe(80);

    // Attribution recorded.
    const audit = await auditFor(lead!.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].meta?.contentId).toBe("content-001");
  });

  it("validates: a missing name or invalid email is rejected, nothing created", async () => {
    expect((await requestReviewAction({ businessName: "", email: "a@b.com" })).ok).toBe(false);
    expect((await requestReviewAction({ businessName: "X Co", email: "not-an-email" })).ok).toBe(false);
    expect(await listLeads()).toHaveLength(0);
  });

  it("is idempotent: a duplicate submit records the request on the existing business, never forks it", async () => {
    await requestReviewAction({ businessName: "Taylor Family Dental", website: "taylordental.com", email: "hello@taylordental.com", ref: "content-001" });
    const second = await requestReviewAction({ businessName: "Taylor Family Dental", website: "taylordental.com", email: "hello@taylordental.com", ref: "content-001" });
    expect(second.deduped).toBe(true);
    expect(await listLeads()).toHaveLength(1); // exactly one business
  });

  it("a direct (no-ref) request is inbound/direct, still email-first", async () => {
    const res = await requestReviewAction({ businessName: "Direct Co", email: "owner@directco.com" });
    expect(res.ok).toBe(true);
    const lead = await leadByName("Direct Co");
    expect(acquisitionChannelOf(lead!.source)).toBe("inbound");
    expect(determineContactStrategy(lead!).kind).toBe("email-first");
  });
});
