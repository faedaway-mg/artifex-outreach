// ─────────────────────────────────────────────────────────────────────────────
// QC pipeline + automatic repair.
//
// runQc()            — run all 11 checks and aggregate a QcReport.
// repairContent()    — deterministically fix every mechanically-fixable defect.
// runQcWithRepair()  — the operator-facing guarantee: generate → QC → repair →
//                      re-QC, looping until the report passes or attempts run out.
//                      The operator never receives a broken report.
//
// Repair is idempotent: applying it to already-clean content is a no-op, so the
// loop converges. Anything still failing after the last attempt is surfaced (never
// silently shipped) and blocks approval upstream.
// ─────────────────────────────────────────────────────────────────────────────
import type { DeliverableContent, Lead, Settings, Screenshot, DeliverableType, ArtifexService } from "../types";
import type { QcReport, QcCheckResult } from "./types";
import { ALL_CHECKS, type QcInput } from "./checks";
import { COMMON_MISSPELLINGS } from "./text";
import { formatLocation } from "../utils";
import { buildInvestmentModel } from "../investment";

export interface QcContext {
  lead: Lead;
  settings: Settings;
  type: DeliverableType;
  screenshots?: Screenshot[];
}

// ── Run + aggregate ───────────────────────────────────────────────────────────
export function runQc(content: DeliverableContent, ctx: QcContext, attempts = 1): QcReport {
  const input: QcInput = { content, lead: ctx.lead, settings: ctx.settings, type: ctx.type, screenshots: ctx.screenshots };
  const checks: QcCheckResult[] = ALL_CHECKS.map((fn) => fn(input));
  return aggregate(checks, attempts);
}

function aggregate(checks: QcCheckResult[], attempts: number): QcReport {
  let blockerCount = 0;
  let warningCount = 0;
  for (const c of checks) {
    if (c.passed) continue;
    if (c.severity === "blocker") blockerCount += c.issues.length;
    else warningCount += c.issues.length;
  }
  const passed = blockerCount === 0;
  const score = Math.max(0, 100 - blockerCount * 8 - warningCount * 2);
  const summary = passed
    ? warningCount === 0
      ? "Passed all quality checks."
      : `Passed with ${warningCount} warning${warningCount === 1 ? "" : "s"}.`
    : `Blocked by ${blockerCount} issue${blockerCount === 1 ? "" : "s"} across ${checks.filter((c) => !c.passed && c.severity === "blocker").length} check${checks.filter((c) => !c.passed && c.severity === "blocker").length === 1 ? "" : "s"}.`;
  return { passed, score, attempts, checks, blockerCount, warningCount, summary, ranAt: null };
}

// ── Orchestration: QC → repair → re-QC ────────────────────────────────────────
export function runQcWithRepair(
  content: DeliverableContent,
  ctx: QcContext,
  opts: { maxAttempts?: number } = {},
): { content: DeliverableContent; report: QcReport } {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  let current = content;
  let report = runQc(current, ctx, 1);
  let attempt = 1;
  while (!report.passed && attempt < maxAttempts) {
    attempt++;
    current = repairContent(current, ctx);
    report = runQc(current, ctx, attempt);
  }
  return { content: current, report: { ...report, attempts: attempt } };
}

