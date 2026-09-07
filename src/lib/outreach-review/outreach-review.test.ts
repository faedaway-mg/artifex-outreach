import { describe, it, expect } from "vitest";
import { narrationReadiness, refillDecision, tallyBacklog, DEFAULT_BACKLOG, type NarrationReadinessInput } from "./eligibility";
import { createSprintSession, currentLead, markComplete, markRejected, markNeedsAttention, skipForNow, resume, progress, orderForSprint, exitSprint } from "./session";
import { verifyTranscript } from "./transcript";
import { planUpload, validateAudio, isStaleRender } from "./upload";

const ready = (over: Partial<NarrationReadinessInput> = {}): NarrationReadinessInput => ({
  scoreBand: "PRIORITY_A", hasDisqualifier: false, verifiedBusinessIdentity: true, recipientVerified: true,
  recipientResolutionTracked: true, hasStrongReputationSignal: true, hasSpecificWebsiteFinding: true,
  hasSupportedConsequence: true, narrationEvidenceBacked: true, statementEvidenceMapComplete: true,
  hasUnsupportedClaims: false, excessiveSimilarity: false, narrationQualityPasses: true,
  hasCurrentScriptRevision: true, hasExistingAudioForCurrentRevision: false, hasCanonicalCompletedRender: false,
  renderState: "none", packageState: "none", needsAttention: false, ...over,
});

describe("mandate 28 — READY_FOR_NARRATION eligibility", () => {
  it("a fully-qualified business is ready for narration", () => {
    const r = narrationReadiness(ready());
    expect(r.ready).toBe(true);
    expect(r.state).toBe("ready-for-narration");
    expect(r.blockers).toEqual([]);
  });
  it.each([
    ["not A/B", { scoreBand: "REVIEW" as const }, "researching"],
    ["disqualified", { hasDisqualifier: true }, "researching"],
    ["no reputation", { hasStrongReputationSignal: false }, "needs-evidence"],
    ["no website finding", { hasSpecificWebsiteFinding: false }, "needs-evidence"],
    ["no recipient", { recipientVerified: false, recipientResolutionTracked: false }, "needs-recipient"],
    ["unsupported claims", { hasUnsupportedClaims: true }, "script-being-prepared"],
    ["too similar", { excessiveSimilarity: true }, "script-being-prepared"],
    ["quality fails", { narrationQualityPasses: false }, "script-being-prepared"],
  ])("NOT ready: %s → %s state with blockers", (_l, over, state) => {
    const r = narrationReadiness(ready(over as any));
    expect(r.ready).toBe(false);
    expect(r.state).toBe(state);
    expect(r.blockers.length).toBeGreaterThan(0);
  });
  it("existing audio for the current revision → audio-uploaded (not narration-ready again)", () => {
    expect(narrationReadiness(ready({ hasExistingAudioForCurrentRevision: true })).state).toBe("audio-uploaded");
  });
  it("a completed render makes narration unnecessary", () => {
    expect(narrationReadiness(ready({ hasCanonicalCompletedRender: true })).ready).toBe(false);
  });
  it("downstream lifecycle states classify correctly", () => {
    expect(narrationReadiness(ready({ packageState: "scheduled" })).state).toBe("scheduled");
    expect(narrationReadiness(ready({ packageState: "sent" })).state).toBe("sent");
    expect(narrationReadiness(ready({ needsAttention: true })).state).toBe("needs-attention");
  });
  it("refill fires below 80, restores to 100, never past max", () => {
    expect(refillDecision(100).shouldRefill).toBe(false);
    expect(refillDecision(80).shouldRefill).toBe(false);
    const d = refillDecision(72);
    expect(d.shouldRefill).toBe(true);
    expect(d.deficit).toBe(28);
    expect(refillDecision(0, { target: 100, refillThreshold: 80, max: 100 }).deficit).toBe(100);
  });
  it("tallyBacklog counts each state", () => {
    const c = tallyBacklog(["ready-for-narration", "ready-for-narration", "needs-recipient", "sent"]);
    expect(c["ready-for-narration"]).toBe(2);
    expect(c.total).toBe(4);
  });
});

