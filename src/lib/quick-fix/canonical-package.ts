// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL PACKAGE READ MODEL (Active Inventory Integrity mandate §1, §2, §37).
//
// ONE read model per package that EVERY operator + customer surface derives from:
// Quick Cash list, Workspace Overview, Preview, Evidence, Video, PDF, Email, Offer
// Page, and Breakbot. The observed contradictions ("no subject" in Overview while
// Preview has one; "screenshots MISSING" while the PDF claims evidence; a personalized
// video missing while the package says "no blockers") were the symptom of every surface
// building its OWN view from divergent fields. This makes the story canonical exactly
// once, then hangs the derived surfaces off it.
//
// It composes the pre-existing canonical primitives — buildEvidencePackage (one evidence
// truth), experienceFrameForOffer (one copy source), offerSubject (one subject), and the
// canonical explainer resolver — and adds the coherence (§13) + completeness (§4–§9)
// judgements plus a `revision` digest that CHANGES whenever any customer-facing material
// changes (the touch-invalidation key Breakbot binds its verdict to, §33).
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import type { QuickFixOffer } from "./types";
import type { StoredOffer } from "./store";
import { buildEvidencePackage, type EvidencePackage, type AssetStatus } from "./evidence-package";
import { experienceFrameForOffer } from "./experience-frame";
import { offerSubject } from "./offer-outreach";
import { isRetiredSubject } from "./subject-engine";
import { scopeForOffer, type TrustVideoScope } from "./trust-videos";
import { resolveCanonicalExplainer, type ExplainerSourceKind } from "./explainer-library";
import { buildRequirements } from "./requirements";
import { buildStripeDescription } from "./stripe-copy";
import { evidenceVersion } from "./evidence-truth";
import { PERSUASION_POLICY_VERSION } from "./offer-readiness";
import { assessPackageCoherence, coherenceBlocks, type CoherenceIssue } from "./package-coherence";
import { assessPackageCompleteness, type PackageCompleteness } from "./package-completeness";
import { assessMarketGate, type MarketGate } from "./market-gate";

/** Compact persisted Problem Reality snapshot (§33). */
export interface ProblemRealitySnapshot {
  verdict: "PROVEN" | "PLAUSIBLE" | "WEAK" | "DISPROVEN" | "NO_MATERIAL_PROBLEM";
  score: number;
}

/** Inventory bucket (§3). Distinct from readiness — this is "is it real active work". */
export type InventoryClass = "ACTIVE" | "RETIRED" | "LEGACY" | "DISQUALIFIED" | "DUPLICATE" | "FIXTURE";

/** Materialization readiness of an ACTIVE package (§39). */
export type PackageReadiness = "PREPARING" | "READY" | "WAITING_FOR_PAID" | "BLOCKED" | "NOT_ACTIVE";

/** The ONE coherent story every surface renders. Never recomputed per surface. */
export interface PackageStory {
  subject: string;
  primaryFinding: string;
  firstLine: string;
  heroTitle: string;
  whyItMatters: string;
  proposedSolution: string;
  offerName: string;
  priceLabel: string;
}

export interface PackageAssets {
  screenshots: {
    count: number;
    status: "READY" | "MISSING" | "STALE";
    mobileRequired: boolean;
    mobilePresent: boolean;
    desktopPresent: boolean;
  };
  personalizedVideo: { required: boolean; status: AssetStatus; url: string | null };
  evergreen: { scope: TrustVideoScope; source: ExplainerSourceKind; status: "READY" | "MISSING"; title: string; servedUrl: string | null };
  pdf: { status: AssetStatus };
}

export interface PackageNextAction {
  /** The single normal recovery/advance action (§38). */
  kind: "complete-package" | "retire" | "generate-video" | "inspect" | "waiting" | "none";
  label: string;
  helper: string | null;
}

