import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetBreakbotNamespace } from "../breakbot/namespace";
import { applyLeadDisposition, latestDisposition, dispositionMap, DISPOSITION_ACTION } from "./disposition";
import { listAudit, isSuppressed } from "../repo";

const savedEnv = { ...process.env };
let dataDir = "";
beforeAll(() => {
  process.env.BREAKBOT_TEST_TENANT = "1";
  delete process.env.DATABASE_URL; delete process.env.CS_DATABASE_URL; delete process.env.RESEND_API_KEY;
  dataDir = mkdtempSync(join(tmpdir(), "disp-")); process.env.CONTENT_STUDIO_DATA_DIR = dataDir;
});
afterAll(() => { process.env = savedEnv; if (dataDir) rmSync(dataDir, { recursive: true, force: true }); });
beforeEach(() => resetBreakbotNamespace());

describe("mandate 29 — lead disposition (append-only, idempotent, no suppression)", () => {
  it("applies DO_NOT_PREPARE + INTERNAL_TEST and reads them back", async () => {
    await applyLeadDisposition({ leadId: "L1", disposition: "DO_NOT_PREPARE", reason: "NO_FUNCTIONING_WEBSITE", batchHash: "H1", actor: "op" });
    await applyLeadDisposition({ leadId: "L2", disposition: "INTERNAL_TEST", reason: "internal-test", batchHash: "H1", actor: "op" });
    expect((await latestDisposition("L1"))?.disposition).toBe("DO_NOT_PREPARE");
    expect((await latestDisposition("L2"))?.disposition).toBe("INTERNAL_TEST");
    const m = await dispositionMap();
    expect(m["L1"]).toBe("DO_NOT_PREPARE");
    expect(m["L2"]).toBe("INTERNAL_TEST");
  });

  it("is idempotent under retry — no duplicate disposition event for the same lead + batchHash", async () => {
    const r1 = await applyLeadDisposition({ leadId: "L3", disposition: "DO_NOT_PREPARE", reason: "x", batchHash: "H2", actor: "op" });
    const r2 = await applyLeadDisposition({ leadId: "L3", disposition: "DO_NOT_PREPARE", reason: "x", batchHash: "H2", actor: "op" });
    expect(r1.applied).toBe(true); expect(r1.idempotent).toBe(false);
    expect(r2.applied).toBe(false); expect(r2.idempotent).toBe(true);
    const events = (await listAudit(5000)).filter((a) => a.action === DISPOSITION_ACTION && a.targetId === "L3");
    expect(events.length).toBe(1); // exactly one
  });

  it("NEVER creates a suppression / unsubscribe event", async () => {
    await applyLeadDisposition({ leadId: "L4", disposition: "DO_NOT_PREPARE", reason: "NO_FUNCTIONING_WEBSITE", batchHash: "H3", actor: "op" });
    const events = (await listAudit(5000)).filter((a) => a.targetId === "L4");
    expect(events.every((e) => !/suppress|unsubscribe/i.test(e.action))).toBe(true);
    expect((events.find((e) => e.action === DISPOSITION_ACTION)?.meta as any)?.suppression).toBe(false);
    expect(await isSuppressed({ email: "l4@example.invalid", domain: null, phone: null })).toBe(false);
  });
});
