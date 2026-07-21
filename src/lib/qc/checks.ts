// ─────────────────────────────────────────────────────────────────────────────
// The eleven QC checks.
//
// Each check is a pure function (QcInput) → QcCheckResult. They are precision-first:
// a clean, well-formed report passes every check with zero issues. Severity decides
// whether a failure blocks approval (and triggers auto-repair/regeneration) or is
// surfaced as a warning.
// ─────────────────────────────────────────────────────────────────────────────
import type { DeliverableContent, Lead, Settings, Screenshot, DeliverableType } from "../types";
import type { QcCheckResult, QcIssue } from "./types";
import {
  findTemplatePlaceholders,
  findDoubledWords,
  findMisspellings,
  findSpacingIssues,
  findGrammarIssues,
  normalizeForCompare,
  similarity,
} from "./text";

export interface QcInput {
  content: DeliverableContent;
  lead: Lead;
  settings: Settings;
  type: DeliverableType;
  screenshots?: Screenshot[];
}

// A text field with the metadata each check needs.
interface Field {
  location: string;
  text: string;
  sentence: boolean; // full-sentence prose (gets capitalization/end-punctuation checks)
  budget: number; // max chars before it would overflow its PDF container
}

/** Every rendered text field, with overflow budgets sized to the A4 brief layout. */
export function collectFields(c: DeliverableContent): Field[] {
  const f: Field[] = [];
  f.push({ location: "cover.subtitle", text: c.cover.subtitle, sentence: false, budget: 80 });
  f.push({ location: "cover.confidentialityNote", text: c.cover.confidentialityNote, sentence: false, budget: 120 });
  f.push({ location: "executiveSnapshot.overview", text: c.executiveSnapshot.overview, sentence: true, budget: 650 });
  f.push({ location: "executiveSnapshot.whatIsWorking", text: c.executiveSnapshot.whatIsWorking, sentence: true, budget: 500 });
  f.push({ location: "executiveSnapshot.primaryOpportunity", text: c.executiveSnapshot.primaryOpportunity, sentence: true, budget: 500 });
  f.push({ location: "executiveSnapshot.potentialImpact", text: c.executiveSnapshot.potentialImpact, sentence: true, budget: 500 });
  f.push({ location: "executiveSnapshot.recommendedFirstConversation", text: c.executiveSnapshot.recommendedFirstConversation, sentence: true, budget: 500 });
  c.strengths.forEach((s, i) => f.push({ location: `strengths[${i}]`, text: s, sentence: false, budget: 220 }));
  c.opportunities.forEach((o, i) => {
    f.push({ location: `opportunities[${i}].observation`, text: o.observation, sentence: false, budget: 180 });
    f.push({ location: `opportunities[${i}].evidence`, text: o.evidence, sentence: true, budget: 320 });
    f.push({ location: `opportunities[${i}].businessConsequence`, text: o.businessConsequence, sentence: true, budget: 320 });
    f.push({ location: `opportunities[${i}].modernizationDirection`, text: o.modernizationDirection, sentence: true, budget: 320 });
  });
  c.customerJourney.currentState.forEach((s, i) => f.push({ location: `customerJourney.currentState[${i}]`, text: s, sentence: false, budget: 340 }));
  c.customerJourney.futureState.forEach((s, i) => f.push({ location: `customerJourney.futureState[${i}]`, text: s, sentence: false, budget: 340 }));
  c.modernizationPath.components.forEach((s, i) => f.push({ location: `modernizationPath.components[${i}]`, text: s, sentence: false, budget: 60 }));
  f.push({ location: "modernizationPath.secondaryOpportunity", text: c.modernizationPath.secondaryOpportunity, sentence: true, budget: 320 });
  f.push({ location: "modernizationPath.disclaimer", text: c.modernizationPath.disclaimer, sentence: true, budget: 400 });
  f.push({ location: "cta.headline", text: c.cta.headline, sentence: false, budget: 90 });
  f.push({ location: "cta.body", text: c.cta.body, sentence: true, budget: 500 });
  const m = c.modernizationPath.investmentModel;
  if (m) {
    m.lineItems.forEach((li, i) => {
      f.push({ location: `investment[${i}].observation`, text: li.observation, sentence: true, budget: 300 });
      f.push({ location: `investment[${i}].businessImpact`, text: li.businessImpact, sentence: true, budget: 320 });
      f.push({ location: `investment[${i}].recommendation`, text: li.recommendation, sentence: true, budget: 320 });
      f.push({ location: `investment[${i}].expectedOutcome`, text: li.expectedOutcome, sentence: true, budget: 300 });
    });
  }
  return f;
}

