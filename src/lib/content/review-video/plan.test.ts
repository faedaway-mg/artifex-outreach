// ─────────────────────────────────────────────────────────────────────────────
// Review Video plan + scene layout — the renderer consumes an explicit plan and never invents findings.
// Tests: plan shape across 1/2/3 findings, opening-hook + starting-point coherence, evidence→scene-type
// mapping (with a no-fake-screenshot fallback), captions from narration, PRIVATE_ONLY rights, and the
// pure layer layout (measured values are featured, nothing fabricated).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { buildReviewVideoPlan, buildSrt } from "./plan";
import { sceneLayers } from "./render";
import type { QuickReview } from "../../outreach/quick-review";
import type { ReviewFinding, StartingPoint } from "../../outreach/review-evidence";
import type { FindingPresentation, VisualHook } from "../../outreach/review-hooks";
import { buildNarrationScript } from "../narration";
import { planSceneTiming } from "../timing";
import { importNarrationAudio } from "../voice";

const hook = (over: Partial<VisualHook>): VisualHook => ({ type: "TEXT_ONLY", primaryValue: null, supportingLabel: null, screenshotRef: null, evidenceExcerpt: null, comparison: null, structure: null, ...over });
const f = (id: string, topic: ReviewFinding["topic"], observation: string, ev: Partial<ReviewFinding["evidence"]> = {}): ReviewFinding => ({
  id, category: "Customer Acquisition", topic, title: `Title ${id}`, observation,
  evidence: { confidence: "Observed", sourceType: "website", sourceUrl: "https://x.com", displayLabel: "x.com · Section", basis: ["b"], observedAt: null, screenshotRef: null, ...ev },
  whyItMatters: "It matters.", whatWedDo: "Audit it.", score: 1,
});
const pres = (findingId: string, textHook: string, visualHook: VisualHook): FindingPresentation => ({ findingId, textHook, title: "T", visualHook });
const start: StartingPoint = { sourceFindingId: "f2", label: "Catalog discovery & navigation pass", intervention: "Audit the catalog.", why: "A large catalog is hard to shop.", proofReference: "x.com · Catalog & navigation" };

function review(n: number): QuickReview {
  const findings = [
    f("f1", "mobile", "On mobile the primary action is off-screen."),
    f("f2", "catalog", "The storefront exposes 19 customer-facing collections, but no filtering."),
    f("f3", "reviews", "The business has 950+ reviews at 4.8★, but none are surfaced.", { confidence: "Reported" }),
  ].slice(0, n);
  const presentations = [
    pres("f1", "The first mobile impression is doing too much work.", hook({ type: "TEXT_ONLY" })),
    pres("f2", "19 ways in. Almost no way to narrow them.", hook({ type: "STRUCTURE", primaryValue: "19", supportingLabel: "customer-facing collections", structure: ["19 collections", "No filters", "Manual browsing"] })),
    pres("f3", "950+ customers already did the hard part.", hook({ type: "COMPARISON", comparison: { left: "950+", leftLabel: "external reviews · 4.8★", right: "0", rightLabel: "surfaced in the crawled pages" } })),
  ].slice(0, n);
  return { businessName: "Urban Americana", industryLabel: "Vintage", location: "Long Beach, CA", website: "urbanamericana.com", brand: null, findings, presentations, openingHook: n ? presentations[Math.min(n - 1, 2)].textHook : null, start: n >= 2 ? start : n === 1 ? { ...start, sourceFindingId: "f1" } : null, status: n >= 2 ? "SENDABLE" : n === 1 ? "NEEDS_REVIEW" : "INSUFFICIENT_EVIDENCE", observations: [], whyItMatters: "", recommendations: [], ready: n >= 2 };
}

describe("review video plan — canonical projection of the review, no invented findings", () => {
  it("has opening + one scene per finding + starting point + close, in order (3 findings)", () => {
    const plan = buildReviewVideoPlan(review(3), { reviewId: "r", leadId: "lead_x" });
    expect(plan.scenes.map((s) => s.type)).toEqual(["OPENING_HOOK", "TEXT", "STRUCTURE", "COMPARISON", "STARTING_POINT", "CLOSE"]);
    expect(plan.provenance.findingIds).toEqual(["f1", "f2", "f3"]);
    expect(plan.rightsState).toBe("PRIVATE_ONLY");
    expect(plan.format).toEqual({ width: 1080, height: 1920, fps: 24 });
    expect(plan.businessId).toBe("lead_x"); // lead association prevents cross-lead mixups
  });
  it("scales to 1 and 2 findings without inventing scenes", () => {
    expect(buildReviewVideoPlan(review(1), { reviewId: "r", leadId: "l" }).scenes.map((s) => s.type)).toEqual(["OPENING_HOOK", "TEXT", "STARTING_POINT", "CLOSE"]);
    expect(buildReviewVideoPlan(review(2), { reviewId: "r", leadId: "l" }).scenes.map((s) => s.type)).toEqual(["OPENING_HOOK", "TEXT", "STRUCTURE", "STARTING_POINT", "CLOSE"]);
  });
  it("the opening scene uses the review's opening hook, and starting point references its source finding", () => {
    const plan = buildReviewVideoPlan(review(3), { reviewId: "r", leadId: "l" });
    expect(plan.scenes[0].headline).toBe("950+ customers already did the hard part.");
    const sp = plan.scenes.find((s) => s.type === "STARTING_POINT")!;
    expect(sp.headline).toBe(start.label);
    expect(sp.evidence?.sourceLabel).toBe(start.proofReference); // proof + label from the same finding
    expect(plan.provenance.startingPointFindingId).toBe("f2");
  });
});

