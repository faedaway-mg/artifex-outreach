// Review Video pilot — pure logic: eligibility, job state machine, Lucas batch matching/validation,
// and pilot-summary aggregation. Deterministic; no store, no I/O.
import { describe, it, expect } from "vitest";
import { reviewVideoReadiness, rankCandidates } from "./readiness";
import { canTransition, transition, allowedTransitions, nextAction } from "./job-state";
import { expectedAudioFilename, matchAudioToJobs, jobIdFromFilename, validateAudioDuration, buildLucasBatch } from "./lucas-batch";
import { summarizePilot } from "./measurement";
import type { QuickReview } from "../outreach/quick-review";
import type { ReviewFinding } from "../outreach/review-evidence";
import type { FindingPresentation, VisualHook } from "../outreach/review-hooks";
import type { ReviewVideoJob } from "../types";

const vh = (type: VisualHook["type"]): VisualHook => ({ type, primaryValue: null, supportingLabel: null, screenshotRef: null, evidenceExcerpt: null, comparison: null, structure: null });
const f = (id: string): ReviewFinding => ({ id, category: "Customer Acquisition", topic: "catalog", title: "T", observation: "o", evidence: { confidence: "Observed", sourceType: "website", sourceUrl: null, displayLabel: "d", basis: ["b"], observedAt: null, screenshotRef: null }, whyItMatters: "w", whatWedDo: "Audit it.", score: 1 });
const p = (findingId: string, t: VisualHook["type"]): FindingPresentation => ({ findingId, textHook: "h", title: "T", visualHook: vh(t) });
const review = (over: Partial<QuickReview>): QuickReview => ({ businessName: "B", industryLabel: "", location: "", website: "b.com", brand: null, findings: [], presentations: [], openingHook: "hook", start: null, status: "SENDABLE", observations: [], whyItMatters: "", recommendations: [], ready: true, ...over });

describe("eligibility / readiness", () => {
  it("a SENDABLE 3-finding review with quantitative hooks is a STRONG, eligible candidate", () => {
    const r = reviewVideoReadiness(review({ status: "SENDABLE", findings: [f("a"), f("b"), f("c")], presentations: [p("a", "TEXT_ONLY"), p("b", "STRUCTURE"), p("c", "COMPARISON")] }));
    expect(r.eligible).toBe(true); expect(r.readiness).toBe("STRONG"); expect(r.quantitativeHookCount).toBe(2); expect(r.visualEvidenceCount).toBe(2);
  });
  it("a SENDABLE 2-finding review with one quant hook is READY + eligible", () => {
    const r = reviewVideoReadiness(review({ status: "SENDABLE", findings: [f("a"), f("b")], presentations: [p("a", "TEXT_ONLY"), p("b", "STAT")] }));
    expect(r.eligible).toBe(true); expect(["READY", "STRONG"]).toContain(r.readiness);
  });
  it("NEEDS_REVIEW is NOT eligible for the default batch but IS overridable", () => {
    const r = reviewVideoReadiness(review({ status: "NEEDS_REVIEW", findings: [f("a")], presentations: [p("a", "TEXT_ONLY")] }));
    expect(r.eligible).toBe(false); expect(r.overridable).toBe(true); expect(r.readiness).toBe("NEEDS_REVIEW");
  });
  it("INSUFFICIENT_EVIDENCE is never eligible and not overridable", () => {
    const r = reviewVideoReadiness(review({ status: "INSUFFICIENT_EVIDENCE", findings: [], presentations: [] }));
    expect(r.eligible).toBe(false); expect(r.overridable).toBe(false); expect(r.readiness).toBe("NOT_ENOUGH_EVIDENCE");
  });
  it("ranks STRONG before READY before NEEDS_REVIEW", () => {
    const mk = (rd: any) => ({ readiness: rd });
    const ranked = rankCandidates([mk(reviewVideoReadiness(review({ status: "NEEDS_REVIEW", findings: [f("a")], presentations: [p("a", "TEXT_ONLY")] }))), mk(reviewVideoReadiness(review({ status: "SENDABLE", findings: [f("a"), f("b"), f("c")], presentations: [p("a", "STAT"), p("b", "STRUCTURE"), p("c", "COMPARISON")] })))]);
    expect(ranked[0].readiness.readiness).toBe("STRONG");
  });
});

describe("job state machine", () => {
  it("walks the happy path and rejects skips", () => {
    expect(canTransition("PLANNING", "RENDERING_VISUAL")).toBe(true);
    expect(canTransition("RENDERING_VISUAL", "LUCAS_REQUIRED")).toBe(true);
    expect(canTransition("LUCAS_REQUIRED", "READY_FOR_REVIEW")).toBe(false); // can't skip audio+final
    expect(canTransition("READY_FOR_REVIEW", "DELIVERY_READY")).toBe(false); // must be approved first
  });
  it("READY_FOR_REVIEW → APPROVED_PRIVATE is required before delivery (approve ≠ rendered)", () => {
    expect(canTransition("READY_FOR_REVIEW", "APPROVED_PRIVATE")).toBe(true);
    expect(canTransition("APPROVED_PRIVATE", "DELIVERY_READY")).toBe(true);
    const patch = transition({ status: "READY_FOR_REVIEW" }, "APPROVED_PRIVATE");
    expect(patch.status).toBe("APPROVED_PRIVATE"); expect(patch.approvedAt).toBeTruthy();
  });
  it("any active stage can FAIL and retry back to a re-runnable stage", () => {
    expect(allowedTransitions("RENDERING_FINAL")).toContain("FAILED");
    expect(canTransition("FAILED", "RENDERING_FINAL")).toBe(true);
    const patch = transition({ status: "RENDERING_FINAL" }, "FAILED", { stage: "final", message: "mux error" });
    expect(patch.failure?.message).toBe("mux error");
    expect(transition({ status: "FAILED" }, "AUDIO_IMPORTED").failure).toBeNull();
  });
  it("throws on an impossible transition", () => {
    expect(() => transition({ status: "PLANNING" }, "DELIVERY_READY")).toThrow(/invalid/);
  });
  it("nextAction distinguishes review from approval", () => {
    expect(nextAction("READY_FOR_REVIEW")).toMatch(/preview|approve/i);
    expect(nextAction("LUCAS_REQUIRED")).toMatch(/lucas/i);
  });
});

