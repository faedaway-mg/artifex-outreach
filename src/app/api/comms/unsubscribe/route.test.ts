import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { __resetStoreForTests } from "@/lib/store";
import { insertLead } from "@/lib/repo";
import { mintUnsubToken } from "@/lib/comms/unsubscribe-token";
import { isEmailSuppressed } from "@/lib/comms/suppression";
import { GET } from "./route";

const ORIG = process.env.COMMS_UNSUBSCRIBE_SECRET;
beforeEach(() => { __resetStoreForTests(); process.env.COMMS_UNSUBSCRIBE_SECRET = "unsub-secret-abc123"; });
afterEach(() => { ORIG === undefined ? delete process.env.COMMS_UNSUBSCRIBE_SECRET : (process.env.COMMS_UNSUBSCRIBE_SECRET = ORIG); });

async function seedLead(email: string): Promise<string> {
  const l = await insertLead({ businessName: "Biz", normalizedName: "biz", industry: "x", normalizedCategory: "x", categoryGroup: "x", address: "1", city: "LA", state: "CA", postalCode: "90012", phone: null, website: "https://biz.example", websiteDomain: "biz.example", publicEmail: email, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 10, businessStatus: "OPERATIONAL", source: "test", tier: "A", leadScore: 50, scoreBreakdown: {}, pipelineStage: "Qualified", estimatedValueLow: 1, estimatedValueHigh: 2, recommendedService: "x", recommendedAction: "x", opportunitySummary: "x", strengths: [], acquisitionStrategy: "Assisted", acquisitionScore: 50, acquisitionOverride: false, assignedTo: "jordan" } as any);
  return l.id;
}
const req = (url: string) => new NextRequest(`http://localhost${url}`, { method: "GET" });

describe("public unsubscribe route (hardened token)", () => {
  it("valid token → 200 confirmation + permanent global suppression (no login)", async () => {
    const id = await seedLead("owner@biz.example");
    const t = mintUnsubToken(id, "owner@biz.example")!;
    const res = await GET(req(`/api/comms/unsubscribe?lead=${id}&t=${t}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/unsubscribed and will not receive further outreach/i);
    expect(await isEmailSuppressed("owner@biz.example")).toBe(true);
  }, 60000);

  it("idempotent: a second click stays 200 + suppressed", async () => {
    const id = await seedLead("owner@biz.example");
    const t = mintUnsubToken(id, "owner@biz.example")!;
    await GET(req(`/api/comms/unsubscribe?lead=${id}&t=${t}`));
    const res2 = await GET(req(`/api/comms/unsubscribe?lead=${id}&t=${t}`));
    expect(res2.status).toBe(200);
  }, 60000);

  it("tampered token → 400, no suppression", async () => {
    const id = await seedLead("owner@biz.example");
    const t = mintUnsubToken(id, "owner@biz.example")!;
    const res = await GET(req(`/api/comms/unsubscribe?lead=${id}&t=${t}TAMPER`));
    expect(res.status).toBe(400);
    expect(await isEmailSuppressed("owner@biz.example")).toBe(false);
  }, 60000);

  it("recipient-substitution: token for lead A cannot suppress lead B (email mismatch → 400)", async () => {
    const a = await seedLead("a@biz.example");
    const b = await seedLead("b@biz.example");
    const tokenForA = mintUnsubToken(a, "a@biz.example")!;
    // present A's token but point lead=B → leadId mismatch → 400
    const res = await GET(req(`/api/comms/unsubscribe?lead=${b}&t=${tokenForA}`));
    expect(res.status).toBe(400);
    expect(await isEmailSuppressed("b@biz.example")).toBe(false);
  }, 60000);

  it("missing lead/token → 400", async () => {
    expect((await GET(req(`/api/comms/unsubscribe`))).status).toBe(400);
  });
});
