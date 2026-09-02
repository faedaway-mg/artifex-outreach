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
import { composeClientNarration, assessScriptQuality, type ComposedNarration } from "./client-narration";
import type { ObservedFinding } from "./site-evidence";

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

// Build the narration + beats + per-line receipts from a value-dense composed script (client-narration.ts).
// The six-beat script REPLACES the terse finding-title narration, but the material lines stay bound to the
// same evidence: the FRICTION beat is the finding (screenshot-backed), the SOLUTION beat is the starting
// point. Framing beats (hook/consequence/value/close) carry no claim. Keeps the evidence gate satisfied.
function buildFromComposed(
  composed: ComposedNarration,
  review: QuickReview,
  screenshots?: ScreenshotByFinding,
): { narration: string[]; beats: Beat[]; narrationEvidence: NarrationEvidence[] } {
  const finding = review.findings[0];
  const presentation = review.presentations[0];
  const sp = review.start;
  const narration: string[] = [];
  const beats: Beat[] = [];
  const narrationEvidence: NarrationEvidence[] = [];

  for (const line of composed.lines) {
    const idx = narration.length;
    narration.push(clip(line.text, 200));
    switch (line.role) {
      case "hook":
        beats.push({ type: "title", lines: [idx], mood: "problem", eyebrow: "BUSINESS TECHNOLOGY REVIEW", headline: clip(review.openingHook || review.businessName || "A quick look", 120), sub: clip(review.businessName || "", 160) });
        narrationEvidence.push({ line: idx, kind: "framing", basis: ["Opening — the customer moment this review is about"] });
        break;
      case "friction":
        // The one MATERIAL finding beat — its interior evidence frame proves it. Bound to the finding's
        // evidence + the SHA-verified screenshot, exactly as the non-composed path binds finding lines.
        beats.push(presentation ? findingBeat(presentation, idx) : { type: "statement", lines: [idx], mood: "problem", text: clip(line.text, 160), size: "h2" });
        narrationEvidence.push(finding ? findingEvidence(idx, finding, screenshots?.[finding.id]) : { line: idx, kind: "finding", basis: [clip(line.text, 200)] });
        break;
      case "consequence":
        beats.push({ type: "statement", lines: [idx], mood: "problem", text: clip(line.text, 160), size: "h3" });
        narrationEvidence.push({ line: idx, kind: "framing", basis: ["Consequence — assessed impact of the finding above"] });
        break;
      case "solution": {
        beats.push({ type: "chain", lines: [idx], mood: "turn", caption: "WHERE WE'D START", nodes: [
          { label: "TODAY", state: "gap" },
          { label: clip((sp?.label || "THE FIX").toUpperCase(), 24), state: "on" },
          { label: "RESULT", state: "on" },
        ] });
        const src = review.findings.find((ff) => ff.id === sp?.sourceFindingId) ?? finding;
        narrationEvidence.push({
          line: idx, kind: "starting-point",
          confidence: src?.evidence.confidence, topic: src?.topic,
          sourceLabel: src?.evidence.displayLabel || sp?.proofReference || undefined,
          sourceUrl: src?.evidence.sourceUrl || undefined,
          basis: [sp?.proofReference, ...(src?.evidence.basis ?? [])].filter(Boolean).slice(0, 6).map((b) => String(b).slice(0, 200)),
          screenshotKey: (src && screenshots?.[src.id]) || src?.evidence.screenshotRef || undefined,
        });
        break;
      }
      case "value":
        beats.push({ type: "statement", lines: [idx], mood: "resolve", text: clip(line.text, 160), size: "h3" });
        narrationEvidence.push({ line: idx, kind: "framing", basis: ["Practical value — how the change helps customers"] });
        break;
      case "close":
        beats.push({ type: "brand", lines: [idx], mood: "resolve", tagline: "A focused review from Artifex Labs." });
        narrationEvidence.push({ line: idx, kind: "framing", basis: ["Credible close — a concrete Artifex offer"] });
        break;
    }
  }
  return { narration, beats, narrationEvidence };
}

// Lower-case the first letter and drop a trailing period, so a topic intervention ("Rework the mobile
// layout…") reads correctly after the composer's "We'd " prefix ("We'd rework the mobile layout…").
function normalizeRecommendation(s: string): string {
  let r = (s || "").trim().replace(/\s*\.\s*$/, "");
  if (r) r = r.charAt(0).toLowerCase() + r.slice(1);
  return r;
}

