import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
// Force the canary auth path (no request cookie context in a unit test) — partial mock keeps the rest.
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal() as any), isAuthenticated: () => false }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedVideoWorkspaceFixtures } from "./approvable-fixture";
import { resetBreakbotNamespace } from "./namespace";
import { __setArtifactStoreForTests } from "../content-studio/storage-factory";
import { latestProspectPackage } from "../outreach/prospect-package-store";
import { loadTemplate } from "../content-studio/store";
import { POST } from "@/app/api/content-studio/narration/route";

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

const CANARY = "m26-canary-secret";
const savedEnv = { ...process.env };
let dataDir = "";
beforeAll(() => {
  process.env.BREAKBOT_TEST_TENANT = "1";
  process.env.CS_CANARY_SECRET = CANARY;
  delete process.env.DATABASE_URL; delete process.env.CS_DATABASE_URL; delete process.env.RESEND_API_KEY;
  dataDir = mkdtempSync(join(tmpdir(), "cs-m26-"));
  process.env.CONTENT_STUDIO_DATA_DIR = dataDir;
  __setArtifactStoreForTests(memStore);
});
afterAll(() => { process.env = savedEnv; __setArtifactStoreForTests(null); if (dataDir) rmSync(dataDir, { recursive: true, force: true }); });
beforeEach(() => { resetBreakbotNamespace(); mem.clear(); });