export interface CanonicalPackage {
  offerId: string;
  leadId: string;
  company: string;
  websiteUrl: string | null;
  shareToken: string | null;
  scope: TrustVideoScope;
  quickFixEligible: boolean;
  priceCents: number | null;
  inventoryClass: InventoryClass;
  story: PackageStory;
  assets: PackageAssets;
  coherence: { issues: CoherenceIssue[]; blocks: boolean };
  completeness: PackageCompleteness;
  /** Problem Reality verdict (§33) — only PROVEN reaches READY. Null ⇒ never assessed. */
  problemReality: ProblemRealitySnapshot | null;
  /** Target-market gate (§10/§41) — null when no location was supplied to the builder. */
  market: MarketGate | null;
  readiness: PackageReadiness;
  /** Human-facing reasons the package is not READY (empty when READY). */
  blockers: string[];
  nextAction: PackageNextAction;
  /** Digest of all customer-facing material — changes ⇒ prior Breakbot PASS is void (§33). */
  revision: string;
  /** The underlying evidence package (surfaces that already need it avoid a rebuild). */
  evidence: EvidencePackage;
}

export interface BuildCanonicalPackageOpts {
  stored?: StoredOffer | null;
  evidence?: EvidencePackage | null;
  classification?: InventoryClass;
  /** #202 finalist eligibility → a personalized diagnostic video is required. */
  personalizedVideoRequired?: boolean;
  /** Override the persisted Problem Reality verdict (e.g. a fresh re-assessment). */
  problemReality?: ProblemRealitySnapshot | null;
  /** The lead's location for the target-market gate + card label (§10/§41). */
  location?: { city?: string | null; state?: string | null } | null;
}

const MOBILE_RE = /\bmobile\b|\bphone\b|\bsmall screen\b|\bresponsive\b/i;

function canonicalSubject(offer: QuickFixOffer, stored: StoredOffer | null): string {
  return stored?.approvedSubjectFrozen || stored?.subjectSelected || offerSubject(offer) || "";
}

/**
 * Build the canonical package read model for an offer. Async (evidence + explainer
 * resolution). Prefer passing a pre-built `evidence` package + `stored` offer when the
 * caller already has them (workspace/list) to avoid rework.
 */
