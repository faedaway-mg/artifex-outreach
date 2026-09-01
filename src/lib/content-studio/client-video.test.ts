import { describe, it, expect } from "vitest";
import { buildBusinessTemplate, hasSufficientEvidence } from "./client-video";
import { parseTemplate } from "./template-schema";
import type { QuickReview } from "../outreach/quick-review";
import type { ReviewFinding } from "../outreach/review-evidence";

// A realistic Quick Review fixture (evidence shapes match review-hooks). Not crawled — constructed to
// exercise the projection + gate deterministically. Findings now carry REAL evidence (section F binds it).
function hook(over: any) {
  return { type: "TEXT_ONLY", primaryValue: null, supportingLabel: null, screenshotRef: null, evidenceExcerpt: null, comparison: null, structure: null, ...over };
}
function finding(id: string, topic: ReviewFinding["topic"], title: string, ev: Partial<ReviewFinding["evidence"]> = {}): ReviewFinding {
  return {
    id, category: "Customer Acquisition", topic, title, observation: `${title} — observed`,
    evidence: { confidence: "Observed", sourceType: "website", sourceUrl: "https://northstar.example/x", displayLabel: "northstar.example · Section", basis: ["basis line"], observedAt: "2026-08-01T00:00:00Z", screenshotRef: null, ...ev },
    whyItMatters: "It matters.", whatWedDo: "We'd fix it.", score: 1,
  };
}
const findingsFull: ReviewFinding[] = [
  finding("f1", "mobile", "Most visitors are on mobile, but there's no mobile booking"),
  finding("f2", "reviews", "Your reviews aren't shown where people decide"),
  finding("f3", "copy", "The contact form asks for too much up front"),
];
const eligible = {
  businessName: "Northstar Hospitality",
  status: "SENDABLE",
  openingHook: "Your booking page works — but three things are quietly costing you inquiries.",
  findings: findingsFull,
  presentations: [
    { findingId: "f1", title: "Most visitors are on mobile, but there's no mobile booking", visualHook: hook({ type: "STAT", primaryValue: "68%", supportingLabel: "of visits are mobile" }) },
    { findingId: "f2", title: "Your reviews aren't shown where people decide", visualHook: hook({ type: "COMPARISON", comparison: { left: "4.8★", leftLabel: "Google", right: "none", rightLabel: "On the site" } }) },
    { findingId: "f3", title: "The contact form asks for too much up front", visualHook: hook({ type: "EXCERPT", evidenceExcerpt: "9 required fields before you can ask a question" }) },
  ],
  start: { label: "Mobile booking", intervention: "Add a one-tap booking flow", why: "Start where most visitors already are — on mobile.", proofReference: "68% mobile", sourceFindingId: "f1" },
} as unknown as QuickReview;

describe("buildBusinessTemplate", () => {
  it("projects an eligible review into a valid, business-bound template", () => {
    const { template, readiness } = buildBusinessTemplate(eligible, { leadId: "lead_abc123" });
    expect(readiness.eligible).toBe(true);
    expect(template).not.toBeNull();
    expect(template!.businessId).toBe("lead_abc123");
    expect(template!.id).toBe("client-lead_abc123");
    const parsed = parseTemplate(template);
    expect(parsed.ok).toBe(true); // renders through the SAME validated engine
    // title + 3 findings + starting-point chain + brand, one narration line each
    expect(template!.beats.length).toBe(6);
    expect(template!.narration.length).toBe(template!.beats.length);
    expect(template!.beats[0].type).toBe("title");
    expect(template!.beats[template!.beats.length - 1].type).toBe("brand");
    // the COMPARISON finding became a cards beat (its two measured sides)
    expect(template!.beats.some((b) => b.type === "cards")).toBe(true);
  });

  it("does NOT weaken the gate: a NEEDS_REVIEW (one-finding) review is blocked, no template", () => {
    const weak = { ...eligible, status: "NEEDS_REVIEW", findings: [{}], presentations: eligible.presentations.slice(0, 1) } as unknown as QuickReview;
    const res = buildBusinessTemplate(weak, { leadId: "lead_weak" });
    expect(res.template).toBeNull();
    expect(res.readiness.overridable).toBe(true);
    expect(res.narrationNote).toMatch(/Blocked/);
  });

  it("an INSUFFICIENT_EVIDENCE review is never eligible and never overridable", () => {
    const none = { ...eligible, status: "INSUFFICIENT_EVIDENCE", findings: [], presentations: [], openingHook: null } as unknown as QuickReview;
    const res = buildBusinessTemplate(none, { leadId: "lead_none", allowOverride: true });
    expect(res.template).toBeNull();
    expect(res.readiness.eligible).toBe(false);
  });

  it("respects an operator override for a NEEDS_REVIEW review", () => {
    const weak = { ...eligible, status: "NEEDS_REVIEW", findings: [{}], presentations: eligible.presentations.slice(0, 1) } as unknown as QuickReview;
    const res = buildBusinessTemplate(weak, { leadId: "lead_ovr", allowOverride: true });
    expect(res.template).not.toBeNull();
    expect(parseTemplate(res.template).ok).toBe(true);
  });
});

