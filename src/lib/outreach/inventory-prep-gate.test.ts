import { describe, it, expect, vi } from "vitest";
import { prepareEmailInventory } from "./inventory-prep";
import type { Lead } from "@/lib/types";

const lead = (id: string, over: Partial<Lead> = {}): Lead =>
  ({ id, businessName: id, pipelineStage: "Qualified", acquisitionStrategy: "Assisted", website: `https://${id}.com`, publicEmail: null, ...over } as unknown as Lead);

describe("prepareEmailInventory — contact-first gate gates the EXPENSIVE analysis", () => {
  it("no reachable email → the expensive analyze is NOT called (cost saved), analysis skipped", async () => {
    const analyze = vi.fn(async () => {});
    const leads = [lead("a"), lead("b"), lead("c")];
    const s = await prepareEmailInventory({
      leads, analyzedLeadIds: new Set(), analyze,
      getEmailAfter: async () => null, max: 10,
      checkContact: async () => ({ outcome: "not-found", email: null }),
    });
    expect(analyze).not.toHaveBeenCalled();      // ← the savings: zero deep analysis on no-email leads
    expect(s.checked).toBe(3);
    expect(s.heldNoContact).toBe(3);
    expect(s.analyzed).toBe(0);
  });

  it("reachable email → adopt it, THEN run the expensive analysis (need-qualification) once", async () => {
    const analyze = vi.fn(async () => {});
    const adopt = vi.fn(async () => {});
    const s = await prepareEmailInventory({
      leads: [lead("a")], analyzedLeadIds: new Set(), analyze,
      getEmailAfter: async () => "info@a.com", max: 10,
      checkContact: async () => ({ outcome: "found", email: "info@a.com" }),
      adoptEmail: adopt,
    });
    expect(adopt).toHaveBeenCalledWith("a", "info@a.com", expect.anything());
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(s.analyzed).toBe(1);
    expect(s.adoptedEmail).toBe(1);
    expect(s.heldNoContact).toBe(0);
  });

  it("mixed batch: only reachable leads consume the expensive step", async () => {
    const analyze = vi.fn(async () => {});
    const leads = [lead("hit1"), lead("miss1"), lead("hit2"), lead("miss2")];
    const s = await prepareEmailInventory({
      leads, analyzedLeadIds: new Set(), analyze,
      getEmailAfter: async (id) => (id.startsWith("hit") ? `info@${id}.com` : null), max: 10,
      checkContact: async (l) => (l.id.startsWith("hit") ? { outcome: "found", email: `info@${l.id}.com` } : { outcome: "not-found", email: null }),
    });
    expect(analyze).toHaveBeenCalledTimes(2);   // only hit1, hit2
    expect(s.checked).toBe(4);
    expect(s.analyzed).toBe(2);
    expect(s.heldNoContact).toBe(2);
  });

  it("records every outcome (for backoff + UI hold-reason)", async () => {
    const recorded: string[] = [];
    await prepareEmailInventory({
      leads: [lead("a"), lead("b")], analyzedLeadIds: new Set(), analyze: async () => {},
      getEmailAfter: async () => null, max: 10,
      checkContact: async () => ({ outcome: "fetch-failed", email: null }),
      recordOutcome: async (id, r) => { recorded.push(`${id}:${r.outcome}`); },
    });
    expect(recorded).toEqual(["a:fetch-failed", "b:fetch-failed"]);
  });

  it("LEGACY (no checkContact): behaviour unchanged — analyze every eligible lead", async () => {
    const analyze = vi.fn(async () => {});
    const s = await prepareEmailInventory({
      leads: [lead("a"), lead("b")], analyzedLeadIds: new Set(), analyze,
      getEmailAfter: async () => "info@x.com", max: 10,
    });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(s.checked).toBeUndefined();          // gate inactive
    expect(s.analyzed).toBe(2);
  });
});
