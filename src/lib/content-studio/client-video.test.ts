import { describe, it, expect } from "vitest";
import { buildBusinessTemplate } from "./client-video";
import { parseTemplate } from "./template-schema";
import type { QuickReview } from "../outreach/quick-review";

// A realistic Quick Review fixture (evidence shapes match review-hooks). Not crawled — constructed to
// exercise the projection + gate deterministically.
function hook(over: any) {
  return { type: "TEXT_ONLY", primaryValue: null, supportingLabel: null, screenshotRef: null, evidenceExcerpt: null, comparison: null, structure: null, ...over };
}
const eligible = {
  businessName: "Northstar Hospitality",
  status: "SENDABLE",
  openingHook: "Your booking page works — but three things are quietly costing you inquiries.",
  findings: [{}, {}, {}],
  presentations: [
    { title: "Most visitors are on mobile, but there's no mobile booking", visualHook: hook({ type: "STAT", primaryValue: "68%", supportingLabel: "of visits are mobile" }) },
    { title: "Your reviews aren't shown where people decide", visualHook: hook({ type: "COMPARISON", comparison: { left: "4.8★", leftLabel: "Google", right: "none", rightLabel: "On the site" } }) },
    { title: "The contact form asks for too much up front", visualHook: hook({ type: "EXCERPT", evidenceExcerpt: "9 required fields before you can ask a question" }) },
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
