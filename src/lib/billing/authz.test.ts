import { describe, it, expect, beforeEach } from "vitest";
import { closingCan, authorizeClosing, ClosingAuthorizationError, resolveActorRole } from "./authz";
import { __resetStoreForTests } from "../store";
import { insertOperatorIfAbsent } from "../repo";
import type { Operator } from "../types";

function makeOperator(over: Partial<Operator> = {}): Operator {
  return {
    id: "op_1", name: "Jordan", email: "j@example.test", role: "founder", initials: "JJ", avatarUrl: null,
    active: true, availabilityMode: "available" as Operator["availabilityMode"], preferredWorkKinds: [],
    dailyCapacity: 10, timezone: "America/Los_Angeles", lastActiveAt: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...over,
  } as Operator;
}

describe("closing capabilities table", () => {
  it("founder and admin may move money and approve contracts", () => {
    for (const cap of ["createInvoice", "issueInvoice", "voidInvoice", "approveAgreement", "refund", "kickoff"] as const) {
      expect(closingCan("founder", cap)).toBe(true);
      expect(closingCan("admin", cap)).toBe(true);
    }
  });

  it("non-owner roles cannot move money or approve contracts (today)", () => {
    for (const role of ["engineering", "head_of_outreach", "operator"] as const) {
      expect(closingCan(role, "createInvoice")).toBe(false);
      expect(closingCan(role, "issueInvoice")).toBe(false);
      expect(closingCan(role, "refund")).toBe(false);
      expect(closingCan(role, "approveAgreement")).toBe(false);
    }
  });

  it("authorizeClosing throws for a denied capability", () => {
    expect(() => authorizeClosing("operator", "issueInvoice")).toThrow(ClosingAuthorizationError);
    expect(() => authorizeClosing("founder", "issueInvoice")).not.toThrow();
  });
});

describe("resolveActorRole (server-side, from persisted operator)", () => {
  beforeEach(() => __resetStoreForTests());

  it("reads the role from the operator record; unknown actor is least-privileged", async () => {
    await insertOperatorIfAbsent(makeOperator({ id: "op_founder", role: "founder" }));
    expect(await resolveActorRole("op_founder")).toBe("founder");
    expect(await resolveActorRole("does-not-exist")).toBe("operator");
  });
});