// ── Deterministic repair ──────────────────────────────────────────────────────
export function repairContent(content: DeliverableContent, ctx: QcContext): DeliverableContent {
  const c: DeliverableContent = structuredClone(content);
  const name = ctx.lead.businessName || "the business";

  // 1. Clean every string: control chars, placeholders, spelling, spacing, doubled words.
  mapStrings(c, cleanText);

  // 2. Remove over-claims inconsistent with the honest framing.
  c.cta.body = stripOverclaims(c.cta.body);
  c.executiveSnapshot.potentialImpact = stripOverclaims(c.executiveSnapshot.potentialImpact);

  // 3. Structural fixes.
  if (!c.cover.subtitle?.trim()) c.cover.subtitle = "Business Technology Review";
  const presenceLoc = formatLocation(ctx.lead.city, ctx.lead.state);
  c.strengths = clampList(c.strengths, 8, [presenceLoc ? `Established presence in ${presenceLoc}.` : "Established local presence."]);
  c.modernizationPath.components = clampList(c.modernizationPath.components, 8, ["A focused first improvement"]);
  c.customerJourney.currentState = clampList(c.customerJourney.currentState, 6, ["A prospective customer finds the business online"]);
  c.customerJourney.futureState = clampList(c.customerJourney.futureState, 6, ["A clear next step guides them to make contact"]);
  if (c.opportunities.length > 3) c.opportunities = c.opportunities.slice(0, 3);

  // 4. Fill empty scalar fields with safe, on-brand defaults.
  const es = c.executiveSnapshot;
  es.overview = orDefault(es.overview, `${name} is a well-regarded business with practical, low-risk opportunities to reduce friction for customers.`);
  es.whatIsWorking = orDefault(es.whatIsWorking, `${name} has an established local presence to build on.`);
  es.primaryOpportunity = orDefault(es.primaryOpportunity, "Make it easier for customers to find, choose, and reach the business.");
  es.potentialImpact = orDefault(es.potentialImpact, "Reducing friction in the customer journey typically recovers inquiries that are otherwise lost.");
  es.recommendedFirstConversation = orDefault(es.recommendedFirstConversation, "A short call to compare these observations with how things actually work.");
  c.modernizationPath.secondaryOpportunity = orDefault(c.modernizationPath.secondaryOpportunity, "Automated follow-up to reduce missed inquiries.");
  c.modernizationPath.disclaimer = orDefault(c.modernizationPath.disclaimer, "Scope and pricing require a short discovery conversation.");
  c.cta.headline = orDefault(c.cta.headline, "Let's explore what this could look like.");
  c.cta.body = orDefault(c.cta.body, `A brief, no-obligation conversation to review the observations for ${name}.`);
  c.cover.confidentialityNote = orDefault(c.cover.confidentialityNote, "Confidential discussion document");
  c.opportunities.forEach((o) => {
    o.observation = orDefault(o.observation, "A point of friction in the customer journey.");
    o.evidence = orDefault(o.evidence, "Observed from publicly available information.");
    o.businessConsequence = orDefault(o.businessConsequence, "May quietly cost inquiries.");
    o.modernizationDirection = orDefault(o.modernizationDirection, "Reduce the friction with a focused improvement.");
  });

  // 5. De-duplicate: the secondary opportunity must not restate another section.
  //    (It is the field most prone to collision — operator-edited and derived.)
  const dupPool = [es.primaryOpportunity, es.potentialImpact, es.overview, es.whatIsWorking, es.recommendedFirstConversation, c.cta.body, c.modernizationPath.disclaimer].map(normalize);
  const SECONDARY_FALLBACKS = [
    "Automated follow-up to reduce missed inquiries.",
    "A lightweight internal dashboard for day-to-day visibility.",
    "Streamlined intake so fewer requests slip through.",
  ];
  if (dupPool.includes(normalize(c.modernizationPath.secondaryOpportunity)))
    c.modernizationPath.secondaryOpportunity = SECONDARY_FALLBACKS.find((f) => !dupPool.includes(normalize(f))) ?? SECONDARY_FALLBACKS[0];

  // 6. Truncate any field that would overflow its container, then balance punctuation.
  for (const fld of REPAIR_FIELDS) {
    const cur = fld.get(c);
    let fixed = truncateAtBoundary(cur, fld.budget);
    if (fld.sentence) fixed = balancePunctuation(fixed);
    fld.set(c, fixed);
  }

  // 7. Rebuild the investment model so pricing reconciles and the engagement matches.
  const engagement: ArtifexService = c.modernizationPath.primaryEngagement;
  const model = buildInvestmentModel(ctx.lead, c.opportunities, engagement, ctx.settings);
  c.modernizationPath.investmentModel = model;
  // Preserve the operator's share decision; keep the shared label consistent.
  if (c.modernizationPath.investmentRange) c.modernizationPath.investmentRange = model.rangeLabel;

  return c;
}

// ── Field table (mirrors collectFields budgets) for truncation ────────────────
interface RepairField {
  get: (c: DeliverableContent) => string;
  set: (c: DeliverableContent, v: string) => void;
  budget: number;
  sentence: boolean;
}
const REPAIR_FIELDS: RepairField[] = [
  { get: (c) => c.executiveSnapshot.overview, set: (c, v) => (c.executiveSnapshot.overview = v), budget: 650, sentence: true },
  { get: (c) => c.executiveSnapshot.whatIsWorking, set: (c, v) => (c.executiveSnapshot.whatIsWorking = v), budget: 500, sentence: true },
  { get: (c) => c.executiveSnapshot.primaryOpportunity, set: (c, v) => (c.executiveSnapshot.primaryOpportunity = v), budget: 500, sentence: true },
  { get: (c) => c.executiveSnapshot.potentialImpact, set: (c, v) => (c.executiveSnapshot.potentialImpact = v), budget: 500, sentence: true },
  { get: (c) => c.executiveSnapshot.recommendedFirstConversation, set: (c, v) => (c.executiveSnapshot.recommendedFirstConversation = v), budget: 500, sentence: true },
  { get: (c) => c.modernizationPath.secondaryOpportunity, set: (c, v) => (c.modernizationPath.secondaryOpportunity = v), budget: 320, sentence: true },
  { get: (c) => c.modernizationPath.disclaimer, set: (c, v) => (c.modernizationPath.disclaimer = v), budget: 400, sentence: true },
  { get: (c) => c.cta.body, set: (c, v) => (c.cta.body = v), budget: 500, sentence: true },
  { get: (c) => c.cover.subtitle, set: (c, v) => (c.cover.subtitle = v), budget: 80, sentence: false },
  { get: (c) => c.cta.headline, set: (c, v) => (c.cta.headline = v), budget: 90, sentence: false },
];

