// Nav reachability tests. The mobile bottom bar can only hold a few destinations, so the
// "More" sheet MUST expose everything else — most importantly Launch Readiness, which was
// previously reachable only by typing the URL. These pure-helper assertions guarantee that
// contract without needing a DOM.
import { describe, it, expect } from "vitest";
import { NAV, MOBILE_PRIMARY_COUNT, mobilePrimaryNav, mobileOverflowNav } from "./nav-items";

describe("nav-items", () => {
  it("Launch Readiness is a destination in the shared NAV", () => {
    const launch = NAV.find((n) => n.href === "/launch-readiness");
    expect(launch).toBeDefined();
    expect(launch?.label).toBe("Launch Readiness");
    expect(launch?.icon).toBeTruthy(); // a lucide-react icon component (forwardRef object)
  });

  it("primary + overflow together cover EVERY destination with no gaps or overlap", () => {
    const primary = mobilePrimaryNav();
    const overflow = mobileOverflowNav();
    expect(primary).toHaveLength(MOBILE_PRIMARY_COUNT);
    const combined = [...primary, ...overflow].map((n) => n.href);
    expect(combined).toEqual(NAV.map((n) => n.href)); // order preserved, nothing dropped
    expect(new Set(combined).size).toBe(NAV.length); // no duplicates
  });

  it("the mobile overflow ('More') menu exposes Launch Readiness by tap", () => {
    const overflowHrefs = mobileOverflowNav().map((n) => n.href);
    expect(overflowHrefs).toContain("/launch-readiness");
  });

  it("every NAV destination is reachable on mobile (bottom bar OR overflow)", () => {
    const reachable = new Set([...mobilePrimaryNav(), ...mobileOverflowNav()].map((n) => n.href));
    for (const item of NAV) expect(reachable.has(item.href)).toBe(true);
  });
});
