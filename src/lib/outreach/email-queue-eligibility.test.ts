import { describe, it, expect } from "vitest";
import { emailQueueEligibility } from "./email-queue-eligibility";
import type { QuickReview } from "./quick-review";

const review = (status: QuickReview["status"], ready: boolean, cta = true): QuickReview =>
  ({ status, ready, cta: cta ? { heading: "", subhead: "", buttonLabel: "Book", bookingUrl: "https://cal.com/x/30min", replyLine: "" } : null } as unknown as QuickReview);

const base = { recipientValid: true, suppressed: false, held: false };

describe("honest Emails-to-send gate — only fully prepared, eligible packages are ready", () => {
  it("SENDABLE + valid recipient + CTA → ready", () => {
    expect(emailQueueEligibility({ ...base, review: review("SENDABLE", true) })).toEqual({ ready: true });
  });

  it("INSUFFICIENT_EVIDENCE (John's Plumbing case) → NOT ready with insufficient-evidence reason", () => {
    const r = emailQueueEligibility({ ...base, review: review("INSUFFICIENT_EVIDENCE", false) });
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("insufficient-evidence");
  });

  it("NEEDS_REVIEW not yet approved → NOT ready (needs-review); approved → ready", () => {
    expect(emailQueueEligibility({ ...base, review: review("NEEDS_REVIEW", false) }).reason).toBe("needs-review");
    expect(emailQueueEligibility({ ...base, review: review("NEEDS_REVIEW", true) })).toEqual({ ready: true }); // approved → ready=true
  });

  it("no/invalid recipient → NOT ready even if the review is SENDABLE", () => {
    expect(emailQueueEligibility({ ...base, recipientValid: false, review: review("SENDABLE", true) }).reason).toBe("no-recipient");
  });

  it("suppressed / held → NOT ready", () => {
    expect(emailQueueEligibility({ ...base, suppressed: true, review: review("SENDABLE", true) }).reason).toBe("suppressed");
    expect(emailQueueEligibility({ ...base, held: true, review: review("SENDABLE", true) }).reason).toBe("held");
  });

  it("missing PDF booking CTA → NOT ready (no-cta)", () => {
    expect(emailQueueEligibility({ ...base, review: review("SENDABLE", true, false) }).reason).toBe("no-cta");
  });

  it("no review generated → NOT ready (no-review), never a bare email", () => {
    expect(emailQueueEligibility({ ...base, review: null }).reason).toBe("no-review");
  });
});
