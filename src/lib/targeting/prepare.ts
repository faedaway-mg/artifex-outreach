// ─────────────────────────────────────────────────────────────────────────────
// TARGETING PREPARATION (mandate 27): pure, deterministic helpers that turn a scored target into an outreach
// plan — the recommended ASSET (minimum sufficient artifact), the RECIPIENT resolution, and the readable
// "Why this business" explanation. No repo/IO here; the adapter feeds canonical data in.
// ─────────────────────────────────────────────────────────────────────────────
import type { TargetingInput, TargetingScore, RecipientResolution, RecipientRole } from "./scoring";

// ── ASSET ROUTING ──────────────────────────────────────────────────────────────
export type OutreachLane = "presentation-video" | "presentation-pdf-email" | "evidence-email" | "operator-review" | "none";
export interface AssetRouting {
  lane: OutreachLane;
  asset: "personalized-video" | "quick-review-pdf+email" | "evidence-email" | "none";
  reason: string;
  requiresApproval: boolean; // whether this package type requires operator approval before scheduling
}

/** Select the MINIMUM sufficient artifact for a scored target. Never fabricate a video to fill capacity. */
export function routeAsset(score: TargetingScore, opts: { videoCapacityAvailable: boolean }): AssetRouting {
  if (score.band === "INELIGIBLE" || score.band === "DO_NOT_PREPARE") {
    return { lane: "none", asset: "none", reason: `${score.band} — no package, no capacity consumed`, requiresApproval: false };
  }
  if (score.band === "REVIEW") {
    return { lane: "operator-review", asset: "none", reason: "REVIEW band — operator review only, no scheduling", requiresApproval: true };
  }
  if (score.band === "PRIORITY_A") {
    // Presentation lane: video when it's visually demonstrable AND capacity permits; else PDF+email.
    const visual = score.components.digitalReputationGap >= 12;
    if (visual && opts.videoCapacityAvailable) {
      return { lane: "presentation-video", asset: "personalized-video", reason: "PRIORITY_A + demonstrable visual opportunity + video capacity", requiresApproval: true };
    }
    return { lane: "presentation-pdf-email", asset: "quick-review-pdf+email", reason: opts.videoCapacityAvailable ? "PRIORITY_A but opportunity is better explained than shown" : "PRIORITY_A but no video capacity — PDF + evidence email", requiresApproval: true };
  }
  // PRIORITY_B → evidence-email lane; a PDF only when it adds real explanatory value; video only after A.
  const pdfAddsValue = score.components.evidenceSpecificity >= 10;
  return { lane: "evidence-email", asset: pdfAddsValue ? "quick-review-pdf+email" : "evidence-email", reason: pdfAddsValue ? "PRIORITY_B with strong specific evidence — PDF adds explanatory value" : "PRIORITY_B — concise personalized evidence email", requiresApproval: true };
}

// ── RECIPIENT RESOLUTION ─────────────────────────────────────────────────────────
export interface ContactLike {
  role?: string | null;         // e.g. "Owner", "Managing Partner", "General Manager", "Marketing Director"
  email?: string | null;
  verified?: boolean;
  confidenceScore?: number;     // 0..1 (from Confidence.score)
  locallyControlled?: boolean;
  source?: string | null;
  inferredPattern?: boolean;    // true when the email was GUESSED from a pattern — never verified
}

const ROLE_MAP: Array<{ re: RegExp; role: RecipientRole }> = [
  { re: /owner|principal|proprietor/i, role: "owner" },
  { re: /founder|co-?founder/i, role: "founder" },
  { re: /managing partner|managing director|partner/i, role: "managing-partner" },
  { re: /general manager|gm\b|operations manager|branch manager/i, role: "general-manager" },
  { re: /marketing|brand|growth/i, role: "marketing-leader" },
];

/** Resolve a canonical contact into the persona's preferred recipient order with an honest verification state.
 *  An inferred email pattern can NEVER be marked verified. */
export function resolveRecipient(contact: ContactLike | null | undefined): RecipientResolution {
  if (!contact || !contact.email) return { role: "none", verified: false, confidence: 0, locallyControlled: false };
  const role = ROLE_MAP.find((m) => m.re.test(contact.role ?? ""))?.role ?? "general-inbox";
  const verified = !!contact.verified && !contact.inferredPattern; // pattern-inferred is never "verified"
  const confidence = Math.max(0, Math.min(1, contact.confidenceScore ?? (verified ? 0.7 : 0.3)));
  const locallyControlled = contact.locallyControlled ?? (role === "owner" || role === "founder" || role === "managing-partner");
  return { role, verified, confidence, locallyControlled };
}

/** Preferred recipient order (mandate 27): owner → managing partner → GM(local) → marketing(local) → inbox. */
export function recipientRank(r: RecipientResolution): number {
  const order: RecipientRole[] = ["owner", "founder", "managing-partner", "general-manager", "marketing-leader", "general-inbox", "none"];
  return order.indexOf(r.role);
}

// ── "WHY THIS BUSINESS" EXPLANATION ──────────────────────────────────────────────
export interface WhyThisBusiness {
  persona: string;
  marketReason: string;
  personaFit: string;
  reputationEarned: string;
  websiteGap: string;
  strongestOpportunity: string;
  recipientRationale: string;
  disqualifiers: string;
  total: number;
  components: TargetingScore["components"];
  evidenceIds: string[];        // evidence backing every material claim
  recommendedAsset: string;
}

export function explainTarget(input: TargetingInput, score: TargetingScore, asset: AssetRouting, marketReason: string): WhyThisBusiness {
  const topFinding = input.websiteFindings[0];
  const evidenceIds = Array.from(new Set([
    ...input.websiteFindings.map((f) => f.id),
    ...input.reputationSignals.map((f) => f.id),
    ...input.growthSignals.map((f) => f.id),
  ]));
  return {
    persona: score.terminalExclusions.length ? `INELIGIBLE (${score.terminalExclusions.join("; ")})` : "REPUTATION_RICH_DIGITALLY_UNDERREPRESENTED_OPERATOR",
    marketReason,
    personaFit: `${input.businessName} is an established local business in ${input.city}, ${input.state} (${input.marketTier} market) with genuine customer trust and an accessible decision-maker.`,
    reputationEarned: `${input.reviewCount} reviews at ${input.rating}★${input.ownerRepliesToReviews ? "; the owner personally replies to reviews" : ""}${input.hasAwardsOrLongHistory ? "; awards / long operating history" : ""}.`,
    websiteGap: input.strongModernConversionSite ? "The website is already a strong modern conversion experience — outreach would be irrelevant." : `The website underrepresents that reputation: ${input.websiteFindings.length} specific finding(s) with ${input.hasSupportedConsequence ? "a supported business consequence" : "no clearly supported consequence"}.`,
    strongestOpportunity: topFinding ? `${topFinding.observation} [${topFinding.id}]` : "No specific website opportunity captured.",
    recipientRationale: input.recipient.role === "none" ? "No verified recipient resolved." : `${input.recipient.role}${input.recipient.locallyControlled ? " (locally controls the decision)" : ""}, ${input.recipient.verified ? "verified" : "unverified"} at ${Math.round(input.recipient.confidence * 100)}% confidence.`,
    disqualifiers: score.terminalExclusions.length ? score.terminalExclusions.join("; ") : "None — passes all hard disqualifiers.",
    total: score.total,
    components: score.components,
    evidenceIds,
    recommendedAsset: `${asset.asset} (${asset.reason})`,
  };
}