describe("Lucas batch handoff — safe matching", () => {
  const job = (id: string, status: ReviewVideoJob["status"], name = "Urban Americana"): ReviewVideoJob => ({ id, leadId: "l-" + id, reviewId: "rv-" + id, batchId: null, status, rightsState: "PRIVATE_ONLY", targetSeconds: 60, narrationWords: 150, expectedAudioFilename: expectedAudioFilename(name, id), planKey: null, narrationKey: null, captionsKey: null, previewKey: null, audioKey: null, audioDurationSeconds: null, finalKey: null, finalDurationSeconds: null, findingIds: [], approvedAt: null, failure: null, attemptCount: 0, lastAttemptAt: null, leaseUntil: null, renderVersion: null, approvedVersion: null, createdAt: "", updatedAt: "" });

  it("expected filenames embed the job id (unique across same-named businesses)", () => {
    expect(expectedAudioFilename("Urban Americana", "rvjob_A")).toContain("rvjob_A");
    expect(expectedAudioFilename("Urban Americana", "rvjob_A")).not.toBe(expectedAudioFilename("Urban Americana", "rvjob_B"));
  });
  it("builds a handoff item only for LUCAS_REQUIRED jobs", () => {
    const items = buildLucasBatch([{ job: job("A", "LUCAS_REQUIRED"), businessName: "Urban Americana", copyBlock: "script A" }, { job: job("B", "PLANNING"), businessName: "B", copyBlock: "x" }]);
    expect(items).toHaveLength(1); expect(items[0].jobId).toBe("A"); expect(items[0].copyBlock).toBe("script A");
  });
  it("maps files to jobs by embedded id; the WRONG business name still matches by id", () => {
    const ids = ["A", "B"];
    expect(jobIdFromFilename("urban-americana__A__lucas.mp3", ids)).toBe("A");
    expect(jobIdFromFilename("totally-wrong-name__B__lucas.mp3", ids)).toBe("B"); // id wins over name
    const r = matchAudioToJobs(["urban-americana__A__lucas.mp3", "other__B__lucas.mp3"], ids);
    expect(r.matched).toHaveLength(2); expect(r.ambiguous).toHaveLength(0); expect(r.unmatchedJobs).toHaveLength(0);
  });
  it("matches job ids that contain hyphens (nanoid) — not split on '-'", () => {
    const ids = ["rvjob_DeW-3LG8Or", "rvjob_zisDYzX1t-"];
    expect(jobIdFromFilename("wildflower-market__rvjob_DeW-3LG8Or__lucas.mp3", ids)).toBe("rvjob_DeW-3LG8Or");
    const r = matchAudioToJobs(["a__rvjob_DeW-3LG8Or__lucas.mp3", "b__rvjob_zisDYzX1t-__lucas.mp3"], ids);
    expect(r.matched).toHaveLength(2); expect(r.ambiguous).toHaveLength(0);
  });
  it("REFUSES ambiguous files (no id, or two files for one job) — never guesses the nearest lead", () => {
    const r = matchAudioToJobs(["random.mp3", "x__A__lucas.mp3", "y__A__lucas.mp3"], ["A", "B"]);
    expect(r.matched).toHaveLength(0);            // A had two files → both ambiguous
    expect(r.ambiguous).toEqual(expect.arrayContaining(["random.mp3", "x__A__lucas.mp3", "y__A__lucas.mp3"]));
    expect(r.unmatchedJobs).toEqual(expect.arrayContaining(["A", "B"]));
  });
  it("validates audio duration against target (block absurd, warn off-target, ok in range)", () => {
    expect(validateAudioDuration(0, 60).level).toBe("block");
    expect(validateAudioDuration(7, 60).level).toBe("block");
    expect(validateAudioDuration(20, 60).level).toBe("block");     // <0.55 ratio
    expect(validateAudioDuration(58, 60).level).toBe("ok");
    expect(validateAudioDuration(90, 60).level).toBe("warn");      // 1.5× off-target → warn, not block
  });
});

describe("pilot summary — counts only what was recorded", () => {
  it("aggregates events and splits sent/reply metrics by cohort", () => {
    const s = summarizePilot([
      { action: "review-video.prepared" }, { action: "review-video.prepared" },
      { action: "review-video.rendered" }, { action: "review-video.approved" },
      { action: "review-video.sent", meta: { cohort: "video" } }, { action: "review-video.reply", meta: { cohort: "video" } },
      { action: "review-video.positive-reply", meta: { cohort: "video" } },
    ]);
    expect(s.prepared).toBe(2); expect(s.approved).toBe(1);
    expect(s.byCohort.video.sent).toBe(1); expect(s.byCohort.video.positiveReplies).toBe(1);
  });
});