function result(id: QcCheckResult["id"], label: string, severity: QcCheckResult["severity"], issues: QcIssue[]): QcCheckResult {
  return { id, label, severity, passed: issues.length === 0, issues };
}

// 1. Alignment — the report's headline claims trace to real content. ─────────────
export function checkAlignment(input: QcInput): QcCheckResult {
  const c = input.content;
  const issues: QcIssue[] = [];
  const opps = c.opportunities;
  if (opps.length > 0) {
    const pool = opps.flatMap((o) => [o.observation, o.modernizationDirection]).concat(c.modernizationPath.components);
    const primary = c.executiveSnapshot.primaryOpportunity;
    const aligned = pool.some((p) => similarity(primary, p) >= 0.1);
    if (!aligned)
      issues.push({
        location: "executiveSnapshot.primaryOpportunity",
        message: "Primary opportunity does not clearly correspond to any listed opportunity or component.",
        detail: primary.slice(0, 120),
      });
  }
  // The recommended engagement label in the model must match the path.
  const m = c.modernizationPath.investmentModel;
  if (m && m.engagement !== c.modernizationPath.primaryEngagement)
    issues.push({ location: "investmentModel.engagement", message: "Investment model engagement differs from the recommended engagement." });
  return result("alignment", "Content alignment", "warning", issues);
}

// 2. Overflow — no field exceeds its container budget. ───────────────────────────
export function checkOverflow(input: QcInput): QcCheckResult {
  const issues: QcIssue[] = [];
  for (const f of collectFields(input.content)) {
    if (f.text && f.text.length > f.budget)
      issues.push({ location: f.location, message: `Text is ${f.text.length} chars; container holds ~${f.budget}.`, detail: f.text.slice(0, 80) + "…" });
  }
  return result("overflow", "Text overflow", "blocker", issues);
}

// 3. Missing screenshots — visual claims must have a supporting image. ────────────
export function checkMissingScreenshots(input: QcInput): QcCheckResult {
  const issues: QcIssue[] = [];
  const approved = (input.screenshots ?? []).filter((s) => s.approved);
  const visualCue = /(screenshot|as shown|see (the )?(image|below|screenshot)|pictured|as pictured|mobile view|scroll(ing)? down|the image above)/i;
  input.content.opportunities.forEach((o, i) => {
    if (visualCue.test(o.evidence) && approved.length === 0)
      issues.push({
        location: `opportunities[${i}].evidence`,
        message: "Evidence references a visual but no approved screenshot is attached.",
        detail: o.evidence.slice(0, 100),
      });
  });
  return result("missing-screenshots", "Missing screenshots", "warning", issues);
}

// 4. Empty sections — no required field is blank or a bare placeholder. ────────────
export function checkEmptySections(input: QcInput): QcCheckResult {
  const c = input.content;
  const issues: QcIssue[] = [];
  const isBlank = (s: string | undefined | null) => !s || !s.trim() || /^[-–—.\s]*$/.test(s) || /^(n\/a|tbd|todo|none|null|undefined)$/i.test(s.trim());
  for (const f of collectFields(c)) {
    if (isBlank(f.text)) issues.push({ location: f.location, message: "Section is empty or a placeholder." });
  }
  if (c.strengths.length === 0) issues.push({ location: "strengths", message: "No strengths listed." });
  if (c.customerJourney.currentState.length === 0) issues.push({ location: "customerJourney.currentState", message: "Current-state journey is empty." });
  if (c.customerJourney.futureState.length === 0) issues.push({ location: "customerJourney.futureState", message: "Future-state journey is empty." });
  if (c.modernizationPath.components.length === 0) issues.push({ location: "modernizationPath.components", message: "No engagement components listed." });
  return result("empty-sections", "Empty sections", "blocker", issues);
}

