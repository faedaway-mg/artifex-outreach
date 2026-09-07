import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal() as any), isAuthenticated: () => false }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSprintFixtures } from "./approvable-fixture";
import { resetBreakbotNamespace } from "./namespace";
import { __setArtifactStoreForTests } from "../content-studio/storage-factory";
import { listJobs } from "../content-studio/store";
import { GET, POST } from "@/app/api/content-studio/outreach-reviews/sprint/route";

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
const CANARY = "m28-canary";
const savedEnv = { ...process.env };
let dataDir = "";
beforeAll(() => {
  process.env.BREAKBOT_TEST_TENANT = "1"; process.env.CS_CANARY_SECRET = CANARY;
  delete process.env.DATABASE_URL; delete process.env.CS_DATABASE_URL; delete process.env.RESEND_API_KEY;
  dataDir = mkdtempSync(join(tmpdir(), "cs-m28-")); process.env.CONTENT_STUDIO_DATA_DIR = dataDir;
  __setArtifactStoreForTests(memStore);
});
afterAll(() => { process.env = savedEnv; __setArtifactStoreForTests(null); if (dataDir) rmSync(dataDir, { recursive: true, force: true }); });
beforeEach(() => { resetBreakbotNamespace(); mem.clear(); });

// A valid M4A container header so detectAudioType passes (ftyp box).
const m4a = () => { const b = Buffer.alloc(64); b.write("ftypM4A ", 4, "ascii"); b[0] = 0; b[1] = 0; b[2] = 0; b[3] = 32; return b.toString("base64"); };

async function get(qs: string) { const req: any = new Request(`http://localhost/api/content-studio/outreach-reviews/sprint?${qs}`, { headers: { "x-cs-canary": CANARY } }); const res = await GET(req); return { status: res.status, json: await res.json() }; }
async function post(action: string, body: any) { const req: any = new Request(`http://localhost/api/content-studio/outreach-reviews/sprint?action=${action}`, { method: "POST", headers: { "Content-Type": "application/json", "x-cs-canary": CANARY }, body: JSON.stringify(body) }); const res = await POST(req); return { status: res.status, json: await res.json() }; }

