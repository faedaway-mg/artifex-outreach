// Content Studio — client-video EVIDENCE GATE (section F addendum, item 4: "block context-free generation").
// A client/proposal video may only be generated when the narrated findings are genuinely supported by a
// DIRECTLY-OBSERVED, concrete observation that a REAL, SHA-verified screenshot proves. This module is pure
// and deterministic: it (re)derives an evidence-led storyboard from the AUTHORITATIVE current evidence
// (the template's per-line receipts + the currently-verified capture) and returns either a generatable
// storyboard or a specific "Needs evidence" reason. It NEVER trusts a stale persisted claim on its own.
//
// Governing rule (matches the mandate): a screenshot existing in storage does NOT satisfy acceptance. The
// finding must be observed + concrete, the screenshot must match by SHA, and the storyboard must bind them.

import type { ContentTemplate, NarrationEvidence, StoryboardScene } from "./template-schema";

// Confidence levels that count as directly evidenced. "Likely"/AI-inference and blank do NOT.
const OBSERVED = new Set(["observed", "reported"]);

// A SYNTHETIC marker (e.g. "evidence:friction:noClearCTA") is a system-generated label, not a concrete
// observation. Concrete basis = a quotable/measurable detail from the page (an excerpt, a measured value,
// a named element). We refuse to treat a synthetic marker — or a bare source label — as proof of a finding.
export function isConcreteBasis(basis: string[] | undefined): boolean {
  for (const raw of basis ?? []) {
    const b = String(raw).trim();
    if (!b) continue;
    if (/^evidence:/i.test(b)) continue;                 // synthetic friction marker → not concrete
    if (/·\s*(homepage|reviews|home)\s*$/i.test(b)) continue; // bare "domain · Homepage" source label
    if (/^synthesizing|^standard\b/i.test(b)) continue;  // framing boilerplate
    if (b.length < 8) continue;                          // too thin to be a real observation
    return true; // something concrete: an excerpt, a measured value, a named observed detail
  }
  return false;
}

// Is a per-line receipt a MATERIAL finding line (a finding or the starting point — not framing, not the
// reviews/ratings context line, which can provide colour but never be the whole personalization)?
export function isMaterialFinding(e: NarrationEvidence): boolean {
  return (e.kind === "finding" || e.kind === "starting-point") && e.topic !== "reviews";
}

// Does a material finding line qualify as DIRECTLY-OBSERVED + CONCRETE (before we even look at screenshots)?
export function findingQualifies(e: NarrationEvidence): boolean {
  return isMaterialFinding(e) && OBSERVED.has(String(e.confidence ?? "").toLowerCase()) && isConcreteBasis(e.basis);
}

export interface LiveShot {
  outputKey: string;   // the currently-verified capture's artifact key
  sha256: string;      // its bytes' SHA-256
  sourceUrl?: string;  // the page it captured
  pageTitle?: string;  // "Homepage" | …
}

export interface GateInput {
  template: Pick<ContentTemplate, "narration" | "narrationEvidence" | "businessName">;
  liveShot: LiveShot | null; // the currently-verified capture for this business, or null if none exists
}

export interface GateResult {
  ok: boolean;
  reason?: string;          // a specific, operator-useful "Needs evidence" reason when ok=false
  evidenceScenes: number;   // how many SHA-bound evidence scenes the honest storyboard contains
  storyboard: StoryboardScene[]; // the derived storyboard (empty/partial when blocked)
}

