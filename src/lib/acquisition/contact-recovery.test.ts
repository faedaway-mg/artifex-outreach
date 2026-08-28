import { describe, it, expect, vi } from "vitest";
import { recoverContacts, type RecoveryDeps } from "./contact-recovery";
import type { ContactCheckResult } from "./contact-check";
import type { Lead } from "../types";

const NOW = "2026-08-28T00:00:00.000Z";
const lead = (id: string, website: string | null): Lead => ({ id, businessName: id, website, publicEmail: null } as unknown as Lead);
const result = (o: ContactCheckResult["outcome"], email: string | null = null, domainMatched = false): ContactCheckResult =>
  ({ outcome: o, email, sourceUrl: email ? "https://x/contact" : null, observedAt: NOW, pagesExamined: [], domainMatched, reason: "", candidates: [] });

function harness(over: Partial<RecoveryDeps> = {}) {
  const saved: Array<{ id: string; email: string }> = [];
  const recorded: Array<{ id: string; outcome: string }> = [];
  const deepAnalyze = vi.fn(); // MUST never be called by recovery — the savings guarantee
  const deps: RecoveryDeps = {
    now: NOW,
    candidates: async () => [],
    isSuppressed: async () => false,
    saveEmail: async (id, email) => { saved.push({ id, email }); },
    recordOutcome: async (id, r) => { recorded.push({ id, outcome: r.outcome }); },
    ...over,
  };
  return { deps, saved, recorded, deepAnalyze };
}

describe("no-email recovery — savings + safety", () => {
  it("a no-website/not-found/fetch-failed lead adopts NO email and triggers NO deep analysis", async () => {
    const h = harness({
      candidates: async () => [lead("A", null), lead("B", "https://b.com"), lead("C", "https://c.com")],
      check: async (w) => (!w ? result("no-website") : w.includes("b") ? result("not-found") : result("fetch-failed")),
    });
    const s = await recoverContacts(h.deps);
    expect(s.recovered).toBe(0);
    expect(h.saved).toHaveLength(0);
    expect(h.deepAnalyze).not.toHaveBeenCalled(); // recovery never calls BI/PDF/video
    expect(s.noWebsite).toBe(1); expect(s.notFound).toBe(1); expect(s.fetchFailed).toBe(1);
  });

  it("FOUND + not suppressed → email adopted with provenance; still no send/BI", async () => {
    const h = harness({
      candidates: async () => [lead("A", "https://cedarsage.com")],
      check: async () => result("found", "info@cedarsage.com", true),
    });
    const s = await recoverContacts(h.deps);
    expect(s.recovered).toBe(1);
    expect(h.saved).toEqual([{ id: "A", email: "info@cedarsage.com" }]);
    expect(s.recoveredLeads[0]).toMatchObject({ leadId: "A", email: "info@cedarsage.com", domainMatched: true });
  });

  it("FOUND but the address is SUPPRESSED → NOT adopted (a new address never bypasses an opt-out)", async () => {
    const h = harness({
      candidates: async () => [lead("A", "https://x.com")],
      check: async () => result("found", "info@x.com", true),
      isSuppressed: async (e) => e === "info@x.com",
    });
    const s = await recoverContacts(h.deps);
    expect(s.recovered).toBe(0);
    expect(s.heldSuppressed).toBe(1);
    expect(h.saved).toHaveLength(0);
  });

  it("records EVERY outcome (so a future pass can back off) and honors recentlyChecked (idempotent)", async () => {
    const h = harness({
      candidates: async () => [lead("A", "https://a.com"), lead("B", "https://b.com")],
      recentlyChecked: async (id) => id === "B", // B was checked recently → skip, don't rescan
      check: async () => result("not-found"),
    });
    const s = await recoverContacts(h.deps);
    expect(s.attempted).toBe(1);        // only A
    expect(s.skipped).toBe(1);          // B skipped
    expect(h.recorded.map((r) => r.id)).toEqual(["A"]); // outcome recorded for A only
  });

  it("shared-domain / duplicate leads are each checked against THEIR OWN site (no cross-assignment)", async () => {
    const seenSites: string[] = [];
    const h = harness({
      candidates: async () => [lead("A", "https://one.com"), lead("B", "https://two.com")],
      check: async (w) => { seenSites.push(w!); return result("found", `info@${new URL(w!).host}`, true); },
    });
    const s = await recoverContacts(h.deps);
    expect(seenSites.sort()).toEqual(["https://one.com", "https://two.com"]);
    expect(h.saved).toEqual([{ id: "A", email: "info@one.com" }, { id: "B", email: "info@two.com" }].sort((x, y) => x.id < y.id ? -1 : 1));
    expect(s.recovered).toBe(2);
  });

  it("respects the maxLeads cap (bounded pass, no padding)", async () => {
    const h = harness({
      candidates: async () => Array.from({ length: 50 }, (_, i) => lead(`L${i}`, `https://l${i}.com`)),
      check: async () => result("not-found"),
      maxLeads: 10,
    });
    const s = await recoverContacts(h.deps);
    expect(s.attempted).toBe(10);
  });
});
