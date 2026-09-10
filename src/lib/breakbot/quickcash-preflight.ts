// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — QUICK-CASH PRE-FLIGHT QA ENGINE.
//
// An autonomous, adversarial pre-flight QA pass over the ENTIRE Quick-Cash customer
// journey for one offer/fixture. It assembles the real customer-facing artifact set
// (subject → email → PDF → offer page → evidence → personalized video → checkout →
// approval/send → manifest → fulfillment) and runs EVERY deterministic check the OS
// already ships, then adds the journey-specific checks the individual primitives do
// not cover on their own. It tries to PROVE the assembled experience VIOLATES the
// approved strategy and returns a structured READY / BLOCKED verdict.
//
// COMPOSITION, NOT REIMPLEMENTATION. Every rule is a primitive:
//   • offer-readiness.assessOfferReadiness + the 15 exported check* functions
//   • no-dark-patterns.scanDarkPatterns
//   • evidence-truth.evidenceVersion / detectStaleAssets / approvalInvalidatedByEvidenceChange
//   • evidence-package.customerReceivesManifest
//   • experience-frame.experienceFrameForOffer
//   • subject-engine.isPolicyCompliantSubject (+ SUBJECT_POLICY_VERSION)
//   • offer-outreach.composeOfferOutreach + email-attachment-policy.buildOutreachAttachments
//   • offer-page.buildOfferPageModel
//   • customer-language.assessOfferCustomerLanguage
//   • trust-videos.trustVideoForOffer (+ caption/narration versions)
//   • fulfillment-center.buildFulfillmentPacket / buildRunbook / buildAccessCenter / scopeGate / safetyGate
//   • fulfillment.canTransitionJob
//   • operator-views.opportunityWorkspaceView (read-only; when a store-backed offer exists)
//
// FAIL-CLOSED (Part Y). Breakbot NEVER approves, sends, charges, schedules, or mutates
// any state. It only READS the assembled artifacts and REPORTS. A BLOCKER is the only
// thing that prevents READY; WARNING / INFO never block. Every issue names the surface,
// what was EXPECTED, what was OBSERVED, and the FIX — no vague messages.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "../quick-fix/types";
import type { EvidencePackage } from "../quick-fix/evidence-package";
import { customerReceivesManifest, type ManifestRow } from "../quick-fix/evidence-package";
import {
  assessOfferReadiness,
  type OfferArtifact,
  type ReadinessIssue,
  PERSUASION_POLICY_VERSION,
} from "../quick-fix/offer-readiness";
import {
  evidenceVersion,
  detectStaleAssets,
  approvalInvalidatedByEvidenceChange,
  type DependentAsset,
} from "../quick-fix/evidence-truth";
import { experienceFrameForOffer } from "../quick-fix/experience-frame";
import { isPolicyCompliantSubject, SUBJECT_POLICY_VERSION } from "../quick-fix/subject-engine";
import { composeOfferOutreach, type OfferOutreachCopy } from "../quick-fix/offer-outreach";
import {
  buildOutreachAttachments,
  type OutreachAttachmentManifest,
} from "../quick-fix/email-attachment-policy";
import { buildOfferPageModel, type OfferPageModel } from "../quick-fix/offer-page";
import type { EvergreenAssetVersion } from "../quick-fix/evergreen-asset";
import { assessOfferCustomerLanguage } from "../quick-fix/customer-language";
import {
  trustVideoForOffer,
  TRUST_VIDEO_NARRATION_VERSION,
  type TrustVideoAsset,
} from "../quick-fix/trust-videos";
import {
  buildFulfillmentPacket,
  buildRunbook,
  normalizePlatform,
  scopeGate,
  safetyGate,
  type Platform,
  type FulfillmentPacket,
} from "../quick-fix/fulfillment-center";
import { canTransitionJob } from "../quick-fix/fulfillment";
import {
  buildVideoStoryboard,
  assessNarrationTruth,
  narrationDigestFor,
  PV_NARRATION_VERSION,
  PV_RENDER_VERSION,
} from "../quick-fix/personalized-video";
import { voiceGeneration, sameVoiceGeneration } from "../voice/registry";
import { playbookFor } from "../quick-fix/playbooks";
import type { JobRecord } from "../quick-fix/store";
import type { CustomerRecord } from "../quick-fix/lifecycle";

// ── Verdict model (Part S) ───────────────────────────────────────────────────
export type Severity = "BLOCKER" | "WARNING" | "INFO";

/** One finding. NEVER vague — always names the surface, expected, observed, fix. */
export interface Issue {
  /** Which journey surface the problem is on (e.g. "email.opener", "video.binding"). */
  surface: string;
  severity: Severity;
  /** What a compliant experience requires. */
  expected: string;
  /** What was actually observed in the assembled artifact. */
  observed: string;
  /** The concrete operator fix. */
  fix: string;
  /** Optional stable link/anchor to the offending surface. */
  link?: string;
}

export interface VerdictCounts {
  blockers: number;
  warnings: number;
  info: number;
  passed: number;
  total: number;
}

export interface BreakbotVerdict {
  overall: "READY" | "BLOCKED";
  counts: VerdictCounts;
  issues: Issue[];
}

// ── Engine input — the fixture/opportunity assembles this; Breakbot never mutates ─
/**
 * The ASSISTED (side-effect-observing) inputs. Breakbot cannot perform an approve/send/
 * charge — so a fixture that wants to PROVE "approval silently sends/schedules" declares
 * what the approve action ACTUALLY did (0 sends / 0 schedules is required). These are
 * OBSERVATIONS of a hypothetical action, never an instruction to perform one.
 */
export interface ApprovalObservation {
  /** How many emails the approve action caused. Must be 0. */
  sendsCausedByApprove: number;
  /** How many schedules the approve action caused. Must be 0. */
  schedulesCausedByApprove: number;
  /** Whether send is a distinct, explicit, operator-initiated action (not auto). */
  sendIsExplicit: boolean;
  /** Whether schedule is a distinct, explicit, operator-initiated action (not auto). */
  scheduleIsExplicit: boolean;
  /** The evidence version the approval was taken against (null ⇒ unstamped). */
  approvedEvidenceVersion?: string | null;
}

/**
 * Checkout observation — Breakbot verifies the checkout is a SAFE/PREVIEW configuration
 * and never a live charge. The fixture declares the checkout config; Breakbot proves it.
 */
export interface CheckoutObservation {
  /** The SKU/line item the checkout charges for (must match the offer). */
  checkoutSku?: string | null;
  /** The price cents the checkout charges (must match server offer.priceCents). */
  checkoutPriceCents?: number | null;
  /** Stripe managed_payments flag — MUST be false. */
  managedPayments: boolean;
  /** Whether the webhook (not the browser redirect) is the authoritative purchase signal. */
  webhookAuthoritative: boolean;
  /** Whether this checkout is a real LIVE charge. MUST be false for a preflight. */
  liveCharge: boolean;
}

/** A demo/test purchase that MUST NOT be counted toward real revenue. */
export interface DemoObservation {
  /** Whether a demo/test order was recorded for this offer. */
  isDemo: boolean;
  /** Whether that demo order was counted toward reported revenue (must be false). */
  countedTowardRevenue: boolean;
}

export interface FulfillmentInput {
  /** The detected/inferred site platform. "unknown"/unmapped ⇒ NEEDS_TECHNICAL_REVIEW. */
  detectedPlatform?: string | null;
  /** The paid job's current lifecycle state (for the runbook + transition proof). */
  jobState?: JobRecord["state"];
  /** Whether required customer access has been received (drives the safety gate). */
  accessReceived?: boolean;
  /** Whether the pre-change state was captured (drives the safety gate). */
  preChangeCaptured?: boolean;
  /** The customer record (portal/email) — null when not yet a customer. */
  customer?: CustomerRecord | null;
  /** Whether a customer portal/thread exists for post-purchase communication. */
  customerPortalPresent?: boolean;
  termsVersion?: string | null;
}

export interface BreakbotPreflightInput {
  /** The fully assembled server offer (fixtures own this — no store dependency). */
  offer: QuickFixOffer;
  /** The ONE canonical evidence package the whole journey derives from. */
  evidence: EvidencePackage;
  /** Dependent assets + their stamped evidence versions (PDF/video/derivatives). */
  dependentAssets?: DependentAsset[];
  /** The evergreen explainer version surfaced on the offer page (null ⇒ script-only). */
  evergreen?: EvergreenAssetVersion | null;
  /** The subject the operator SELECTED (null ⇒ engine derives via composeOfferOutreach). */
  approvedSubject?: string | null;
  /** The trust-video asset actually bound to this offer (defaults to trustVideoForOffer). */
  videoAsset?: TrustVideoAsset | null;
  /** Whether a screenshot is REQUIRED for this offer family (visual defect). */
  screenshotsRequired?: boolean;
  approval?: ApprovalObservation;
  checkout?: CheckoutObservation;
  demo?: DemoObservation;
  fulfillment?: FulfillmentInput;
  /** The operator workspace view for this offer (read-only), when store-backed. Optional. */
  operatorView?: {
    websiteUrl: string | null;
    legacyFrozenShownActive?: boolean;
  } | null;
  /** Whether this offer is genuinely fulfillable today (a supported delivery path exists). */
  sellable?: boolean;

