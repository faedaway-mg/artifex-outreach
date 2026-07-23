import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
import type { Lead, MemoryCategory } from "../types";
import { __resetStoreForTests } from "../store";
import {
  insertLead, insertMemoryItem, roadmapProgressForLead, snapshotsForLead, outcomeReviewsForLead,
  memoryForLead, meetingsForLead, proposalsForLead, plansForLead, outreachForLead, inboundForLead,
} from "../repo";
import { advanceRoadmapAction } from "../roadmap-actions";
import { startOutcomeReviewAction, setOutcomeStatusAction } from "../outcomes-actions";
import { assembleEngagementContext, buildCommandCenter, engagementTimeline, parseSnapshot } from "./index";

beforeEach(() => __resetStoreForTests());

async function seedBusiness(): Promise<string> {
  const lead = await insertLead({ businessName: "Bright Smiles Dental" } as unknown as Omit<Lead, "id" | "createdAt" | "updatedAt">);
  const add = (category: MemoryCategory, value: string) =>
    insertMemoryItem({ leadId: lead.id, category, title: value.slice(0, 20), value, status: "Verified", confidence: "High", source: "Discovery Meeting", supportingContext: null, operatorNotes: null });
  await add("Existing Systems", "We use Square for checkout.");
  await add("Existing Systems", "We use QuickBooks for the books.");
  await add("Existing Systems", "No online booking — every appointment is by phone.");
  await add("Decision Makers", "The owner personally handles scheduling.");
  await add("Current Priorities", "The front desk is overwhelmed with phone calls.");
  return lead.id;
}

async function ctxFor(leadId: string) {
  const lead = { id: leadId, businessName: "Bright Smiles Dental" } as unknown as Lead;
  const [memory, meetings, proposals, plans, progress, reviews, outreach, inbound, snapshots] = await Promise.all([
    memoryForLead(leadId), meetingsForLead(leadId), proposalsForLead(leadId), plansForLead(leadId),
    roadmapProgressForLead(leadId), outcomeReviewsForLead(leadId), outreachForLead(leadId), inboundForLead(leadId), snapshotsForLead(leadId),
  ]);
  return assembleEngagementContext({ lead, memory, meetings, proposals, plans, progress, reviews, outreach, inbound, snapshots, now: Date.now() });
}

const REC = "rec_integration-over-replacement";

describe("full engagement lifecycle — persistence + operator-approved transitions", () => {
  it("moving a recommendation to In Progress freezes an immutable baseline", async () => {
    const leadId = await seedBusiness();
    await advanceRoadmapAction(leadId, REC, "Connect the tools they already trust", "In Progress");

    const snaps = await snapshotsForLead(leadId);
    expect(snaps).toHaveLength(1);
    const payload = parseSnapshot(snaps[0].payload)!;
    expect(payload.capturedFor).toBe(REC);
    expect(payload.memory.length).toBeGreaterThan(0);
    expect(payload.businessNarrative.length).toBeGreaterThan(0);
  });

  it("does not overwrite history — a second commit of the same trigger keeps one snapshot", async () => {
    const leadId = await seedBusiness();
    await advanceRoadmapAction(leadId, REC, "Connect the tools", "In Progress");
    await advanceRoadmapAction(leadId, REC, "Connect the tools", "In Progress");
    expect(await snapshotsForLead(leadId)).toHaveLength(1);
  });

  it("outcome review inherits its 'before' from the frozen baseline", async () => {
    const leadId = await seedBusiness();
    await advanceRoadmapAction(leadId, REC, "Connect the tools", "In Progress");
    await advanceRoadmapAction(leadId, REC, "Connect the tools", "Completed");
    await startOutcomeReviewAction(leadId, REC, "Connect the tools", "Data stops being re-keyed by hand.");

    const reviews = await outcomeReviewsForLead(leadId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].status).toBe("Awaiting Review"); // nothing auto-succeeds
    expect(reviews[0].beforeState.length).toBeGreaterThan(0); // pulled from the snapshot
  });

  it("the operator's verdict sticks and stamps a review date", async () => {
    const leadId = await seedBusiness();
    await advanceRoadmapAction(leadId, REC, "Connect the tools", "Completed");
    await startOutcomeReviewAction(leadId, REC, "Connect the tools", "Data stops being re-keyed.");
    const review = (await outcomeReviewsForLead(leadId))[0];
    await setOutcomeStatusAction(review.id, leadId, "Supported");

    const after = (await outcomeReviewsForLead(leadId))[0];
    expect(after.status).toBe("Supported");
    expect(after.reviewedAt).toBeTruthy();
  });

  it("the whole engagement is one coherent, up-to-date read after the lifecycle", async () => {
    const leadId = await seedBusiness();
    await advanceRoadmapAction(leadId, REC, "Connect the tools", "In Progress");
    await advanceRoadmapAction(leadId, REC, "Connect the tools", "Completed");
    await startOutcomeReviewAction(leadId, REC, "Connect the tools", "Data stops being re-keyed.");

    const ctx = await ctxFor(leadId);
    const cc = buildCommandCenter(ctx);
    // Completed work with an open review surfaces as pending, and the timeline carries it all.
    expect(cc.pending.some((p) => p.kind === "outcome-review")).toBe(true);
    const sources = new Set(engagementTimeline(ctx).map((e) => e.source));
    expect(sources.has("snapshot")).toBe(true);
    expect(sources.has("roadmap")).toBe(true);
    expect(sources.has("memory")).toBe(true);
  });
});
