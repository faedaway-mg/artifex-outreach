// Acquisition OS — resolve the DELIVERY_READY context for a lead from real stored state (nationwide-refill
// mandate). This is the async I/O half that feeds the PURE gate in delivery-ready.ts: it reads BI, the
// frozen Quick Review binding, the recipient, suppression, and prior-contact history, and hands back a
// plain DeliveryContext the gate can judge. It NEVER sends and NEVER mutates.

import type { Lead } from "../types";
import type { DeliveryContext } from "./delivery-ready";
import { resolveTimezone } from "./materialize-batch";
import { getBusinessIntelligence, isSuppressed, emailSendsForLead, inboundForLead } from "../repo";
import { latestReviewApproval } from "../outreach/quick-review-freeze";
import { buildQuickReview } from "../outreach/quick-review";
import { validEmail } from "./compliance";
import { ARTIFEX_ADDRESS } from "../identity";

const SENT_FAMILY = new Set(["sent", "delivered", "opened", "clicked"]);

// A compliant unsubscribe + postal footer is resolvable when the signing secret is configured (hardened,
// per-recipient unsubscribe URLs) and a printed postal address exists. Env-derived, so it's honest about
// the actual deployment.
function footerResolvable(): boolean {
  return !!process.env.COMMS_UNSUBSCRIBE_SECRET && !!ARTIFEX_ADDRESS && ARTIFEX_ADDRESS.trim().length > 0;
}

/** Resolve the full DELIVERY_READY context for one lead. Defensive: any resolver failure degrades to the
 *  conservative (not-ready) value rather than throwing, so one bad lead never breaks a reserve measurement. */
export async function gatherDeliveryContext(lead: Lead): Promise<DeliveryContext> {
  const leadId = lead.id;
  const website = lead.website ?? null;
  const websiteDomain = (lead as { websiteDomain?: string | null }).websiteDomain ?? null;
  const recipientEmail = (lead as { publicEmail?: string | null }).publicEmail ?? null;

  // Evidence + sendability from BI via the real review builder (Observed, non-reviews finding required).
  let hasObservedFinding = false, reviewSendable = false;
  try {
    const bi = await getBusinessIntelligence(leadId);
    const profile = bi?.profile?.businessProfile ?? null;
    if (profile) {
      const review = buildQuickReview(lead, profile, null, {});
      hasObservedFinding = review.findings.some((f) => f.evidence?.confidence === "Observed" && f.topic !== "reviews");
      reviewSendable = review.status === "SENDABLE";
    }
  } catch { /* conservative: stays false */ }

  // Approved/frozen Quick Review binding → attachment SHA + approval.
  let reviewApproved = false, attachmentSha: string | null = null;
  try {
    const approval = await latestReviewApproval(leadId);
    if (approval?.binding) {
      reviewApproved = true;
      attachmentSha = approval.binding.frozenPdfSha256 || null;
      if (approval.binding.reviewStatus) reviewSendable = reviewSendable || approval.binding.reviewStatus === "SENDABLE";
    }
  } catch { /* conservative */ }

  // Compliance / prior-contact.
  let suppressed = false, priorContact = false;
  try { suppressed = await isSuppressed({ email: recipientEmail, domain: websiteDomain, phone: (lead as { phone?: string | null }).phone ?? null }); } catch { suppressed = true; }
  try {
    const sends = await emailSendsForLead(leadId);
    const inbound = await inboundForLead(leadId);
    priorContact = sends.some((s) => SENT_FAMILY.has(String(s.status))) || (Array.isArray(inbound) && inbound.length > 0);
  } catch { /* conservative: false (no prior contact known) */ }

  const state = (lead as { state?: string | null }).state ?? null;
  return {
    leadId,
    businessName: lead.businessName,
    website,
    websiteDomain,
    serviceFit: !!((lead as { industry?: string | null }).industry || (lead as { normalizedCategory?: string | null }).normalizedCategory),
    recipientEmail,
    recipientEmailValid: validEmail(recipientEmail),
    hasObservedFinding,
    reviewApproved,
    reviewSendable,
    attachmentSha,
    footerReady: footerResolvable(),
    suppressed,
    unsubscribed: false, // captured within suppression (reason=unsubscribe) → already reflected in `suppressed`
    bounced: false,      // captured within suppression (reason=bounce) → already reflected in `suppressed`
    duplicate: false,    // national dedup enforced at insert (findDuplicate); survivors are unique
    priorContact,
    recipientTimezone: resolveTimezone(state),
    score: Number((lead as { leadScore?: number }).leadScore ?? (lead as { acquisitionScore?: number }).acquisitionScore ?? 0.5) || 0.5,
    city: (lead as { city?: string | null }).city ?? null,
    state,
  };
}