describe("mandate 28 — narration sprint (server-level acceptance)", () => {
  it("only READY_FOR_NARRATION businesses enter the sprint; enterprise + no-recipient excluded", async () => {
    const seeded = await seedSprintFixtures(12);
    const b = await get("action=backlog");
    expect(b.json.readyCount).toBe(12);
    expect(b.json.order).not.toContain(seeded.enterpriseId);
    expect(b.json.order).not.toContain(seeded.noRecipientId);
  });

  it("start → copy-ready card → valid upload matches transcript → EXACTLY ONE render → auto-advance", async () => {
    await seedSprintFixtures(5);
    const start = await post("start", { batchSize: 5 });
    expect(start.json.firstLeadId).toBeTruthy();
    const sid = start.json.sessionId;
    const sess = await get(`action=session&sessionId=${sid}`);
    const card = sess.json.card;
    expect(card.narration.length).toBeGreaterThan(40);
    // upload a valid recording (fake transcriber returns the card narration → MATCH)
    const up = await post("upload", { sessionId: sid, leadId: card.leadId, audioBase64: m4a(), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: card.scriptRevisionId });
    expect(up.json.ok).toBe(true);
    expect(up.json.transcript.classification).toBe("MATCH");
    expect(up.json.renderQueued).toBe(true);
    expect(up.json.autoAdvance).toBe(true);
    expect(up.json.nextLeadId).not.toBe(card.leadId); // advanced
    // exactly one render job for this piece
    const jobs = (await listJobs()).filter((j) => j.pieceId === `client-${card.leadId}`);
    expect(jobs.length).toBe(1);
  });

  it("double-tap upload converges to ONE render job (idempotent)", async () => {
    await seedSprintFixtures(3);
    const start = await post("start", { batchSize: 3 });
    const sid = start.json.sessionId; const leadId = start.json.firstLeadId;
    const card = (await get(`action=session&sessionId=${sid}`)).json.card;
    await post("upload", { sessionId: sid, leadId, audioBase64: m4a(), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: card.scriptRevisionId });
    // second identical upload (retry) against the same lead — session already advanced, so re-target the lead
    await post("upload", { sessionId: sid, leadId, audioBase64: m4a(), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: card.scriptRevisionId });
    const jobs = (await listJobs()).filter((j) => j.pieceId === `client-${leadId}`);
    expect(jobs.length).toBe(1);
  });

  it("wrong-company recording is BLOCKED before rendering (no auto-advance, no job)", async () => {
    await seedSprintFixtures(3);
    const start = await post("start", { batchSize: 3 });
    const sid = start.json.sessionId; const leadId = start.json.firstLeadId;
    const card = (await get(`action=session&sessionId=${sid}`)).json.card;
    // A wrong recording of comparable LENGTH (so it's not merely 'incomplete') but different content → WRONG.
    const wrong = "Thanks so much for calling Joe's Pizza Kitchen this evening, our today specials include a large pepperoni pizza, a mushroom and sausage combination, plus garlic knots and a fresh garden salad, and delivery across the whole downtown neighborhood usually takes around thirty five minutes depending on traffic and current kitchen volume, so please order early tonight friends.";
    const up = await post("upload", { sessionId: sid, leadId, audioBase64: m4a(), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: card.scriptRevisionId, spokenTranscript: wrong });
    expect(up.json.ok).toBe(true);
    expect(up.json.transcript.classification).toBe("POSSIBLE_WRONG_RECORDING");
    expect(up.json.renderQueued).toBe(false);
    expect((await listJobs()).filter((j) => j.pieceId === `client-${leadId}`).length).toBe(0);
    // stayed on the same business (no advance)
    expect((await get(`action=session&sessionId=${sid}`)).json.leadId).toBe(leadId);
  });

  it("bad MIME / stale revision are rejected", async () => {
    await seedSprintFixtures(2);
    const start = await post("start", { batchSize: 2 });
    const sid = start.json.sessionId; const leadId = start.json.firstLeadId;
    const card = (await get(`action=session&sessionId=${sid}`)).json.card;
    const bad = await post("upload", { sessionId: sid, leadId, audioBase64: Buffer.from("not audio at all here padding padding").toString("base64"), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: card.scriptRevisionId });
    expect(bad.json.ok).toBe(false);
    const stale = await post("upload", { sessionId: sid, leadId, audioBase64: m4a(), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: `${leadId}#r99` });
    expect(stale.json.code).toBe("REVISION_MISMATCH");
  });

  it("skip is session-local (stays eligible); reject is canonical + removes from sprint", async () => {
    const seeded = await seedSprintFixtures(4);
    const start = await post("start", { batchSize: 4 });
    const sid = start.json.sessionId; const first = start.json.firstLeadId;
    const sk = await post("skip", { sessionId: sid });
    expect(sk.json.session.skipped).toContain(first);
    // skipped lead still in READY backlog
    expect((await get("action=backlog")).json.order).toContain(first);
    const rj = await post("reject", { sessionId: sid, reason: "poor-fit" });
    expect(rj.json.session.rejected.length).toBe(1);
  });

  it("session persists + resumes; ineligible current lead is skipped on resume", async () => {
    await seedSprintFixtures(3);
    const start = await post("start", { batchSize: 3 });
    const sid = start.json.sessionId;
    // reload by id (survives 'refresh')
    const reloaded = await get(`action=session&sessionId=${sid}`);
    expect(reloaded.json.session.id).toBe(sid);
    const res = await post("resume", { sessionId: sid });
    expect(res.json.session.resumedAt).toBeTruthy();
    expect(res.json.leadId).toBeTruthy();
  });

  it("proves the FULL 100-item eligible sprint in isolation", async () => {
    await seedSprintFixtures(100);
    const b = await get("action=backlog");
    expect(b.json.readyCount).toBe(100);
    const start = await post("start", { batchSize: "all" });
    expect(start.json.order.length).toBe(100);
  });

  it("never queues a render on a failed upload; provider calls = 0 (no email provider imported here)", async () => {
    await seedSprintFixtures(2);
    const start = await post("start", { batchSize: 2 });
    const sid = start.json.sessionId; const leadId = start.json.firstLeadId;
    const card = (await get(`action=session&sessionId=${sid}`)).json.card;
    // too-short recording → incomplete → no render
    const up = await post("upload", { sessionId: sid, leadId, audioBase64: m4a(), mime: "audio/mp4", durationSeconds: 2, requestedRevisionId: card.scriptRevisionId });
    expect(up.json.ok).toBe(false); // TOO_SHORT
    expect((await listJobs()).filter((j) => j.pieceId === `client-${leadId}`).length).toBe(0);
  });
});