describe("scene-type selection — evidence maps to scene, screenshots never faked", () => {
  it("stat→STAT_REVEAL, structure→STRUCTURE, comparison→COMPARISON, excerpt→EVIDENCE_EXCERPT", () => {
    const mk = (h: VisualHook) => buildReviewVideoPlan({ ...review(1), findings: [f("f1", "catalog", "obs 19 collections")], presentations: [pres("f1", "hook", h)], openingHook: "hook" }, { reviewId: "r", leadId: "l" }).scenes[1].type;
    expect(mk(hook({ type: "STAT", primaryValue: "14", supportingLabel: "x" }))).toBe("STAT_REVEAL");
    expect(mk(hook({ type: "STRUCTURE", primaryValue: "19" }))).toBe("STRUCTURE");
    expect(mk(hook({ type: "COMPARISON", comparison: { left: "9", leftLabel: "a", right: "0", rightLabel: "b" } }))).toBe("COMPARISON");
    expect(mk(hook({ type: "EXCERPT", evidenceExcerpt: "test-old" }))).toBe("EVIDENCE_EXCERPT");
  });
  it("a screenshot hook → SCREENSHOT_FOCUS (or MOBILE_VIEW for mobile); no ref → TEXT fallback (no fake)", () => {
    const withShot = buildReviewVideoPlan({ ...review(1), findings: [f("f1", "mobile", "mobile obs", { screenshotRef: "data:image/png;base64,AA" })], presentations: [pres("f1", "h", hook({ type: "SCREENSHOT", screenshotRef: "data:image/png;base64,AA" }))], openingHook: "h" }, { reviewId: "r", leadId: "l" });
    expect(withShot.scenes[1].type).toBe("MOBILE_VIEW");
    // No screenshot present anywhere → the mobile TEXT_ONLY finding stays a TEXT scene, and its layer
    // layout contains NO image layer (never fabricated).
    const textScene = buildReviewVideoPlan(review(1), { reviewId: "r", leadId: "l" }).scenes[1];
    expect(textScene.type).toBe("TEXT");
    expect(sceneLayers(textScene).some((l) => l.kind === "image")).toBe(false);
  });
});

describe("scene layout — measured values featured, nothing fabricated", () => {
  const plan = buildReviewVideoPlan(review(3), { reviewId: "r", leadId: "l" });
  it("STRUCTURE scene features the measured count and its flow", () => {
    const layers = sceneLayers(plan.scenes.find((s) => s.type === "STRUCTURE")!);
    expect(layers.some((l) => l.text === "19")).toBe(true);
    expect(layers.some((l) => (l.text ?? "").includes("No filters"))).toBe(true);
  });
  it("COMPARISON scene features BOTH measured sides", () => {
    const layers = sceneLayers(plan.scenes.find((s) => s.type === "COMPARISON")!);
    expect(layers.some((l) => l.text === "950+")).toBe(true);
    expect(layers.some((l) => l.text === "0")).toBe(true);
  });
  it("CLOSE scene is Artifex identity with the private marker", () => {
    const layers = sceneLayers(plan.scenes.find((s) => s.type === "CLOSE")!);
    expect(layers.some((l) => l.kind === "mark")).toBe(true);
    expect(layers.some((l) => (l.text ?? "").includes("ARTIFEX"))).toBe(true);
    expect(layers.some((l) => /PRIVATE/i.test(l.text ?? ""))).toBe(true);
  });
});

describe("captions — generated from narration, aligned, non-empty", () => {
  it("produces SRT cues from narration segments and their timings", () => {
    const r = review(3);
    const script = buildNarrationScript(r);
    const audio = importNarrationAudio({ file: "/tmp/x.mp3", durationSeconds: 60, voice: "Lucas" });
    const timings = planSceneTiming(script, audio);
    const srt = buildSrt(script.segments, timings);
    expect(srt).toMatch(/00:00:00,000 --> /);         // starts at zero
    expect(srt).toMatch(/-->/);
    expect(srt.split("\n\n").filter(Boolean).length).toBeGreaterThanOrEqual(4); // opening + 3 findings at least
    expect(srt).toContain("Urban Americana");
  });
});
