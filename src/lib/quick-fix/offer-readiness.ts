// ─────────────────────────────────────────────────────────────────────────────
// OFFER READINESS (PART U) — the deterministic "is this offer materially ready to
// be SENT?" gate. This is DISTINCT from SALES qualification (qualifyLead): a lead can
// be sales-qualified yet the assembled offer artifact still be materially unready
// (a stale PDF, a raw URL leaking to the customer, the first sentence not matching the
// evidence-backed experience frame, a price that disagrees with the server, …). This
// module answers "READY_TO_SEND?" as a set of PURE, composable check functions.
//
// Each check returns zero or more issues {surface, severity, expected, observed}. The
// aggregate is {ready, issues}. `ready` is false when any BLOCKER issue is present.
// The engine REUSES the fixed contracts (never re-implements them):
//   • subject-engine.isPolicyCompliantSubject
//   • experience-frame.experienceFrameForOffer  (emailOpener / attemptSupported)
//   • evidence-gate.containsFabricatedClaim
//   • customer-language.assessOfferCustomerLanguage
//   • no-dark-patterns.scanDarkPatterns
//   • evidence-truth.detectStaleAssets
//   • evidence-package.EvidencePackage / AssetStatus
//
// PURE + READ-ONLY. No sends, no charges, no external state. Composable for Breakbot.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import type { EvidencePackage } from "./evidence-package";
import { isPolicyCompliantSubject } from "./subject-engine";
import { experienceFrameForOffer } from "./experience-frame";
import { containsFabricatedClaim } from "./evidence-gate";
import { assessOfferCustomerLanguage } from "./customer-language";
import { scanDarkPatterns, type DarkPatternSurfaces } from "./no-dark-patterns";
import { detectStaleAssets, type DependentAsset } from "./evidence-truth";

/** The single persuasion-policy version stamped onto offers at generation/preparation.
 *  Bump when the readiness rule set, the dark-pattern set, or the framing rules change,
 *  so downstream conversion attributes to the exact policy that produced the artifact. */
export const PERSUASION_POLICY_VERSION = "persuasion.v1";

export type ReadinessSeverity = "BLOCKER" | "WARNING";

export interface ReadinessIssue {
  /** Stable check id (surface of the problem) — e.g. "subject", "email.opener". */
  surface: string;
  severity: ReadinessSeverity;
  /** What a ready offer requires. */
  expected: string;
  /** What was actually observed. */
  observed: string;
}

export interface ReadinessResult {
  ready: boolean;
  issues: ReadinessIssue[];
}

/**
 * The customer-facing artifact surrounding an offer, as PLAIN inputs. The gate does not
 * reach into route/generator internals — the caller assembles what the customer will
 * actually see and hands it in. Every field is optional; an absent field is skipped by
 * the checks that depend on it (an absent PDF is not "stale", an absent subject is a
 * blocker only if the check requires one — see each check).
 */
export interface OfferArtifact {
  offer: QuickFixOffer;
  /** The canonical evidence package (one evidence truth). */
  evidence: EvidencePackage;
  /** The selected first-touch subject the customer will see. */
  subject?: string | null;
  /** The full first email body the customer will read. */
  emailBody?: string | null;
  /** The first sentence of the email body (if pre-split); else derived from emailBody. */
  emailFirstSentence?: string | null;
  /** Offer page hero/opening copy in READING ORDER (first element read first). */
  offerPageBlocks?: string[];
  /** Checkout page copy the customer sees before paying. */
  checkoutCopy?: string | null;
  /** The exact price string shown at/near the checkout button (e.g. "$300"). */
  checkoutPriceText?: string | null;
  /** Whether the exact price is visible on the offer page BEFORE the purchase step. */
  priceVisibleBeforePurchase?: boolean;
  /** The item list the customer is told they will receive (customer-facing). */
  packageItems?: string[];
  /** The scope/SKU items that are actually in-scope (authoritative). */
  scopeItems?: string[];
  /** The protections copy shown to the customer (revision/refund/delivery promises). */
  protectionsCopy?: string | null;
  /** The authoritative protections facts (from terms) the copy must not exceed. */
  protectionsFacts?: { revisionPolicy?: string | null; deliveryWindow?: string | null } | null;
  /** Dependent assets + their stamped evidence versions (for staleness). */
  dependentAssets?: DependentAsset[];
  /** Whether a screenshot is required for this offer's family (e.g. visual defect). */
  screenshotsRequired?: boolean;
}

// ── Small helpers ──────────────────────────────────────────────────────────────
const RAW_URL = /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/i;
const PRICE_WORDS = /\$\s?\d|\bdollars?\b|\bprice\b|\bcost\b|\b\d+\s?usd\b/i;