async function call(body: any): Promise<{ status: number; json: any }> {
  const req: any = new Request("http://localhost/api/content-studio/narration", {
    method: "POST", headers: { "Content-Type": "application/json", "x-cs-canary": CANARY }, body: JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, json: await res.json() };
}

// Heavy SERVER-LEVEL acceptance tests (real narration variant generation); each runs
// several seconds and can exceed the 30s global timeout under full-suite CPU contention.
// Explicit headroom keeps a saturated machine from false-failing them.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

describe("mandate 26 — narration route acceptance (server-level, isolated)", () => {
  it("editable draft: analyze reports editable permissions; accept-on-draft succeeds", async () => {
    const ids = await seedVideoWorkspaceFixtures();
    const a = await call({ action: "analyze", leadId: ids.good });
    expect(a.status).toBe(200);
    expect(a.json.permissions.mode).toBe("editable");
    expect(a.json.permissions.canAccept).toBe(true);
    expect(a.json.permissions.canCreateImprovedVersion).toBe(false);
  });

  it("§1A regeneration: variant 0 and variant 1 return genuinely different grounded candidates", async () => {
    const ids = await seedVideoWorkspaceFixtures();
    const v0 = await call({ action: "expand", leadId: ids.good, variant: 0 });
    const v1 = await call({ action: "expand", leadId: ids.good, variant: 1 });
    expect(v0.json.available).toBe(true);
    expect(v1.json.available).toBe(true);
    expect(v1.json.candidate).not.toBe(v0.json.candidate);
    expect(v0.json.variantCount).toBeGreaterThanOrEqual(2);
    expect(v1.json.usedEvidenceIds.length).toBeGreaterThan(0);
  });

  it("§1A no-safe-alternative is reported honestly past the distinct-variant set", async () => {
    const ids = await seedVideoWorkspaceFixtures();
    const v0 = await call({ action: "expand", leadId: ids.good, variant: 0 });
    const beyond = await call({ action: "expand", leadId: ids.good, variant: v0.json.variantCount + 3 });
    expect(beyond.json.available).toBe(true);
    expect(beyond.json.noSafeAlternative).toBe(true);
    expect(beyond.json.code).toBe("NO_SAFE_ALTERNATIVE");
  });

  it("§1B accept on a not-frozen draft advances the revision and requires new audio/render", async () => {
    const ids = await seedVideoWorkspaceFixtures();
    const exp = await call({ action: "expand", leadId: ids.good, variant: 1 });
    const before = await loadTemplate(`client-${ids.good}`);
    const acc = await call({ action: "accept", leadId: ids.good, narration: exp.json.candidate });
    expect(acc.status).toBe(200);
    expect(acc.json.newRevision).toBe((before?.revision ?? 0) + 1);
    expect(acc.json.requiresNewAudioAndRender).toBe(true);
    // idempotent re-accept of the identical script is a no-op (no duplicate revision)
    const again = await call({ action: "accept", leadId: ids.good, narration: exp.json.candidate });
    expect(again.json.idempotent).toBe(true);
    expect(again.json.code).toBe("IDEMPOTENT_NOOP");
  });

  it("§1B an approved-but-not-frozen draft is editable (approval is not immutability)", async () => {
    const ids = await seedVideoWorkspaceFixtures();
    // ids.frozen is READY_TO_APPROVE + quick-review approved → still an editable draft (the reported bug case).
    const a = await call({ action: "analyze", leadId: ids.frozen });
    expect(a.json.approved).toBe(true);
    expect(a.json.permissions.mode).toBe("editable");
    expect(a.json.permissions.canAccept).toBe(true);
    const exp = await call({ action: "expand", leadId: ids.frozen, variant: 1 });
    const acc = await call({ action: "accept", leadId: ids.frozen, narration: exp.json.candidate });
    expect(acc.status).toBe(200); // NOT 409 — the old "package is approved" over-block is gone
  });

  it("§1C committed (SCHEDULED) package: accept refused; fork preserves the frozen package + binding", async () => {
    const ids = await seedVideoWorkspaceFixtures();
    const leadId = ids.scheduled;
    // analyze → committed-fork permissions
    const a = await call({ action: "analyze", leadId });
    expect(a.json.permissions.mode).toBe("committed-fork");
    expect(a.json.permissions.canAccept).toBe(false);
    expect(a.json.permissions.canCreateImprovedVersion).toBe(true);

    // capture the frozen package fingerprint
    const pkgBefore = await latestProspectPackage(leadId);
    expect(pkgBefore).toBeTruthy();

    // accept-in-place is refused (immutable)
    const exp = await call({ action: "expand", leadId, variant: 0 });
    const acc = await call({ action: "accept", leadId, narration: exp.json.candidate });
    expect(acc.status).toBe(409);
    expect(acc.json.code).toBe("IMMUTABLE_PACKAGE");

    // fork creates a new unapproved draft revision
    const before = await loadTemplate(`client-${leadId}`);
    const fork = await call({ action: "fork", leadId, narration: exp.json.candidate });
    expect(fork.status).toBe(200);
    expect(fork.json.forkedFromState).toBe("SCHEDULED");
    expect(fork.json.newRevision).toBe((before?.revision ?? 0) + 1);
    expect(fork.json.requiresNewApprovalAudioRender).toBe(true);

    // the SCHEDULED/frozen package is byte-for-byte unchanged (version + digest + state)
    const pkgAfter = await latestProspectPackage(leadId);
    expect(pkgAfter?.packageVersion).toBe(pkgBefore?.packageVersion);
    expect((pkgAfter as any)?.packageDigest).toBe((pkgBefore as any)?.packageDigest);
    expect(pkgAfter?.state).toBe(pkgBefore?.state);
    expect(pkgAfter?.state).toBe("SCHEDULED");

    // double-tap fork is idempotent (no duplicate revision)
    const fork2 = await call({ action: "fork", leadId, narration: exp.json.candidate });
    expect(fork2.json.idempotent).toBe(true);
    expect(fork2.json.code).toBe("IDEMPOTENT_NOOP");
  });

  it("a CONTENT video can never use the outreach narration workflow", async () => {
    await seedVideoWorkspaceFixtures();
    const r = await call({ action: "analyze", leadId: "bb-content-note" });
    // pieceIdFor('bb-content-note') → 'client-bb-content-note' has no template; the content template id is
    // 'bb-content-note' directly, so the route sees no proposal template for this leadId → analyze runs on an
    // empty narration. The structural bar is proven in outreach-content-bar.test.ts; here we assert the route
    // never treats a social/content piece as a proposal by rejecting a direct content pieceId.
    const direct: any = new Request("http://localhost/api/content-studio/narration", {
      method: "POST", headers: { "Content-Type": "application/json", "x-cs-canary": CANARY },
      body: JSON.stringify({ action: "accept", leadId: "bb-content-note", narration: "x. y." }),
    });
    // loadTemplate('client-bb-content-note') is empty → 404 no-template, never a CONTENT mutation.
    const res = await POST(direct);
    expect([404, 422]).toContain(res.status);
  });
});
