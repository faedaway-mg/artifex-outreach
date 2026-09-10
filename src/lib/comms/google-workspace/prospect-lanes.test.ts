// ─────────────────────────────────────────────────────────────────────────────
// TWO PROSPECT LANES (A / B) — independent per-lane caps, enabled/disabled switch,
// health, combined capacity, and NO quota transfer between lanes. In-memory Settings
// store (no DATABASE_URL); FAKE non-secret credentials; no network.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prospectLanesView, laneDailyCap, laneEnabled } from "./prospect-lanes";
import { recordSenderSuccess, recordSenderError } from "./sender-health";
import { __resetStoreForTests } from "../../store";

const FAKE = {
  GOOGLE_OAUTH_CLIENT_ID: "fake-client-id.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "FAKE_SECRET",
  GOOGLE_WORKSPACE_SENDER_1: "outreach-a@lane-a.test",
  GOOGLE_WORKSPACE_REFRESH_TOKEN_1: "FAKE_RT_1",
  GOOGLE_WORKSPACE_SENDER_2: "outreach-b@lane-b.test",
  GOOGLE_WORKSPACE_REFRESH_TOKEN_2: "FAKE_RT_2",
};
const SAVED: Record<string, string | undefined> = {};
const KEYS = [...Object.keys(FAKE), "DATABASE_URL", "GOOGLE_SENDER_DAILY_CAP", "GOOGLE_SENDER_1_DAILY_CAP", "GOOGLE_SENDER_2_DAILY_CAP", "GOOGLE_SENDER_1_ENABLED", "GOOGLE_SENDER_2_ENABLED"];

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  delete process.env.DATABASE_URL;
  for (const [k, v] of Object.entries(FAKE)) process.env[k] = v;
  process.env.GOOGLE_SENDER_DAILY_CAP = "8"; // shared default for these tests
  __resetStoreForTests();
});
afterEach(() => {
  for (const k of KEYS) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
});

const laneA = (v: Awaited<ReturnType<typeof prospectLanesView>>) => v.lanes.find((l) => l.label === "A")!;
const laneB = (v: Awaited<ReturnType<typeof prospectLanesView>>) => v.lanes.find((l) => l.label === "B")!;

describe("two prospect lanes — resolution + combined capacity", () => {
  it("resolves Lane A and Lane B independently; both healthy when configured", async () => {
    const v = await prospectLanesView();
    expect(v.transport).toBe("google-workspace");
    expect(v.configuredLaneCount).toBe(2);
    expect(laneA(v).address).toBe("outreach-a@lane-a.test");
    expect(laneB(v).address).toBe("outreach-b@lane-b.test");
    expect(laneA(v).healthy && laneB(v).healthy).toBe(true);
    expect(v.combinedCapacityRemaining).toBe(16); // 8 + 8, each lane's OWN cap
    expect(v.anyLaneAvailable).toBe(true);
  });

  it("honors INDEPENDENT per-lane caps (combined = sum of each lane's own remaining)", async () => {
    process.env.GOOGLE_SENDER_1_DAILY_CAP = "5";
    process.env.GOOGLE_SENDER_2_DAILY_CAP = "10";
    expect(laneDailyCap("sender-1")).toBe(5);
    expect(laneDailyCap("sender-2")).toBe(10);
    const v = await prospectLanesView();
    expect(laneA(v).cap).toBe(5);
    expect(laneB(v).cap).toBe(10);
    expect(v.combinedCapacityRemaining).toBe(15);
  });

  it("never leaks a secret (refresh token / client secret) into the view", async () => {
    const blob = JSON.stringify(await prospectLanesView());
    expect(blob).not.toContain("FAKE_RT_1");
    expect(blob).not.toContain("FAKE_RT_2");
    expect(blob).not.toContain("FAKE_SECRET");
  });
});

describe("two prospect lanes — no quota transfer, independent health", () => {
  it("a lane at its OWN cap contributes zero, and its capacity does NOT transfer to the other lane", async () => {
    process.env.GOOGLE_SENDER_1_DAILY_CAP = "2";
    process.env.GOOGLE_SENDER_2_DAILY_CAP = "3";
    const now = new Date();
    await recordSenderSuccess("sender-1", now.toISOString());
    await recordSenderSuccess("sender-1", now.toISOString()); // sender-1 now at its cap (2/2)
    const v = await prospectLanesView(process.env, now);
    expect(laneA(v).healthy).toBe(false);      // lane A exhausted
    expect(laneA(v).remaining).toBe(0);
    expect(laneB(v).remaining).toBe(3);        // lane B keeps its OWN cap — no transfer of A's quota
    expect(v.combinedCapacityRemaining).toBe(3); // only lane B's remaining, NOT 2+3 pooled
    expect(v.anyLaneAvailable).toBe(true);      // B is still available
  });

  it("a repeatedly-failing lane cools down (unhealthy) while the other stays healthy", async () => {
    const now = new Date();
    for (let i = 0; i < 3; i++) await recordSenderError("sender-1", now.toISOString(), "server");
    const v = await prospectLanesView(process.env, now);
    expect(laneA(v).healthy).toBe(false);
    expect(laneA(v).cooldownUntil).toBeTruthy();
    expect(laneB(v).healthy).toBe(true);       // lane B unaffected — bounded by its own cap, never unlimited
  });

  it("a DISABLED lane contributes zero capacity; the other lane still sends", async () => {
    process.env.GOOGLE_SENDER_2_ENABLED = "0";
    expect(laneEnabled("sender-2")).toBe(false);
    const v = await prospectLanesView();
    expect(laneB(v).enabled).toBe(false);
    expect(laneB(v).healthy).toBe(false);
    expect(laneB(v).remaining).toBe(0);
    expect(laneA(v).healthy).toBe(true);
    expect(v.combinedCapacityRemaining).toBe(8); // lane A only
    expect(v.anyLaneAvailable).toBe(true);
  });

  it("BOTH lanes exhausted/disabled ⇒ no lane available (prospect outbound on hold)", async () => {
    process.env.GOOGLE_SENDER_1_ENABLED = "0";
    process.env.GOOGLE_SENDER_2_ENABLED = "0";
    const v = await prospectLanesView();
    expect(v.anyLaneAvailable).toBe(false);
    expect(v.combinedCapacityRemaining).toBe(0);
  });
});
