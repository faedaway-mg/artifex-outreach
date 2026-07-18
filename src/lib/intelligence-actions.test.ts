import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "./store";
import { insertLead, insertFinding, getBusinessIntelligence, allBusinessIntelligence } from "./repo";
import { generateAndStoreBI } from "./intelligence-actions";
import { makeLead } from "./test-lead";
import type { WebsiteSignals } from "./scoring";

const WEAK_HTML = `<html><head><title>Joe Plumbing</title></head><body><p>We do plumbing.</p></body></html>`;
const signals: WebsiteSignals = { hasWebsite: true, mobileFriendly: false, slowLoad: true, hasOnlineBooking: false, hasLeadForm: false };

async function seedLead() {
  const base = makeLead({ businessName: "Taylor Dental", website: "https://taylordental.com" });
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = base;
  const lead = await insertLead(rest);
  await insertFinding({
    leadId: lead.id, category: "Conversion journey", title: "No primary action",
    observation: "no obvious way to book or call from a phone", evidence: "no tel/cta", businessImpact: "customers may leave",
    modernizationDirection: "add CTA", findingType: "Automated technical finding", confidence: "Verified",
    sourceUrl: null, analyzedAt: null, deterministic: true, approved: true,
  });
  return lead;
}

describe("Live BI generation + persistence", () => {
  beforeEach(() => __resetStoreForTests());

  it("generates and persists a complete profile from supplied website content", async () => {
    const lead = await seedLead();
    const stored = await generateAndStoreBI(lead, { pages: [{ url: "https://taylordental.com", html: WEAK_HTML }], signals });

    expect(stored.leadId).toBe(lead.id);
    expect(stored.profile.snapshot.businessName).toBe("Taylor Dental");
    expect(stored.profile.briefing.nextAction.length).toBeGreaterThan(0);
    expect(stored.profile.maturity.dimensions.length).toBe(10);
    expect(stored.profile.opportunityGraph.highLeverage).not.toBeNull();
    expect(stored.evidenceConfidence).toBeGreaterThan(0);
    expect(stored.improvementScore).toBe(stored.profile.improvement.score);
    // Website intelligence contributed from the supplied page (no duplicate crawl).
    expect(stored.profile.providerCoverage.contributing).toContain("website-intelligence");

    const round = await getBusinessIntelligence(lead.id);
    expect(round?.id).toBe(stored.id);
  });

  it("upserts (one row per lead) and records an enrichment delta on re-run", async () => {
    const lead = await seedLead();
    await generateAndStoreBI(lead, { signals });
    const second = await generateAndStoreBI(lead, { pages: [{ url: "https://taylordental.com", html: WEAK_HTML }], signals });

    const rows = (await allBusinessIntelligence()).filter((r) => r.leadId === lead.id);
    expect(rows.length).toBe(1); // upsert, not append
    expect(second.enrichmentDelta).not.toBeNull();
    expect(second.enrichmentDelta!.summary.length).toBeGreaterThan(0);
  });

  it("does not crash for a lead with no website/pages (graceful)", async () => {
    const base = makeLead({ businessName: "No Site Co", website: null, publicEmail: "x@y.com" });
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = base;
    const lead = await insertLead(rest);
    const stored = await generateAndStoreBI(lead);
    expect(stored.profile.briefing.nextAction.length).toBeGreaterThan(0);
  });
});
