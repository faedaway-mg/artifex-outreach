// Content Studio — PROSPECT/CLIENT video projection. A business video is the SAME data-driven template
// as a Field Note, generated deterministically from a business's evidence (its Quick Review) and BOUND
// to that business. It reuses the approved review-video EVIDENCE + readiness gate (no new scoring, no
// invented claims — every beat traces to a finding). The result renders through the identical engine
// (thumbnail-first, native viewport), so client videos are a real, working path, not a separate stack.

import type { QuickReview } from "../outreach/quick-review";
import type { FindingPresentation } from "../outreach/review-hooks";
import type { ReviewFinding } from "../outreach/review-evidence";
import { reviewVideoReadiness, type ReviewVideoReadiness } from "../review-video/readiness";
import type { Beat, ContentTemplate, NarrationEvidence } from "./template-schema";

function clip(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }

// A screenshot artifact key already resolved for a finding (keyed by finding id), when the screenshot
// worker has captured the supporting page. Passed in by the prepare route; never fabricated here.
export type ScreenshotByFinding = Record<string, string | undefined>;

// Evidence sufficiency (section F, requirement #6/#8): a client video needs at least one SPECIFIC,
// demonstrable finding — not ratings/review-count alone. `reviews` is real context but can't be the
// whole personalization. Insufficient → the caller shows "Needs evidence" and generates NOTHING.
export function hasSufficientEvidence(findings: ReviewFinding[]): boolean {
  const material = findings.filter((f) => f && f.topic !== "reviews");
  return material.some((f) => f.evidence?.confidence === "Observed" || f.evidence?.confidence === "Reported");
}

// Build the receipt for one finding's narration line — the exact provenance the operator UI shows.
function findingEvidence(line: number, f: ReviewFinding, screenshotKey?: string): NarrationEvidence {
  const ev = f.evidence ?? ({} as ReviewFinding["evidence"]);
  return {
    line, kind: "finding",
    confidence: ev.confidence,
    topic: f.topic,
    sourceLabel: ev.displayLabel || undefined,
    sourceUrl: ev.sourceUrl || undefined,
    basis: (ev.basis || []).slice(0, 6).map((b) => String(b).slice(0, 200)),
    observedAt: ev.observedAt || undefined,
    screenshotKey: screenshotKey || ev.screenshotRef || undefined,
  };
}

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
  template: ContentTemplate | null; // null when not eligible / insufficient evidence (and not overridden)
  narrationNote: string;
  evidenceState: "evidence-backed" | "needs-evidence";
  blockedReason?: string;
}

// Build a business video template from a Quick Review. Honors TWO gates, in order:
//   1) the existing readiness/eligibility gate (an ineligible, non-overridable review yields NO template);
//   2) the section-F evidence gate — a review with only ratings/reviews (no specific demonstrable finding)
//      returns evidenceState:"needs-evidence" and NO template. We never synthesize a generic substitute.
// Every material narration line is bound to its finding's evidence in `narrationEvidence`.
export function buildBusinessTemplate(
  review: QuickReview,
  opts: { leadId: string; allowOverride?: boolean; screenshots?: ScreenshotByFinding },
): BusinessTemplateResult {
  const readiness = reviewVideoReadiness(review);
  if (!readiness.eligible && !(readiness.overridable && opts.allowOverride)) {
    return { readiness, template: null, evidenceState: "needs-evidence", blockedReason: readiness.blockers.join("; ") || "not eligible", narrationNote: `Blocked: ${readiness.blockers.join("; ") || "not eligible"}` };
  }

  // Section-F evidence gate: refuse to generate a generic, ratings-only video.
  const findingsFull = review.findings.slice(0, 3);
  if (!hasSufficientEvidence(review.findings) && !opts.allowOverride) {
    return {
      readiness, template: null, evidenceState: "needs-evidence",
      blockedReason: "No specific, demonstrable finding beyond ratings/reviews — needs evidence.",
      narrationNote: "Needs evidence: the review has only rating/review-count signal. Capture the site and re-run before generating.",
    };
  }

  const name = review.businessName || "this business";
  const presentations = review.presentations.slice(0, 3);

  // Narration = the operator's script, assembled from evidence (opening hook → each finding → the
  // recommended starting point → a soft close). One line per beat, in order. Every material line gets a
  // receipt in narrationEvidence; framing lines are marked kind:"framing".
  const narration: string[] = [];
  const beats: Beat[] = [];
  const narrationEvidence: NarrationEvidence[] = [];

  narration.push(clip(review.openingHook || `A quick look at ${name}.`, 200));
  beats.push({ type: "title", lines: [0], mood: "problem", eyebrow: "BUSINESS TECHNOLOGY REVIEW", headline: clip(review.openingHook || name, 120), sub: clip(name, 160) });
  narrationEvidence.push({ line: 0, kind: "framing", basis: ["Synthesizing frame across the findings below"] });

  presentations.forEach((p, i) => {
    const idx = narration.length;
    narration.push(clip(p.title, 200));
    beats.push(findingBeat(p, idx));
    const f = findingsFull[i];
    if (f) narrationEvidence.push(findingEvidence(idx, f, opts.screenshots?.[f.id]));
  });

  const sp = review.start;
  const startIdx = narration.length;
  if (sp) {
    // Prefer the CONCRETE recommended action over generic meta-rationale ("it's the clearest to
    // evidence…"), and if that would duplicate a finding line, anchor to the specific starting point.
    const spText = clip(sp.intervention || sp.why || sp.label, 200);
    const dup = narration.some((l) => l.toLowerCase() === spText.toLowerCase());
    narration.push(dup ? clip(`Where we'd start: ${sp.label.toLowerCase()}.`, 200) : spText);
    beats.push({ type: "chain", lines: [startIdx], mood: "turn", caption: "WHERE WE'D START", nodes: [
      { label: "TODAY", state: "gap" },
      { label: clip(sp.label.toUpperCase(), 24), state: "on" },
      { label: "RESULT", state: "on" },
    ] });
    const src = findingsFull.find((f) => f.id === sp.sourceFindingId);
    narrationEvidence.push({
      line: startIdx, kind: "starting-point",
      confidence: src?.evidence.confidence, topic: src?.topic,
      sourceLabel: src?.evidence.displayLabel || sp.proofReference || undefined,
      sourceUrl: src?.evidence.sourceUrl || undefined,
      basis: [sp.proofReference, ...(src?.evidence.basis ?? [])].filter(Boolean).slice(0, 6).map((b) => String(b).slice(0, 200)),
      screenshotKey: (src && opts.screenshots?.[src.id]) || src?.evidence.screenshotRef || undefined,
    });
  }

  const closeIdx = narration.length;
  narration.push("Happy to walk you through it — no obligation.");
  beats.push({ type: "brand", lines: [closeIdx], mood: "resolve", tagline: "A focused review from Artifex Labs." });
  narrationEvidence.push({ line: closeIdx, kind: "framing", basis: ["Standard no-obligation close"] });

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
      rows: presentations.slice(0, 3).map((p) => ({ label: clip(p.title, 24), value: p.visualHook.primaryValue ? clip(p.visualHook.primaryValue, 40) : "reviewed" })),
    },
    narrationEvidence,
    evidenceState: "evidence-backed",
    revision: 1,
  };
  return { readiness, template, evidenceState: "evidence-backed", narrationNote: `Script assembled from ${presentations.length} evidence-backed finding(s) + starting point; every material line bound to its source.` };
}
