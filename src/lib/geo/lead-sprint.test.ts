import { describe, it, expect } from "vitest";
import {
  marketPodOf, geoGate, activePodIds, activePodTerritories, explicitlyEnabledStates, FIRST_WAVE_PODS,
} from "./lead-sprint";

const env = (o: Record<string, string>) => ({ ...o }) as unknown as NodeJS.ProcessEnv;

describe("lead-sprint market registry", () => {
  it("matches in-pod cities to their pod", () => {
    expect(marketPodOf({ city: "Greenville", state: "SC" }, env({}))?.id).toBe("greenville-sc");
    expect(marketPodOf({ city: "Huntsville", state: "AL" }, env({}))?.id).toBe("huntsville-al");
    expect(marketPodOf({ city: "Chattanooga", state: "TN" }, env({}))?.id).toBe("chattanooga-tn-ga");
    expect(marketPodOf({ city: "Ringgold", state: "GA" }, env({}))?.id).toBe("chattanooga-tn-ga");
    expect(marketPodOf({ city: "Bentonville", state: "AR" }, env({}))?.id).toBe("nw-arkansas");
  });

  it("is case-insensitive and trims", () => {
    expect(marketPodOf({ city: "  greenVILLE ", state: " sc " }, env({}))?.id).toBe("greenville-sc");
  });

  it("fails closed: a state alone never qualifies", () => {
    expect(marketPodOf({ city: "Birmingham", state: "AL" }, env({}))).toBeNull();
    expect(marketPodOf({ city: "Atlanta", state: "GA" }, env({}))).toBeNull();
    expect(marketPodOf({ city: "", state: "SC" }, env({}))).toBeNull();
  });

  it("California is a retired market → gate denies as retired", () => {
    const g = geoGate({ city: "Los Angeles", state: "CA" }, env({}));
    expect(g.allowed).toBe(false);
    expect(g).toMatchObject({ retired: true });
  });

  it("out-of-pod non-CA is denied but not marked retired", () => {
    const g = geoGate({ city: "Austin", state: "TX" }, env({}));
    expect(g.allowed).toBe(false);
    expect(g).toMatchObject({ retired: false });
  });

  it("in-pod lead passes the gate with pod label", () => {
    const g = geoGate({ city: "Springdale", state: "AR" }, env({}));
    expect(g.allowed).toBe(true);
    if (g.allowed) expect(g.podLabel).toContain("Arkansas");
  });

  it("ACQ_ACTIVE_PODS narrows the active set", () => {
    expect(activePodIds(env({ ACQ_ACTIVE_PODS: "greenville-sc" }))).toEqual(["greenville-sc"]);
    // A lead in a non-active pod is now gated out even though it's a valid pod.
    expect(marketPodOf({ city: "Huntsville", state: "AL" }, env({ ACQ_ACTIVE_PODS: "greenville-sc" }))).toBeNull();
  });

  it("ACQ_ACTIVE_PODS=none freezes discovery", () => {
    expect(activePodIds(env({ ACQ_ACTIVE_PODS: "none" }))).toEqual([]);
    expect(marketPodOf({ city: "Greenville", state: "SC" }, env({ ACQ_ACTIVE_PODS: "none" }))).toBeNull();
    expect(activePodTerritories(env({ ACQ_ACTIVE_PODS: "none" }))).toEqual([]);
  });

  it("unknown pod ids in config are ignored (fail-safe)", () => {
    expect(activePodIds(env({ ACQ_ACTIVE_PODS: "bogus,greenville-sc" }))).toEqual(["greenville-sc"]);
  });

  it("ACQ_ENABLE_STATES can re-enable CA explicitly", () => {
    expect(explicitlyEnabledStates(env({ ACQ_ENABLE_STATES: "ca,tx" }))).toEqual(new Set(["CA", "TX"]));
    const g = geoGate({ city: "Los Angeles", state: "CA" }, env({ ACQ_ENABLE_STATES: "CA" }));
    // Still not in a pod, so still denied — but no longer flagged retired.
    expect(g.allowed).toBe(false);
    expect(g).toMatchObject({ retired: false });
  });

  it("activePodTerritories yields in-market cities with correct states", () => {
    const terr = activePodTerritories(env({}));
    expect(terr.some((t) => t.city === "Greenville" && t.state === "SC")).toBe(true);
    expect(terr.some((t) => t.city === "Ringgold" && t.state === "GA")).toBe(true);
    expect(terr.some((t) => t.city === "Chattanooga" && t.state === "TN")).toBe(true);
    // No California city ever appears.
    expect(terr.every((t) => t.state !== "CA")).toBe(true);
  });

  it("every pod has cities and states", () => {
    for (const p of FIRST_WAVE_PODS) {
      expect(p.cities.length).toBeGreaterThan(0);
      expect(p.states.length).toBeGreaterThan(0);
    }
  });
});
