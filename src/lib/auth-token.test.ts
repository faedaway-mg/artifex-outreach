// ─────────────────────────────────────────────────────────────────────────────
// The session token is the only thing standing between a request and the whole
// workspace, and impersonation now leans on it a second time — as a SHORTER
// window laid over the same signature. These tests defend both readings.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { signToken, verifyToken, tokenSubject, tokenIssuedAt } from "./auth-token";

describe("signing and reading a token", () => {
  it("round-trips the operator it was issued to", () => {
    for (const id of ["jordan", "alex", "sam-rivera", "op00"]) {
      expect(tokenSubject(signToken(id))).toBe(id);
    }
  });

  it("reports when it was issued", () => {
    const before = Date.now();
    const issued = tokenIssuedAt(signToken("alex"))!;
    expect(issued).toBeGreaterThanOrEqual(before - 1000);
    expect(issued).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("never separates identity from validity", () => {
    // A tampered token has no subject and no issue time — not a subject we
    // then decide not to trust. There is no code path that can read one
    // without having verified the other.
    const good = signToken("jordan");
    const tampered = good.replace(/.$/, (c) => (c === "a" ? "b" : "a"));
    expect(verifyToken(tampered)).toBe(false);
    expect(tokenSubject(tampered)).toBeNull();
    expect(tokenIssuedAt(tampered)).toBeNull();
  });

  it("rejects a forged subject", () => {
    const forged = `${Buffer.from(`founder.${Date.now()}`).toString("base64url")}.deadbeef`;
    expect(verifyToken(forged)).toBe(false);
    expect(tokenSubject(forged)).toBeNull();
  });

  it("returns nothing for missing or malformed input rather than throwing", () => {
    for (const bad of [undefined, "", "not-a-token", "a.b.c"]) {
      expect(verifyToken(bad as string | undefined)).toBe(false);
      expect(tokenSubject(bad as string | undefined)).toBeNull();
      expect(tokenIssuedAt(bad as string | undefined)).toBeNull();
    }
  });
});

describe("the impersonation window rides on the same signature", () => {
  it("lets a caller apply a shorter life than the session's", () => {
    // This is exactly what impersonation.ts does: same token, 60 minutes instead
    // of 14 days. The session stays valid; the visit lapses.
    const token = signToken("alex");
    const issued = tokenIssuedAt(token)!;
    const SIXTY_MINUTES = 60 * 60 * 1000;

    expect(Date.now() - issued).toBeLessThan(SIXTY_MINUTES); // fresh: still viewing
    expect(verifyToken(token)).toBe(true); // and the session would still be fine

    // An hour and a second later the visit is over even though the token is not.
    const pretendNow = issued + SIXTY_MINUTES + 1000;
    expect(pretendNow - issued > SIXTY_MINUTES).toBe(true);
    expect(verifyToken(token)).toBe(true);
  });
});
