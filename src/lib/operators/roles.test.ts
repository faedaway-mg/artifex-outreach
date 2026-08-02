// ─────────────────────────────────────────────────────────────────────────────
// Roles decide who may DECIDE. These tests defend the two properties that make
// that safe: an unrecognised role grants nothing, and impersonation can never
// hand someone authority they do not already have.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { normalizeOperator } from "./model";
import { roleOf, capabilitiesOf, can, canImpersonate, isManager, ROLES, CAPABILITIES } from "./roles";
import type { Operator } from "../types";

const op = (id: string, role: string, over: Partial<Operator> = {}): Operator =>
  normalizeOperator({ id, name: id, email: `${id}@example.com`, role, ...over });

describe("reading the free-text role column", () => {
  it("understands the prose already in production without a migration", () => {
    // These are the literal values in the live `users` table today.
    expect(roleOf({ role: "Founder / Operator" })).toBe("founder");
    expect(roleOf({ role: "Operator" })).toBe("operator");
  });

  it("understands the canonical ids too", () => {
    for (const r of ROLES) expect(roleOf({ role: r })).toBe(r);
  });

  it("falls back to the LEAST privileged role for anything it does not recognise", () => {
    // A typo must never grant authority. "founder-ish-maybe" is the case that
    // caught a substring match during development: /founder/ read it as full
    // authority, so the matching is exact.
    for (const junk of ["", "  ", "Superuser", "founder-ish-maybe", "co-founder emeritus", "root", "ADMINISTRATOR"]) {
      const role = roleOf({ role: junk });
      expect(CAPABILITIES[role].changePolicy).toBe(false);
      expect(CAPABILITIES[role].createOperator).toBe(false);
    }
    expect(roleOf(null)).toBe("operator");
    expect(roleOf(undefined)).toBe("operator");
  });
});

describe("what each role may decide", () => {
  it("gives nobody-at-all no capabilities", () => {
    const none = capabilitiesOf(null);
    expect(Object.values(none).every((v) => v === false)).toBe(true);
  });

  it("makes an outreach operator responsible for businesses, not for people", () => {
    const o = op("sam", "operator");
    expect(can(o, "viewTeam")).toBe(true);
    expect(can(o, "createOperator")).toBe(false);
    expect(can(o, "manageOperators")).toBe(false);
    expect(can(o, "rebalance")).toBe(false);
    expect(can(o, "changePolicy")).toBe(false);
    expect(can(o, "impersonate")).toBe(false);
    expect(isManager("operator")).toBe(false);
  });

  it("lets the Head of Outreach run the team without changing system policy", () => {
    const alex = op("alex", "head_of_outreach");
    expect(can(alex, "transferWork")).toBe(true);
    expect(can(alex, "createOperator")).toBe(true);
    expect(can(alex, "rebalance")).toBe(true);
    expect(can(alex, "impersonate")).toBe(true);
    // The distribution gate, sending, environment — founder territory.
    expect(can(alex, "changePolicy")).toBe(false);
    expect(isManager("head_of_outreach")).toBe(true);
  });

  it("keeps Engineering able to see and fix everything without running the daily book", () => {
    const jordan = op("jordan", "engineering");
    expect(can(jordan, "viewTeam")).toBe(true);
    expect(can(jordan, "changePolicy")).toBe(true);
    expect(can(jordan, "transferWork")).toBe(true);
    // Managing people is the Head of Outreach's job once Jordan moves across.
    expect(can(jordan, "createOperator")).toBe(false);
    expect(can(jordan, "rebalance")).toBe(false);
  });

  it("keeps Founder and Admin identical, so continuity never requires being the founder", () => {
    expect(CAPABILITIES.admin).toEqual(CAPABILITIES.founder);
  });
});

describe("the co-equal manager phase", () => {
  // Today Jordan and Alex both work the book. This is not a special case in the
  // code, and these tests exist to keep it from ever becoming one.
  const OUTREACH: Array<keyof typeof CAPABILITIES.founder> = [
    "transferWork", "createOperator", "manageOperators", "rebalance", "viewTeam", "impersonate",
  ];

  it("makes Founder and Head of Outreach identical on every outreach capability", () => {
    for (const c of OUTREACH) {
      expect(CAPABILITIES.founder[c]).toBe(CAPABILITIES.head_of_outreach[c]);
      expect(CAPABILITIES.head_of_outreach[c]).toBe(true);
    }
  });

  it("separates them only on system policy, which is not outreach", () => {
    expect(CAPABILITIES.founder.changePolicy).toBe(true);
    expect(CAPABILITIES.head_of_outreach.changePolicy).toBe(false);
  });

  it("makes the future transition one row, not a redesign", () => {
    // The day Jordan moves to Engineering, his role string changes and nothing
    // else does. Alex keeps every outreach power he already had.
    const before = roleOf({ role: "Founder / Operator" });
    const after = roleOf({ role: "engineering" });
    expect(before).toBe("founder");
    expect(after).toBe("engineering");
    // Alex loses nothing when Jordan steps back.
    for (const c of OUTREACH) expect(CAPABILITIES.head_of_outreach[c]).toBe(true);
    // And Jordan keeps the two things Engineering must never lose.
    expect(CAPABILITIES.engineering.viewTeam).toBe(true);
    expect(CAPABILITIES.engineering.changePolicy).toBe(true);
  });
});

describe("impersonation can never escalate", () => {
  const founder = op("jordan", "founder");
  const alex = op("alex", "head_of_outreach");
  const sam = op("sam", "operator");

  it("lets a manager view as someone less privileged", () => {
    expect(canImpersonate(founder, sam).ok).toBe(true);
    expect(canImpersonate(alex, sam).ok).toBe(true);
  });

  it("refuses to let anyone view as someone with authority they lack", () => {
    // This is the whole rule. Otherwise "view as" is privilege escalation
    // wearing a training-mode hat.
    expect(canImpersonate(alex, founder).ok).toBe(false);
    expect(canImpersonate(sam, founder).ok).toBe(false);
    expect(canImpersonate(sam, alex).ok).toBe(false);
  });

  it("refuses a plain operator entirely", () => {
    expect(canImpersonate(sam, op("kim", "operator")).ok).toBe(false);
    expect(canImpersonate(sam, sam).ok).toBe(false);
  });

  it("refuses to view as yourself, or as an inactive operator", () => {
    expect(canImpersonate(founder, founder).ok).toBe(false);
    expect(canImpersonate(founder, op("gone", "operator", { active: false })).ok).toBe(false);
  });

  it("always explains itself", () => {
    for (const v of [canImpersonate(alex, founder), canImpersonate(sam, alex), canImpersonate(founder, founder)]) {
      expect(v.ok).toBe(false);
      expect(v.reason.length).toBeGreaterThan(0);
    }
  });
});
