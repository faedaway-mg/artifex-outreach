import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { getRampState, setLaneRampState, setSeedPlacement, rampView, defaultRampState } from "./ramp-store";

const NOW = "2026-09-10T12:00:00.000Z";

beforeEach(() => {
  __resetStoreForTests();
  process.env.GOOGLE_SENDER_1_DAILY_CAP = "8";
  process.env.GOOGLE_SENDER_2_DAILY_CAP = "8";
});
afterEach(() => {
  delete process.env.GOOGLE_SENDER_1_DAILY_CAP;
  delete process.env.GOOGLE_SENDER_2_DAILY_CAP;
});

describe("ramp store persistence (§28-30)", () => {
  it("default state: both lanes WARMING L1, Outlook seed Junk (§29 preserved observation)", () => {
    const d = defaultRampState(NOW);
    expect(d.lanes["sender-1"].state).toBe("WARMING");
    expect(d.lanes["sender-1"].level).toBe(1);
    expect(d.seed.outlook).toBe("junk");
    expect(d.seed.gmail).toBe("not_tested");
  });

  it("returns defaults when nothing is persisted", async () => {
    const s = await getRampState(NOW);
    expect(s.lanes["sender-2"].level).toBe(1);
    expect(s.seed.outlook).toBe("junk");
  });

  it("persists a lane transition and reads it back", async () => {
    await setLaneRampState("sender-1", { state: "RAMPING", level: 2 }, { now: NOW, actor: "test" });
    const s = await getRampState(NOW);
    expect(s.lanes["sender-1"].state).toBe("RAMPING");
    expect(s.lanes["sender-1"].level).toBe(2);
    // the other lane is untouched (independent, no quota transfer)
    expect(s.lanes["sender-2"].level).toBe(1);
  });

  it("records operator seed placement", async () => {
    await setSeedPlacement("outlook", "inbox", { now: NOW, actor: "test" });
    const s = await getRampState(NOW);
    expect(s.seed.outlook).toBe("inbox");
  });

  it("rampView: combined capacity is the sum of each lane's own cap; Outlook Junk blocks promotion", async () => {
    const v = await rampView(NOW);
    // both lanes at L1 (=2) → combined 4
    expect(v.combinedDailyCapacity).toBe(4);
    expect(v.outlookBlocksPromotion).toBe(true); // default Outlook=junk
    // record Outlook Inbox → no longer blocks
    await setSeedPlacement("outlook", "inbox", { now: NOW, actor: "test" });
    const v2 = await rampView(NOW);
    expect(v2.outlookBlocksPromotion).toBe(false);
  });
});