// ── Text helpers ──────────────────────────────────────────────────────────────
export function cleanText(s: string): string {
  if (typeof s !== "string") return s;
  let t = s;
  t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ""); // control chars (keep \t\n\r)
  t = t.replace(/\{\{[^}]*\}\}/g, "").replace(/<[a-z][a-z0-9 _-]*>/gi, ""); // template mustache/angle
  t = t.replace(/\[[^\]]*\]/g, ""); // [placeholder]
  t = t.replace(/\b(TODO|TBD|FIXME|XXX|LOREM)\b/gi, "");
  t = fixSpelling(t);
  t = t.replace(/([!?]){2,}/g, "$1"); // repeated end punctuation
  t = t.replace(/([,;:]){2,}/g, "$1");
  t = t.replace(/\.{2,}/g, "…"); // collapse stray double periods to an ellipsis
  t = t.replace(/\s+([,.;:!?])/g, "$1"); // space before punctuation
  t = t.replace(/([a-z][.!?])([A-Z])/g, "$1 $2").replace(/([a-z][,;:])([A-Za-z])/g, "$1 $2"); // missing space after punctuation
  t = t.replace(/[ \t]{2,}/g, " "); // double spaces
  t = t.replace(/\b(\w+)(\s+\1\b)+/gi, "$1"); // doubled words
  t = t.trim();
  if (t && /[a-z]/.test(t.charAt(0))) t = t.charAt(0).toUpperCase() + t.slice(1); // capitalize
  return t;
}

function fixSpelling(s: string): string {
  return s.replace(/[A-Za-z][A-Za-z'’]*/g, (w) => {
    const lower = w.toLowerCase();
    const fix = COMMON_MISSPELLINGS[lower];
    if (!fix) return w;
    // Preserve capitalization of the first letter.
    return /^[A-Z]/.test(w) ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix;
  });
}

function stripOverclaims(s: string): string {
  return s.replace(/\b(guaranteed|guarantee|risk-free|risk free)\b/gi, "worth exploring").replace(/[ \t]{2,}/g, " ").trim();
}

function balancePunctuation(s: string): string {
  let t = s;
  // Drop parentheses if unbalanced (usually a truncation artifact).
  const open = (t.match(/\(/g) ?? []).length;
  const close = (t.match(/\)/g) ?? []).length;
  if (open !== close) t = t.replace(/[()]/g, "");
  // Even out double quotes.
  const dq = (t.match(/"/g) ?? []).length;
  if (dq % 2 !== 0) t = t.replace(/"/g, "");
  return t.replace(/[ \t]{2,}/g, " ").trim();
}

function truncateAtBoundary(s: string, budget: number): string {
  if (!s || s.length <= budget) return s;
  const hard = s.slice(0, budget - 1);
  const lastSpace = hard.lastIndexOf(" ");
  const body = (lastSpace > budget * 0.6 ? hard.slice(0, lastSpace) : hard).replace(/[\s,.;:!?–—-]+$/, "");
  return body + "…";
}

function clampList(arr: string[], max: number, fallback: string[]): string[] {
  const cleaned = arr.map((x) => (typeof x === "string" ? x.trim() : "")).filter((x) => x.length > 0).slice(0, max);
  return cleaned.length ? cleaned : fallback;
}

function orDefault(s: string, fallback: string): string {
  return s && s.trim() && !/^(n\/a|tbd|todo|none|null|undefined)$/i.test(s.trim()) ? s : fallback;
}

function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// Recursively apply `fn` to every string in the content object (arrays + nested).
function mapStrings(obj: unknown, fn: (s: string) => string): void {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === "string") obj[i] = fn(obj[i]);
      else mapStrings(obj[i], fn);
    }
    return;
  }
  if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      const rec = obj as Record<string, unknown>;
      if (typeof rec[k] === "string") rec[k] = fn(rec[k] as string);
      else mapStrings(rec[k], fn);
    }
  }
}