function firstSentenceOf(text: string): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim();
}

function norm(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function blocker(surface: string, expected: string, observed: string): ReadinessIssue {
  return { surface, severity: "BLOCKER", expected, observed };
}
function warn(surface: string, expected: string, observed: string): ReadinessIssue {
  return { surface, severity: "WARNING", expected, observed };
}

// ── Individual checks (each PURE, each returns 0+ issues) ────────────────────────

/** (1) Subject is evidence-derived (matches the offer's experience frame family/topic)
 *  AND policy-compliant. */
export function checkSubject(a: OfferArtifact): ReadinessIssue[] {
  const subject = a.subject ?? null;
  if (subject == null || subject.trim() === "") {
    return [blocker("subject", "an evidence-derived, policy-compliant subject", "no subject selected")];
  }
  const issues: ReadinessIssue[] = [];
  if (!isPolicyCompliantSubject(subject)) {
    issues.push(blocker("subject", "a policy-compliant first-touch subject (short/lowercase/inbox-native/no false premise)", `non-compliant subject: "${subject}"`));
  }
  // Evidence-derived: the subject topic should relate to the offer's experience frame.
  const frame = experienceFrameForOffer(a.offer);
  const topicWords = new Set(norm(frame.topic).split(" ").filter((w) => w.length > 2));
  const subjWords = new Set(norm(subject).split(" "));
  const overlaps = [...topicWords].some((w) => subjWords.has(w));
  // "website"-family generic topics always overlap loosely; only flag when there is NO
  // shared meaningful token AND the frame has a specific topic.
  if (!overlaps && frame.topic && frame.topic !== "website note") {
    issues.push(warn("subject", `a subject derived from the evidence topic "${frame.topic}"`, `subject "${subject}" shares no token with the evidence topic`));
  }
  return issues;
}

/** (2) The first email sentence == experienceFrame.emailOpener (evidence-backed). */
export function checkEmailOpener(a: OfferArtifact): ReadinessIssue[] {
  const frame = experienceFrameForOffer(a.offer);
  const observed = (a.emailFirstSentence ?? (a.emailBody ? firstSentenceOf(a.emailBody) : "")) || "";
  if (!observed) return [blocker("email.opener", `the evidence-backed opener: "${frame.emailOpener}"`, "no email opener present")];
  if (norm(observed) !== norm(frame.emailOpener)) {
    return [blocker("email.opener", `the evidence-backed opener: "${frame.emailOpener}"`, `first sentence was: "${observed}"`)];
  }
  return [];
}

/** (3) No raw URLs in any customer-visible surface. */
export function checkNoRawUrls(a: OfferArtifact): ReadinessIssue[] {
  const surfaces: Array<[string, string | null | undefined]> = [
    ["subject", a.subject],
    ["email", a.emailBody],
    ["checkout", a.checkoutCopy],
    ["protections", a.protectionsCopy],
    ...(a.offerPageBlocks ?? []).map((b, i) => [`offerPage[${i}]`, b] as [string, string]),
    ...(a.packageItems ?? []).map((b, i) => [`packageItems[${i}]`, b] as [string, string]),
  ];
  const issues: ReadinessIssue[] = [];
  for (const [where, text] of surfaces) {
    const m = (text ?? "").match(RAW_URL);
    if (m) issues.push(blocker(`rawUrl.${where}`, "no raw URL in customer-visible copy (use a labeled link)", `raw URL: "${m[0]}"`));
  }
  return issues;
}

/** (4) If a PDF is attached, it must be current (not stale) w.r.t. the evidence. */
export function checkPdfCurrent(a: OfferArtifact): ReadinessIssue[] {
  const assets = a.dependentAssets ?? [];
  const pdf = assets.find((x) => x.kind === "diagnosticPdf");
  if (!pdf || !pdf.present) return []; // not attached → nothing to be stale
  const det = detectStaleAssets(a.evidence, [pdf]);
  const r = det.assets[0];
  if (r.stale) {
    return [blocker("pdf.current", `PDF generated against current evidence ${det.currentVersion}`, `${r.status}: PDF at ${r.observed ?? "unstamped"}`)];
  }
  return [];
}

/** (5) Screenshots present where required. */
export function checkScreenshots(a: OfferArtifact): ReadinessIssue[] {
  if (!a.screenshotsRequired) return [];
  if (a.evidence.screenshotStatus === "READY") return [];
  return [blocker("screenshots", "at least one READY screenshot (required for this offer)", `screenshotStatus=${a.evidence.screenshotStatus}`)];
}

/** (6) The offer begins with evidence/experience, NOT with price. */
export function checkStartsWithEvidence(a: OfferArtifact): ReadinessIssue[] {
  const blocks = a.offerPageBlocks ?? [];
  if (blocks.length === 0) return [];
  const first = blocks[0] ?? "";
  if (PRICE_WORDS.test(first)) {
    return [blocker("openingFrame", "the offer opens with the observed problem/experience", `the first block leads with price/cost: "${first.slice(0, 60)}"`)];
  }
  return [];
}

/** (7) Package items ⊆ SKU/scope items (nothing promised beyond scope). */
export function checkPackageWithinScope(a: OfferArtifact): ReadinessIssue[] {
  const pkg = a.packageItems;
  const scope = a.scopeItems ?? a.offer.scope.includedItems ?? [];
  if (!pkg || pkg.length === 0) return [];
  const scopeNorm = new Set(scope.map(norm));
  const issues: ReadinessIssue[] = [];
  for (const item of pkg) {
    if (!scopeNorm.has(norm(item))) {
      issues.push(blocker("packageScope", "every promised item is within the SKU/scope", `promised item not in scope: "${item}"`));
    }
  }
  return issues;
}

/** (8) Displayed price == server offer.priceCents. */
export function checkPriceMatchesServer(a: OfferArtifact): ReadinessIssue[] {
  const text = a.checkoutPriceText ?? null;
  if (text == null) return []; // no explicit price string supplied to check
  const cents = parsePriceToCents(text);
  if (cents == null) {
    return [warn("price.match", `a parseable price equal to server ${a.offer.priceCents}¢`, `unparseable price text: "${text}"`)];
  }
  if (cents !== a.offer.priceCents) {
    return [blocker("price.match", `displayed price == server ${a.offer.priceCents}¢`, `displayed ${cents}¢ ("${text}")`)];
  }
  return [];
}

/** (9) Protections copy is accurate — never promises more than the authoritative facts. */
export function checkProtectionsAccurate(a: OfferArtifact): ReadinessIssue[] {
  const copy = a.protectionsCopy ?? null;
  if (copy == null) return [];
  const issues: ReadinessIssue[] = [];
  // A protections surface must never invent a money-back/guarantee promise not backed by
  // the offer's actual policy. We flag unconditional guarantee language (fabrication guard
  // also catches "guaranteed"), and any claim the facts don't support.
  if (/\bmoney[-\s]?back guarantee\b|\bfull refund\b|\b100%\s+guarantee/i.test(copy)) {
    const facts = a.protectionsFacts ?? {};
    const factText = norm(`${facts.revisionPolicy ?? ""} ${facts.deliveryWindow ?? ""}`);
    if (!/refund|money[-\s]?back|guarantee/.test(factText)) {
      issues.push(blocker("protections", "protections copy matches the authoritative policy", "copy promises a refund/guarantee the policy does not state"));
    }
  }
  return issues;
}

/** (10) The exact price is visible BEFORE the purchase step. */
export function checkPriceVisibleBeforePurchase(a: OfferArtifact): ReadinessIssue[] {
  if (a.priceVisibleBeforePurchase === undefined) return [];
  if (a.priceVisibleBeforePurchase) return [];
  return [blocker("priceVisibility", "the exact price is shown before the purchase step", "price is not visible before purchase")];
}

/** (11) Checkout introduces no surprise price or scope (matches the offer). */
export function checkCheckoutNoSurprise(a: OfferArtifact): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  // Surprise price: if checkout shows a price, it must equal the server price.
  if (a.checkoutPriceText) issues.push(...checkPriceMatchesServer(a));
  // Surprise scope/fees at checkout: run the dark-pattern hidden-fee/subscription guard.
  if (a.checkoutCopy) {
    const dp = scanDarkPatterns({ checkoutCopy: a.checkoutCopy });
    for (const v of dp.violations) {
      if (v.kind === "HIDDEN_FEES" || v.kind === "SURPRISE_SUBSCRIPTION" || v.kind === "PRECHECKED_EXTRA") {
        issues.push(blocker("checkout.surprise", "checkout introduces no surprise cost/scope", `${v.kind}: "${v.match}"`));
      }
    }
  }
  // Dedupe the price-match issue if it appeared twice.
  return dedupeIssues(issues);
}

