// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT VISUAL QA — PURE unit suite (Part AE items 31-40).
//
// Feeds synthetic RenderedSurface geometry into assessRenderedSurface and proves
// every Part-S failure is caught, a clean surface PASSES, tolerance behaves
// (2px overflow does NOT block; 3px+ does), and the combiner is fail-closed.
// NO browser is launched here — this is fast and deterministic.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import {
  assessRenderedSurface,
  combineVisualResults,
  VIEWPORTS,
  GEOMETRY_TOLERANCE_PX,
  type Box,
  type RenderedSurface,
  type VisualViewport,
} from "./visual-qa";

function box(overrides: Partial<Box> = {}): Box {
  return { x: 0, y: 0, width: 300, height: 48, visible: true, ...overrides };
}

// A fully-clean surface: every asserted element present/visible/sane, no overflow,
// no hero price, sticky bar sitting above (not overlapping) the purchase controls.
function cleanSurface(viewport: VisualViewport = "mobile"): RenderedSurface {
  const vw = VIEWPORTS[viewport].width;
  return {
    surface: "offer",
    viewport,
    documentScrollWidth: vw,
    viewportWidth: vw,
    screenshotPath: `artifacts/x-${viewport}.png`,
    elements: {
      primaryCta: box({ y: 600, height: 52 }),
      heroTitle: box({ y: 40, width: vw - 40, height: 44 }),
      evidenceScreenshot: box({ y: 200, width: 320, height: 200 }),
      personalizedVideoFrame: box({ y: 420, width: 320, height: 180 }),
      purchaseControls: box({ y: 640, height: 120, zIndex: 1 }),
      stickyBar: box({ y: 800, height: 40, zIndex: 5 }), // below purchase, no overlap
      // heroPrice intentionally absent (price forbidden in hero)
      // stickyBar2 intentionally absent (no duplicate)
    },
  };
}

describe("assessRenderedSurface — clean surface PASSES", () => {
  it("31. a fully-clean surface has zero blockers and PASSES", () => {
    const r = assessRenderedSurface(cleanSurface("mobile"));
    expect(r.findings.filter((f) => f.severity === "BLOCKER")).toHaveLength(0);
    expect(r.status).toBe("PASS");
    expect(r.screenshotPath).toBe("artifacts/x-mobile.png");
  });

  it("clean surface passes at desktop too", () => {
    expect(assessRenderedSurface(cleanSurface("desktop")).status).toBe("PASS");
  });
});