// 5. Repeated content — the same text is not duplicated across sections. ──────────
export function checkRepeatedContent(input: QcInput): QcCheckResult {
  const issues: QcIssue[] = [];
  // Investment line items deliberately restate the opportunity they are derived
  // from (that traceability is the point), so they are excluded from cross-section
  // duplicate detection. Their internal consistency is covered by pricing checks.
  const fields = collectFields(input.content).filter((f) => f.text && f.text.trim().length >= 25 && !f.location.startsWith("investment["));
  const seen = new Map<string, string>();
  for (const f of fields) {
    const norm = normalizeForCompare(f.text);
    if (norm.length < 20) continue;
    const prior = seen.get(norm);
    if (prior) issues.push({ location: f.location, message: `Exact duplicate of ${prior}.`, detail: f.text.slice(0, 80) });
    else seen.set(norm, f.location);
  }
  // Secondary opportunity duplicating the primary is a specific, common defect.
  const prim = input.content.executiveSnapshot.primaryOpportunity;
  const sec = input.content.modernizationPath.secondaryOpportunity;
  if (prim && sec && similarity(prim, sec) >= 0.85)
    issues.push({ location: "modernizationPath.secondaryOpportunity", message: "Secondary opportunity nearly duplicates the primary opportunity." });
  return result("repeated-content", "Repeated content", "blocker", issues);
}

// 6. Grammar — spacing, punctuation, articles, capitalization. ────────────────────
export function checkGrammar(input: QcInput): QcCheckResult {
  const issues: QcIssue[] = [];
  for (const f of collectFields(input.content)) {
    if (!f.text) continue;
    for (const s of findSpacingIssues(f.text)) issues.push({ location: f.location, message: `Grammar: ${s}.`, detail: f.text.slice(0, 80) });
    for (const d of findDoubledWords(f.text)) issues.push({ location: f.location, message: `Doubled word: "${d}".` });
    if (f.sentence) for (const g of findGrammarIssues(f.text)) issues.push({ location: f.location, message: `Grammar: ${g}.`, detail: f.text.slice(0, 80) });
  }
  return result("grammar", "Grammar", "blocker", issues);
}

// 7. Spelling — curated misspellings + leftover template placeholders. ────────────
export function checkSpelling(input: QcInput): QcCheckResult {
  const issues: QcIssue[] = [];
  for (const f of collectFields(input.content)) {
    if (!f.text) continue;
    for (const p of findTemplatePlaceholders(f.text)) issues.push({ location: f.location, message: `Unresolved placeholder: ${p}` });
    for (const m of findMisspellings(f.text)) issues.push({ location: f.location, message: `Misspelling: "${m.word}" → "${m.correction}".` });
  }
  return result("spelling", "Spelling", "blocker", issues);
}