/** (12) No unsupported financial claims (containsFabricatedClaim) anywhere customer-facing. */
export function checkNoFabricatedClaims(a: OfferArtifact): ReadinessIssue[] {
  const surfaces: Array<[string, string | null | undefined]> = [
    ["subject", a.subject],
    ["email", a.emailBody],
    ["checkout", a.checkoutCopy],
    ["protections", a.protectionsCopy],
    ...(a.offerPageBlocks ?? []).map((b, i) => [`offerPage[${i}]`, b] as [string, string]),
  ];
  const issues: ReadinessIssue[] = [];
  for (const [where, text] of surfaces) {
    if (text && containsFabricatedClaim(text)) {
      issues.push(blocker(`fabrication.${where}`, "no unsupported revenue/traffic/conversion claim", `fabricated claim in "${where}"`));
    }
  }
  return issues;
}

/** (13) No fake urgency / dark patterns across the customer-facing artifact. */
export function checkNoDarkPatterns(a: OfferArtifact): ReadinessIssue[] {
  const surfaces: DarkPatternSurfaces = {
    subject: a.subject,
    emailBody: a.emailBody,
    offerPageCopy: (a.offerPageBlocks ?? []).join("\n"),
    checkoutCopy: a.checkoutCopy,
    extra: [
      { where: "protections", text: a.protectionsCopy },
      ...(a.packageItems ?? []).map((b, i) => ({ where: `packageItems[${i}]`, text: b })),
    ],
  };
  const dp = scanDarkPatterns(surfaces);
  return dp.violations.map((v) =>
    blocker(`darkPattern.${v.surface}`, "no manipulative pattern in customer-facing copy", `${v.kind}: "${v.match}"`),
  );
}