describe("mandate 28 — sprint session", () => {
  const mk = () => createSprintSession({ id: "s1", operator: "op", order: ["a", "b", "c", "d"], batchSize: 10, now: "2026-09-07T00:00:00Z" });
  it("batch size caps the order; current starts at the first", () => {
    const s = createSprintSession({ id: "s", operator: "op", order: ["a", "b", "c"], batchSize: 2, now: "t" });
    expect(s.order).toEqual(["a", "b"]);
    expect(currentLead(s)).toBe("a");
  });
  it("complete auto-advances; progress tracks counts", () => {
    let s = mk();
    s = markComplete(s); // a done → b
    expect(currentLead(s)).toBe("b");
    expect(progress(s).completed).toBe(1);
    expect(progress(s).remaining).toBe(3);
  });
  it("skip is session-local: moves to the end, stays narration-ready, not disposed", () => {
    let s = mk();
    s = skipForNow(s); // a → end; current becomes b
    expect(currentLead(s)).toBe("b");
    expect(s.order[s.order.length - 1]).toBe("a");
    expect(s.skipped).toContain("a");
    expect(progress(s).remaining).toBe(4); // still all pending
  });
  it("reject + needs-attention remove from remaining", () => {
    let s = mk();
    s = markRejected(s);       // a rejected → b
    s = markNeedsAttention(s); // b attention → c
    expect(currentLead(s)).toBe("c");
    expect(progress(s).rejected).toBe(1);
    expect(progress(s).needsAttention).toBe(1);
    expect(progress(s).remaining).toBe(2);
  });
  it("resume skips a lead that is no longer eligible, truthfully", () => {
    let s = mk();
    s = exitSprint(s, "t1");
    const { session, skippedIneligible } = resume(s, { now: "t2", stillEligible: (l) => l !== "a" });
    expect(skippedIneligible).toContain("a");
    expect(currentLead(session)).toBe("b");
    expect(session.resumedAt).toBe("t2");
  });
  it("orderForSprint ranks score → growth → freshness → recipient → oldest", () => {
    const order = orderForSprint([
      { leadId: "low", score: 70, growth: 0, evidenceFreshnessTs: 0, recipientConfidence: 0.5, readySinceTs: 1 },
      { leadId: "high", score: 90, growth: 1, evidenceFreshnessTs: 5, recipientConfidence: 0.9, readySinceTs: 2 },
      { leadId: "mid-old", score: 90, growth: 1, evidenceFreshnessTs: 5, recipientConfidence: 0.9, readySinceTs: 1 },
    ]);
    expect(order[0]).toBe("mid-old"); // ties broken by oldest-ready
    expect(order[2]).toBe("low");
  });
});

describe("mandate 28 — transcript verification", () => {
  const narr = "Right now there's no online booking on your website so a customer who searches can't schedule without calling. A simple booking page could capture those requests.";
  it("MATCH tolerates contractions/greetings/word-order → auto-render", () => {
    const r = verifyTranscript(narr, "Hi. Right now there is no online booking on the website, so a customer who searches cannot schedule a job without calling. A simple booking page could capture those requests.");
    expect(["MATCH", "MINOR_VARIATION"]).toContain(r.classification);
    expect(r.canAutoRender).toBe(true);
  });
  it("wrong recording → POSSIBLE_WRONG_RECORDING, no auto-render", () => {
    const r = verifyTranscript(narr, "Thanks for calling Joe's Pizza, our specials today are pepperoni and mushroom, delivery takes about thirty minutes.");
    expect(r.classification).toBe("POSSIBLE_WRONG_RECORDING");
    expect(r.canAutoRender).toBe(false);
    expect(r.requiresOperator).toBe(true);
  });
  it("incomplete recording → INCOMPLETE_RECORDING", () => {
    const r = verifyTranscript(narr, "Right now there's no online booking.");
    expect(r.classification).toBe("INCOMPLETE_RECORDING");
    expect(r.canAutoRender).toBe(false);
  });
  it("unavailable transcription preserves work + requires confirmation", () => {
    const r = verifyTranscript(narr, "", { available: false });
    expect(r.classification).toBe("TRANSCRIPTION_UNAVAILABLE");
    expect(r.requiresOperator).toBe(true);
  });
});