// Reconstruct a directly-observed finding from the review's strongest MATERIAL finding, so the
// value-dense composer can run in the HTTP prepare path WITHOUT re-capturing the site (a re-capture
// would mint a NEW screenshot SHA and break the existing evidence binding). Everything the composer
// references is read back from the finding itself: the exact page count from the observation/basis, the
// way the business can currently be reached, the booking noun from the industry, and the recommendation
// from the review engine's topic intervention. Returns null when there's no material observed finding.
export function reviewToObservedFinding(review: QuickReview, industry?: string | null): ObservedFinding | null {
  const f = review.findings.find((x) => x.topic !== "reviews" && (x.evidence?.confidence === "Observed" || x.evidence?.confidence === "Reported"));
  if (!f) return null;
  const obs = f.observation || "";
  const hay = obs + " " + (f.evidence?.basis || []).join(" ");
  const pageMatch = hay.match(/(?:any of the\s+)?(\d+)\s+(?:inspected\s+)?pages|(\d+)\s+inspected/i);
  const inspected = pageMatch ? Number(pageMatch[1] || pageMatch[2]) : 0;
  const ind = (industry || review.industryLabel || "").toLowerCase();
  const serviceWord = /massage/.test(ind) || /massage/.test(obs) ? "massage"
    : /salon|spa|hair|nail|barber|beauty/.test(ind) ? "visit"
    : "appointment";
  const hasPhone = /phone/i.test(obs), hasMail = /email/i.test(obs);
  const reach = hasPhone && hasMail ? "a phone number and an email address" : hasMail && !hasPhone ? "an email address" : "a phone number";
  return {
    key: f.id,
    topic: f.topic as unknown as ObservedFinding["topic"],
    category: f.category,
    impactLevel: (f.impactLevel === "High" ? "High" : "Moderate") as ObservedFinding["impactLevel"],
    observation: obs,
    whyItMatters: f.whyItMatters || "",
    basis: f.evidence?.basis || [],
    reproduction: [],
    sourcePageUrl: f.evidence?.sourceUrl || review.website || "",
    sourcePageTitle: "Homepage",
    recommendation: normalizeRecommendation(f.whatWedDo || ""),
    details: {
      inspected,
      serviceWord,
      reach,
      kind: /viewport/i.test(obs) ? "no-viewport" : /scroll|overflow|past the edge/i.test(obs) ? "overflow" : "no-viewport",
    },
  };
}

// The value-dense six-beat narration for the review's strongest observed finding, or null if there is
// no material finding OR the composed script fails the section-E quality gate. The HTTP prepare route
// uses this so operator regeneration is evidence-led — never the terse finding-title fallback.
export function composeReviewNarration(review: QuickReview, industry?: string | null): ComposedNarration | null {
  const of = reviewToObservedFinding(review, industry);
  if (!of) return null;
  const composed = composeClientNarration(of, review.businessName || "this business");
  return assessScriptQuality(composed).ok ? composed : null;
}

// Build a business video template from a Quick Review. Honors TWO gates, in order:
//   1) the existing readiness/eligibility gate (an ineligible, non-overridable review yields NO template);
//   2) the section-F evidence gate — a review with only ratings/reviews (no specific demonstrable finding)
//      returns evidenceState:"needs-evidence" and NO template. We never synthesize a generic substitute.
// Every material narration line is bound to its finding's evidence in `narrationEvidence`.
export function buildBusinessTemplate(
  review: QuickReview,
  opts: { leadId: string; allowOverride?: boolean; screenshots?: ScreenshotByFinding; composedNarration?: ComposedNarration | null },
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

  // Value-dense path (narration-quality mandate): when a composed six-beat script is supplied, it REPLACES
  // the terse finding-title narration while keeping every material line bound to the same evidence.
  if (opts.composedNarration) {
    const { narration, beats, narrationEvidence } = buildFromComposed(opts.composedNarration, review, opts.screenshots);
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
    return { readiness, template, evidenceState: "evidence-backed", narrationNote: `Value-dense script (${opts.composedNarration.wordCount} words, ${opts.composedNarration.lines.length} beats) — hook → friction → consequence → solution → value → close; friction bound to the finding, solution to the starting point.` };
  }

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
