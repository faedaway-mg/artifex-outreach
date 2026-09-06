import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedVideoWorkspaceFixtures } from "./approvable-fixture";
import { resetBreakbotNamespace } from "./namespace";
import { studioSnapshot } from "../content-studio/store";
import { buildCompanySnapshot } from "../outreach/company-snapshot";
import { buildStudioWorkspaces, focusStateToProspect, type LeadLifecycle } from "../content-studio/studio-workspaces";
import { assertNoContentInOutreach, splitWorkspaces } from "../content-studio/video-workspace";
import { assembleWorkspaceVideos } from "../content-studio/studio-workspaces";
import { evaluateNarrationQuality } from "../content-studio/narration-quality";
import { __setArtifactStoreForTests } from "../content-studio/storage-factory";

const mem = new Map<string, { body: Buffer; sha256: string; contentType: string }>();
const memStore: any = {
  mode: "memory",
  async put(key: string, body: Buffer, o: any) { const { createHash } = await import("node:crypto"); const sha256 = createHash("sha256").update(body).digest("hex"); mem.set(key, { body, sha256, contentType: o.contentType }); return { key, sha256, bytes: body.length }; },
  async getMeta(key: string) { const v = mem.get(key); return v ? { key, size: v.body.length, contentType: v.contentType, sha256: v.sha256 } : null; },
  async readFull(key: string) { return mem.get(key)?.body ?? null; },
  async readRange(key: string, s: number, e: number) { const b = mem.get(key)?.body; return b ? b.subarray(s, e + 1) : null; },
  async exists(key: string) { return mem.has(key); },
  async del(key: string) { mem.delete(key); },
};

const savedEnv = { ...process.env };
let dataDir = "";
beforeAll(() => {
  process.env.BREAKBOT_TEST_TENANT = "1";
  delete process.env.DATABASE_URL; delete process.env.CS_DATABASE_URL; delete process.env.RESEND_API_KEY;
  dataDir = mkdtempSync(join(tmpdir(), "cs-ws-"));
  process.env.CONTENT_STUDIO_DATA_DIR = dataDir;
  __setArtifactStoreForTests(memStore);
});
afterAll(() => { process.env = savedEnv; __setArtifactStoreForTests(null); if (dataDir) rmSync(dataDir, { recursive: true, force: true }); });
beforeEach(() => { resetBreakbotNamespace(); mem.clear(); });

async function buildByLead(): Promise<Record<string, LeadLifecycle>> {
  const company = await buildCompanySnapshot();
  const byLead: Record<string, LeadLifecycle> = {};
  const addFocus = (rows: Array<{ leadId: string; state: string; finding: string | null }>) =>
    rows.forEach((r) => { byLead[r.leadId] = { state: focusStateToProspect(r.state) ?? "NEEDS_ATTENTION", finding: r.finding }; });
  addFocus(company.needsVoiceover); addFocus(company.rendering); addFocus(company.needsAttention); addFocus(company.ready);
  company.scheduled.forEach((r) => { byLead[r.leadId] = { state: "SCHEDULED", finding: byLead[r.leadId]?.finding ?? null }; });
  company.sentToday.forEach((r) => { byLead[r.leadId] = { state: "SENT", finding: byLead[r.leadId]?.finding ?? null }; });
  return byLead;
}

describe("mandate 25 — two-tab workspace fixtures (server-level acceptance)", () => {
  it("seeds the fixtures and splits them cleanly into Proposal / Content / unclassified", async () => {
    const ids = await seedVideoWorkspaceFixtures();
    const items = await studioSnapshot();
    const byLead = await buildByLead();
    const split = buildStudioWorkspaces(items.map((it) => ({ piece: it.piece as any, jobs: it.jobs, provenance: it.provenance as any, postedAt: it.postedAt })), byLead);

    const proposalIds = new Set(split.proposal.cards.map((c) => c.id));
    const contentIds = new Set(split.content.cards.map((c) => c.id));

    // Proposals present in the Proposal tab.
    for (const key of ["good", "shortGeneric", "similarA", "similarB", "unsupported"] as const) {
      expect(proposalIds.has(`client-${ids[key]}`), `proposal ${key}`).toBe(true);
    }
    // The genuine CONTENT video is ONLY in the Content tab.
    expect(contentIds.has("bb-content-note")).toBe(true);
    expect(proposalIds.has("bb-content-note")).toBe(false);
    // A no-lineage template resolves to CONTENT via workflowOf's default (studioSnapshot assigns every piece
    // a workflow) — so in practice the snapshot never yields an "unclassified" bucket (matches the prod
    // dry-run's 0 ambiguous). The NEEDS_CLASSIFICATION branch is a defensive guard for RAW records and is
    // unit-tested in video-classification.test.ts. What must NEVER happen: a no-lineage video in outreach.
    expect(proposalIds.has("BB_LEGACY_9")).toBe(false);

    // Zero cross-contamination across the whole seeded set.
    const videos = assembleWorkspaceVideos(items.map((it) => ({ piece: it.piece as any, jobs: it.jobs, provenance: it.provenance as any, postedAt: it.postedAt })), byLead);
    expect(assertNoContentInOutreach(videos)).toEqual([]);
  });

  it("the seeded narration scenarios grade as designed (authoritative evaluator)", async () => {
    const finding = "No online booking on your website — customers who search can't schedule a job without calling.";
    const ev = { businessName: "Vertex Roofing", findings: [finding], hasScreenshot: true, hasApprovedRecommendation: true };
    const good = "Hi — I spent a few minutes on Vertex Roofing's website and one thing stood out. Right now there's no online booking, so a customer who searches for a roofer can't schedule a job without calling. A lot of people won't make that call after hours, so those jobs quietly slip away. A simple booking page on the site you already have could capture those requests directly. No pressure — if it's useful, just reply.";
    expect(["GOOD", "NEEDS_REVIEW"]).toContain(evaluateNarrationQuality({ narration: good, evidence: ev }).classification);
    expect(evaluateNarrationQuality({ narration: "Hi, I made a quick video. Take a look.", evidence: ev }).classification).toBe("TOO_SHORT");
    expect(evaluateNarrationQuality({ narration: `${good} This will increase your revenue by 30% within a month, guaranteed.`, evidence: ev }).classification).toBe("UNSUPPORTED_CLAIMS");

    // Two similar scripts flag TOO_SIMILAR against each other.
    const shared = "Right now there's no online booking on the website so customers who search can't schedule a job without calling. A simple booking page could capture those requests directly.";
    const a = evaluateNarrationQuality({ narration: `Hi — about Summit Plumbing. ${shared} Reply if useful.`, evidence: ev, otherScripts: [{ leadId: "b", narration: `Hi — about Harbor Electric. ${shared} Reply if useful.` }] });
    expect(a.classification).toBe("TOO_SIMILAR");
  });
});
