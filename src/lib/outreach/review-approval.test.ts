// The explicit, auditable Quick Review approval — the operational half of the NEEDS_REVIEW gate.
import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { approveQuickReview, quickReviewApproved, REVIEW_APPROVED_ACTION } from "./review-approval";
import { auditForTarget } from "../repo";

beforeEach(() => __resetStoreForTests());

describe("quick review approval", () => {
  it("a lead starts unapproved", async () => {
    expect(await quickReviewApproved("lead-1")).toBe(false);
  });
  it("approving a NEEDS_REVIEW records an auditable event and flips the flag", async () => {
    const r = await approveQuickReview("lead-1", "NEEDS_REVIEW");
    expect(r.ok).toBe(true);
    expect(await quickReviewApproved("lead-1")).toBe(true);
    const audit = await auditForTarget("lead", "lead-1");
    expect(audit.some((a) => a.action === REVIEW_APPROVED_ACTION)).toBe(true); // visible + auditable
  });
  it("is idempotent — approving twice does not create a second event", async () => {
    await approveQuickReview("lead-1", "NEEDS_REVIEW");
    await approveQuickReview("lead-1", "NEEDS_REVIEW");
    const audit = await auditForTarget("lead", "lead-1");
    expect(audit.filter((a) => a.action === REVIEW_APPROVED_ACTION)).toHaveLength(1);
  });
  it("REFUSES to approve an INSUFFICIENT_EVIDENCE review (nothing credible to wave through)", async () => {
    const r = await approveQuickReview("lead-1", "INSUFFICIENT_EVIDENCE");
    expect(r.ok).toBe(false);
    expect(await quickReviewApproved("lead-1")).toBe(false);
  });
  it("approval is per-lead — approving A does not approve B", async () => {
    await approveQuickReview("lead-A", "NEEDS_REVIEW");
    expect(await quickReviewApproved("lead-A")).toBe(true);
    expect(await quickReviewApproved("lead-B")).toBe(false);
  });
});
