// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER FULFILLMENT PORTAL (Part B) — a calm, read-only view of the customer's
// OWN job, gated by the offerId/share token in the URL. It shows ONLY what the
// customer needs: a 5-stage journey, exactly ONE dominant current action, their
// scope, access instructions + status, the completion report once DELIVERED, access
// revocation guidance, and the revision deadline.
//
// It NEVER exposes: internal scoring/economics, operator notes, sensitive evidence,
// error traces, the technician runbook/workspace, or any other customer's data.
// ─────────────────────────────────────────────────────────────────────────────
import * as store from "./store";
import { getBusinessIntelligence } from "../repo";
import { buildAccessCenter, accessCloseoutGuidance, normalizePlatform, type Platform } from "./fulfillment-center";
import { persistedCompletionReport } from "./fulfillment-gates";
import type { QuickFixOffer, JobState } from "./types";
import { ARTIFEX_IDENTITY } from "../identity";

export type PortalStage = "PURCHASED" | "ACCESS_NEEDED" | "WORKING" | "TESTING" | "COMPLETE";

export interface PortalAccessItem {
  key: string;
  label: string;
  method: string;
  steps: string[];
  status: string;
}

export interface CustomerPortalView {
  offerId: string;
  company: string;
  serviceName: string;
  finding: string;
  jobState: JobState;
  stage: PortalStage;
  stageIndex: number;
  stages: Array<{ key: PortalStage; label: string; done: boolean; current: boolean }>;
  /** Exactly ONE dominant action for the customer right now. */
  currentAction: { headline: string; detail: string; ctaLabel?: string; ctaHref?: string } | null;
  includedItems: string[];
  turnaround: string;
  revisionPolicy: string;
  /** The customer-facing access instructions (native invite; never a password). */
  access: PortalAccessItem[];
  accessNeverAskFor: string[];
  accessAssist: { note: string; bookUrl: string };
  screenshotCredentialWarning: string;
  /** Access revocation / close-out guidance — only meaningful at/after delivery. */
  accessCloseout: string;
  /** Populated ONLY when state >= DELIVERED. */
  completionReport: {
    issue: string; changes: string[]; verification: string[];
    beforeRef: string | null; afterRef: string | null; completedAt: string;
  } | null;
  /** The revision deadline sentence (from the offer's revision policy + delivery). */
  revisionDeadline: string;
}

const STAGE_ORDER: PortalStage[] = ["PURCHASED", "ACCESS_NEEDED", "WORKING", "TESTING", "COMPLETE"];
const STAGE_LABEL: Record<PortalStage, string> = {
  PURCHASED: "Purchased", ACCESS_NEEDED: "Access needed", WORKING: "Artifex working", TESTING: "Testing", COMPLETE: "Complete",
};

/** Map the internal JobState → the calm 5-stage customer journey. */
export function stageForJobState(state: JobState): PortalStage {
  switch (state) {
    case "PAID": return "PURCHASED";
    case "WAITING_FOR_CUSTOMER_INPUT": return "ACCESS_NEEDED";
    case "READY_FOR_FULFILLMENT":
    case "IN_PROGRESS": return "WORKING";
    case "QA": return "TESTING";
    case "DELIVERED":
    case "COMPLETE": return "COMPLETE";
    // Refund/cancel: keep the journey calm at the earliest stage; details handled elsewhere.
    case "REFUNDED":
    case "CANCELED": return "PURCHASED";
    default: return "PURCHASED";
  }
}

function currentActionFor(stage: PortalStage, hasAccessItems: boolean, intakeHref: string): CustomerPortalView["currentAction"] {
  switch (stage) {
    case "PURCHASED":
      return { headline: "You're all set — we're preparing your fix.", detail: "No action needed right now. We'll let you know the moment we need access or your fix is ready." };
    case "ACCESS_NEEDED":
      return hasAccessItems
        ? { headline: "One step: grant access so we can start.", detail: "Send a collaborator/editor invite using the steps below. We never ask for your password.", ctaLabel: "Grant access", ctaHref: intakeHref }
        : { headline: "One step: confirm your details so we can start.", detail: "Complete your quick intake and we'll begin.", ctaLabel: "Complete intake", ctaHref: intakeHref };
    case "WORKING":
      return { headline: "Artifex is on it.", detail: "We're implementing your fix. Nothing is needed from you right now." };
    case "TESTING":
      return { headline: "Final checks in progress.", detail: "We're testing your fix on the live site (desktop + mobile) before we hand it over." };
    case "COMPLETE":
      return { headline: "Your fix is complete.", detail: "See the completion report below. You can safely revoke our access when you're ready." };
    default:
      return null;
  }
}

