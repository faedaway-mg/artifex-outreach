import { describe, it, expect } from "vitest";
import { emailsSentOn } from "./send-capacity";
import type { EmailSend } from "../types";

const send = (over: Partial<EmailSend>): EmailSend => ({
  id: "s", idempotencyKey: "k", stepId: null, planId: null, leadId: null,
  toAddr: "a@b.com", fromAddr: "me@x.com", subject: "", status: "sent", provider: "test",
  providerMessageId: null, attempts: 1, lastError: null, lastErrorCode: null, nextAttemptAt: null,
  queuedAt: null, sendingAt: null, sentAt: null, deliveredAt: null, openedAt: null, clickedAt: null,
  bouncedAt: null, complainedAt: null, unsubscribedAt: null, failedAt: null,
  createdAt: "", updatedAt: "", ...over,
});

describe("emailsSentOn — the day's spent send capacity", () => {
  const now = new Date("2026-08-09T17:00:00Z");

  it("counts only sends that actually left the system today", () => {
    const rows = [
      send({ sentAt: "2026-08-09T15:00:00Z" }), // today
      send({ sentAt: "2026-08-09T16:30:00Z" }), // today
      send({ sentAt: "2026-08-08T16:00:00Z" }), // yesterday — does not count
      send({ sentAt: null }), // queued/never-sent — does not consume capacity
    ];
    expect(emailsSentOn(rows, now)).toBe(2);
  });

  it("is zero when nothing has gone out yet today", () => {
    expect(emailsSentOn([send({ sentAt: null })], now)).toBe(0);
    expect(emailsSentOn([], now)).toBe(0);
  });
});