describe("evidence-led scripts (section F)", () => {
  it("binds every MATERIAL narration line to its finding's evidence; framing lines are marked", () => {
    const { template } = buildBusinessTemplate(eligible, { leadId: "lead_ev" });
    expect(template).not.toBeNull();
    expect(template!.evidenceState).toBe("evidence-backed");
    const ev = template!.narrationEvidence!;
    // one evidence entry per narration line
    expect(ev.length).toBe(template!.narration.length);
    // opening + close are framing; the 3 findings + starting point are material with a source
    expect(ev.filter((e) => e.kind === "framing").length).toBe(2);
    const material = ev.filter((e) => e.kind === "finding" || e.kind === "starting-point");
    expect(material.length).toBe(4);
    for (const e of material) expect(e.confidence || (e.basis && e.basis.length > 0)).toBeTruthy();
    // the first finding line names the mobile topic + its confidence
    const f1 = ev.find((e) => e.topic === "mobile");
    expect(f1?.confidence).toBe("Observed");
    expect(parseTemplate(template).ok).toBe(true);
  });

  it("REFUSES to generate when the only signal is ratings/reviews — needs evidence, no generic substitute", () => {
    const reviewsOnly = {
      ...eligible,
      findings: [finding("r1", "reviews", "4.8★ with 950 reviews", { confidence: "Reported" })],
      presentations: [{ findingId: "r1", title: "4.8★ with 950 reviews", visualHook: hook({ type: "COMPARISON", comparison: { left: "950+", leftLabel: "Google", right: "0", rightLabel: "On the site" } }) }],
      start: null,
    } as unknown as QuickReview;
    const res = buildBusinessTemplate(reviewsOnly, { leadId: "lead_thin" });
    expect(res.template).toBeNull();
    expect(res.evidenceState).toBe("needs-evidence");
    expect(res.narrationNote).toMatch(/[Nn]eeds evidence/);
  });

  it("carries a resolved screenshot key onto the finding line it supports", () => {
    const key = "content-studio/production/poster/csshot_x/abc.png";
    const { template } = buildBusinessTemplate(eligible, { leadId: "lead_shot", screenshots: { f1: key } });
    const shotLine = template!.narrationEvidence!.find((e) => e.topic === "mobile");
    expect(shotLine?.screenshotKey).toBe(key);
  });

  it("hasSufficientEvidence: reviews-only is insufficient; a demonstrable finding is sufficient", () => {
    expect(hasSufficientEvidence([finding("r", "reviews", "reviews only")])).toBe(false);
    expect(hasSufficientEvidence([finding("m", "mobile", "no mobile booking")])).toBe(true);
    // a demonstrable finding but only "Likely" confidence is not enough
    expect(hasSufficientEvidence([finding("c", "copy", "draft copy", { confidence: "Likely" })])).toBe(false);
  });
});