/** Build the customer's OWN portal view. Returns null if there is no offer/job for
 *  the given accessor (offerId or share token). Reads only the customer's data. */
export async function buildCustomerPortalView(seg: string): Promise<CustomerPortalView | null> {
  const offer = await store.resolveOffer(seg);
  if (!offer) return null;
  const offerId = offer.offerId;
  const job = await store.getJob(offerId);
  if (!job) return null;

  const bi = await getBusinessIntelligence(offer.leadId).catch(() => null);
  const detected = extractPlatform(bi);
  const platform: Platform = normalizePlatform(detected);
  const typedOffer = offer as unknown as QuickFixOffer;

  const stage = stageForJobState(job.state);
  const stageIndex = STAGE_ORDER.indexOf(stage);
  const stages = STAGE_ORDER.map((k, i) => ({ key: k, label: STAGE_LABEL[k], done: i < stageIndex, current: i === stageIndex }));

  const ac = buildAccessCenter(typedOffer, platform);
  const access: PortalAccessItem[] = ac.instructions.map((a) => ({
    key: a.key, label: a.label, method: a.method, steps: a.steps,
    status: job.accessState?.[a.key]?.status ?? "REQUESTED",
  }));

  // Completion report is exposed ONLY at/after DELIVERED — derived from persisted facts.
  const delivered = job.state === "DELIVERED" || job.state === "COMPLETE";
  const report = delivered
    ? persistedCompletionReport(typedOffer, job, detected, job.updatedAt)
    : null;

  const intakeHref = `/offer/${offer.shareToken ?? offerId}/intake`;

  return {
    offerId,
    company: offer.companyName,
    serviceName: offer.scope.offerName,
    finding: offer.scope.problemBeingSolved,
    jobState: job.state,
    stage,
    stageIndex,
    stages,
    currentAction: currentActionFor(stage, access.length > 0, intakeHref),
    includedItems: offer.scope.includedItems,
    turnaround: offer.scope.deliveryWindow,
    revisionPolicy: offer.scope.revisionPolicy,
    access,
    accessNeverAskFor: ac.neverAskFor,
    accessAssist: {
      note: "Not sure where your website is managed? Book a short Access Assist session and we'll help you connect Artifex without asking for your password.",
      bookUrl: ARTIFEX_IDENTITY.bookingUrl,
    },
    screenshotCredentialWarning: "If you send a screenshot, please make sure no passwords, one-time codes, or account credentials are visible in it.",
    accessCloseout: accessCloseoutGuidance(typedOffer),
    completionReport: report
      ? { issue: report.issue, changes: report.changes, verification: report.verification, beforeRef: report.beforeRef, afterRef: report.afterRef, completedAt: report.completedAt }
      : null,
    revisionDeadline: revisionDeadlineSentence(offer.scope.revisionPolicy, delivered ? job.updatedAt : job.targetDeliveryAt),
  };
}

function revisionDeadlineSentence(revisionPolicy: string, ref: string | null): string {
  const rev = (revisionPolicy ?? "").toLowerCase();
  if (!rev || rev === "none" || rev.includes("no revision")) {
    return "This fix does not include a revision window.";
  }
  if (ref) {
    return `Your included revision window (${revisionPolicy}) starts from delivery — please request any revisions within it. Keep our access active until then.`;
  }
  return `Revisions included: ${revisionPolicy}. Your window begins once your fix is delivered.`;
}

// Best-effort platform detection from a lead's business intelligence (CMS signature only).
function extractPlatform(bi: any): string | null {
  const p = bi?.profile?.businessProfile ?? bi?.businessProfile ?? null;
  const blob = JSON.stringify(p ?? "").toLowerCase();
  for (const k of ["wordpress", "shopify", "squarespace", "webflow", "wix", "godaddy"]) if (blob.includes(k)) return k;
  return null;
}
