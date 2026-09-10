import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { appendCostEntry, getCostLedgerEntries, costLedgerView, getCostLedgerView, type PersistedCostEntry } from "./cost-ledger-store";

const NOW = "2026-09-10T12:00:00.000Z";

beforeEach(() => {
  __resetStoreForTests();
  delete process.env.LEAD_SPRINT_RATE_ELEVENLABS_VOICE;
  delete process.env.LEAD_SPRINT_RATE_RENDER;
});
afterEach(() => {
  delete process.env.LEAD_SPRINT_RATE_ELEVENLABS_VOICE;
  delete process.env.LEAD_SPRINT_RATE_RENDER;
});

describe("cost ledger view (§15 — honest, never fabricated)", () => {
  it("rolls up per kind; USD stays null when no provider rate is configured", () => {
    const entries: PersistedCostEntry[] = [
      { kind: "elevenlabs-voice", units: 2, unit: "minute", knownUsd: null, basis: "unknown", at: NOW, actor: "voice" },
      { kind: "elevenlabs-voice", units: 1, unit: "minute", knownUsd: null, basis: "unknown", at: NOW, actor: "voice" },
      { kind: "render", units: 1, unit: "render", knownUsd: null, basis: "unknown", at: NOW, actor: "render-worker" },
    ];
    const v = costLedgerView(entries);
    expect(v.totalEvents).toBe(3);
    const voice = v.byKind.find((k) => k.kind === "elevenlabs-voice")!;
    expect(voice.units).toBe(3);
    expect(voice.events).toBe(2);
    expect(voice.knownUsd).toBeNull(); // no configured rate → honest unknown
    expect(v.summary.knownUsdTotal).toBe(0);
    expect(v.summary.unknownCostKinds).toContain("elevenlabs-voice");
  });

  it("attaches USD only for kinds with a configured rate", () => {
    process.env.LEAD_SPRINT_RATE_RENDER = "0.05"; // $0.05 per render
    const entries: PersistedCostEntry[] = [
      { ...({ kind: "render", units: 4, unit: "render" } as any), knownUsd: 0.2, basis: "env", at: NOW, actor: "render-worker" },
    ];
    const v = costLedgerView(entries);
    const render = v.byKind.find((k) => k.kind === "render")!;
    expect(render.knownUsd).toBe(0.2);
    expect(v.summary.knownUsdTotal).toBe(0.2);
  });

  it("efficiency metrics are null until a real denominator AND known cost exist (no fabrication)", () => {
    const entries: PersistedCostEntry[] = [
      { kind: "render", units: 1, unit: "render", knownUsd: 0.5, basis: "env", at: NOW, actor: "render-worker" },
    ];
    // no outcomes → every per-X metric null
    let v = costLedgerView(entries, {});
    expect(v.perSuccessfulSend).toBeNull();
    expect(v.perPurchase).toBeNull();
    // a denominator but zero known cost → still null
    v = costLedgerView([{ ...entries[0], knownUsd: null }], { successfulSends: 3 });
    expect(v.perSuccessfulSend).toBeNull();
    // both present → computed
    v = costLedgerView(entries, { successfulSends: 2 });
    expect(v.perSuccessfulSend).toBe(0.25);
  });
});

describe("cost ledger persistence (§15)", () => {
  it("appends measured entries and reads them back (append-only)", async () => {
    await appendCostEntry("elevenlabs-voice", 3, { actor: "voice", now: NOW });
    await appendCostEntry("render", 1, { actor: "render-worker", now: NOW });
    const entries = await getCostLedgerEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("elevenlabs-voice");
    expect(entries[0].units).toBe(3);
    expect(entries[0].knownUsd).toBeNull(); // no rate configured → honest unknown
  });

  it("getCostLedgerView summarizes the persisted ledger", async () => {
    await appendCostEntry("deep-analysis", 5, { actor: "analysis", now: NOW });
    const v = await getCostLedgerView();
    expect(v.totalEvents).toBe(1);
    expect(v.byKind[0].kind).toBe("deep-analysis");
    expect(v.byKind[0].units).toBe(5);
  });

  it("starts empty (honest: no paid compute has run — not a bug)", async () => {
    expect(await getCostLedgerEntries()).toEqual([]);
    const v = await getCostLedgerView();
    expect(v.totalEvents).toBe(0);
    expect(v.summary.knownUsdTotal).toBe(0);
  });
});
