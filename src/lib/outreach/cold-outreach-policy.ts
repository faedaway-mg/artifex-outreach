// ─────────────────────────────────────────────────────────────────────────────
// COLD OUTREACH ELIGIBILITY DOCTRINE (canonical). Two independent gates decide
// whether a business may receive cold first-touch:
//   1. PROBLEM gate  — verdict MUST be PROVEN (enforced at the wire by dispatchGate).
//   2. CHANNEL gate  — allowed cold channels are validated business EMAIL (primary) or a
//      legitimate public CONTACT FORM (secondary). Phone / SMS / social DMs / guessed
//      personal email are NEVER cold channels. A PROVEN business with no approved async
//      channel is PROVEN_UNCONTACTABLE (preserved for future contact discovery).
// We do not contact a business to find out whether it has a problem.
// ─────────────────────────────────────────────────────────────────────────────

export type ColdChannel = "email" | "contact-form" | "none";
export type ColdClassification =
  | "EMAIL_READY"
  | "FORM_READY"
  | "PROVEN_UNCONTACTABLE"
  | "NOT_MATERIAL"
  | "NOT_PROVEN";

export interface ColdOutreachDecision {
  eligible: boolean;
  channel: ColdChannel;
  classification: ColdClassification;
  reason: string;
}

export function coldOutreachDecision(input: {
  verdict?: string | null;
  sendEligibleEmail: boolean;   // VERIFIED / HIGH_CONFIDENCE, not bounced
  contactFormUsable: boolean;   // legitimate public form, policy-appropriate
  materiality?: string | null;  // PASS / FAIL — a PROVEN but trivial defect is not outreach-eligible
}): ColdOutreachDecision {
  if ((input.verdict ?? "").toUpperCase() !== "PROVEN") {
    return { eligible: false, channel: "none", classification: "NOT_PROVEN", reason: "Problem Reality is not PROVEN — research only, no outreach" };
  }
  // A PROVEN defect must ALSO clear the materiality threshold. A cosmetic/non-material
  // defect is a true technical fact but does not justify cold outreach.
  if ((input.materiality ?? "PASS").toUpperCase() === "FAIL") {
    return { eligible: false, channel: "none", classification: "NOT_MATERIAL", reason: "PROVEN but below the materiality threshold — no outreach" };
  }
  if (input.sendEligibleEmail) {
    return { eligible: true, channel: "email", classification: "EMAIL_READY", reason: "PROVEN + validated business email" };
  }
  if (input.contactFormUsable) {
    return { eligible: true, channel: "contact-form", classification: "FORM_READY", reason: "PROVEN + legitimate public contact form" };
  }
  return { eligible: false, channel: "none", classification: "PROVEN_UNCONTACTABLE", reason: "PROVEN but no approved asynchronous channel (phone is not a cold channel)" };
}
