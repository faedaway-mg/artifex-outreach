// ─────────────────────────────────────────────────────────────────────────────
// OFFER PAGE POLISH (PART O) + FUNNEL INSTRUMENTATION (PART P). Polish-only: verify
// the information-architecture invariants hold (no redesign) and that the funnel
// roll-up is honest.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { summarizeFunnel } from "./funnel-instrumentation";
import { FUNNEL_EVENTS } from "./lifecycle";

const offerSrc = readFileSync(path.join(process.cwd(), "src/components/quick-fix/OfferPageView.tsx"), "utf8");

describe("offer page IA invariants (PART O) — polish, not redesign", () => {
  it("48. illustrative before/after is explicitly labeled Example, distinct from observed evidence", () => {
    // Conceptual interface is labeled Example …
    expect(offerSrc).toMatch(/Example · before/);
    expect(offerSrc).toMatch(/Example · after/);
    // … and the observed-evidence area is a separate section (observed issue + evidence).
    expect(offerSrc).toMatch(/Observed issue/);
    expect(offerSrc).toMatch(/Evidence/);
  });
  it("49. the sticky CTA is ONE actual DOM element (rendered once)", () => {
    const matches = offerSrc.match(/<OfferStickyBar/g) ?? [];
    expect(matches.length).toBe(1);
  });
  it("50. captions are not auto-opened over the video (no `default` on the track)", () => {
    const trackTags = offerSrc.match(/<track[^>]*>/g) ?? [];
    for (const t of trackTags) expect(t).not.toMatch(/\bdefault\b/);
  });
  it("51. mobile purchase remains usable — checkout accept-terms control is present", () => {
    const checkoutSrc = readFileSync(path.join(process.cwd(), "src/components/quick-fix/OfferCheckout.tsx"), "utf8");
    expect(checkoutSrc).toMatch(/accept-terms/);
    expect(checkoutSrc).toMatch(/btn-primary/);
  });
});

describe("funnel instrumentation (PART P) — honest roll-up, never fabricated", () => {
  it("an empty log yields zeros and hasTracking=false (do not fake behavior)", () => {
    const s = summarizeFunnel([]);
    expect(s.hasTracking).toBe(false);
    expect(s.purchases).toBe(0);
    for (const st of s.stages) expect(st.count).toBe(0);
  });
  it("counts canonical events deterministically across the funnel", () => {
    const events = [
      { action: FUNNEL_EVENTS.offerPageViewed, targetType: "quickfix_offer", targetId: "o1" },
      { action: FUNNEL_EVENTS.offerPageViewed, targetType: "quickfix_offer", targetId: "o2" },
      { action: FUNNEL_EVENTS.trustVideoStarted, targetType: "quickfix_offer", targetId: "o1" },
      { action: FUNNEL_EVENTS.checkoutStarted, targetType: "quickfix_offer", targetId: "o1" },
      { action: FUNNEL_EVENTS.purchaseCompleted, targetType: "quickfix_offer", targetId: "o1" },
      { action: "unrelated.event", targetType: "other", targetId: "x" },
    ];
    const s = summarizeFunnel(events);
    expect(s.offersTouched).toBe(2);
    expect(s.purchases).toBe(1);
    expect(s.stages.find((x) => x.key === "offer_opened")?.count).toBe(2);
    expect(s.stages.find((x) => x.key === "video_play_started")?.count).toBe(1);
    expect(s.hasTracking).toBe(true);
    expect(summarizeFunnel(events)).toEqual(s); // deterministic
  });
});
