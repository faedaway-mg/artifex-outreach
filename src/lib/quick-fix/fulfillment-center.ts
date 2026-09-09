// ─────────────────────────────────────────────────────────────────────────────
// FULFILLMENT CENTER — the post-purchase operating system for a paid Quick-Fix.
//
// Turns a verified purchase + the approved offer + the fulfillment job into a single
// canonical FULFILLMENT PACKET so the operator never reconstructs the sale by hand:
//   customer/purchase → sale context → technical context (platform-aware Access Center)
//   → execution (platform-aware runbook + scope/safety gates + completion evidence).
//
// Everything is DETERMINISTIC and grounded in existing, approved data — it reuses the
// job state machine, the versioned playbook library, the requirements/access engine,
// and the completion model. It NEVER invents platform capabilities, access methods,
// destructive steps, or scope, and NEVER requests passwords. Unsupported SKU×platform
// combinations resolve to NEEDS_TECHNICAL_REVIEW rather than hallucinated instructions.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import type { JobRecord } from "./store";
import type { CustomerRecord } from "./lifecycle";
import { buildRequirements, type RequirementItem } from "./requirements";
import { playbookFor, type FulfillmentPlaybook } from "./playbooks";
import { skuFor } from "./catalog";

// ── Platform ─────────────────────────────────────────────────────────────────
export type Platform = "wordpress" | "shopify" | "squarespace" | "webflow" | "wix" | "godaddy" | "custom" | "unknown";
const PLATFORM_LABEL: Record<Platform, string> = {
  wordpress: "WordPress", shopify: "Shopify", squarespace: "Squarespace", webflow: "Webflow",
  wix: "Wix", godaddy: "GoDaddy", custom: "Custom / static site", unknown: "Unknown",
};

/** Normalize a detected/inferred platform name (from BI tech detection) to a canonical Platform. */
export function normalizePlatform(name?: string | null): Platform {
  const s = (name ?? "").toLowerCase();
  if (/wordpress|woocommerce|wp-/.test(s)) return "wordpress";
  if (/shopify/.test(s)) return "shopify";
  if (/squarespace/.test(s)) return "squarespace";
  if (/webflow/.test(s)) return "webflow";
  if (/wix/.test(s)) return "wix";
  if (/godaddy/.test(s)) return "godaddy";
  if (/custom|static|next|react|html/.test(s)) return "custom";
  return "unknown";
}

// ── Access Center — least-privilege, platform-aware, never a password ────────────
export type AccessStatus = "REQUESTED" | "INVITED" | "RECEIVED" | "VERIFIED" | "NO_LONGER_REQUIRED" | "REVOKED";
export type AccessMethod = "native-invite" | "oauth" | "scoped-token" | "blocked-no-vault";

export interface AccessInstruction {
  key: string;               // requirement key (e.g. website-admin)
  label: string;             // what access, in customer words
  method: AccessMethod;      // least-privilege preference order
  steps: string[];           // platform-specific, native, never asks for a password
  status: AccessStatus;      // current lifecycle status (default REQUESTED)
  blocked?: string;          // set when method is unavailable (e.g. no secret vault)
}

// Platform-specific collaborator/native-invite steps for the common access types.
// These describe ONLY the native invite flow — never a password, never broad access.
function nativeInviteSteps(platform: Platform, accessKey: string): string[] {
  const deliver = "our delivery address (shown in your intake email)";
  if (accessKey.includes("analytics")) {
    return [
      "Open Google Analytics (or Tag Manager) Admin.",
      "Go to Account/Property Access Management.",
      `Add ${deliver} with the minimum role needed (Viewer, or Editor if a change is required).`,
      "Save — no password is ever shared.",
    ];
  }
  switch (platform) {
    case "wordpress":
      return ["Open WordPress Admin → Users.", "Click Add New / Invite.", `Enter ${deliver}.`, "Assign the minimum role required (Editor, or Administrator only if the fix needs it).", "Send the invitation."];
    case "shopify":
      return ["Open Shopify Admin → Settings → Users and permissions.", "Click Add staff.", `Enter ${deliver}.`, "Grant only the permissions the fix needs (e.g. Themes / Online Store).", "Send the invite."];
    case "squarespace":
      return ["Open Squarespace → Settings → Permissions.", "Click Invite Contributor.", `Enter ${deliver}.`, "Choose the minimum role (Editor or Administrator only if required).", "Send the invitation."];
    case "webflow":
      return ["Open the Webflow project → Settings → Members / Sharing.", `Invite ${deliver} to the site.`, "Grant the minimum role (Editor/Designer as required).", "Send the invite."];
    case "wix":
      return ["Open Wix → Site → Roles & Permissions.", "Click Invite People.", `Enter ${deliver}.`, "Assign the minimum role required.", "Send the invitation."];
    case "godaddy":
      return ["Open GoDaddy → Account Settings → Delegate Access.", `Invite ${deliver}.`, "Grant the minimum access level needed for the fix.", "Send the invitation."];
    default:
      return [`Send a collaborator/editor invite for your site to ${deliver} — never your password.`, "Grant only the access the fix needs.", "If you're not sure where your site is managed, use Access Assist below."];
  }
}