// 8. Pricing consistency — the investment model reconciles exactly. ───────────────
export function checkPricingConsistency(input: QcInput): QcCheckResult {
  const issues: QcIssue[] = [];
  const path = input.content.modernizationPath;
  const m = path.investmentModel;
  if (m) {
    const sumLow = m.lineItems.reduce((a, l) => a + l.investmentLow, 0);
    const sumHigh = m.lineItems.reduce((a, l) => a + l.investmentHigh, 0);
    if (sumLow !== m.subtotalLow) issues.push({ location: "investmentModel.subtotalLow", message: `Line items sum to ${sumLow} but subtotalLow is ${m.subtotalLow}.` });
    if (sumHigh !== m.subtotalHigh) issues.push({ location: "investmentModel.subtotalHigh", message: `Line items sum to ${sumHigh} but subtotalHigh is ${m.subtotalHigh}.` });
    if (m.subtotalLow !== m.totalLow || m.subtotalHigh !== m.totalHigh) issues.push({ location: "investmentModel.total", message: "Totals do not equal subtotals." });
    if (m.totalLow > m.totalHigh) issues.push({ location: "investmentModel.total", message: `totalLow (${m.totalLow}) exceeds totalHigh (${m.totalHigh}).` });
    for (const [i, l] of m.lineItems.entries()) {
      if (l.investmentLow > l.investmentHigh) issues.push({ location: `investment[${i}]`, message: "Line item low exceeds high." });
      if (l.effort.lowHours > l.effort.highHours) issues.push({ location: `investment[${i}].effort`, message: "Effort low hours exceed high hours." });
    }
    const expectedLabel = `$${m.totalLow.toLocaleString()}–$${m.totalHigh.toLocaleString()}`;
    if (m.rangeLabel !== expectedLabel) issues.push({ location: "investmentModel.rangeLabel", message: `Range label "${m.rangeLabel}" does not match totals (${expectedLabel}).` });
    // If the range is shared to the prospect, it must match the model exactly.
    if (path.investmentRange && path.investmentRange !== m.rangeLabel)
      issues.push({ location: "modernizationPath.investmentRange", message: `Shared range "${path.investmentRange}" disagrees with the model (${m.rangeLabel}).` });

    // Field completeness — a client-facing line must carry its full chain and
    // clean, whole-dollar figures (no inconsistent currency formatting).
    const seen = new Set<string>();
    for (const [i, l] of m.lineItems.entries()) {
      if (!l.observation?.trim()) issues.push({ location: `investment[${i}].observation`, message: "Line item is missing its observation." });
      if (!l.recommendation?.trim()) issues.push({ location: `investment[${i}].recommendation`, message: "Line item is missing its recommendation." });
      if (!l.expectedOutcome?.trim()) issues.push({ location: `investment[${i}].expectedOutcome`, message: "Line item is missing its expected outcome." });
      if (!l.effort?.summary?.trim()) issues.push({ location: `investment[${i}].effort`, message: "Line item is missing an effort summary." });
      if (!l.deliverables?.length || l.deliverables.every((d) => !d?.trim())) issues.push({ location: `investment[${i}].deliverables`, message: "Line item has no deliverables." });
      if (!Number.isInteger(l.investmentLow) || !Number.isInteger(l.investmentHigh) || l.investmentLow < 0) issues.push({ location: `investment[${i}]`, message: "Line item investment must be non-negative whole dollars." });
      // Duplicate line items read as a copy-paste error to the client.
      const key = `${(l.observation || "").trim().toLowerCase()}|${(l.recommendation || "").trim().toLowerCase()}`;
      if (seen.has(key)) issues.push({ location: `investment[${i}]`, message: "Duplicate line item (same observation and recommendation)." });
      seen.add(key);
    }

    // Ongoing / third-party costs must be structurally separate from the
    // implementation total (guaranteed by reconciliation above) and each must
    // declare who bills it — so implementation fees are never confused with them.
    for (const [i, oc] of (m.ongoingCosts ?? []).entries()) {
      if (!oc.label?.trim()) issues.push({ location: `ongoingCosts[${i}].label`, message: "Ongoing cost is missing a label." });
      if (!oc.amount?.trim()) issues.push({ location: `ongoingCosts[${i}].amount`, message: "Ongoing cost is missing an amount." });
      if (oc.paidTo !== "third-party" && oc.paidTo !== "artifex") issues.push({ location: `ongoingCosts[${i}].paidTo`, message: "Ongoing cost must declare who bills it (third-party or artifex)." });
    }
  } else if (path.investmentRange) {
    issues.push({ location: "modernizationPath.investmentRange", message: "A range is shared but there is no explainable investment model behind it." });
  }
  return result("pricing-consistency", "Pricing consistency", "blocker", issues);
}

