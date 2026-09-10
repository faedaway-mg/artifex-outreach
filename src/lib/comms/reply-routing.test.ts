// ─────────────────────────────────────────────────────────────────────────────
// PROSPECT REPLY ROUTING — replies return to the sending lane's mailbox by default,
// or to an explicitly-configured canonical Reply-To; a reply maps back to its lead /
// send / lane / thread without changing mailbox ownership. Pure; no secrets.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterEach } from "vitest";
import { canonicalReplyToOverride, resolveProspectReplyTo, mapReplyToLineage } from "./reply-routing";

const SAVED = process.env.COMMS_CANONICAL_REPLY_TO;
afterEach(() => { if (SAVED === undefined) delete process.env.COMMS_CANONICAL_REPLY_TO; else process.env.COMMS_CANONICAL_REPLY_TO = SAVED; });

describe("prospect reply-to resolution", () => {
  it("defaults to the ACTUAL sending lane mailbox (replies return to the lane that sent)", () => {
    delete process.env.COMMS_CANONICAL_REPLY_TO;
    expect(resolveProspectReplyTo("Jordan Jackson <outreach-a@lane-a.test>")).toBe("outreach-a@lane-a.test");
    // Never Resend, never hello@ M365 — it mirrors the sending lane.
    expect(resolveProspectReplyTo("Artifex Labs <outreach-b@lane-b.test>")).toBe("outreach-b@lane-b.test");
  });

  it("uses an explicitly-configured canonical Reply-To override when set + valid", () => {
    process.env.COMMS_CANONICAL_REPLY_TO = "replies@artifexoutreach.test";
    expect(canonicalReplyToOverride()).toBe("replies@artifexoutreach.test");
    expect(resolveProspectReplyTo("Jordan <outreach-a@lane-a.test>")).toBe("replies@artifexoutreach.test");
  });

  it("ignores an invalid/blank override (never invents a value) and falls back to the lane", () => {
    process.env.COMMS_CANONICAL_REPLY_TO = "   ";
    expect(canonicalReplyToOverride()).toBeNull();
    process.env.COMMS_CANONICAL_REPLY_TO = "not-an-email";
    expect(canonicalReplyToOverride()).toBeNull();
    expect(resolveProspectReplyTo("Jordan <outreach-a@lane-a.test>")).toBe("outreach-a@lane-a.test");
  });
});

describe("reply → lineage mapping (attribution only, no ownership change)", () => {
  it("maps an inbound reply back to lead / send / lane / thread from the original send", () => {
    const lineage = mapReplyToLineage({
      leadId: "lead_42", id: "send_7", senderId: "sender-1",
      fromAddr: "Jordan <outreach-a@lane-a.test>", providerMessageId: "gmail_abc", planId: "plan_3",
    });
    expect(lineage).toEqual({
      leadId: "lead_42", sendId: "send_7", senderId: "sender-1",
      senderAddress: "outreach-a@lane-a.test", threadId: "gmail_abc", planId: "plan_3",
    });
  });

  it("returns nulls (never guesses) when the original send is unknown", () => {
    const lineage = mapReplyToLineage(null);
    expect(lineage).toEqual({ leadId: null, sendId: null, senderId: null, senderAddress: null, threadId: null, planId: null });
  });
});