export async function buildCanonicalPackage(offer: QuickFixOffer, opts: BuildCanonicalPackageOpts = {}): Promise<CanonicalPackage> {
  const stored = opts.stored ?? null;
  const inventoryClass: InventoryClass = opts.classification ?? (stored?.retiredAt ? "RETIRED" : "ACTIVE");

  const evidence =
    opts.evidence ?? (await buildEvidencePackage(offer, { personalizedVideo: stored?.personalizedVideo ?? null }));

  const frame = experienceFrameForOffer(offer);
  const subject = canonicalSubject(offer, stored);
  const scope = scopeForOffer(offer);
  const explainer = await resolveCanonicalExplainer(scope);
  const desc = buildStripeDescription(offer);
  const requirements = buildRequirements(offer);

  // Primary finding anchors on the first evidence finding (offer.findingIds[0]); fall back
  // to the offer's canonical problem statement. whyItMatters is finding-specific (§15).
  const primary = evidence.findings[0] ?? null;
  const primaryFinding = primary?.plain || offer.scope.problemBeingSolved || offer.notEligibleReason || "";
  const whyItMatters = primary?.whyItMatters || "";

  // Screenshot facts from the ONE evidence truth.
  const ready = evidence.screenshots.filter((s) => s.status === "READY");
  const mobilePresent = ready.some((s) => s.viewport === "mobile");
  const desktopPresent = ready.some((s) => s.viewport === "desktop");
  const mentionsMobile =
    frame.family === "mobile_booking" ||
    frame.family === "mobile_contact" ||
    MOBILE_RE.test(`${primaryFinding} ${offer.scope.problemBeingSolved} ${subject}`);

  const pvRequired = opts.personalizedVideoRequired ?? false;
  const pvStatus = evidence.personalizedVideo.status;

  // Cheap offer-page readiness proxy (mirrors buildOfferPageModel.purchasable without the
  // heavy page-service build): eligible + approved + requirements + copy-safe + explainer.
  const evergreenReady = explainer.source !== "missing";
  const offerPageReady =
    offer.quickFixEligible &&
    stored?.approvalStatus === "approved" &&
    requirements.items.length > 0 &&
    desc.safe &&
    evergreenReady;

  const evidenceStale = !!(stored?.evidenceVersion && stored.evidenceVersion !== evidenceVersion(evidence));
  const policyStale = !!(stored?.persuasionPolicyVersion && stored.persuasionPolicyVersion !== PERSUASION_POLICY_VERSION);

  const hasSpecificSubject = !!subject && subject.trim() !== "" && !isRetiredSubject(subject);

  const completeness = assessPackageCompleteness({
    hasFinding: offer.findingIds.length > 0 && evidence.findings.length > 0,
    hasSubject: hasSpecificSubject,
    screenshotStatus: evidence.screenshotStatus === "READY" ? "READY" : "MISSING",
    emailSafe: desc.safe,
    pdfRenderable: evidence.diagnosticPdf.status === "READY",
    offerPageReady,
    evergreenStatus: evergreenReady ? "READY" : "MISSING",
    personalizedVideo: {
      required: pvRequired,
      status: pvStatus === "READY" ? "READY" : pvStatus === "STALE" ? "STALE" : "MISSING",
    },
    evidenceStale,
    policyStale,
  });

  const coherenceIssues = assessPackageCoherence({
    subject,
    findingText: primaryFinding,
    firstLine: frame.emailOpener,
    heroTitle: frame.offerHeroTitle,
    whyItMatters,
    attemptSupported: frame.attemptSupported,
    mentionsMobile,
    hasMobileScreenshot: mobilePresent,
    hasAnyScreenshot: ready.length > 0,
    screenshotCount: ready.length,
    quickFixEligible: offer.quickFixEligible,
  });
  const blocks = coherenceBlocks(coherenceIssues);

  const problemReality: ProblemRealitySnapshot | null =
    opts.problemReality ?? (stored?.problemRealityVerdict ? { verdict: stored.problemRealityVerdict, score: stored.problemRealityScore ?? 0 } : null);
  const market = opts.location ? assessMarketGate(opts.location) : null;

  // ── Readiness derivation ──────────────────────────────────────────────────────
  const blockers: string[] = [];
  // A retire is the honest action when the problem is not real or the lead is out of market.
  let retireRequired = false;
  let readiness: PackageReadiness;
  if (inventoryClass !== "ACTIVE") {
    readiness = "NOT_ACTIVE";
  } else if (!offer.quickFixEligible) {
    // Conversation-only — not a materializable sellable package.
    readiness = "NOT_ACTIVE";
  } else {
    if (blocks) blockers.push(...coherenceIssues.filter((i) => i.severity === "BLOCK").map((i) => i.detail));
    if (!completeness.dependencies.find((d) => d.dep === "finding" && d.status === "READY")) blockers.push("no primary evidence-backed finding");
    if (!evergreenReady) blockers.push("no canonical evergreen explainer for this scope");

    // Target-market gate (§10/§37): out-of-market ⇒ reject before it can be READY.
    if (market && !market.inMarket) { blockers.push(market.reason ?? "outside the approved target markets"); retireRequired = true; }

    // Problem Reality gate (§33): only a PROVEN problem reaches READY; a NO_MATERIAL_PROBLEM
    // or DISPROVEN verdict means the honest action is to RETIRE (a good, successful result).
    if (problemReality) {
      if (problemReality.verdict === "NO_MATERIAL_PROBLEM" || problemReality.verdict === "DISPROVEN") {
        blockers.push(`problem reality ${problemReality.verdict} — no compelling Quick-Fix; retire and replace`);
        retireRequired = true;
      } else if (problemReality.verdict !== "PROVEN") {
        blockers.push(`problem reality not PROVEN (${problemReality.verdict}) — must survive the reality gate + counter-test`);
      }
    }

    if (blockers.length > 0) readiness = "BLOCKED";
    else if (completeness.complete) readiness = "READY";
    else if (completeness.waitingForPaidOnly) readiness = "WAITING_FOR_PAID";
    else readiness = "PREPARING";
  }

  const nextAction = deriveNextAction(readiness, completeness, offer, retireRequired);

  const revision = computePackageRevision({
    subject,
    primaryFinding,
    heroTitle: frame.offerHeroTitle,
    whyItMatters,
    offerName: offer.scope.offerName,
    priceCents: offer.priceCents,
    scope,
    screenshotShas: ready.map((s) => `${s.viewport}:${s.sha256 ?? ""}`).sort(),
    pdfStatus: evidence.diagnosticPdf.status,
    pvKey: stored?.personalizedVideo?.mp4Key ?? null,
    pvEvidenceVersion: stored?.personalizedVideo?.evidenceVersion ?? null,
    evergreenRevision: explainer.assetRevision,
  });

  return {
    offerId: offer.offerId,
    leadId: offer.leadId,
    company: offer.companyName,
    websiteUrl: evidence.websiteUrl,
    shareToken: stored?.shareToken ?? null,
    scope,
    quickFixEligible: offer.quickFixEligible,
    priceCents: offer.quickFixEligible ? offer.priceCents : null,
    inventoryClass,
    story: {
      subject,
      primaryFinding,
      firstLine: frame.emailOpener,
      heroTitle: frame.offerHeroTitle,
      whyItMatters,
      proposedSolution: offer.scope.proposedSolution,
      offerName: offer.scope.offerName,
      priceLabel: offer.quickFixEligible ? `$${Math.round(offer.priceCents / 100)} flat` : "",
    },
    assets: {
      screenshots: {
        count: ready.length,
        status: evidence.screenshotStatus === "READY" ? "READY" : "MISSING",
        mobileRequired: mentionsMobile,
        mobilePresent,
        desktopPresent,
      },
      personalizedVideo: { required: pvRequired, status: pvStatus, url: evidence.personalizedVideo.url },
      evergreen: { scope, source: explainer.source, status: evergreenReady ? "READY" : "MISSING", title: explainer.title, servedUrl: explainer.servedMp4Url },
      pdf: { status: evidence.diagnosticPdf.status },
    },
    coherence: { issues: coherenceIssues, blocks },
    completeness,
    problemReality,
    market,
    readiness,
    blockers,
    nextAction,
    revision,
    evidence,
  };
}

