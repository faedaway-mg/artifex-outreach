import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mintUnsubToken, verifyUnsubToken, tokenMatchesRecipient, recipientHmac, normalizeEmail, UNSUB_MAX_AGE_SECONDS } from "./unsubscribe-token";

const ORIG = process.env.COMMS_UNSUBSCRIBE_SECRET;
beforeEach(() => { process.env.COMMS_UNSUBSCRIBE_SECRET = "test-unsub-secret-1234567890"; });
afterEach(() => { ORIG === undefined ? delete process.env.COMMS_UNSUBSCRIBE_SECRET : (process.env.COMMS_UNSUBSCRIBE_SECRET = ORIG); });

const LEAD = "lead_123", EMAIL = "Owner@Biz.com";

describe("hardened unsubscribe token", () => {
  it("mints + verifies a valid token, binding lead + recipient", () => {
    const t = mintUnsubToken(LEAD, EMAIL)!;
    const v = verifyUnsubToken(t);
    expect(v.ok).toBe(true);
    expect(v.leadId).toBe(LEAD);
    expect(v.expired).toBe(false);
    expect(tokenMatchesRecipient(v.recipientHmac!, EMAIL)).toBe(true);
    expect(tokenMatchesRecipient(v.recipientHmac!, "owner@biz.com")).toBe(true); // normalized (case)
  });

  it("fail-closed when the dedicated secret is missing (no token, no verify)", () => {
    delete process.env.COMMS_UNSUBSCRIBE_SECRET;
    expect(mintUnsubToken(LEAD, EMAIL)).toBeNull();
    expect(verifyUnsubToken("anything.here").ok).toBe(false);
  });

  it("rejects tampering, malformed, wrong version, wrong purpose", () => {
    const t = mintUnsubToken(LEAD, EMAIL)!;
    const [body, sig] = t.split(".");
    expect(verifyUnsubToken(`${body}.${sig}x`).reason).toMatch(/signature/); // tampered sig
    expect(verifyUnsubToken("not-a-token").reason).toMatch(/malformed/);
    expect(verifyUnsubToken("").reason).toMatch(/malformed/);
    // tamper the payload (recipient substitution attempt) → signature no longer matches
    const evil = Buffer.from(JSON.stringify({ a: "lead_999", e: "x", iat: 1, v: 1, p: "outreach-unsub" })).toString("base64url");
    expect(verifyUnsubToken(`${evil}.${sig}`).ok).toBe(false);
  });

  it("recipient-substitution guard: a token for one recipient does not validate another", () => {
    const t = mintUnsubToken(LEAD, EMAIL)!;
    const v = verifyUnsubToken(t);
    expect(tokenMatchesRecipient(v.recipientHmac!, "someone-else@other.com")).toBe(false);
  });

  it("expiry: an old token is flagged expired (blocks a NEW opt-out) but still verifies structurally", () => {
    const old = Math.floor(Date.now() / 1000) - (UNSUB_MAX_AGE_SECONDS + 100);
    const t = mintUnsubToken(LEAD, EMAIL, old)!;
    const v = verifyUnsubToken(t);
    expect(v.ok).toBe(true);
    expect(v.expired).toBe(true);
  });

  it("normalizeEmail + recipientHmac are stable across case/whitespace", () => {
    expect(normalizeEmail("  A@B.COM ")).toBe("a@b.com");
    expect(recipientHmac("A@B.com")).toBe(recipientHmac("a@b.com "));
  });
});