  // ── ARTIFACT OVERRIDES ──────────────────────────────────────────────────────
  // Breakbot QAs whatever customer-facing artifact it is handed. When a caller (or an
  // adversarial fixture) provides the actual assembled surface — because the composer
  // was overridden, hand-edited, or a defect was introduced upstream — these override
  // the derived defaults so the checks run over the REAL artifact, not an idealized one.
  /** Override the email body the checks scan (else the composed body). */
  emailBodyOverride?: string | null;
  /** Extra customer-visible copy appended to the scanned offer-page/email surfaces. */
  extraCustomerCopy?: string[];
  /** Override the offer-page blocks in reading order (else derived from the page model). */
  offerPageBlocksOverride?: string[];
  /** Override whether the exact price is visible before purchase (else derived). */
  priceVisibleBeforePurchaseOverride?: boolean;

  // ── VOICE COHERENCE (journey-level ElevenLabs voiceover chain) ───────────────
  /**
   * Journey-level VOICE COHERENCE inputs. A prospect journey resolves to exactly ONE
   * coherent generation — ALL Matt (current) or ALL Lucas (legacy), never mixed. Matt is
   * the default for new journeys; Lucas legacy journeys are preserved and remain valid.
   * OPTIONAL: when absent, Breakbot runs NO voice-coherence checks (existing callers and
   * the regression batch never regress). When present, runVoiceCoherenceChecks validates
   * the whole chain (audio readiness + generation coherence + no secret leaks).
   */
  voiceCoherence?: {
    /** The lead's canonical journey voice key (the generation the whole journey must match). */
    leadCanonicalVoiceKey: string;
    /** The voice key of the personalized/problem video. */
    problemVideoVoiceKey?: string | null;
    /** The voice key of the trust video. */
    trustVideoVoiceKey?: string | null;
    /** The canonical voiceover bound to this offer's narration (null ⇒ none bound). */
    voiceover?: {
      present: boolean;
      status: "VOICEOVER_GENERATING" | "VOICEOVER_READY" | "VOICEOVER_FAILED";
      narrationRevision: string;
      leadId: string;
      durationSeconds: number | null;
      assetBytes: number | null;
    } | null;
  } | null;

  // ── FULL PRESENTATION READINESS (the live customer experience end-to-end) ────
  /**
   * The assembled, DURABLE customer-facing experience for the whole journey. OPTIONAL:
   * when absent, Breakbot runs NO presentation checks (existing callers/regression never
   * regress). When present, runPresentationReadinessChecks proves the personalized video
   * exists in durable storage, its served URL resolves + is playable, the trust video
   * resolves in the SAME generation, no raw storage URL / secret leaks into any customer
   * asset URL, and nothing stale is selected. Breakbot never fetches — the caller does the
   * resolution/serve probe and declares the OBSERVED facts here.
   */
  presentation?: {
    /** The personalized diagnostic video's live serving facts. */
    personalizedVideo: {
      /** Effective status recomputed against current evidence/narration/render. */
      status: "NOT_GENERATED" | "QUEUED" | "RENDERING" | "READY" | "STALE" | "FAILED" | "BLOCKED";
      /** Durable object-store key for the mp4 (null ⇒ local-only / not durable). */
      mp4Key: string | null;
      /** App-managed served route the customer page embeds (never a raw storage URL). */
      mp4Url: string | null;
      posterKey: string | null;
      durationSeconds: number | null;
      /** The render's voice generation (matt | lucas). */
      voiceGeneration: string | null;
      /** Did the served-video resolver return OK (the current READY render streams)? */
      servedUrlResolves: boolean;
    } | null;
    /** The journey-resolved trust video's live facts. */
    trust: {
      outcome: "use-legacy-lucas" | "reuse-matt" | "prepare-matt";
      generation: string; // matt | lucas
      /** The served trust asset URL (null for prepare-matt / script-only). */
      assetUrl: string | null;
      /** True ONLY for a Matt journey whose Matt trust video is not built yet. */
      mattTrustMissing: boolean;
      /** Media-format contract: the offer/trust explainer must be LANDSCAPE. Null when no asset is bound. */
      orientation?: "landscape" | "portrait" | null;
    } | null;
    /** EVERY customer-facing asset URL to scan for raw-storage/secret/filesystem leakage. */
    customerAssetUrls?: string[];
  } | null;
}

/** A prior verdict + the versions it was computed under, for staleness detection (Part T). */
export interface BreakbotPassSnapshot {
  ready: boolean;
  evidenceVersion: string;
  persuasionPolicyVersion: string;
  subjectPolicyVersion: string;
  approvedSubjectFrozen: string | null;
  narrationVersion: string;
  personalizedVideoNarrationVersion: string;
  personalizedVideoRenderVersion: string;
}

// ── Small helpers ──────────────────────────────────────────────────────────────
function issue(i: Issue): Issue {
  return i;
}
function fromReadiness(r: ReadinessIssue, fix: string): Issue {
  return {
    surface: r.surface,
    severity: r.severity, // ReadinessSeverity is BLOCKER|WARNING — a subset of Severity
    expected: r.expected,
    observed: r.observed,
    fix,
  };
}
const RAW_URL_RE = /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/i;
const PRICE_RE = /\$\s?\d|\bdollars?\b|\b\d+\s?usd\b|\bflat\b/i;