// Derive the honest storyboard and decide whether generation is allowed. Returns a SPECIFIC reason on block.
export function assessGenerationEvidence(input: GateInput): GateResult {
  const { template, liveShot } = input;
  const company = template.businessName || "this business";
  const receipts = template.narrationEvidence ?? [];
  const materialLines = receipts.filter(isMaterialFinding);

  if (!materialLines.length) {
    return { ok: false, evidenceScenes: 0, storyboard: [], reason: "Needs evidence: no specific finding beyond ratings/reviews — capture the site and re-run before generating." };
  }

  // A finding line must be directly OBSERVED + CONCRETE. Ratings-only / "Likely" AI-inference / synthetic
  // friction markers do not qualify — surface exactly why, per the mandate's needs-evidence rule.
  const qualifying = materialLines.filter(findingQualifies);
  if (!qualifying.length) {
    const hasObserved = materialLines.some((e) => OBSERVED.has(String(e.confidence ?? "").toLowerCase()));
    const reason = hasObserved
      ? "Needs evidence: the finding's only basis is a system-generated marker, not a concrete observation from the page. Re-capture and extract a specific, quotable detail before generating."
      : "Needs evidence: no directly-observed finding (only inferred/likely signal). Capture the site and confirm an observed detail before generating.";
    return { ok: false, evidenceScenes: 0, storyboard: [], reason };
  }

  // A qualifying finding needs a REAL, SHA-verified screenshot to prove it inside the video.
  if (!liveShot || !liveShot.outputKey || !liveShot.sha256) {
    return { ok: false, evidenceScenes: 0, storyboard: [], reason: "Needs evidence: no verified website screenshot exists to prove the finding on screen. Prepare the capture, then generate." };
  }

  // Build the evidence-led storyboard: identity → page-reviewed → (finding → evidence → why → recommendation)
  // per qualifying finding → cta. Every evidence scene binds the SHA-verified screenshot. Timestamps stay
  // approximate here (the render worker resolves exact onsets from the voiceover).
  const storyboard: StoryboardScene[] = [];
  let n = 1;
  const push = (s: Omit<StoryboardScene, "scene">) => { storyboard.push({ scene: n++, ...s }); };
  const prov = (e: NarrationEvidence) => ({ confidence: e.confidence, basis: (e.basis ?? []).slice(0, 6), observedAt: e.observedAt });

  const line = (i: number) => template.narration[i] ?? "";
  push({ narrationLine: 0, narration: line(0), purpose: "identity", companyName: company, visualTreatment: "title", onScreenContext: "Who this is", provenance: { basis: ["Company identity"] } });
  push({ narrationLine: 0, narration: line(0), purpose: "page-reviewed", companyName: company, sourcePageTitle: liveShot.pageTitle || "Homepage", sourceUrl: liveShot.sourceUrl, visualTreatment: "screenshot", onScreenContext: "What we reviewed", screenshotKey: liveShot.outputKey, screenshotSha: liveShot.sha256, provenance: { basis: ["Reviewed page"] } });

  let evidenceScenes = 0;
  for (const e of qualifying) {
    const shotKey = e.screenshotKey || liveShot.outputKey;
    const shotSha = e.screenshotKey && e.screenshotKey !== liveShot.outputKey ? undefined : liveShot.sha256;
    // The finding statement.
    push({ narrationLine: e.line, narration: line(e.line), purpose: "finding", companyName: company, sourcePageTitle: e.sourceLabel, sourceUrl: e.sourceUrl, evidenceId: e.topic, visualTreatment: "statement", onScreenContext: "What we found", provenance: prov(e) });
    // The real screenshot proving it (interior evidence frame) — SHA-bound.
    push({ narrationLine: e.line, narration: line(e.line), purpose: "evidence", companyName: company, sourcePageTitle: e.sourceLabel || liveShot.pageTitle || "Homepage", sourceUrl: e.sourceUrl || liveShot.sourceUrl, screenshotKey: shotKey, screenshotSha: shotSha, evidenceId: e.topic, visualTreatment: "screenshot-focus", onScreenContext: "What visitors see", provenance: prov(e) });
    evidenceScenes++;
  }
  const closeIdx = template.narration.length - 1;
  push({ narrationLine: closeIdx, narration: line(closeIdx), purpose: "cta", companyName: company, visualTreatment: "brand", onScreenContext: "Artifex Labs", provenance: { basis: ["No-obligation close"] } });

  // Every material narration finding line must be represented by an evidence scene; otherwise the narration
  // "discusses evidence absent from the storyboard" — block rather than narrate an unproven claim.
  const covered = new Set(storyboard.filter((s) => s.purpose === "evidence").map((s) => s.narrationLine));
  const uncovered = qualifying.find((e) => !covered.has(e.line));
  if (uncovered) {
    return { ok: false, evidenceScenes, storyboard, reason: `Needs evidence: narration line ${uncovered.line} states a finding with no screenshot scene to prove it.` };
  }
  // The bound screenshot SHA must match the currently-verified capture (no stale/mismatched evidence).
  const mismatch = storyboard.find((s) => s.purpose === "evidence" && s.screenshotSha && s.screenshotSha !== liveShot.sha256);
  if (mismatch) {
    return { ok: false, evidenceScenes, storyboard, reason: "Needs evidence: a finding's bound screenshot no longer matches the verified capture (SHA mismatch). Re-capture and regenerate." };
  }

  if (!evidenceScenes) {
    return { ok: false, evidenceScenes: 0, storyboard, reason: "Needs evidence: no evidence scene could be bound to a verified screenshot." };
  }
  return { ok: true, evidenceScenes, storyboard };
}