// 9. Broken layout — structural defects that render as broken pages. ──────────────
export function checkBrokenLayout(input: QcInput): QcCheckResult {
  const c = input.content;
  const issues: QcIssue[] = [];
  const controlChar = /[\x00-\x08\x0B\x0C\x0E-\x1F]/; // control chars except tab/newline/CR
  for (const f of collectFields(c)) {
    if (f.text && controlChar.test(f.text)) issues.push({ location: f.location, message: "Contains control characters." });
  }
  if (!c.cover.subtitle?.trim()) issues.push({ location: "cover.subtitle", message: "Cover subtitle is missing (breaks the title)." });
  if (c.modernizationPath.components.length > 8) issues.push({ location: "modernizationPath.components", message: `${c.modernizationPath.components.length} component chips overflow the row (max 8).` });
  if (c.opportunities.length > 3) issues.push({ location: "opportunities", message: "More than 3 opportunities overflow the layout." });
  // Empty array entries render as broken/empty bullets.
  const arrays: Array<[string, string[]]> = [
    ["strengths", c.strengths],
    ["components", c.modernizationPath.components],
    ["currentState", c.customerJourney.currentState],
    ["futureState", c.customerJourney.futureState],
  ];
  for (const [name, arr] of arrays) if (arr.some((x) => !x || !x.trim())) issues.push({ location: name, message: "Contains a blank list entry (renders as an empty bullet)." });
  return result("broken-layout", "Broken layout", "blocker", issues);
}

// 10. Image quality — attached screenshots are usable. ────────────────────────────
export function checkImageQuality(input: QcInput): QcCheckResult {
  const issues: QcIssue[] = [];
  for (const s of input.screenshots ?? []) {
    if (!s.approved) continue;
    if (!s.storageUrl || !s.storageUrl.trim()) issues.push({ location: `screenshot ${s.id}`, message: "Screenshot has no image URL." });
    else if (/placeholder|example\.com|about:blank/i.test(s.storageUrl)) issues.push({ location: `screenshot ${s.id}`, message: "Screenshot points at a placeholder image." });
    if (!s.caption || !s.caption.trim()) issues.push({ location: `screenshot ${s.id}`, message: "Screenshot has no caption." });
    if (s.viewport !== "mobile" && s.viewport !== "desktop") issues.push({ location: `screenshot ${s.id}`, message: "Screenshot has an invalid viewport." });
  }
  return result("image-quality", "Image quality", "warning", issues);
}

// 11. Inconsistent recommendations — the recommendation is internally coherent. ────
export function checkInconsistentRecommendations(input: QcInput): QcCheckResult {
  const c = input.content;
  const issues: QcIssue[] = [];
  const m = c.modernizationPath.investmentModel;
  if (m && m.engagement !== c.modernizationPath.primaryEngagement)
    issues.push({ location: "investmentModel.engagement", message: `Investment model is for "${m.engagement}" but the recommended engagement is "${c.modernizationPath.primaryEngagement}".` });
  // Every opportunity must carry a concrete recommendation (direction).
  c.opportunities.forEach((o, i) => {
    if (!o.modernizationDirection?.trim()) issues.push({ location: `opportunities[${i}].modernizationDirection`, message: "Opportunity has no recommended direction." });
  });
  // The first-conversation CTA should not contradict the disclaimer's low-pressure framing.
  if (/\bguarantee|guaranteed|risk-free\b/i.test(c.cta.body + c.executiveSnapshot.potentialImpact))
    issues.push({ location: "cta.body", message: "Contains an over-claim (guarantee/risk-free) inconsistent with the honest framing." });
  return result("inconsistent-recommendations", "Recommendation consistency", "blocker", issues);
}

export const ALL_CHECKS = [
  checkAlignment,
  checkOverflow,
  checkMissingScreenshots,
  checkEmptySections,
  checkRepeatedContent,
  checkGrammar,
  checkSpelling,
  checkPricingConsistency,
  checkBrokenLayout,
  checkImageQuality,
  checkInconsistentRecommendations,
] as const;