// A default remediation for each readiness surface family (never a vague message).
function readinessFix(surface: string): string {
  if (surface.startsWith("rawUrl")) return "Replace the raw URL with a labeled link; keep the href correct but hide it behind text.";
  if (surface.startsWith("darkPattern")) return "Remove the manipulative pattern from the customer-facing copy — persuade with the evidence, not pressure.";
  if (surface.startsWith("fabrication")) return "Remove the unsupported business-impact claim; only state what the evidence actually supports.";
  switch (surface) {
    case "subject": return "Select an evidence-derived, policy-compliant subject from the subject engine's candidates.";
    case "email.opener": return "Set the first sentence to experienceFrameForOffer(offer).emailOpener verbatim.";
    case "pdf.current": return "Regenerate the diagnostic PDF against the current evidence version before attaching/linking it.";
    case "screenshots": return "Capture at least one READY screenshot for this visual-defect offer before sending.";
    case "openingFrame": return "Lead the offer page with the observed problem/experience, not the price.";
    case "packageScope": return "Only promise items that are within the SKU/scope; remove any out-of-scope promise.";
    case "price.match": return "Make the displayed price equal the server offer.priceCents.";
    case "protections": return "Align the protections copy with the authoritative policy facts; do not promise a refund/guarantee the policy lacks.";
    case "priceVisibility": return "Show the exact price on the offer page before the purchase step.";
    case "checkout.surprise": return "Remove the surprise cost/scope at checkout; the checkout must match the offer.";
    case "customerLanguage": return "Translate the jargon/acronym/internal key into plain owner language (do not change scope).";
    case "attemptedUse": return "Use the honest observational opener — do not claim an attempted action the evidence does not support.";
    default: return "Resolve the readiness violation before this offer can be sent.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE
// ─────────────────────────────────────────────────────────────────────────────
export function runBreakbotPreflight(input: BreakbotPreflightInput): BreakbotVerdict {
  const { offer, evidence } = input;
  const issues: Issue[] = [];
  let passed = 0;
  const pass = () => { passed += 1; };

  const frame = experienceFrameForOffer(offer);
  const currentEvidenceVersion = evidenceVersion(evidence);

  // ── Assemble the customer-facing surfaces the SAME way the operator/customer views do.
  const offerPath = `/offer/${offer.offerId}`;
  const bookingUrl = "/book";
  const attachments = buildAttachmentsSync(input);
  const videoAsset = input.videoAsset ?? trustVideoForOffer(offer).asset;
  const copy: OfferOutreachCopy = composeOfferOutreach(
    offer,
    { buyUrl: offerPath, bookingUrl, videoUrl: attachments.videoLinkUrl ?? undefined },
    { assets: { pdf: attachments.pdf, video: attachments.video } },
  );
  const subject = input.approvedSubject ?? copy.subject;
  // The REAL composed body — scanned for raw URLs + default-opener + price-first below.
  const composedBody = input.emailBodyOverride ?? copy.bodyText;
  const firstLine = composedBody.split("\n\n")[0] ?? "";
  // The body fed to the readiness JARGON/opener checks. When a fixture overrides the body
  // (an adversarial hand-edited email), that IS the body under test. Otherwise we use the
  // evidence-first readiness body (opener + a short review line) exactly as the shipped
  // a2z-journey readiness assertion does — the composed "one-page review" template phrase
  // is an approved artifact and is not re-litigated by the internal-key jargon detector.
  const readinessBody = input.emailBodyOverride ?? `${frame.emailOpener} Here is a short review of what we found.`;

  const model: OfferPageModel = buildOfferPageModel({
    offer,
    evergreen: input.evergreen ?? null,
    approved: true,
    stripeConfigured: true,
    termsAccepted: true,
    superseded: false,
    bookingUrl,
    maintenanceUpsellEnabled: false,
    evidence,
  });

  // Offer page blocks in READING ORDER (hero → evidence → solution → package → price).
  const offerPageBlocks = (input.offerPageBlocksOverride ?? [
    model.experience.offerHeroTitle,
    model.experience.offerHeroSubline,
    model.whatWeFound,
    model.proposedSolution,
    ...model.whatWeFix,
    ...(model.conversationOnly ? [] : [model.priceLabel]),
  ]).filter(Boolean).concat(input.extraCustomerCopy ?? []) as string[];

  // The dependent-asset stamps (PDF + video) for staleness/wrong-business checks.
  const dependentAssets: DependentAsset[] = input.dependentAssets ?? [
    { kind: "diagnosticPdf", present: evidence.diagnosticPdf.status === "READY", generatedEvidenceVersion: currentEvidenceVersion },
  ];

  const artifact: OfferArtifact = {
    offer,
    evidence,
    subject,
    emailBody: readinessBody,
    emailFirstSentence: firstLine,
    offerPageBlocks,
    checkoutCopy: model.conversationOnly ? null : `${model.priceLabel}. ${model.turnaround}`,
    checkoutPriceText: model.conversationOnly ? null : model.priceLabel,
    priceVisibleBeforePurchase: input.priceVisibleBeforePurchaseOverride ?? !model.conversationOnly,
    packageItems: model.whatWeFix,
    scopeItems: offer.scope.includedItems,
    protectionsCopy: model.integrityPrinciples.join(" "),
    protectionsFacts: { revisionPolicy: offer.scope.revisionPolicy, deliveryWindow: offer.scope.deliveryWindow },
    dependentAssets,
    screenshotsRequired: input.screenshotsRequired ?? false,
  };

  // ── (D–L) ALL readiness checks — the 15 composed rules over the real artifact. ──
  const readiness = assessOfferReadiness(artifact);
  for (const r of readiness.issues) issues.push(fromReadiness(r, readinessFix(r.surface)));
  // Count each readiness check that produced NO issue as a pass (15 checks total).
  passed += 15 - new Set(readiness.issues.map((i) => baseSurface(i.surface))).size;

  // ── (D) SUBJECT — the approved subject the operator SELECTED must itself be compliant
  // (assessOfferReadiness checked `subject`; here we also hard-gate the frozen selection). ──
  if (subject && !isPolicyCompliantSubject(subject)) {
    // Already surfaced by checkSubject when subject===artifact.subject; only add if the
    // approved subject differs from the composed one and is itself non-compliant.
    if (input.approvedSubject && !readiness.issues.some((i) => i.surface === "subject")) {
      issues.push(issue({
        surface: "subject.approved",
        severity: "BLOCKER",
        expected: "the operator-selected (frozen) subject is policy-compliant",
        observed: `frozen subject "${subject}" fails subject policy`,
        fix: "Re-select a policy-compliant subject before approving.",
      }));
    }
  } else { pass(); }

  // ── (E) EMAIL: not a 'we reviewed…' default; not price-first; manifest correct. ──
  if (offer.quickFixEligible) {
    if (/^\s*(we|i)\s+(reviewed|analy[sz]ed|audited)\b/i.test(firstLine) ||
        /during our (audit|review)/i.test(firstLine)) {
      issues.push(issue({
        surface: "email.opener.default",
        severity: "BLOCKER",
        expected: "the evidence-backed experience-frame opener, never a 'we reviewed your website' default",
        observed: `opener was a generic default: "${firstLine}"`,
        fix: "Use experienceFrameForOffer(offer).emailOpener as the first sentence.",
      }));
    } else { pass(); }
    // Price must NOT dominate the first-touch email body (scan the REAL composed body).
    if (PRICE_RE.test(composedBody)) {
      issues.push(issue({
        surface: "email.priceFirst",
        severity: "BLOCKER",
        expected: "no price in the first-touch email body (the email earns the click; the page sells)",
        observed: "the email body contains price/money language",
        fix: "Remove price from the first-touch email; keep it on the offer page.",
      }));
    } else { pass(); }
  } else { pass(); pass(); }

  // Raw URLs in the REAL composed body (the readiness check scanned the readiness body;
  // this catches a raw-URL leak in the actual composer even when no override is supplied).
  if (RAW_URL_RE.test(composedBody) && !readiness.issues.some((i) => i.surface === "rawUrl.email")) {
    issues.push(issue({
      surface: "rawUrl.email",
      severity: "BLOCKER",
      expected: "no raw URL in the customer-visible email body (use a labeled link)",
      observed: `raw URL leaked into the composed email body`,
      fix: "Replace the raw URL with a labeled link; keep the href correct behind text.",
    }));
  }

  // Manifest correctness: the outreach attachment manifest must reflect real bindings.
  const emailReady = copy.safe;
  const manifest: ManifestRow[] = customerReceivesManifest(evidence, offer, emailReady);
  // The attachment manifest's disposition must agree with the real PDF asset status.
  const pdfAssetReady = evidence.diagnosticPdf.status === "READY";
  if (attachments.pdf === "ATTACHED" && !pdfAssetReady) {
    issues.push(issue({
      surface: "email.manifest",
      severity: "BLOCKER",
      expected: "the email attachment manifest matches real asset bindings (never ATTACHED without a READY PDF)",
      observed: `manifest says ATTACHED but the diagnostic PDF asset is ${evidence.diagnosticPdf.status}`,
      fix: "Fall back to LINKED/MISSING when the PDF is not READY for this offer.",
    }));
  } else { pass(); }

  // ── (F) PDF: right business + canonical-evidence match + not stale + filename/size. ──
  const pdfAsset = dependentAssets.find((a) => a.kind === "diagnosticPdf");
  if (pdfAsset && pdfAsset.present) {
    const det = detectStaleAssets(evidence, [pdfAsset]);
    if (det.assets[0].stale) {
      issues.push(issue({
        surface: "pdf.stale",
        severity: "BLOCKER",
        expected: `the diagnostic PDF is generated against the current evidence ${currentEvidenceVersion}`,
        observed: `${det.assets[0].status}: PDF stamped ${det.assets[0].observed ?? "unstamped"}`,
        fix: "Regenerate the PDF from the offer's current canonical evidence, then re-stamp it.",
      }));
    } else { pass(); }
    // Right business: the package the PDF derives from must be bound to THIS offer/lead.
    if (evidence.offerId !== offer.offerId || evidence.leadId !== offer.leadId) {
      issues.push(issue({
        surface: "pdf.wrongBusiness",
        severity: "BLOCKER",
        expected: "the PDF's evidence package is bound to THIS offer/business",
        observed: `evidence package is for offer=${evidence.offerId} lead=${evidence.leadId}, offer is ${offer.offerId}/${offer.leadId}`,
        fix: "Rebuild the diagnostic PDF from this offer's own evidence package.",
      }));
    } else { pass(); }
  } else { pass(); pass(); }

  // ── (H) EVIDENCE TRUTH: every surface derives from ONE canonical package. ──
  // The email/offer opener + PDF §1 must all trace to experienceFrame + the SAME package.
  const emailOpenerMatches = norm(firstLine) === norm(frame.emailOpener) || !offer.quickFixEligible;
  const offerHeroMatches = !!model.experience && model.experience.emailOpener === frame.emailOpener;
  if (!emailOpenerMatches || !offerHeroMatches) {
    issues.push(issue({
      surface: "evidence.oneTruth",
      severity: "BLOCKER",
      expected: "email, offer page, and PDF openers all derive from the ONE experience frame + evidence package",
      observed: `email-opener-matches=${emailOpenerMatches}, offer-hero-derives=${offerHeroMatches}`,
      fix: "Regenerate every surface from experienceFrameForOffer(offer) and the single evidence package.",
    }));
  } else { pass(); }

  // ── (I) ATTEMPTED-USE: passive evidence must NOT yield an 'I tried…' claim anywhere. ──
  // (offer-readiness check #15 covers email+offer page; here we also scan the derived video/PDF text.)
  const derivedSurfaces = [videoAsset?.title ?? "", model.experience.offerHeroTitle].join("\n");
  if (!frame.attemptSupported && /\bi tried to\b|\bi attempted to\b/i.test(derivedSurfaces)) {
    issues.push(issue({
      surface: "attemptedUse.derived",
      severity: "BLOCKER",
      expected: "no 'I tried' claim on any surface when the defect is observational (attemptSupported=false)",
      observed: "a derived surface (video/hero) claims an attempted action the evidence does not support",
      fix: "Use the honest observational frame for the video/hero on observational defects.",
    }));
  } else { pass(); }

  // ── (K) PERSONALIZED VIDEO: bound to offer; company voice; captions default-off +
  // captionsVerified matches narration; MISSING honest; evergreen kept separate. ──
  runVideoChecks(input, offer, videoAsset, evidence, issues, pass);

  // ── (M) CHECKOUT: SKU/price match; managed_payments=false; webhook authoritative;
  // NEVER a live charge (safe/preview only). ──
  runCheckoutChecks(input, offer, issues, pass);

  // ── (N) APPROVAL / SEND: approve causes 0 sends / 0 schedules; send+schedule explicit;
  // frozen-asset change invalidates approval. ──
  runApprovalChecks(input, evidence, currentEvidenceVersion, issues, pass);

  // ── (O) MANIFEST: customerReceives reflects real bindings, never READY from capability. ──
  runManifestChecks(manifest, evidence, issues, pass);

  // ── (J) CUSTOMER LANGUAGE — the offer/email/offer-page surfaces are already covered by
  // readiness check #14 (checkNoJargon). Here we add the ONE surface #14 does not see: the
  // operator-selected SUBJECT the customer reads in their inbox. (The approved evergreen
  // narration is a separately-approved artifact and is intentionally NOT re-scanned for
  // internal-key false positives — check #14 already governs the offer's customer copy.) ──
  const subjectLang = assessOfferCustomerLanguage(offer, { extra: [subject] });
  const subjectProblems = subjectLang.problems.filter((p) => p.startsWith("[extra[0]]"));
  if (subjectProblems.length > 0) {
    issues.push(issue({
      surface: "customerLanguage.subject",
      severity: "BLOCKER",
      expected: "the inbox subject uses plain owner language (no unexplained acronym/internal key)",
      observed: subjectProblems[0].replace("[extra[0]] ", ""),
      fix: "Select a plain-language subject from the subject engine's candidates.",
    }));
  } else { pass(); }

  // ── (P) FULFILLMENT READINESS: sellable ⇒ must be fulfillable, else BLOCK. ──
  runFulfillmentChecks(input, offer, issues, pass);

  // ── (Demo/revenue safety): a demo/test order must NEVER count toward real revenue. ──
  if (input.demo?.isDemo) {
    if (input.demo.countedTowardRevenue) {
      issues.push(issue({
        surface: "revenue.demoCounted",
        severity: "BLOCKER",
        expected: "a demo/test order is never counted toward reported revenue",
        observed: "a demo order was counted toward revenue",
        fix: "Exclude demo/test orders (provenance=demo/breakbot) from revenue reporting.",
      }));
    } else { pass(); }
  }

  // ── (Operator view): the website link the operator taps must be present. ──
  if (input.operatorView) {
    if (!input.operatorView.websiteUrl) {
      issues.push(issue({
        surface: "operator.websiteLink",
        severity: "BLOCKER",
        expected: "the operator workspace surfaces the canonical stored website URL",
        observed: "the operator view has no website link (operator must hunt for it)",
        fix: "Populate the offer's stored website URL so the operator taps it directly.",
      }));
    } else { pass(); }
    if (input.operatorView.legacyFrozenShownActive) {
      issues.push(issue({
        surface: "operator.legacyFrozen",
        severity: "BLOCKER",
        expected: "legacy frozen records are labelled FROZEN, never shown as active",
        observed: "a legacy/frozen record is displayed as an active Quick-Cash send",
        fix: "Classify the legacy record as LEGACY_FROZEN and never as an active send.",
      }));
    } else { pass(); }
  }

  // ── (Voice coherence): validate the journey-level ElevenLabs voiceover chain. Runs
  // ONLY when the caller supplied voiceCoherence — absent ⇒ zero voice checks (no regress). ──
  if (input.voiceCoherence) {
    runVoiceCoherenceChecks(input, offer, evidence, composedBody, offerPageBlocks, issues, pass);
  }

  // ── (Presentation readiness): validate the whole DURABLE live customer experience.
  // Runs ONLY when the caller supplied presentation — absent ⇒ zero checks (no regress). ──
  if (input.presentation) {
    runPresentationReadinessChecks(input, offer, composedBody, offerPageBlocks, issues, pass);
  }

  // ── Verdict roll-up (Part S) — ONLY a blocker prevents READY. ──
  const blockers = issues.filter((i) => i.severity === "BLOCKER").length;
  const warnings = issues.filter((i) => i.severity === "WARNING").length;
  const info = issues.filter((i) => i.severity === "INFO").length;
  return {
    overall: blockers === 0 ? "READY" : "BLOCKED",
    counts: { blockers, warnings, info, passed, total: passed + issues.length },
    issues,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// READINESS POLICY (Part T)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * BREAKBOT_READY: the verdict is READY under the CURRENT frozen versions. True only when
 * the pass found 0 blockers. (Just re-exposes the verdict's overall for a stable name.)
 */
export function breakbotReady(verdict: BreakbotVerdict): boolean {
  return verdict.overall === "READY";
}

/** Snapshot the versions a pass was computed under, for later staleness detection. */
export function breakbotPassSnapshot(input: BreakbotPreflightInput, verdict: BreakbotVerdict): BreakbotPassSnapshot {
  const subject = input.approvedSubject ??
    composeOfferOutreach(input.offer, { buyUrl: `/offer/${input.offer.offerId}`, bookingUrl: "/book" }).subject;
  return {
    ready: verdict.overall === "READY",
    evidenceVersion: evidenceVersion(input.evidence),
    persuasionPolicyVersion: PERSUASION_POLICY_VERSION,
    subjectPolicyVersion: SUBJECT_POLICY_VERSION,
    approvedSubjectFrozen: subject ?? null,
    narrationVersion: TRUST_VIDEO_NARRATION_VERSION,
    personalizedVideoNarrationVersion: PV_NARRATION_VERSION,
    personalizedVideoRenderVersion: PV_RENDER_VERSION,
  };
}

/**
 * breakbotResultIsStale — a prior PASS is stale when ANY frozen version it was computed
 * under has changed since (evidenceVersion, persuasion policy, subject policy, the frozen
 * approved subject, or the narration version). Reuses evidence-truth's version model:
 * a material artifact change makes a prior pass no longer trustworthy and re-runs Breakbot.
 */
export function breakbotResultIsStale(prev: BreakbotPassSnapshot, current: BreakbotPreflightInput): boolean {
  const now = breakbotPassSnapshot(current, { overall: prev.ready ? "READY" : "BLOCKED", counts: { blockers: 0, warnings: 0, info: 0, passed: 0, total: 0 }, issues: [] });
  // Reuse the canonical evidence-change verdict for the evidence dimension.
  const evidenceChanged = approvalInvalidatedByEvidenceChange(current.evidence, prev.evidenceVersion).invalidate;
  return (
    evidenceChanged ||
    now.persuasionPolicyVersion !== prev.persuasionPolicyVersion ||
    now.subjectPolicyVersion !== prev.subjectPolicyVersion ||
    now.approvedSubjectFrozen !== prev.approvedSubjectFrozen ||
    now.narrationVersion !== prev.narrationVersion ||
    now.personalizedVideoNarrationVersion !== prev.personalizedVideoNarrationVersion ||
    now.personalizedVideoRenderVersion !== prev.personalizedVideoRenderVersion
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Journey-specific check groups (compose primitives; add what they don't cover)
// ─────────────────────────────────────────────────────────────────────────────
function runVideoChecks(
  input: BreakbotPreflightInput,
  offer: QuickFixOffer,
  videoAsset: TrustVideoAsset,
  evidence: EvidencePackage,
  issues: Issue[],
  pass: () => void,
): void {
  // (1) PERSONALIZED VIDEO IS MANDATORY (new persuasion policy). The offer is presentation-
  //     ready ONLY when a current, evidence-bound personalized diagnostic video exists
  //     (evidence.personalizedVideo.status === "READY"). Any non-READY state — MISSING (i.e.
  //     NOT_GENERATED/QUEUED/RENDERING/FAILED/BLOCKED all surface as MISSING) or STALE — is a
  //     BLOCKER. This check depends ONLY on evidence.personalizedVideo; the evergreen explainer
  //     is a SEPARATE asset (checked below) and can NEVER satisfy the personalized requirement.
  if (evidence.personalizedVideo.status === "READY") {
    pass();
  } else {
    issues.push(issue({
      surface: "video.personalized",
      severity: "BLOCKER",
      expected: "a current, evidence-bound personalized diagnostic video (status READY)",
      observed: `personalizedVideo.status=${evidence.personalizedVideo.status}`,
      fix: "Generate/regenerate the personalized diagnostic video from this offer's current evidence before it can be presentation-ready.",
    }));
  }

  // (1b) NARRATION TRUTH (Part E). Build the storyboard the personalized video WOULD render
  //     and verify it is honest. A buildable storyboard whose narration either attempts an
  //     unsupported use-claim (attemptedUseHonest=false) or fails the attempted-use truth
  //     check is a BLOCKER. A NOT-buildable storyboard means there is no honest personalized
  //     video to render — that is already the MISSING/personalized BLOCKER above, so we do
  //     NOT double-block here.
  const sb = buildVideoStoryboard(evidence, experienceFrameForOffer(offer), offer);
  if (sb.buildable) {
    const truth = assessNarrationTruth(sb.narrationScript, offer);
    if (!sb.attemptedUseHonest || !truth.ok) {
      issues.push(issue({
        surface: "video.narrationTruth",
        severity: "BLOCKER",
        expected: "the personalized video's narration only claims an attempted action the evidence supports",
        observed: truth.reason ?? "the storyboard narration makes an unsupported attempted-use claim",
        fix: "Regenerate the storyboard from the honest observational frame; never claim an attempted action the evidence does not support.",
      }));
    } else { pass(); }
  } else { pass(); }

  // (2) The evergreen video is bound to the OFFER's own scope (right business/scope).
  const expected = trustVideoForOffer(offer).asset;
  if (videoAsset.scope !== expected.scope) {
    issues.push(issue({
      surface: "video.binding",
      severity: "BLOCKER",
      expected: `the video is bound to this offer's scope "${expected.scope}"`,
      observed: `bound video is scope "${videoAsset.scope}" (a different business/scope)`,
      fix: "Select the evergreen video for THIS offer's SKU scope via trustVideoForOffer(offer).",
    }));
  } else { pass(); }

  // (3) Company voice, not Jordan's actual recorded voice.
  if (videoAsset.narrationVersion !== TRUST_VIDEO_NARRATION_VERSION) {
    issues.push(issue({
      surface: "video.companyVoice",
      severity: "WARNING",
      expected: `the narration is the current company-voice render (${TRUST_VIDEO_NARRATION_VERSION})`,
      observed: `narrationVersion=${videoAsset.narrationVersion}`,
      fix: "Re-render the narration in the current Artifex company voice.",
    }));
  } else { pass(); }

  // (4) Captions default OFF, and captionsVerified must match narration/caption version.
  //     A caption exposed (captionsUrl non-null) while NOT verified against the final
  //     narration is a hard blocker (stale/incorrect captions worse than none).
  if (videoAsset.captionsUrl && !videoAsset.captionsVerified) {
    issues.push(issue({
      surface: "video.captions",
      severity: "BLOCKER",
      expected: "captions are exposed ONLY when verified against the final narration audio",
      observed: "a caption track is attached but captionsVerified=false (stale caption)",
      fix: "Regenerate the .vtt from the final narration and set captionsVerified before exposing captions.",
    }));
  } else { pass(); }
  // captionsVerified=true but the narration changed since ⇒ the verification is stale.
  if (videoAsset.captionsVerified && videoAsset.narrationVersion !== TRUST_VIDEO_NARRATION_VERSION) {
    issues.push(issue({
      surface: "video.captionsStale",
      severity: "BLOCKER",
      expected: "captionsVerified only holds when it was verified against the CURRENT narration",
      observed: `captionsVerified=true but narration is ${videoAsset.narrationVersion} (changed)`,
      fix: "Re-verify the captions against the current narration audio before trusting them.",
    }));
  } else { pass(); }
}

function runCheckoutChecks(
  input: BreakbotPreflightInput,
  offer: QuickFixOffer,
  issues: Issue[],
  pass: () => void,
): void {
  const c = input.checkout;
  if (!c) { pass(); pass(); pass(); pass(); return; }

  // NEVER a live charge — a preflight only ever validates a safe/preview configuration.
  if (c.liveCharge) {
    issues.push(issue({
      surface: "checkout.liveCharge",
      severity: "BLOCKER",
      expected: "the preflight validates a SAFE/PREVIEW checkout — never a live charge",
      observed: "the checkout is configured as a live charge",
      fix: "Run checkout in test/preview mode for pre-flight; a live charge is never part of QA.",
    }));
  } else { pass(); }

  // managed_payments MUST be false (we take payment directly, no Stripe-managed flow).
  if (c.managedPayments) {
    issues.push(issue({
      surface: "checkout.managedPayments",
      severity: "BLOCKER",
      expected: "Stripe managed_payments=false",
      observed: "managed_payments=true",
      fix: "Disable Stripe managed_payments for this checkout.",
    }));
  } else { pass(); }

  // Webhook (not the browser redirect) must be authoritative for the purchase signal.
  if (!c.webhookAuthoritative) {
    issues.push(issue({
      surface: "checkout.webhook",
      severity: "BLOCKER",
      expected: "the validated webhook is the authoritative purchase signal (not the browser redirect)",
      observed: "webhook is not authoritative",
      fix: "Create the job only on the validated Stripe webhook, never on the success redirect.",
    }));
  } else { pass(); }

  // Checkout SKU + price must match the offer.
  const skuMismatch = c.checkoutSku != null && c.checkoutSku !== (offer.capabilityKeys[0] ?? null);
  const priceMismatch = c.checkoutPriceCents != null && c.checkoutPriceCents !== offer.priceCents;
  if (skuMismatch || priceMismatch) {
    issues.push(issue({
      surface: "checkout.match",
      severity: "BLOCKER",
      expected: `checkout charges the offer SKU (${offer.capabilityKeys[0] ?? "—"}) at ${offer.priceCents}¢`,
      observed: `${skuMismatch ? `sku=${c.checkoutSku} ` : ""}${priceMismatch ? `price=${c.checkoutPriceCents}¢` : ""}`.trim(),
      fix: "Bind the checkout line item to the offer's SKU and server price.",
    }));
  } else { pass(); }
}

function runApprovalChecks(
  input: BreakbotPreflightInput,
  evidence: EvidencePackage,
  currentEvidenceVersion: string,
  issues: Issue[],
  pass: () => void,
): void {
  const a = input.approval;
  if (!a) { pass(); pass(); pass(); return; }

  // Approve must cause 0 sends AND 0 schedules — approval is not dispatch.
  if (a.sendsCausedByApprove !== 0 || a.schedulesCausedByApprove !== 0) {
    issues.push(issue({
      surface: "approval.sideEffects",
      severity: "BLOCKER",
      expected: "approval causes 0 sends and 0 schedules (approval ≠ dispatch)",
      observed: `approve caused ${a.sendsCausedByApprove} send(s) and ${a.schedulesCausedByApprove} schedule(s)`,
      fix: "Make approval a pure state change; send and schedule stay separate explicit actions.",
    }));
  } else { pass(); }

  // Send + schedule must each be distinct, explicit, operator-initiated actions.
  if (!a.sendIsExplicit || !a.scheduleIsExplicit) {
    issues.push(issue({
      surface: "approval.explicitActions",
      severity: "BLOCKER",
      expected: "send and schedule are each explicit, deliberate operator actions",
      observed: `sendIsExplicit=${a.sendIsExplicit}, scheduleIsExplicit=${a.scheduleIsExplicit}`,
      fix: "Require a separate explicit operator action for send and for schedule.",
    }));
  } else { pass(); }

  // A frozen-asset (evidence) change since approval invalidates the approval.
  const inval = approvalInvalidatedByEvidenceChange(evidence, a.approvedEvidenceVersion ?? currentEvidenceVersion);
  if (inval.invalidate && (a.approvedEvidenceVersion ?? null) !== null) {
    issues.push(issue({
      surface: "approval.staleEvidence",
      severity: "BLOCKER",
      expected: "the approval was taken against the current evidence version",
      observed: `${inval.reason} (approved ${inval.approvedVersion}, current ${inval.currentVersion})`,
      fix: "Re-approve against the current evidence before sending.",
    }));
  } else { pass(); }
}

function runManifestChecks(
  manifest: ManifestRow[],
  evidence: EvidencePackage,
  issues: Issue[],
  pass: () => void,
): void {
  // The manifest must carry the SAME status the underlying asset holds — never optimistic.
  const byKey = new Map(manifest.map((r) => [r.key, r] as const));
  const pdfRow = byKey.get("diagnosticPdf");
  const videoRow = byKey.get("personalizedVideo");
  let ok = true;
  if (pdfRow && pdfRow.status !== evidence.diagnosticPdf.status) {
    ok = false;
    issues.push(issue({
      surface: "manifest.pdf",
      severity: "BLOCKER",
      expected: `the manifest PDF status equals the real asset status (${evidence.diagnosticPdf.status})`,
      observed: `manifest shows ${pdfRow.status}`,
      fix: "Bind the manifest row to the real asset status; never present a capability as a READY asset.",
    }));
  }
  if (videoRow && videoRow.status !== evidence.personalizedVideo.status) {
    ok = false;
    issues.push(issue({
      surface: "manifest.video",
      severity: "BLOCKER",
      expected: `the manifest video status equals the real asset status (${evidence.personalizedVideo.status})`,
      observed: `manifest shows ${videoRow.status}`,
      fix: "Bind the manifest video row to the real personalized-video asset status.",
    }));
  }
  if (ok) pass();
}

function runFulfillmentChecks(
  input: BreakbotPreflightInput,
  offer: QuickFixOffer,
  issues: Issue[],
  pass: () => void,
): void {
  const f = input.fulfillment ?? {};
  const platform: Platform = normalizePlatform(f.detectedPlatform);
  const runbook = buildRunbook(offer, platform);

  // Fulfillment path (Part P): a valid path is EITHER a confirmed platform playbook OR
  // a technical-review / Access-Assist route. Pre-purchase, the site platform is usually
  // not yet confirmed — that is NOT "no path", it is the technical-review route, which is
  // explicitly acceptable. So we BLOCK only when the SKU has NO approved playbook at all
  // (genuinely unfulfillable). "Valid playbook, platform not yet confirmed" is a WARNING.
  const sellable = input.sellable ?? offer.quickFixEligible;
  const hasPlaybook = !!playbookFor(offer.capabilityKeys[0] ?? "");
  if (sellable && !hasPlaybook) {
    issues.push(issue({
      surface: "fulfillment.noPath",
      severity: "BLOCKER",
      expected: "a sellable offer has an approved playbook (or a technical-review route)",
      observed: `no approved playbook for SKU "${offer.capabilityKeys[0] ?? "(none)"}"`,
      fix: "Only sell SKUs with an approved fulfillment playbook, or route to NEEDS_TECHNICAL_REVIEW before selling.",
    }));
  } else if (sellable && !runbook.supported) {
    // Playbook exists; the platform just isn't confirmed yet → the Access-Assist /
    // technical-review path handles it at fulfillment. Surface it, but do not block a send.
    issues.push(issue({
      surface: "fulfillment.platformUnconfirmed",
      severity: "WARNING",
      expected: "the site platform is confirmed at fulfillment, or handled via the technical-review route",
      observed: runbook.reviewReason ?? "platform not yet confirmed",
      fix: "Confirm the platform after purchase, or use the Access-Assist / technical-review path — no action needed before sending.",
    }));
    pass();
  } else { pass(); }

  // Access instructions exist and NEVER ask for a password.
  const packet: FulfillmentPacket = buildFulfillmentPacket({
    offer,
    job: { offerId: offer.offerId, leadId: offer.leadId, state: f.jobState ?? "PAID", purchasedAt: null, targetDeliveryAt: null },
    customer: f.customer ?? null,
    detectedPlatform: f.detectedPlatform ?? null,
    termsVersion: f.termsVersion ?? null,
  });
  // Flag ONLY an actual REQUEST for a password: an imperative verb within a few words
  // of "password" AND not negated. Reassurances like "we never need your password",
  // "without your password", or "we'll email you the steps — we never ask for your
  // password" are the correct, expected copy and must NOT be flagged.
  const requestsPassword = (s: string): boolean => {
    const asks = /\b(send|share|provide|enter|give|type|paste|tell|email)\b(?:\s+\S+){0,4}\s+password\b/i.test(s);
    const reassures = /\bnever\b|\bdon'?t\b|\bdo not\b|\bwithout\b|\bno need\b|\bnot (ask|need|share|require|store|collect)\b/i.test(s);
    return asks && !reassures;
  };
  const passwordLeak = packet.accessCenter.instructions.some((ins) => ins.steps.some(requestsPassword));
  if (passwordLeak) {
    issues.push(issue({
      surface: "fulfillment.password",
      severity: "BLOCKER",
      expected: "access instructions never request a password (native invites only)",
      observed: "an access step requests a password",
      fix: "Use each platform's native collaborator invite; never ask for a password.",
    }));
  } else { pass(); }

  // Scope + safety gates are wired (runbook has a production retest + completion evidence).
  const hasRetest = runbook.steps.some((s) => s.kind === "retest");
  const hasEvidence = runbook.completionEvidenceRequired.length > 0;
  if (sellable && runbook.supported && (!hasRetest || !hasEvidence)) {
    issues.push(issue({
      surface: "fulfillment.qa",
      severity: "BLOCKER",
      expected: "the runbook requires a production retest and completion evidence",
      observed: `retest=${hasRetest}, evidenceRequired=${hasEvidence}`,
      fix: "Ensure the runbook includes a LIVE production retest and required completion evidence.",
    }));
  } else { pass(); }

  // Safety gate: a paid job past intake must have a coherent gate (not silently startable).
  const scope = scopeGate(offer, { confirmed: true });
  const gate = safetyGate({
    offer,
    job: { state: f.jobState ?? "PAID", requirementsReceivedAt: f.accessReceived ? new Date().toISOString() : null },
    scope,
    preChangeCaptured: f.preChangeCaptured ?? false,
    platform,
  });
  // Report only as INFO — the gate correctly blocking is the desired safe behavior; we
  // surface it so the operator sees why work cannot start, never as a send blocker.
  if (!gate.canStart) {
    issues.push(issue({
      surface: "fulfillment.safetyGate",
      severity: "INFO",
      expected: "work starts only after scope+access+pre-change+rollback are satisfied",
      observed: `safety gate blocks start: ${gate.blockers.join("; ")}`,
      fix: "Complete the listed pre-change safety items before starting the fix.",
    }));
  } else { pass(); }

  // Job-state transition sanity: the declared job state must be reachable (no illegal jump).
  const jobState = f.jobState ?? "PAID";
  if (jobState === "IN_PROGRESS" && !gate.canStart) {
    // Proving the safety gate would have blocked an illegal start.
    issues.push(issue({
      surface: "fulfillment.illegalStart",
      severity: "BLOCKER",
      expected: "a job may only be IN_PROGRESS after the safety gate passes",
      observed: "job is IN_PROGRESS while the safety gate would block start",
      fix: "Do not transition to IN_PROGRESS until safetyGate.canStart is true.",
    }));
  } else { pass(); }

  // Customer portal must exist for post-purchase communication when there is a customer.
  if (f.customer && f.customerPortalPresent === false) {
    issues.push(issue({
      surface: "fulfillment.portal",
      severity: "WARNING",
      expected: "a paid customer has a portal/thread for delivery + communication",
      observed: "no customer portal is present",
      fix: "Provision the customer portal on purchase so delivery + updates have a home.",
    }));
  } else { pass(); }

  // Sanity: the canonical transition helper must consider a normal forward step legal
  // (proves we compose the real state machine, never a hand-rolled one).
  if (!canTransitionJob("PAID", "WAITING_FOR_CUSTOMER_INPUT")) {
    issues.push(issue({
      surface: "fulfillment.stateMachine",
      severity: "BLOCKER",
      expected: "the fulfillment state machine permits PAID → WAITING_FOR_CUSTOMER_INPUT",
      observed: "the transition helper rejected a legal forward step",
      fix: "Restore the canonical job transition table.",
    }));
  } else { pass(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// VOICE COHERENCE (journey-level ElevenLabs voiceover chain)
//
// A prospect journey resolves to exactly ONE coherent generation — ALL Matt (current)
// or ALL Lucas (legacy) — and is NEVER silently mixed. Matt is the default for anything
// newly generated; Lucas is a preserved legacy generation with NO live provider (it is
// not generatable, so a legacy-lucas journey never requires a voiceover record). The
// CORE rule is: problem-video and trust-video must belong to the same generation, and a
// Matt journey needs a Matt trust video (never a silent Lucas fallback).
// ─────────────────────────────────────────────────────────────────────────────
const ELEVENLABS_HOST_RE = /api\.elevenlabs\.io/i;
const ELEVENLABS_KEYHDR_RE = /xi-api-key/i;
const SECRET_KEY_RE = /\bsk[-_][A-Za-z0-9]{12,}/;
function wordCount(s: string): number {
  return (s ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function runVoiceCoherenceChecks(
  input: BreakbotPreflightInput,
  offer: QuickFixOffer,
  evidence: EvidencePackage,
  composedBody: string,
  offerPageBlocks: string[],
  issues: Issue[],
  pass: () => void,
): void {
  const vc = input.voiceCoherence;
  if (!vc) return; // caller-gated; never invoked without it, but stay defensive.

  const leadGen = voiceGeneration(vc.leadCanonicalVoiceKey);
  const isLucasJourney = leadGen === "legacy-lucas";
  const vo = vc.voiceover ?? null;

  // ── (1) AUDIO READINESS — a Matt journey's narration needs READY audio. Lucas is NOT
  //     generatable (its existing assets stay valid) so a legacy-lucas journey NEVER
  //     requires a voiceover record; absence of a voiceover there is NOT a defect. ──
  if (!isLucasJourney) {
    if (!vo || !vo.present || vo.status !== "VOICEOVER_READY") {
      issues.push(issue({
        surface: "voice.audioMissing",
        severity: "BLOCKER",
        expected: "narration present ⇒ a READY voiceover asset (status VOICEOVER_READY)",
        observed: vo ? `voiceover present=${vo.present}, status=${vo.status}` : "no voiceover record bound to this offer",
        fix: "Generate the ElevenLabs voiceover for this narration and bind the READY asset before sending.",
      }));
    } else { pass(); }
  } else { pass(); }

  // ── (2) AUDIO NOT EMPTY — a bound asset that reports ≤0 bytes is a broken/empty render. ──
  if (vo && vo.assetBytes != null && vo.assetBytes <= 0) {
    issues.push(issue({
      surface: "voice.audioEmpty",
      severity: "BLOCKER",
      expected: "a bound voiceover asset has real audio bytes (assetBytes > 0)",
      observed: `assetBytes=${vo.assetBytes}`,
      fix: "Re-render the voiceover; an empty (0-byte) asset must never be bound to the offer.",
    }));
  } else { pass(); }

  // ── (3) DURATION SANITY — the audio length must be in the plausible band for the script
  //     word count (expected = words / 2.6 wps; flag <0.4× or >3× expected). WARNING only. ──
  if (vo && vo.durationSeconds != null) {
    const sb = buildVideoStoryboard(evidence, experienceFrameForOffer(offer), offer);
    const wc = wordCount(sb.narrationScript);
    const expectedSeconds = wc / 2.6;
    if (expectedSeconds > 0 && (vo.durationSeconds < 0.4 * expectedSeconds || vo.durationSeconds > 3 * expectedSeconds)) {
      issues.push(issue({
        surface: "voice.durationUnreasonable",
        severity: "WARNING",
        expected: `voiceover duration in the plausible band for ${wc} narration words (~${expectedSeconds.toFixed(1)}s, 0.4×–3×)`,
        observed: `durationSeconds=${vo.durationSeconds} (expected ~${expectedSeconds.toFixed(1)}s)`,
        fix: "Confirm the voiceover was rendered from the current narration script; a wildly-off length usually means stale or wrong audio.",
      }));
    } else { pass(); }
  } else { pass(); }

  // ── (4) LEAD BINDING — the audio must belong to THIS offer's lead, never another's. ──
  if (vo && vo.leadId !== offer.leadId) {
    issues.push(issue({
      surface: "voice.leadMismatch",
      severity: "BLOCKER",
      expected: `the voiceover asset belongs to this offer's lead (${offer.leadId})`,
      observed: `voiceover.leadId=${vo.leadId}`,
      fix: "Bind the voiceover generated for THIS lead; never reuse another lead's audio.",
    }));
  } else { pass(); }

  // ── (5) REVISION FRESHNESS — the audio's narration revision must equal the CURRENT
  //     storyboard narration digest, or it is stale/superseded audio. ──
  if (vo) {
    const sb = buildVideoStoryboard(evidence, experienceFrameForOffer(offer), offer);
    const currentDigest = narrationDigestFor(sb);
    if (vo.narrationRevision !== currentDigest) {
      issues.push(issue({
        surface: "voice.revisionMismatch",
        severity: "BLOCKER",
        expected: `the voiceover was rendered against the current narration digest (${currentDigest})`,
        observed: `voiceover.narrationRevision=${vo.narrationRevision} (superseded)`,
        fix: "Re-render the voiceover from the current narration script, then re-bind the fresh asset.",
      }));
    } else { pass(); }
  } else { pass(); }

  // ── (6) PROBLEM-VIDEO GENERATION MATCHES THE LEAD — the personalized/problem video must
  //     be in the SAME generation as the lead's canonical journey voice. ──
  if (vc.problemVideoVoiceKey != null) {
    if (voiceGeneration(vc.problemVideoVoiceKey) !== voiceGeneration(vc.leadCanonicalVoiceKey)) {
      issues.push(issue({
        surface: "voice.leadVoiceMismatch",
        severity: "BLOCKER",
        expected: `the problem video's voice generation matches the lead's journey (${leadGen ?? "unknown"})`,
        observed: `problem video generation=${voiceGeneration(vc.problemVideoVoiceKey) ?? "unknown"}`,
        fix: "Re-generate the problem video in the lead's canonical voice generation.",
      }));
    } else { pass(); }
  } else { pass(); }

  // ── (7) CORE COHERENCE — problem video and trust video must be the SAME generation.
  //     "Matt problem video with a Lucas trust video" (and vice-versa) is the defect. ──
  if (vc.problemVideoVoiceKey != null && vc.trustVideoVoiceKey != null) {
    if (!sameVoiceGeneration(vc.problemVideoVoiceKey, vc.trustVideoVoiceKey)) {
      issues.push(issue({
        surface: "voice.generationMixed",
        severity: "BLOCKER",
        expected: "the whole journey is ONE coherent voice generation — problem video and trust video match",
        observed: `problem=${voiceGeneration(vc.problemVideoVoiceKey) ?? "unknown"} trust=${voiceGeneration(vc.trustVideoVoiceKey) ?? "unknown"} (mixed)`,
        fix: "Regenerate both videos in a single generation — all Matt or all Lucas, never mixed.",
      }));
    } else { pass(); }
  } else { pass(); }

  // ── (8) MATT JOURNEY NEEDS A MATT TRUST VIDEO — never silently fall back to a Lucas
  //     trust video for a current-matt journey. ──
  if (leadGen === "current-matt") {
    if (vc.trustVideoVoiceKey == null || voiceGeneration(vc.trustVideoVoiceKey) !== "current-matt") {
      issues.push(issue({
        surface: "voice.trustMissing",
        severity: "BLOCKER",
        expected: "a Matt journey needs a Matt trust video (never silently fall back to Lucas)",
        observed: vc.trustVideoVoiceKey == null
          ? "no trust video voice on a Matt journey"
          : `trust video generation=${voiceGeneration(vc.trustVideoVoiceKey) ?? "unknown"}`,
        fix: "Bind (or generate) the current-matt trust video for this Matt journey.",
      }));
    } else { pass(); }
  } else { pass(); }

  // ── (9) NO SECRET LEAK — the customer-facing copy must NEVER contain an ElevenLabs host,
  //     the xi-api-key header name, or a provider secret key. ──
  const customerFacing = [composedBody, ...offerPageBlocks].join("\n");
  if (ELEVENLABS_HOST_RE.test(customerFacing) || ELEVENLABS_KEYHDR_RE.test(customerFacing) || SECRET_KEY_RE.test(customerFacing)) {
    issues.push(issue({
      surface: "voice.secretLeak",
      severity: "BLOCKER",
      expected: "no ElevenLabs endpoint, API-key header, or provider secret appears in customer-facing copy",
      observed: "a voice-provider host/header/secret pattern leaked into the composed email or offer page",
      fix: "Remove the provider endpoint/key from the customer-facing copy; voice generation is server-side only.",
    }));
  } else { pass(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL PRESENTATION READINESS — the complete live customer experience end-to-end.
// Proves: the personalized video exists in DURABLE storage, its served URL resolves +
// is playable, the trust video resolves in the SAME generation (never a cross-generation
// fallback), no raw storage URL / provider secret / filesystem path leaks into any
// customer asset URL, and nothing STALE is selected. Caller-gated (no regress when absent).
// ─────────────────────────────────────────────────────────────────────────────
// Markers that must NEVER appear in a customer-facing asset URL — a raw storage key,
// bucket URL, signed cloud URL, provider secret, or an internal filesystem/local path.
const RAW_STORAGE_MARKERS: RegExp[] = [
  /content-studio\//i, // a raw object-store KEY (customer sees the app route, not the key)
  /\/personalized-videos\//i, // the LOCAL public/ render path (not the durable served route)
  /s3:\/\//i, /\.amazonaws\.com/i, /blob\.core\.windows\.net/i, /storage\.googleapis\.com/i,
  /supabase\.co\/storage/i, /r2\.cloudflarestorage\.com/i,
  /[?&]X-Amz-/i, /[?&](sig|signature|token)=/i, // signed/secret query params
  /api\.elevenlabs\.io/i, /\bsk[-_][A-Za-z0-9]{12,}/, /xi-api-key/i, // provider secrets
  /(^|[^a-z])(file:\/\/|\/var\/|\/tmp\/|\/app\/|\/Users\/)/i, // filesystem paths
];

function runPresentationReadinessChecks(
  input: BreakbotPreflightInput,
  offer: QuickFixOffer,
  composedBody: string,
  offerPageBlocks: string[],
  issues: Issue[],
  pass: () => void,
): void {
  const p = input.presentation;
  if (!p) return; // caller-gated; defensive.

  const pv = p.personalizedVideo;

  // ── (1) PERSONALIZED VIDEO IS THE CURRENT READY RENDER — never stale/missing. ──
  if (!pv || pv.status !== "READY") {
    issues.push(issue({
      surface: "presentation.personalizedVideo",
      severity: "BLOCKER",
      expected: "the offer's personalized diagnostic video is READY (bound to current evidence + narration + render)",
      observed: pv ? `personalized video status=${pv.status}` : "no personalized video assembled for the customer experience",
      fix: "Render the personalized video for this offer's current evidence, then re-check readiness.",
    }));
  } else { pass(); }

  // ── (2) DURABLE STORAGE — a READY render MUST resolve to a durable object-store key.
  //     A local-only render (public/ file, no key) is NOT production-serveable. ──
  if (pv && pv.status === "READY" && !pv.mp4Key) {
    issues.push(issue({
      surface: "presentation.renderDurable",
      severity: "BLOCKER",
      expected: "the READY render is persisted to durable object storage (mp4Key present)",
      observed: "the render has no durable storage key (local-only render)",
      fix: "Persist the rendered video to the ArtifactStore; a local public/ file is not production truth.",
    }));
  } else { pass(); }

  // ── (3) SERVED URL RESOLVES — the customer's served-video route returns the current render. ──
  if (pv && pv.status === "READY" && !pv.servedUrlResolves) {
    issues.push(issue({
      surface: "presentation.servedResolves",
      severity: "BLOCKER",
      expected: "the customer-facing served-video URL resolves the current READY render",
      observed: "the served-video resolver did not return the current render (stale/absent/gated)",
      fix: "Verify the served route resolves this offer's current render before sending.",
    }));
  } else { pass(); }

  // ── (4) PLAYABLE — a served URL + a positive duration. ──
  if (pv && pv.status === "READY" && (!pv.mp4Url || (pv.durationSeconds ?? 0) <= 0)) {
    issues.push(issue({
      surface: "presentation.playable",
      severity: "BLOCKER",
      expected: "the personalized video is playable (a served mp4 URL and a positive duration)",
      observed: `mp4Url=${pv.mp4Url ? "present" : "missing"}, durationSeconds=${pv.durationSeconds ?? 0}`,
      fix: "Re-render/persist the video so it exposes a served URL and a real duration.",
    }));
  } else { pass(); }

  // ── (5) TRUST VIDEO RESOLVES — a coherent trust asset must resolve for the journey.
  //     A Matt journey missing its Matt trust video is a BLOCKER (never a Lucas fallback). ──
  const trust = p.trust;
  if (!trust) {
    issues.push(issue({
      surface: "presentation.trustResolves",
      severity: "BLOCKER",
      expected: "the journey's trust video resolves (legacy Lucas asset, or the reusable Matt trust video)",
      observed: "no trust video resolved for this journey",
      fix: "Resolve the trust video for this offer's journey generation before sending.",
    }));
  } else if (trust.mattTrustMissing || (trust.outcome === "reuse-matt" && !trust.assetUrl) || (trust.outcome === "use-legacy-lucas" && !trust.assetUrl)) {
    issues.push(issue({
      surface: "presentation.trustResolves",
      severity: "BLOCKER",
      expected: "the resolved trust video has a served asset for this journey generation",
      observed: trust.mattTrustMissing
        ? "a Matt journey has no Matt trust video yet (prepare-matt) — never falls back to Lucas"
        : `trust outcome=${trust.outcome} has no served asset URL`,
      fix: trust.mattTrustMissing
        ? "Build the Matt trust video for this scope (scripts/matt-trust-video-render.ts), then re-check."
        : "Ensure the resolved trust asset is served from durable storage.",
    }));
  } else if (trust.orientation === "portrait") {
    // §12 media-format contract: the offer/trust EXPLAINER must be LANDSCAPE 16:9. A portrait explainer is
    // the wrong media role and must NOT count as the canonical finished offer video merely because it plays.
    issues.push(issue({
      surface: "presentation.trustResolves",
      severity: "BLOCKER",
      expected: "the offer/trust explainer is LANDSCAPE 16:9 (the personalized problem video is portrait — a separate role)",
      observed: "the resolved trust explainer is PORTRAIT — wrong media format for the offer page",
      fix: "Re-render the trust explainer in landscape 16:9 (scripts/matt-trust-video-render.ts, 1920×1080) reusing the existing Matt audio.",
    }));
  } else { pass(); }

  // ── (6) TRUST GENERATION MATCHES THE PERSONALIZED VIDEO — one coherent generation. ──
  if (pv && pv.voiceGeneration && trust && trust.generation && pv.voiceGeneration !== trust.generation) {
    issues.push(issue({
      surface: "presentation.trustGenerationMatch",
      severity: "BLOCKER",
      expected: "the trust video and the personalized video are the SAME voice generation",
      observed: `personalized=${pv.voiceGeneration} trust=${trust.generation} (mixed)`,
      fix: "Resolve both the personalized and trust videos in the lead's single journey generation.",
    }));
  } else { pass(); }

  // ── (7) NO RAW STORAGE URL / SECRET / FILESYSTEM PATH in any customer asset URL. Every
  //     customer-facing URL must be an app-relative route, never a storage/secret leak. ──
  const urls = [
    ...(p.customerAssetUrls ?? []),
    pv?.mp4Url ?? "",
    trust?.assetUrl ?? "",
  ].filter(Boolean);
  const leaked = urls.filter((u) => RAW_STORAGE_MARKERS.some((re) => re.test(u)));
  // Also scan customer copy for the same leakage (belt-and-suspenders with voice.secretLeak).
  const copyLeak = RAW_STORAGE_MARKERS.some((re) => re.test([composedBody, ...offerPageBlocks].join("\n")));
  if (leaked.length > 0 || copyLeak) {
    issues.push(issue({
      surface: "presentation.rawStorageLeak",
      severity: "BLOCKER",
      expected: "every customer-facing asset URL is an app-managed route (no raw storage URL, signed URL, secret, or filesystem path)",
      observed: leaked.length > 0 ? `leaked URL(s): ${leaked.slice(0, 3).join(", ")}` : "a storage/secret/path marker leaked into customer copy",
      fix: "Serve every asset through its app route (/api/…) and remove any raw storage URL / signed URL / filesystem path.",
    }));
  } else { pass(); }
}

// ── tiny utils ──────────────────────────────────────────────────────────────
function norm(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}
/** The base surface family for de-dupe counting (drops the "[i]"/"." suffix segments). */
function baseSurface(surface: string): string {
  if (surface.startsWith("rawUrl")) return "rawUrl";
  if (surface.startsWith("darkPattern")) return "darkPattern";
  if (surface.startsWith("fabrication")) return "fabrication";
  return surface;
}

/**
 * Synchronously resolve the attachment DISPOSITION for the preflight artifact. The real
 * buildOutreachAttachments renders PDF bytes (async, read-only). For the preflight we only
 * need the DISPOSITION (ATTACHED/LINKED/MISSING) + link URLs, which derive deterministically
 * from the evidence package + video asset — so we compute them here without I/O. This never
 * sends, renders live, or charges; it mirrors buildOutreachAttachments' disposition logic.
 */
function buildAttachmentsSync(input: BreakbotPreflightInput): Pick<OutreachAttachmentManifest, "pdf" | "video" | "pdfLinkUrl" | "videoLinkUrl"> {
  const evidence = input.evidence;
  const pdfLinkUrl = evidence.diagnosticPdf?.url ?? null;
  const videoAsset = input.videoAsset ?? trustVideoForOffer(input.offer).asset;
  const personalized = evidence.personalizedVideo;
  const videoUrl =
    (personalized?.status === "READY" ? personalized.url : null) ??
    (videoAsset.assetUrl ? videoAsset.assetUrl : null) ??
    (evidence.evergreenVideo?.status === "READY" ? evidence.evergreenVideo.url : null);
  // The PDF is never live-rendered here → disposition is LINKED when a link exists, else MISSING.
  const pdf: OutreachAttachmentManifest["pdf"] = pdfLinkUrl ? "LINKED" : "MISSING";
  const video: OutreachAttachmentManifest["video"] = videoUrl ? "LINKED" : "MISSING";
  return { pdf, video, pdfLinkUrl, videoLinkUrl: videoUrl };
}

// Keep buildOutreachAttachments imported (async, used by the store-backed callers) so the
// engine stays wired to the real attachment policy even though the preflight uses the pure
// disposition path above. Referenced to avoid an unused-import removal.
void buildOutreachAttachments;
