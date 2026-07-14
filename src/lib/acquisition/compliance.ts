// ─────────────────────────────────────────────────────────────────────────────
// Compliance gates. An acquisition plan cannot be approved unless every gate
// passes. Product compliance support — a qualified attorney should review final
// outbound policy before high-volume use.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Settings, AcquisitionPlan, AcquisitionStep } from "../types";
import { policyFor } from "./policy";

export interface ComplianceResult { ok: boolean; blockers: string[]; warnings: string[] }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CLAIM_WORDS = ["award-winning", "#1", "guaranteed", "best in", "certified", "board-certified"];

export function validEmail(email: string | null | undefined): boolean {
  return !!email && EMAIL_RE.test(email);
}

export function checkPlanCompliance(
  lead: Lead,
  plan: AcquisitionPlan,
  steps: AcquisitionStep[],
  settings: Settings,
  opts: { suppressed?: boolean } = {},
): ComplianceResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const policy = policyFor(plan.strategy);

  if (plan.strategy === "Do Not Contact") blockers.push("Strategy is Do Not Contact.");
  if (plan.strategy === "Manual Review") blockers.push("Strategy requires manual review — no automated approval.");
  if (opts.suppressed) blockers.push("Contact is suppressed / opted out.");
  if (lead.businessStatus === "CLOSED_PERMANENTLY") blockers.push("Business appears permanently closed.");
  if (lead.leadScore == null) blockers.push("Lead is not qualified yet (no score).");

  const usesEmail = plan.primaryChannel === "email" || plan.secondaryChannel === "email" || steps.some((s) => s.channel === "email");
  if (usesEmail) {
    if (!validEmail(settings.contactEmail)) blockers.push("No valid sender/reply email configured (Settings).");
    if (!settings.businessAddress?.trim()) blockers.push("No postal business address configured (required for commercial email).");
    if (!validEmail(lead.publicEmail)) blockers.push("No valid recipient email for this lead.");
    // Every email step must carry an unsubscribe mechanism.
    const missingUnsub = steps.filter((s) => s.channel === "email" && !/\{\{unsubscribe\}\}|unsubscribe/i.test(s.content));
    if (missingUnsub.length) blockers.push("An email step is missing an opt-out/unsubscribe mechanism.");
    const missingPostal = steps.filter((s) => s.channel === "email" && !s.content.includes(settings.businessAddress));
    if (settings.businessAddress && missingPostal.length) warnings.push("An email step does not include the postal address.");
  }

  // Touch limit
  if (steps.length > policy.maxTouches) blockers.push(`Sequence exceeds the maximum ${policy.maxTouches} touches for ${plan.strategy}.`);

  // Unsupported claims in any step
  for (const s of steps) {
    const lc = (s.subject + " " + s.content).toLowerCase();
    for (const w of CLAIM_WORDS) if (lc.includes(w)) blockers.push(`Step ${s.stepNumber} contains an unsupported claim ("${w}").`);
  }
  // Deceptive subject heuristic (fake reply)
  for (const s of steps) if (/^(re:|fwd:)/i.test(s.subject.trim())) blockers.push(`Step ${s.stepNumber} uses a deceptive reply-style subject.`);

  return { ok: blockers.length === 0, blockers, warnings };
}
