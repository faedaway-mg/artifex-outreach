// Page-plan projection (M2) — two-line editorial hooks + scene data for the content-grade renderer.
import { describe, it, expect } from "vitest";
import { splitHook, buildScenePlan, type PageSurface } from "./scene-plan";
import { buildReviewVideoPlan } from "./plan";
import { buildSchedule } from "./motion";
import type { QuickReview } from "../../outreach/quick-review";
import type { ReviewFinding, StartingPoint } from "../../outreach/review-evidence";
import type { FindingPresentation, VisualHook } from "../../outreach/review-hooks";

const hook = (over: Partial<VisualHook>): VisualHook => ({ type: "TEXT_ONLY", primaryValue: null, supportingLabel: null, screenshotRef: null, evidenceExcerpt: null, comparison: null, structure: null, ...over });
const f = (id: string, topic: ReviewFinding["topic"], observation: string): ReviewFinding => ({ id, category: "Customer Acquisition", topic, title: `T ${id}`, observation, evidence: { confidence: "Observed", sourceType: "website", sourceUrl: "u", displayLabel: "urbanamericana.com · S", basis: ["b"], observedAt: null, screenshotRef: null }, whyItMatters: "w", whatWedDo: "Audit it.", score: 1 });
const pres = (findingId: string, textHook: string, visualHook: VisualHook): FindingPresentation => ({ findingId, textHook, title: "T", visualHook });
const start: StartingPoint = { sourceFindingId: "f2", label: "Catalog discovery & navigation pass", intervention: "Audit.", why: "A large catalog is hard to shop.", proofReference: "urbanamericana.com · Catalog & navigation" };
const review: QuickReview = {
  businessName: "Urban Americana", industryLabel: "V", location: "L", website: "u", brand: null,
  findings: [f("f1", "mobile", "On mobile the primary action is off-screen."), f("f2", "catalog", "The storefront exposes 19 customer-facing collections, but no filtering."), f("f3", "reviews", "The business has 950+ reviews at 4.8★, but none surfaced.")],
  presentations: [pres("f1", "The first mobile impression is doing too much work.", hook({ type: "TEXT_ONLY" })), pres("f2", "19 ways in. Almost no way to narrow them.", hook({ type: "STRUCTURE", primaryValue: "19", supportingLabel: "customer-facing collections", structure: ["19 collections", "No filters", "Manual"] })), pres("f3", "950+ customers already did the hard part.", hook({ type: "COMPARISON", comparison: { left: "950+", leftLabel: "external reviews · 4.8★", right: "0", rightLabel: "surfaced in the crawled pages" } }))],
  openingHook: "950+ customers already did the hard part.", start, status: "SENDABLE", observations: [], whyItMatters: "", recommendations: [], ready: true,
};

describe("splitHook — two-line editorial statements", () => {
  it("splits on the first sentence break", () => {
    expect(splitHook("19 ways in. Almost no way to narrow them.")).toEqual({ l1: "19 ways in.", l2: "Almost no way to narrow them." });
  });
  it("keeps a single short line intact", () => {
    expect(splitHook("The name shows up twice.")).toEqual({ l1: "The name shows up twice.", l2: "" });
  });
  it("wraps a long no-break line near the middle on a word boundary", () => {
    const r = splitHook("a very long hook line with no sentence break that should wrap somewhere sensible");
    expect(r.l2.length).toBeGreaterThan(0);
    expect(`${r.l1} ${r.l2}`).toBe("a very long hook line with no sentence break that should wrap somewhere sensible");
  });
});

describe("buildScenePlan — content-grade scene projection", () => {
  const plan = buildReviewVideoPlan(review, { reviewId: "rv", leadId: "lead_A", targetSeconds: 60 });
  const schedule = buildSchedule(plan.scenes.map((s) => s.id), plan.scenes.map((s) => Math.max(2.6, s.provisionalSec)));
  const sf = (src: string, kind: "desktop" | "mobile", focalY: number, mode: PageSurface["mode"]): PageSurface => ({ src, kind, focalY, mode, scaleStart: mode === "EVIDENCE_FRAME" ? 1.0 : 1.03, scaleEnd: mode === "EVIDENCE_FRAME" ? 1.16 : 1.08, focusStart: mode === "EVIDENCE_FRAME" ? 0.55 : 0, originX: 0.5, originY: focalY });
  const surfaces: Record<string, PageSurface> = { opening: sf("file:///d.png", "desktop", 0.25, "CINEMATIC_CROP"), "finding-01": sf("file:///m.png", "mobile", 0.3, "EVIDENCE_FRAME"), "finding-02": sf("file:///d.png", "desktop", 0.6, "EVIDENCE_FRAME") };
  const page = buildScenePlan(review, plan, schedule, surfaces);

  it("opening carries the business name + a two-line hook + its surface", () => {
    const o = page.scenes.find((s) => s.id === "opening")!;
    expect(o.businessName).toBe("Urban Americana");
    expect(o.hook?.l1).toBe("950+ customers already did the hard part.");
    expect(o.surface?.kind).toBe("desktop");
  });
  it("the catalog scene features the measured value + label + surface", () => {
    const c = page.scenes.find((s) => s.id === "finding-02")!;
    expect(c.type).toBe("STRUCTURE");
    expect(c.value).toBe("19");
    expect(c.label).toBe("CUSTOMER-FACING COLLECTIONS");
    expect(c.surface?.focalY).toBeCloseTo(0.6);
  });
  it("the proof scene carries both comparison sides", () => {
    const p = page.scenes.find((s) => s.id === "finding-03")!;
    expect(p.type).toBe("COMPARISON");
    expect(p.cmp?.left).toBe("950+");
    expect(p.cmp?.right).toBe("0");
  });
  it("the starting point is a quiet payoff with label + why + proof, no surface", () => {
    const sp = page.scenes.find((s) => s.type === "STARTING_POINT")!;
    expect(sp.label).toBe(start.label);
    expect(sp.why).toBe(start.why);
    expect(sp.proof).toMatch(/Proof · /);
    expect(sp.surface).toBeNull();
  });
  it("every scene has a time window and they are ordered", () => {
    for (const s of page.scenes) { expect(s.end).toBeGreaterThan(s.start); }
    for (let i = 1; i < page.scenes.length; i++) expect(page.scenes[i].start).toBeGreaterThanOrEqual(page.scenes[i - 1].start);
    expect(page.total).toBeGreaterThan(0);
  });
});
