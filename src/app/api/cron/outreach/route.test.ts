import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { __resetStoreForTests } from "@/lib/store";
import { POST } from "./route";

const SECRET = "test-cron-secret";
const ORIG = { cron: process.env.CRON_SECRET, autosend: process.env.QR_AUTOSEND_ENABLED, pause: process.env.QR_OUTREACH_PAUSED };

function req(auth?: string) {
  return new NextRequest("http://localhost/api/cron/outreach", { method: "POST", headers: auth ? { authorization: auth } : {} });
}

beforeEach(() => { __resetStoreForTests(); process.env.CRON_SECRET = SECRET; delete process.env.QR_AUTOSEND_ENABLED; delete process.env.QR_OUTREACH_PAUSED; });
afterEach(() => {
  ORIG.cron === undefined ? delete process.env.CRON_SECRET : (process.env.CRON_SECRET = ORIG.cron);
  ORIG.autosend === undefined ? delete process.env.QR_AUTOSEND_ENABLED : (process.env.QR_AUTOSEND_ENABLED = ORIG.autosend);
  ORIG.pause === undefined ? delete process.env.QR_OUTREACH_PAUSED : (process.env.QR_OUTREACH_PAUSED = ORIG.pause);
});

describe("/api/cron/outreach — scheduled runner is delivery-disabled at both boundaries", () => {
  it("401 without the cron secret", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer wrong"))).status).toBe(401);
  });

  it("ENTRY gate: with QR_AUTOSEND_ENABLED off, it is a pure no-op (dispatched:false, sent:0)", async () => {
    const r = await (await POST(req(`Bearer ${SECRET}`))).json();
    expect(r).toMatchObject({ ok: true, dispatched: false, sent: 0 });
    expect(r.reason).toMatch(/disabled/i);
  });

  it("even ENABLED, it dispatches NOTHING (non-delivering transport, no scheduled batch)", async () => {
    process.env.QR_AUTOSEND_ENABLED = "1";
    const r = await (await POST(req(`Bearer ${SECRET}`))).json();
    expect(r.ok).toBe(true);
    expect(r.dispatched).toBe(false);
    expect(r.sent).toBe(0);
    expect(r.summary?.sent).toBe(0);
  });

  it("ENABLED + paused → paused (no run)", async () => {
    process.env.QR_AUTOSEND_ENABLED = "1";
    process.env.QR_OUTREACH_PAUSED = "1";
    const r = await (await POST(req(`Bearer ${SECRET}`))).json();
    expect(r).toMatchObject({ ok: true, sent: 0, reason: "paused" });
  });
});