/** Build the Access Center: the MINIMUM access this exact repair needs, with
 *  platform-specific native-invite steps. Least privilege — never broader than the
 *  offer's own required inputs, and never a password. A scoped secret/token is only
 *  ever requested if unavoidable; with no secure vault in the system it is BLOCKED
 *  (returns the manual path) rather than storing plaintext credentials. */
export function buildAccessCenter(offer: QuickFixOffer, platform: Platform): {
  platform: Platform; platformLabel: string;
  instructions: AccessInstruction[];
  neverAskFor: string[];
  assist: { guidedHelp: boolean; bookCall: boolean; note: string };
} {
  const reqs = buildRequirements(offer);
  // LEAST PRIVILEGE: only the access this fix REQUIRES to start (never the conditional
  // ONLY_IF_NEEDED items like DNS/hosting, and never optional extras). A CTA repair that
  // needs editor access must not request domain-registrar / DNS / hosting credentials.
  const relevant = reqs.items.filter((i: RequirementItem) => i.necessity === "REQUIRED_BEFORE_START");
  const instructions: AccessInstruction[] = relevant.map((i) => ({
    key: i.key,
    label: i.label,
    method: "native-invite" as AccessMethod,
    steps: nativeInviteSteps(platform, i.key),
    status: "REQUESTED" as AccessStatus,
  }));
  return {
    platform, platformLabel: PLATFORM_LABEL[platform],
    instructions,
    neverAskFor: ["Your account password", "Payment card details", "Backup / 2FA recovery codes", "Any other secret"],
    assist: {
      guidedHelp: true,
      bookCall: true,
      note: "Not sure where your website is managed? Use guided help, or book a short Access Assist session — we'll help you locate the right account and connect access without asking for your password. You've already purchased; this is not a sales call.",
    },
  };
}

/** Access revocation / close-out guidance (mandate J) — depends on the revision window. */
export function accessCloseoutGuidance(offer: QuickFixOffer): string {
  const rev = offer.scope.revisionPolicy?.toLowerCase() ?? "";
  if (rev && rev !== "none" && !rev.includes("no revision")) {
    return "Keep our collaborator access active through your included revision window. After that, you can safely revoke it.";
  }
  return "You can now revoke our collaborator access — the work is complete.";
}

// ── Deployment method per platform (never a generic "deploy") ────────────────────
const DEPLOY_METHOD: Record<Platform, string> = {
  wordpress: "Publish/Update the affected page or save the theme/plugin setting in WordPress.",
  shopify: "Publish the approved theme/section change in Shopify (or save the affected setting).",
  squarespace: "Save and publish the change within Squarespace.",
  webflow: "Publish the affected Webflow site so the change goes live.",
  wix: "Publish the Wix site so the change goes live.",
  godaddy: "Publish/save the change in the GoDaddy Website Builder.",
  custom: "Deploy the change through the site's existing publish/deploy process (verify the live URL).",
  unknown: "NEEDS TECHNICAL REVIEW — the platform is unknown; confirm the correct publish/deploy method before going live.",
};

// ── Runbook — the platform-tailored, checkable execution plan ─────────────────────
export interface RunbookStep { id: string; label: string; kind: "prepare" | "implement" | "verify" | "deploy" | "retest" | "evidence"; }
export interface Runbook {
  skuKey: string;
  platform: Platform;
  supported: boolean;                 // false → NEEDS TECHNICAL REVIEW
  reviewReason: string | null;
  steps: RunbookStep[];
  qaChecklist: string[];
  deployMethod: string;
  rollback: string;
  completionEvidenceRequired: string[];
  escalationConditions: string[];
}