/** (14) No unexplained jargon (assessOfferCustomerLanguage over the offer + extra copy). */
export function checkNoJargon(a: OfferArtifact): ReadinessIssue[] {
  const r = assessOfferCustomerLanguage(a.offer, {
    extra: [a.emailBody ?? undefined, a.checkoutCopy ?? undefined, ...(a.offerPageBlocks ?? [])],
  });
  if (r.passes) return [];
  return r.problems.map((p) => blocker("customerLanguage", "plain owner language (no unexplained jargon/acronyms/internal keys)", p));
}

/** (15) Attempted-use claims match experienceFrame.attemptSupported. */
export function checkAttemptedUseHonest(a: OfferArtifact): ReadinessIssue[] {
  const frame = experienceFrameForOffer(a.offer);
  const surfaces = [a.emailBody ?? "", ...(a.offerPageBlocks ?? [])].join("\n");
  const claimsAttempt = /\bi tried to\b|\bi attempted to\b|\bwhen i tried\b/i.test(surfaces);
  if (claimsAttempt && !frame.attemptSupported) {
    return [blocker("attemptedUse", "no 'I tried' claim when the defect is observational (attemptSupported=false)", "copy claims an attempted action the evidence does not support")];
  }
  return [];
}

// ── Aggregate ────────────────────────────────────────────────────────────────
const ALL_CHECKS: Array<(a: OfferArtifact) => ReadinessIssue[]> = [
  checkSubject,                     // 1
  checkEmailOpener,                 // 2
  checkNoRawUrls,                   // 3
  checkPdfCurrent,                  // 4
  checkScreenshots,                 // 5
  checkStartsWithEvidence,          // 6
  checkPackageWithinScope,          // 7
  checkPriceMatchesServer,          // 8
  checkProtectionsAccurate,         // 9
  checkPriceVisibleBeforePurchase,  // 10
  checkCheckoutNoSurprise,          // 11
  checkNoFabricatedClaims,          // 12
  checkNoDarkPatterns,              // 13
  checkNoJargon,                    // 14
  checkAttemptedUseHonest,          // 15
];

/**
 * Run every readiness check. `ready` is false when ANY BLOCKER issue exists (WARNINGs
 * do not block but are surfaced). Deterministic + pure — composable for Breakbot, which
 * can also call the individual `check*` functions directly.
 */
export function assessOfferReadiness(a: OfferArtifact): ReadinessResult {
  const issues: ReadinessIssue[] = [];
  for (const check of ALL_CHECKS) issues.push(...check(a));
  const deduped = dedupeIssues(issues);
  const ready = !deduped.some((i) => i.severity === "BLOCKER");
  return { ready, issues: deduped };
}

// ── internals ──────────────────────────────────────────────────────────────────
function parsePriceToCents(text: string): number | null {
  const m = text.match(/\$?\s*(\d[\d,]*)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  const dollars = parseInt(m[1].replace(/,/g, ""), 10);
  const cents = m[2] ? parseInt(m[2].padEnd(2, "0"), 10) : 0;
  if (Number.isNaN(dollars)) return null;
  return dollars * 100 + cents;
}

function dedupeIssues(issues: ReadinessIssue[]): ReadinessIssue[] {
  const seen = new Set<string>();
  const out: ReadinessIssue[] = [];
  for (const i of issues) {
    const key = `${i.surface}|${i.severity}|${i.expected}|${i.observed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}
