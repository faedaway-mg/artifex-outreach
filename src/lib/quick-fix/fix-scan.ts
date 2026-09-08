// ─────────────────────────────────────────────────────────────────────────────
// ARTIFEX FIX SCAN — the $99 diagnostic/downsell SKU.
//
// GOVERNING RULE: ACTUAL FIX FIRST, DIAGNOSTIC ONLY WHEN NECESSARY. If the engine
// already has strong evidence + a confident SKU match, it sells the repair — the
// $99 scan must NOT cannibalize an obvious direct-repair purchase. Fix Scan exists
// for promising-but-insufficient evidence, access/authenticated-inspection needs,
// broader-inspection requests, or a post-decline downsell. Fixed price, fixed
// scope, fixed SLA, QA-gated, creditable toward an eligible repair within 14 days.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer, OfferFinding } from "./types";
import { assessEvidence, isConcreteDefect } from "./evidence-gate";
import { assessFixability } from "./fixability";
import { matchCapability } from "./capabilities";
import { skuFor } from "./catalog";
import { deliveryWindowHours } from "./requirements";

export const FIX_SCAN_SKU = {
  key: "artifex-fix-scan",
  name: "Artifex Fix Scan",
  family: "DIAGNOSTIC" as const,
  priceCents: 9900, // $99 — fixed, versioned, never LLM-set
  slaLabel: "24–48 hours",
  creditWindowDays: 14,
  estimatedLaborMinutes: 45, // strict target — a labor sink means reprice/narrow/retire
  version: "fixscan-sku-v1",
  scope: {
    includes: [
      "Inspect one agreed website / workflow surface",
      "Identify concrete, fixable defects",
      "Validate findings with evidence",
      "Prioritize findings by severity/relevance",
      "Map eligible findings to approved Artifex repair SKUs",
      "Deliver a concise Fix Scan report with fixed-price repair options",
    ],
    excludes: [
      "Unlimited consulting or advisory work",
      "Full website redesign / SEO / brand strategy",
      "Large custom technical architecture",
      "The implementation itself (repairs are purchased separately)",
      "Extensive competitive research",
    ],
    deliverable: "Artifex Fix Scan Report — findings, evidence, matched repairs, fixed prices + SLAs, recommended order",
    requiredAccess: ["Editor/collaborator access to the surface being inspected (native invite; never a password)"],
  },
} as const;

// ── Routing: DIRECT FIX FIRST ─────────────────────────────────────────────────
export type LeadRoute = "DIRECT_FIX" | "FIX_SCAN" | "CONVERSATION_REQUIRED" | "NO_FIX_FOUND";

export interface RouteOpts {
  /** Prospect explicitly asked for a broader inspection. */
  prospectRequestedScan?: boolean;
  /** Downsell context: prospect engaged with a repair offer but didn't buy (no opt-out). */
  prospectDeclinedRepair?: boolean;
  /** Deeper authenticated inspection / platform access is needed to scope safely. */
  accessUncertain?: boolean;
}

export interface RouteDecision {
  route: LeadRoute;
  reason: string;
  cannibalizationFlag: boolean;
}

/**
 * Decide the route for a lead. Direct fix wins whenever a confident repair exists.
 * Fix Scan is offered only for promising-but-insufficient / access-uncertain /
 * requested / post-decline cases — never when a direct repair is safely available.
 */
export function routeLead(offer: QuickFixOffer, opts: RouteOpts = {}): RouteDecision {
  const fix = assessFixability(offer);

  // 1) DIRECT FIX FIRST — a confident, ready-to-sell repair is never downsold to a scan.
  if (offer.quickFixEligible && fix.readyToSell) {
    // Cannibalization guard: if something asked us to scan a direct-eligible lead, flag it.
    const cannibal = !!(opts.prospectRequestedScan || opts.prospectDeclinedRepair || opts.accessUncertain);
    return { route: "DIRECT_FIX", reason: `strong evidence + SKU match (${fix.matchedSku}) → sell the repair`, cannibalizationFlag: cannibal };
  }

  const r = (offer.notEligibleReason ?? "").toLowerCase();

  // 2) LARGE / CUSTOM / NO-WEBSITE → conversation, not a scan.
  if (fix.state === "CONVERSATION_REQUIRED" || r.includes("website") || r.includes("exceeds") || r.includes("beyond a productized")) {
    return { route: "CONVERSATION_REQUIRED", reason: offer.notEligibleReason ?? "large/custom → conversation", cannibalizationFlag: false };
  }

  // 3) PROMISING BUT INSUFFICIENT / ACCESS-UNCERTAIN / REQUESTED / DOWNSELL → Fix Scan.
  const promisingButThin = r.includes("diagnostic") || fix.state === "NEEDS_REVIEW";
  if (promisingButThin || opts.accessUncertain || opts.prospectRequestedScan || opts.prospectDeclinedRepair) {
    return { route: "FIX_SCAN", reason: promisingButThin ? "promising signal but evidence insufficient to safely scope a repair — Fix Scan" : opts.prospectRequestedScan ? "prospect requested a broader inspection" : opts.prospectDeclinedRepair ? "post-decline downsell to a lower-friction diagnostic" : "deeper authenticated inspection needed", cannibalizationFlag: false };
  }

  // 4) NOTHING CONCRETE → no fix.
  return { route: "NO_FIX_FOUND", reason: offer.notEligibleReason ?? "no concrete fixable signal", cannibalizationFlag: false };
}

/** Should we present Fix Scan as a downsell now? Lifecycle-gated, not desperate. */
export function fixScanDownsellEligible(args: { offerViewed: boolean; purchased: boolean; optedOut: boolean; daysSinceOffer: number; cooldownDays?: number }): boolean {
  const cooldown = args.cooldownDays ?? 3;
  return args.offerViewed && !args.purchased && !args.optedOut && args.daysSinceOffer >= cooldown;
}