/** Generate the job-specific runbook from the versioned playbook + a platform overlay.
 *  Reuses the approved playbook steps/QA/rollback verbatim (no freestyling) and adds a
 *  platform-specific deploy method + production retest. Unknown platform or missing
 *  playbook → supported=false (NEEDS TECHNICAL REVIEW). */
export function buildRunbook(offer: QuickFixOffer, platform: Platform): Runbook {
  const skuKey = offer.capabilityKeys[0] ?? "";
  const pb: FulfillmentPlaybook | null = skuKey ? playbookFor(skuKey) : null;
  const sku = skuKey ? skuFor(skuKey) : null;
  const platformSupported = platform !== "unknown" && (!sku || sku.platformCompatibility.map((p) => p.toLowerCase()).includes(PLATFORM_LABEL[platform].toLowerCase()) || platform === "custom");
  const supported = !!pb && platformSupported;
  const reviewReason = !pb ? "No approved playbook for this SKU." : !platformSupported ? `Platform ${PLATFORM_LABEL[platform]} is not confirmed compatible with ${skuKey}.` : null;

  const steps: RunbookStep[] = [];
  if (pb) {
    steps.push({ id: "confirm-scope", label: "Confirm the purchased page(s) and exact scope match reality.", kind: "prepare" });
    steps.push({ id: "pre-capture", label: "Capture a pre-change screenshot / rollback point.", kind: "prepare" });
    pb.steps.forEach((s, i) => steps.push({ id: `impl-${i + 1}`, label: s, kind: "implement" }));
    steps.push({ id: "verify-desktop", label: "Verify the change on desktop.", kind: "verify" });
    steps.push({ id: "verify-mobile", label: "Verify the change on mobile.", kind: "verify" });
    steps.push({ id: "deploy", label: DEPLOY_METHOD[platform], kind: "deploy" });
    steps.push({ id: "retest-prod", label: "Retest the LIVE production URL (not a preview) — desktop + mobile.", kind: "retest" });
    steps.push({ id: "evidence", label: "Capture completion evidence (before/after + production proof).", kind: "evidence" });
  }
  return {
    skuKey, platform, supported, reviewReason,
    steps,
    qaChecklist: pb?.qaChecklist ?? [],
    deployMethod: DEPLOY_METHOD[platform],
    rollback: pb?.rollbackRequired ? "Restore the captured pre-change revision / backup if the change must be reverted." : "Platform version history/revisions provide rollback; capture the pre-change state before editing.",
    completionEvidenceRequired: pb?.deliveryArtifacts ?? ["Before screenshot", "After screenshot", "Production test result"],
    escalationConditions: pb?.escalationConditions ?? [],
  };
}

// ── Pre-change gates ─────────────────────────────────────────────────────────────
export type ScopeGate = "SCOPE_CONFIRMED" | "SCOPE_EXCEPTION" | "PENDING";
export interface ScopeDecision {
  gate: ScopeGate;
  originalAssumption: string;
  observedIssue: string | null;
  reason: string | null;
  recommendedRoute: "PROCEED" | "DIFFERENT_SKU" | "FIX_SCAN" | "CONVERSATION" | "REFUND_OR_CANCEL" | null;
}

/** Scope validation gate (mandate M): after access, before any change, confirm the sold
 *  repair still matches reality. An exception is surfaced with a recommended route — never
 *  silently absorbed and never turned into out-of-scope work without approval. */
export function scopeGate(offer: QuickFixOffer, input: { confirmed?: boolean; observedIssue?: string | null }): ScopeDecision {
  const base = { originalAssumption: offer.scope.problemBeingSolved };
  if (input.observedIssue && input.observedIssue.trim()) {
    return { gate: "SCOPE_EXCEPTION", ...base, observedIssue: input.observedIssue, reason: "The observed issue differs materially from the purchased scope; the current fix cannot safely resolve it.", recommendedRoute: "DIFFERENT_SKU" };
  }
  if (input.confirmed) return { gate: "SCOPE_CONFIRMED", ...base, observedIssue: null, reason: null, recommendedRoute: "PROCEED" };
  return { gate: "PENDING", ...base, observedIssue: null, reason: null, recommendedRoute: null };
}

export interface SafetyGate {
  canStart: boolean;
  checks: { id: string; label: string; ok: boolean }[];
  blockers: string[];
}

