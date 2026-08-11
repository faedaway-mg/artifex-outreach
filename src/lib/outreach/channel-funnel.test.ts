import { describe, it, expect } from "vitest";
import { channelFunnel } from "./channel-funnel";
import { CALL_SESSION_AUDIT_ACTION } from "./call-commit";

const call = (leadId: string, createdAt: string, meta: Record<string, unknown>) => ({ action: CALL_SESSION_AUDIT_ACTION, targetId: leadId, createdAt, meta });

describe("channelFunnel — compares cold call vs value-first email → warm follow-up", () => {
  it("classifies a call placed AFTER an email as warm, and one before as cold", () => {
    const f = channelFunnel({
      emailSends: [{ leadId: "A", sentAt: "2026-08-01T10:00:00Z" }],
      outreach: [],
      meetings: [],
      audit: [
        call("A", "2026-08-03T10:00:00Z", { outcome: "reached-dm" }), // warm: after A's email
        call("B", "2026-08-03T10:00:00Z", { outcome: "no-answer" }), // cold: B was never emailed
      ],
    });
    expect(f.warmCalls.attempted).toBe(1);
    expect(f.warmCalls.answered).toBe(1);
    expect(f.coldCalls.attempted).toBe(1);
    expect(f.coldCalls.answered).toBe(0); // no-answer
  });

  it("counts emails sent, distinct businesses, and replies from existing sources", () => {
    const f = channelFunnel({
      emailSends: [
        { leadId: "A", sentAt: "2026-08-01T10:00:00Z" },
        { leadId: "A", sentAt: "2026-08-05T10:00:00Z" }, // same business, 2 sends
        { leadId: "B", sentAt: null }, // not actually sent
      ],
      outreach: [{ leadId: "A", responseStatus: "replied" }, { leadId: "C", responseStatus: "none" }],
      meetings: [],
      audit: [],
    });
    expect(f.email.sent).toBe(2);
    expect(f.email.businessesEmailed).toBe(1);
    expect(f.email.replies).toBe(1);
  });

  it("credits a cold call that captured an email, and counts substantive conversations + meetings", () => {
    const f = channelFunnel({
      emailSends: [],
      outreach: [],
      meetings: [{ leadId: "A", scheduledAt: "2026-08-10T10:00:00Z", outcome: "pending" }, { leadId: "B", scheduledAt: null, outcome: "pending" }],
      audit: [
        call("A", "2026-08-03T10:00:00Z", { outcome: "asked-to-send", permission: true, emailKind: "direct" }),
        call("B", "2026-08-03T10:00:00Z", { outcome: "voicemail" }),
      ],
    });
    expect(f.coldCalls.emailCaptured).toBe(1); // asked-to-send with permission
    expect(f.conversations).toBe(1); // asked-to-send is substantive
    expect(f.meetingsBooked).toBe(1); // only the one with a scheduledAt
  });
});