// ── $99 repair credit — single-use, expiring, never exceeds the repair price ────
export interface CreditRecord {
  scanOfferId: string;
  amountCents: number; // what was paid for the scan (9900)
  deliveredAt: string; // starts the window
  expiresAtMs: number;
  used: boolean;
  usedOnOfferId: string | null;
}

export function createCredit(scanOfferId: string, deliveredAt: string, windowDays = FIX_SCAN_SKU.creditWindowDays): CreditRecord {
  return { scanOfferId, amountCents: FIX_SCAN_SKU.priceCents, deliveredAt, expiresAtMs: new Date(deliveredAt).getTime() + windowDays * 86_400_000, used: false, usedOnOfferId: null };
}

export interface CreditApplication {
  finalPriceCents: number;
  creditAppliedCents: number;
  applies: boolean;
  reason: string;
}

/** Apply an eligible credit to a repair price. Single-use, expiry-checked, capped. */
export function applyCredit(credit: CreditRecord | null, repairPriceCents: number, repairOfferId: string, nowMs: number): CreditApplication {
  if (!credit) return { finalPriceCents: repairPriceCents, creditAppliedCents: 0, applies: false, reason: "no credit" };
  if (credit.used) return { finalPriceCents: repairPriceCents, creditAppliedCents: 0, applies: false, reason: "credit already used" };
  if (nowMs > credit.expiresAtMs) return { finalPriceCents: repairPriceCents, creditAppliedCents: 0, applies: false, reason: "credit expired" };
  const creditAppliedCents = Math.min(credit.amountCents, repairPriceCents); // never exceed repair price
  return { finalPriceCents: repairPriceCents - creditAppliedCents, creditAppliedCents, applies: true, reason: `applied $${creditAppliedCents / 100} Fix Scan credit toward repair` };
}

// ── Fix Scan report — prioritized, evidence-backed, approved SKUs only ──────────
export interface FixScanReportItem {
  issue: string;
  status: "Confirmed" | "Needs access to verify";
  evidence: string[];
  matchedSku: string | null;
  matchedSkuName: string | null;
  priceCents: number | null;
  slaLabel: string | null;
}

export interface FixScanReport {
  items: FixScanReportItem[];
  creditNote: string;
  valid: boolean;
  problems: string[];
}

/** Build the report from validated findings. Vague findings are rejected; repair
 *  options come ONLY from the approved catalog; requires evidence. */
export function buildFixScanReport(findings: OfferFinding[], creditExpiresAt: string): FixScanReport {
  const ev = assessEvidence(findings);
  const problems: string[] = [];
  const items: FixScanReportItem[] = [];
  for (const f of findings) {
    if (!isConcreteDefect(f.observation)) continue; // reject vague
    if ((f.basis ?? []).length === 0) continue; // require evidence
    const cap = matchCapability(f);
    const sku = cap ? skuFor(cap.key) : null;
    const confirmed = f.confidenceLabel === "Observed";
    items.push({
      issue: f.observation,
      status: confirmed ? "Confirmed" : "Needs access to verify",
      evidence: f.basis,
      matchedSku: sku?.key ?? null,
      matchedSkuName: sku?.name ?? null,
      priceCents: sku ? approxPriceForSku(cap!.key) : null,
      slaLabel: sku?.slaLabel ?? null,
    });
  }
  // Prioritize: confirmed + matched first.
  items.sort((a, b) => Number(b.status === "Confirmed") - Number(a.status === "Confirmed") || Number(!!b.matchedSku) - Number(!!a.matchedSku));
  if (items.length === 0) problems.push("no concrete, evidence-backed finding to report");
  return {
    items,
    creditNote: `Your $99 Fix Scan credit is valid toward one eligible repair until ${creditExpiresAt}.`,
    valid: problems.length === 0,
    problems,
  };
}

function approxPriceForSku(capKey: string): number {
  // Report shows the tier price the repair would land in (deterministic, catalog-driven).
  const sku = skuFor(capKey);
  if (!sku) return 24900;
  const midHours = (sku.priceHintHours[0] + sku.priceHintHours[1]) / 2;
  return midHours <= 2 ? 24900 : midHours <= 5 ? 49500 : 99500;
}

// ── Fix Scan fulfillment playbook (QA-gated) ───────────────────────────────────
export const FIX_SCAN_PLAYBOOK = {
  fulfillmentPlaybookId: "pb-artifex-fix-scan-v1",
  skuKey: FIX_SCAN_SKU.key,
  steps: [
    "Confirm the agreed inspection surface",
    "Confirm required access",
    "Capture baseline",
    "Run safe, non-destructive inspection",
    "Validate findings with evidence",
    "Reject vague / unproven findings",
    "Match findings to approved SKUs",
    "Prioritize",
    "Generate the evidence-backed report",
    "QA",
    "Deliver",
    "Start the 14-day credit eligibility window",
    "Create the next-best repair recommendation",
  ],
  qaChecklist: [
    "Only the agreed surface was inspected",
    "Every reported finding has evidence",
    "No vague / unproven findings included",
    "Repair options map to approved catalog SKUs only",
  ],
  deliveryArtifacts: ["fix-scan-report", "evidence", "credit-record"],
  estimatedLaborMinutes: FIX_SCAN_SKU.estimatedLaborMinutes,
} as const;

export function fixScanReportReady(qaPassed: Record<string, boolean>): { ok: boolean; missing: string[] } {
  const missing = FIX_SCAN_PLAYBOOK.qaChecklist.filter((q) => qaPassed[q] !== true);
  return { ok: missing.length === 0, missing };
}

// silence unused-import lint if deliveryWindowHours ever removed
void deliveryWindowHours;
