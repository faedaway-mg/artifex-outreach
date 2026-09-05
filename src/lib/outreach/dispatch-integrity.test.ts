import { describe, it, expect } from "vitest";
import { detectPlaceholderContent, assertDispatchable, classifyPackageType, testProvenanceReason, type PackageIntegrityInput } from "./dispatch-integrity";

const base: PackageIntegrityInput = {
  type: "EMAIL_VIDEO", subject: "A short review for Northstar", body: "Hi — I put together a short, focused review for your business.",
  businessName: "Northstar", recipientValid: true, hasFrozenReview: true, hasVideo: true, hasShare: true, packageRevision: 1,
};

describe("dispatch-integrity — placeholder/test detection (mandate 16)", () => {
  it("flags the Silver test package (subject 'BreakBot test', body 't')", () => {
    expect(detectPlaceholderContent({ subject: "BreakBot test", body: "t", businessName: "Silver In the City" })).toMatch(/test\/placeholder subject/);
  });
  it("flags trivially short bodies + empty subjects + fixture/canary names", () => {
    expect(detectPlaceholderContent({ subject: "Real subject line here", body: "t" })).toMatch(/too short/);
    expect(detectPlaceholderContent({ subject: "", body: "long enough body content" })).toBe("empty subject");
    expect(detectPlaceholderContent({ subject: "Quick Review", body: "long enough body content", businessName: "Canary Co" })).toMatch(/business/);
  });
  it("passes genuine outreach content", () => {
    expect(detectPlaceholderContent({ subject: "A short review for Motion Recruitment", body: "Hi — I put together a short review for your team.", businessName: "Motion Recruitment" })).toBeNull();
  });
  it("does not misfire on real short-ish business names", () => {
    expect(detectPlaceholderContent({ subject: "A short review for A to Z", body: "Hi — a short review for your business.", businessName: "a2z Health Massage Schools" })).toBeNull();
  });
});

describe("assertDispatchable — fail-closed per package type", () => {
  it("blocks placeholder BEFORE anything else", () => {
    const v = assertDispatchable({ ...base, subject: "BreakBot test", body: "t" });
    expect(v.ok).toBe(false); expect(v.code).toBe("PLACEHOLDER_OR_TEST_CONTENT");
  });
  it("EMAIL_VIDEO requires PDF + video + share", () => {
    expect(assertDispatchable({ ...base, hasVideo: false }).code).toBe("MISSING_REQUIRED_ARTIFACT");
    expect(assertDispatchable({ ...base, hasShare: false }).code).toBe("MISSING_REQUIRED_ARTIFACT");
    expect(assertDispatchable({ ...base, hasFrozenReview: false }).code).toBe("MISSING_REQUIRED_ARTIFACT");
    expect(assertDispatchable(base).ok).toBe(true);
  });
  it("EMAIL_ONLY needs no video/PDF but needs recipient + revision + real content", () => {
    const emailOnly = { ...base, type: "EMAIL_ONLY" as const, hasVideo: false, hasShare: false, hasFrozenReview: false };
    expect(assertDispatchable(emailOnly).ok).toBe(true);
    expect(assertDispatchable({ ...emailOnly, recipientValid: false }).code).toBe("INVALID_RECIPIENT");
    expect(assertDispatchable({ ...emailOnly, packageRevision: null }).code).toBe("MISSING_REQUIRED_ARTIFACT");
  });
  it("EMAIL_PDF requires the PDF but not a video", () => {
    const pdf = { ...base, type: "EMAIL_PDF" as const, hasVideo: false, hasShare: false };
    expect(assertDispatchable(pdf).ok).toBe(true);
    expect(assertDispatchable({ ...pdf, hasFrozenReview: false }).code).toBe("MISSING_REQUIRED_ARTIFACT");
  });
  it("VIDEO_FOLLOW_UP requires a prior-send receipt (lineage)", () => {
    const fu = { ...base, type: "VIDEO_FOLLOW_UP" as const, hasPriorReceipt: false };
    expect(assertDispatchable(fu).code).toBe("MISSING_LINEAGE");
    expect(assertDispatchable({ ...fu, hasPriorReceipt: true }).ok).toBe(true);
  });
  it("test-provenance is rejected at the dispatch boundary (mandate 17 Workstream 5)", () => {
    expect(testProvenanceReason({ source: "internal-test", businessName: "Real Co" })).toMatch(/test source/);
    expect(testProvenanceReason({ source: "breakbot", businessName: "Real Co" })).toMatch(/test source/);
    expect(testProvenanceReason({ source: "google-places", businessName: "Real Co", test_only: true })).toMatch(/test_only/);
    expect(testProvenanceReason({ source: "google-places", businessName: "BreakBot Canary" })).toMatch(/synthetic/);
    expect(testProvenanceReason({ source: "google-places", businessName: "Real Co" }, { internal: true })).toMatch(/internal/);
    // a genuine production lead passes
    expect(testProvenanceReason({ source: "google-places", businessName: "Motion Recruitment" })).toBeNull();
  });

  it("classifyPackageType maps artifacts → type", () => {
    expect(classifyPackageType({ video: {}, review: {} })).toBe("EMAIL_VIDEO");
    expect(classifyPackageType({ review: {} })).toBe("EMAIL_PDF");
    expect(classifyPackageType({})).toBe("EMAIL_ONLY");
    expect(classifyPackageType(null)).toBe("EMAIL_ONLY");
  });
});
