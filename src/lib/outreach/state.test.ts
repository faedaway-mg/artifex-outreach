import { describe, it, expect } from "vitest";
import { deriveOutreachState } from "./state";
import { computeNextAction } from "./next-action";
import { makeLead } from "../test-lead";
import type { EmailSend } from "../types";

function sendRow(over: Partial<EmailSend> = {}): EmailSend {
  return {
    id: "es1", idempotencyKey: "step:s1", stepId: "s1", planId: "p1", leadId: "lead_test",
    toAddr: "o@x.com", fromAddr: "j@artifexlabs.tech", subject: "s", status: "sent", provider: "resend",
    providerMessageId: "pm_1", attempts: 1, sentAt: "2026-07-22T10:00:00.000Z", deliveredAt: null, openedAt: null,
    clickedAt: null, bouncedAt: null, complainedAt: null, unsubscribedAt: null, queuedAt: null, sendingAt: null,
    nextAttemptAt: null, lastError: null, lastErrorCode: null, createdAt: "2026-07-22T10:00:00.000Z", updatedAt: "2026-07-22T10:00:00.000Z",
    ...over,
  } as EmailSend;
}

const base = (emailSends: EmailSend[], over = {}) =>
  deriveOutreachState({
    now: "2026-07-22T12:00:00.000Z",
    lead: makeLead(),
    deliverables: [{ content: {} }],
    videos: [],
    emailSends,
    meetings: [],
    inbound: [],
    videoRecommended: false,
    confidenceHigh: true,
    ...over,
  });

describe("outreach state derives from the real ledger, truthfully", () => {
  it("no accepted send yet → still the introduction", () => {
    const s = base([]);
    expect(s.introSentAt).toBeNull();
    expect(computeNextAction(s).kind).toBe("send-intro");
  });

  it("a provider-accepted send → Waiting, never re-offering the introduction", () => {
    const s = base([sendRow()]);
    expect(s.introSentAt).toBe("2026-07-22T10:00:00.000Z");
    const action = computeNextAction(s);
    expect(action.kind).toBe("wait");
    expect(action.kind).not.toBe("send-intro");
  });

  it("distinguishes accepted from opened, and never infers a video view", () => {
    const accepted = base([sendRow()]);
    expect(accepted.emailOpened).toBe(false); // accepted != opened
    const opened = base([sendRow({ openedAt: "2026-07-22T11:00:00.000Z" })]);
    expect(opened.emailOpened).toBe(true);
    // a link/thumbnail click is never a verified video view
    const clicked = base([sendRow({ clickedAt: "2026-07-22T11:00:00.000Z" })]);
    expect(clicked.videoViewed).toBe(false);
  });

  it("a hard bounce / unsubscribe terminal marks the lead suppressed → blocked", () => {
    const bounced = base([sendRow({ bouncedAt: "2026-07-22T11:00:00.000Z" })]);
    expect(bounced.suppressed).toBe(true);
    expect(computeNextAction(bounced).kind).toBe("blocked");
  });

  it("two accepted sends → follow-up already done, next is a call or nurture (never a 3rd email)", () => {
    const s = base([sendRow({ id: "a", sentAt: "2026-07-10T10:00:00.000Z" }), sendRow({ id: "b", sentAt: "2026-07-14T10:00:00.000Z" })]);
    expect(s.introSentAt).toBe("2026-07-10T10:00:00.000Z");
    expect(s.followUpSentAt).toBe("2026-07-14T10:00:00.000Z");
    expect(["call", "nurture", "schedule-discovery"]).toContain(computeNextAction(s).kind);
  });
});