/** Pre-change safety gate (mandate N): scope confirmed + required access received +
 *  pre-change state captured + rollback path identified. Platform-aware (don't require
 *  a manual backup where the platform provides revisions). Only then may START FIX. */
export function safetyGate(args: {
  offer: QuickFixOffer;
  job: Pick<JobRecord, "state" | "requirementsReceivedAt">;
  scope: ScopeDecision;
  preChangeCaptured: boolean;
  platform: Platform;
}): SafetyGate {
  const reqs = buildRequirements(args.offer);
  const accessReceived = !!args.job.requirementsReceivedAt || reqs.blockingCount === 0;
  const checks = [
    { id: "scope", label: "Scope confirmed (no unresolved exception)", ok: args.scope.gate === "SCOPE_CONFIRMED" },
    { id: "access", label: "Required access received", ok: accessReceived },
    { id: "pre-change", label: "Current state captured (pre-change screenshot / revision)", ok: args.preChangeCaptured },
    { id: "rollback", label: "Rollback path identified (platform revisions or backup)", ok: args.platform !== "unknown" },
  ];
  const blockers = checks.filter((c) => !c.ok).map((c) => c.label);
  return { canStart: blockers.length === 0, checks, blockers };
}

// ── Fulfillment Packet — the one canonical post-purchase object ───────────────────
export interface FulfillmentPacket {
  // CUSTOMER / PURCHASE
  offerId: string;
  leadId: string;
  company: string;
  sku: string | null;
  serviceName: string;          // human-readable canonical label (no naming drift)
  priceCents: number;
  purchasedAt: string | null;
  jobState: string;
  targetDeliveryAt: string | null;
  customerEmail: string | null;
  isCustomer: boolean;
  // ORIGINAL SALE CONTEXT
  finding: string;
  evidenceGrade: string;
  confidence: number;
  includedItems: string[];
  excludedItems: string[];
  doNotTouch: string[];         // explicit boundary derived from exclusions
  turnaround: string;
  revisionPolicy: string;
  termsVersion: string | null;
  // TECHNICAL CONTEXT
  platform: Platform;
  accessCenter: ReturnType<typeof buildAccessCenter>;
  accessCloseout: string;
  // EXECUTION
  runbook: Runbook;
  completionEvidenceRequired: string[];
}

const GENERIC_DO_NOT_TOUCH = [
  "Unrelated pages", "Branding / visual identity", "Unrelated plugins or apps",
  "Any redesign beyond the purchased scope", "DNS / domain settings", "Hosting configuration",
];

export interface BuildPacketInput {
  offer: QuickFixOffer;
  job: Pick<JobRecord, "offerId" | "leadId" | "state" | "purchasedAt" | "targetDeliveryAt">;
  customer?: CustomerRecord | null;
  detectedPlatform?: string | null;
  termsVersion?: string | null;
}

export function buildFulfillmentPacket(input: BuildPacketInput): FulfillmentPacket {
  const { offer, job } = input;
  const platform = normalizePlatform(input.detectedPlatform);
  const runbook = buildRunbook(offer, platform);
  const doNotTouch = [...offer.scope.excludedItems, ...GENERIC_DO_NOT_TOUCH];
  return {
    offerId: offer.offerId,
    leadId: offer.leadId,
    company: offer.companyName,
    sku: offer.capabilityKeys[0] ?? null,
    serviceName: offer.scope.offerName,
    priceCents: offer.priceCents,
    purchasedAt: job.purchasedAt,
    jobState: job.state,
    targetDeliveryAt: job.targetDeliveryAt,
    customerEmail: input.customer?.email ?? null,
    isCustomer: !!input.customer,
    finding: offer.scope.problemBeingSolved,
    evidenceGrade: offer.evidenceGrade,
    confidence: offer.confidence,
    includedItems: offer.scope.includedItems,
    excludedItems: offer.scope.excludedItems,
    doNotTouch,
    turnaround: offer.scope.deliveryWindow,
    revisionPolicy: offer.scope.revisionPolicy,
    termsVersion: input.termsVersion ?? null,
    platform,
    accessCenter: buildAccessCenter(offer, platform),
    accessCloseout: accessCloseoutGuidance(offer),
    runbook,
    completionEvidenceRequired: runbook.completionEvidenceRequired,
  };
}