describe("mandate 28 — upload validation + render gating", () => {
  const goodMeta = { mime: "audio/mp4", bytes: 2_000_000, durationSeconds: 60, signatureOk: true };
  const narr = "Right now there's no online booking so customers can't schedule without calling. A booking page could capture those requests.";
  const spokenMatch = "Right now there is no online booking so customers cannot schedule without calling. A booking page could capture those requests.";
  it("valid M4A + matching transcript → queue exactly one render", () => {
    const p = planUpload({ meta: goodMeta, sha256: "sha1", scriptRevisionId: "r2", inputVersion: "iv2", requestedRevisionId: "r2", narration: narr, spokenTranscript: spokenMatch });
    expect(p.ok).toBe(true);
    expect(p.shouldQueueRender).toBe(true);
    expect(p.bindsToRevision).toBe("r2");
  });
  it.each([
    ["bad MIME", { mime: "image/png" }, "BAD_MIME"],
    ["bad signature", { signatureOk: false }, "BAD_SIGNATURE"],
    ["oversized", { bytes: 999_999_999 }, "TOO_LARGE"],
    ["too short", { durationSeconds: 2 }, "TOO_SHORT"],
  ])("rejects %s", (_l, over, code) => {
    const p = planUpload({ meta: { ...goodMeta, ...over }, sha256: "s", scriptRevisionId: "r2", inputVersion: "iv2", requestedRevisionId: "r2", narration: narr, spokenTranscript: spokenMatch });
    expect(p.ok).toBe(false);
    expect(p.code).toBe(code);
    expect(p.shouldQueueRender).toBe(false);
  });
  it("stale client revision → REVISION_MISMATCH, no render", () => {
    const p = planUpload({ meta: goodMeta, sha256: "s", scriptRevisionId: "r3", inputVersion: "iv3", requestedRevisionId: "r2", narration: narr, spokenTranscript: spokenMatch });
    expect(p.code).toBe("REVISION_MISMATCH");
    expect(p.shouldQueueRender).toBe(false);
  });
  it("duplicate identical bytes → idempotent, converges to one artifact (no second render)", () => {
    const p = planUpload({ meta: goodMeta, sha256: "shaX", scriptRevisionId: "r2", inputVersion: "iv2", requestedRevisionId: "r2", existingArtifactSha: "shaX", narration: narr, spokenTranscript: spokenMatch });
    expect(p.idempotent).toBe(true);
    expect(p.shouldQueueRender).toBe(false);
  });
  it("wrong recording uploads but does NOT queue a render (caught before rendering)", () => {
    const p = planUpload({ meta: goodMeta, sha256: "s2", scriptRevisionId: "r2", inputVersion: "iv2", requestedRevisionId: "r2", narration: narr, spokenTranscript: "completely different content about pizza delivery specials today" });
    expect(p.ok).toBe(true);
    expect(p.code).toBe("TRANSCRIPT_BLOCKED");
    expect(p.shouldQueueRender).toBe(false);
  });
  it("a late render for an older input version is stale", () => {
    expect(isStaleRender("iv1", "iv2")).toBe(true);
    expect(isStaleRender("iv2", "iv2")).toBe(false);
  });
  it("validateAudio accepts all Voice Memo formats", () => {
    for (const mime of ["audio/mp4", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/wav"]) {
      expect(validateAudio({ mime, bytes: 1_000_000, durationSeconds: 30, signatureOk: true }).ok).toBe(true);
    }
  });
});