describe("assessRenderedSurface — Part S failures (AE items 32-40)", () => {
  it("32. horizontal overflow BLOCKS", () => {
    const s = cleanSurface("mobile");
    s.documentScrollWidth = 2000; // 390 viewport
    const r = assessRenderedSurface(s);
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "overflow")).toBe(true);
  });

  it("33. clipped/hidden primary CTA BLOCKS (missing, hidden, and zero-height)", () => {
    const missing = cleanSurface();
    missing.elements.primaryCta = null;
    expect(assessRenderedSurface(missing).findings.some((f) => f.kind === "cta.hidden")).toBe(true);

    const hidden = cleanSurface();
    hidden.elements.primaryCta = box({ visible: false });
    expect(assessRenderedSurface(hidden).findings.some((f) => f.kind === "cta.hidden")).toBe(true);

    const zero = cleanSurface();
    zero.elements.primaryCta = box({ height: 0 });
    const rz = assessRenderedSurface(zero);
    expect(rz.status).toBe("BLOCKED");
    expect(rz.findings.some((f) => f.kind === "cta.hidden")).toBe(true);
  });

  it("34. hidden operator website button BLOCKS (present-but-invisible)", () => {
    const s = cleanSurface("desktop");
    s.surface = "operator";
    s.elements.websiteButton = box({ visible: false });
    const r = assessRenderedSurface(s);
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "operator.websiteButton.hidden")).toBe(true);
  });

  it("visible operator website button does NOT block", () => {
    const s = cleanSurface("desktop");
    s.elements.websiteButton = box({ visible: true });
    expect(assessRenderedSurface(s).status).toBe("PASS");
  });

  it("35. sticky bar overlapping purchase controls (on top) BLOCKS", () => {
    const s = cleanSurface();
    s.elements.purchaseControls = box({ y: 640, height: 120, zIndex: 1 });
    s.elements.stickyBar = box({ y: 700, height: 80, zIndex: 10 }); // overlaps + higher z
    const r = assessRenderedSurface(s);
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "sticky.overlap")).toBe(true);
  });

  it("sticky bar overlapping but painted BEHIND (lower z) does NOT block", () => {
    const s = cleanSurface();
    s.elements.purchaseControls = box({ y: 640, height: 120, zIndex: 10 });
    s.elements.stickyBar = box({ y: 700, height: 80, zIndex: 1 });
    expect(assessRenderedSurface(s).status).toBe("PASS");
  });

  it("36. duplicate sticky bar BLOCKS", () => {
    const s = cleanSurface();
    s.elements.stickyBar2 = box({ y: 810, height: 40, visible: true });
    const r = assessRenderedSurface(s);
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "sticky.duplicate")).toBe(true);
  });

  it("37. evidence screenshot too small BLOCKS", () => {
    const s = cleanSurface();
    s.elements.evidenceScreenshot = box({ width: 120, height: 90 });
    const r = assessRenderedSurface(s);
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "evidence.tooSmall")).toBe(true);
  });

  it("37b. evidence screenshot distorted aspect BLOCKS", () => {
    const s = cleanSurface();
    s.elements.evidenceScreenshot = box({ width: 800, height: 20 }); // 40:1
    const r = assessRenderedSurface(s);
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "evidence.distorted")).toBe(true);
  });

  it("38. missing personalized video frame BLOCKS (absent and invisible)", () => {
    const absent = cleanSurface();
    absent.elements.personalizedVideoFrame = null;
    expect(
      assessRenderedSurface(absent).findings.some((f) => f.kind === "video.frameMissing"),
    ).toBe(true);

    const invisible = cleanSurface();
    invisible.elements.personalizedVideoFrame = box({ visible: false });
    const r = assessRenderedSurface(invisible);
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "video.frameMissing")).toBe(true);
  });

  it("39. price leaking into hero BLOCKS", () => {
    const s = cleanSurface();
    s.elements.heroPrice = box({ y: 60, width: 80, height: 30, visible: true });
    const r = assessRenderedSurface(s);
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "price.inHero")).toBe(true);
  });

  it("39b. an absent/hidden hero price does NOT block", () => {
    const hidden = cleanSurface();
    hidden.elements.heroPrice = box({ visible: false });
    expect(assessRenderedSurface(hidden).status).toBe("PASS");
  });

  it("40. clipped hero title (zero size) BLOCKS", () => {
    const s = cleanSurface();
    s.elements.heroTitle = box({ height: 0, width: 200 });
    const r = assessRenderedSurface(s);
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "heroTitle.clipped")).toBe(true);
  });
});

describe("assessRenderedSurface — tolerance (antialiasing must not flake)", () => {
  it(`overflow of exactly ${GEOMETRY_TOLERANCE_PX}px does NOT block`, () => {
    const s = cleanSurface("mobile");
    s.documentScrollWidth = s.viewportWidth + GEOMETRY_TOLERANCE_PX;
    expect(assessRenderedSurface(s).status).toBe("PASS");
  });

  it(`overflow of ${GEOMETRY_TOLERANCE_PX + 1}px DOES block`, () => {
    const s = cleanSurface("mobile");
    s.documentScrollWidth = s.viewportWidth + GEOMETRY_TOLERANCE_PX + 1;
    expect(assessRenderedSurface(s).status).toBe("BLOCKED");
  });

  it("a 1px sticky/purchase touch (within tolerance) does NOT count as overlap", () => {
    const s = cleanSurface();
    s.elements.purchaseControls = box({ y: 640, height: 100, zIndex: 1 });
    // sticky starts at 739 -> overlaps the purchase bottom (740) by only 1px
    s.elements.stickyBar = box({ y: 739, height: 40, zIndex: 10 });
    expect(assessRenderedSurface(s).status).toBe("PASS");
  });
});

describe("combineVisualResults — fail-closed portfolio verdict", () => {
  it("empty => NOT_RUN", () => {
    expect(combineVisualResults([]).status).toBe("NOT_RUN");
  });

  it("all PASS => PASS", () => {
    const results = [
      assessRenderedSurface(cleanSurface("mobile")),
      assessRenderedSurface(cleanSurface("desktop")),
    ];
    expect(combineVisualResults(results).status).toBe("PASS");
  });

  it("any BLOCKED => BLOCKED and blocked list is populated", () => {
    const bad = cleanSurface("mobile");
    bad.documentScrollWidth = 2000;
    const combined = combineVisualResults([
      assessRenderedSurface(cleanSurface("desktop")),
      assessRenderedSurface(bad),
    ]);
    expect(combined.status).toBe("BLOCKED");
    expect(combined.blocked).toHaveLength(1);
    expect(combined.blocked[0].viewport).toBe("mobile");
  });
});
