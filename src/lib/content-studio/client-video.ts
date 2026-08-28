// Content Studio — PROSPECT/CLIENT video projection. A business video is the SAME data-driven template
// as a Field Note, generated deterministically from a business's evidence (its Quick Review) and BOUND
// to that business. It reuses the approved review-video EVIDENCE + readiness gate (no new scoring, no
// invented claims — every beat traces to a finding). The result renders through the identical engine
// (thumbnail-first, native viewport), so client videos are a real, working path, not a separate stack.

import type { QuickReview } from "../outreach/quick-review";
import type { FindingPresentation } from "../outreach/review-hooks";
import { reviewVideoReadiness, type ReviewVideoReadiness } from "../review-video/readiness";
import type { Beat, ContentTemplate } from "./template-schema";

function clip(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }

// Turn one finding presentation into the strongest bounded beat its evidence supports.
function findingBeat(p: FindingPresentation, lineIdx: number): Beat {
  const v = p.visualHook;
  if (v.type === "COMPARISON" && v.comparison) {
    const c = v.comparison;
    return { type: "cards", lines: [lineIdx], mood: "problem", items: [
      { label: clip(c.leftLabel, 24), name: clip(c.left, 40) },
      { label: clip(c.rightLabel, 24), name: clip(c.right, 40) },
    ] };
  }
  if ((v.type === "STRUCTURE" || v.type === "STAT") && v.primaryValue) {
    const rows = v.type === "STRUCTURE" && v.structure?.length
      ? v.structure.slice(0, 3).map((s, i) => ({ label: i === 0 ? "FOUND" : "·", value: clip(s, 40) }))
      : [{ label: clip(v.supportingLabel || "MEASURED", 24), value: clip(v.primaryValue, 40) }];
    return { type: "surface", lines: [lineIdx], mood: "problem", barLabel: clip(p.title, 40), barIcon: "▦", tone: "neutral", rows };
  }
  if (v.type === "EXCERPT" && v.evidenceExcerpt) {
    return { type: "surface", lines: [lineIdx], mood: "problem", barLabel: clip(p.title, 40), barIcon: "“", rows: [{ label: "ON THE PAGE", value: clip(v.evidenceExcerpt, 60) }] };
  }
  // SCREENSHOT / TEXT_ONLY → a clear statement of the finding (still evidence-derived text).
  return { type: "statement", lines: [lineIdx], mood: "problem", text: clip(p.title, 160), size: "h2" };
}

export interface BusinessTemplateResult {
  readiness: ReviewVideoReadiness;
  template: ContentTemplate | null; // null when not eligible (and not overridden)
  narrationNote: string;
}

// Build a business video template from a Quick Review. Honors the eligibility gate: an ineligible,
// non-overridable review yields NO template (template=null) with the blocker reasons preserved.
export function buildBusinessTemplate(
  review: QuickReview,
  opts: { leadId: string; allowOverride?: boolean },
): BusinessTemplateResult {
  const readiness = reviewVideoReadiness(review);
  if (!readiness.eligible && !(readiness.overridable && opts.allowOverride)) {
    return { readiness, template: null, narrationNote: `Blocked: ${readiness.blockers.join("; ") || "not eligible"}` };
  }

  const name = review.businessName || "this business";
  const findings = review.presentations.slice(0, 3);

  // Narration = the operator's script, assembled from evidence (opening hook → each finding → the
  // recommended starting point → a soft close). One line per beat, in order.
  const narration: string[] = [];
  const beats: Beat[] = [];

  narration.push(clip(review.openingHook || `A quick look at ${name}.`, 200));
  beats.push({ type: "title", lines: [0], mood: "problem", eyebrow: "BUSINESS TECHNOLOGY REVIEW", headline: clip(review.openingHook || name, 120), sub: clip(name, 160) });

  findings.forEach((p) => {
    const idx = narration.length;
    narration.push(clip(p.title, 200));
    beats.push(findingBeat(p, idx));
  });

  const sp = review.start;
  const startIdx = narration.length;
  if (sp) {
    narration.push(clip(sp.why || sp.intervention, 200));
    beats.push({ type: "chain", lines: [startIdx], mood: "turn", caption: "WHERE WE'D START", nodes: [
      { label: "TODAY", state: "gap" },
      { label: clip(sp.label.toUpperCase(), 24), state: "on" },
      { label: "RESULT", state: "on" },
    ] });
  }

  const closeIdx = narration.length;
  narration.push("Happy to walk you through it — no obligation.");
  beats.push({ type: "brand", lines: [closeIdx], mood: "resolve", tagline: "A focused review from Artifex Labs." });

  const template: ContentTemplate = {
    version: 1,
    id: `client-${opts.leadId}`.replace(/[^0-9a-z_-]/gi, "-").slice(0, 40),
    title: clip(`${name} — review`, 80),
    concept: clip(review.openingHook || `Evidence-backed review for ${name}`, 120),
    businessId: opts.leadId,
    businessName: name,
    seed: 20260200,
    narration,
    beats,
    thumbnail: {
      headline: [clip(name, 24)],
      secondary: clip(review.openingHook || "Business technology review", 60),
      art: "statusCard",
      rows: findings.slice(0, 3).map((p) => ({ label: clip(p.title, 24), value: p.visualHook.primaryValue ? clip(p.visualHook.primaryValue, 40) : "reviewed" })),
    },
  };
  return { readiness, template, narrationNote: `Script assembled from ${findings.length} evidence-backed finding(s) + starting point.` };
}