function deriveNextAction(
  readiness: PackageReadiness,
  completeness: PackageCompleteness,
  offer: QuickFixOffer,
  retireRequired: boolean,
): PackageNextAction {
  if (readiness === "NOT_ACTIVE") return { kind: "none", label: "—", helper: null };
  // Out-of-market / no-material-problem / disproven ⇒ the honest action is to retire (§10/§14/§33).
  if (retireRequired) return { kind: "retire", label: "Reject / Not a Fit", helper: "No compelling in-market problem — remove from active work (history preserved)." };
  if (readiness === "READY") return { kind: "inspect", label: "Preview package", helper: "Package is complete and Breakbot-eligible." };
  if (readiness === "WAITING_FOR_PAID") return { kind: "generate-video", label: "Generate personalized video", helper: "Requires #202 finalist authorization + voice capacity." };

  // BLOCKED / PREPARING. If there is no primary finding at all, the honest action is to
  // retire, not to dress up a non-package (§10/§14).
  const noFinding = offer.findingIds.length === 0;
  if (noFinding) return { kind: "retire", label: "Reject / Not a Fit", helper: "No evidence-backed finding to sell — remove from active work." };
  return {
    kind: "complete-package",
    label: "Complete Package",
    helper: `Brings this package to the highest valid state (${completeness.missing.length + completeness.stale.length} item(s) to reconcile).`,
  };
}

interface RevisionInput {
  subject: string;
  primaryFinding: string;
  heroTitle: string;
  whyItMatters: string;
  offerName: string;
  priceCents: number;
  scope: string;
  screenshotShas: string[];
  pdfStatus: string;
  pvKey: string | null;
  pvEvidenceVersion: string | null;
  evergreenRevision: string | null;
}

/** Stable digest of everything a customer could see. Any change ⇒ revision changes (§33). */
export function computePackageRevision(input: RevisionInput): string {
  const canon = JSON.stringify(input);
  return `pkg_${createHash("sha256").update(canon).digest("hex").slice(0, 16)}`;
}
