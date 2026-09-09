// ─────────────────────────────────────────────────────────────────────────────
// SCOPE REGENERATION (Mandate Parts N/O/AB) — the mechanical, PURE translation
// of a stored offer's FROZEN customer-facing scope copy into the CURRENT
// plain-language capability copy.
//
// WHY THIS EXISTS
//   A prior production Breakbot batch found ~9 stored offers BLOCKED solely on
//   customerLanguage: their `offer.scope` text was frozen BEFORE the plain-language
//   capability copy shipped (capabilities.ts was since translated — customerTitle +
//   plain solutionSummary / includedItems / excludedItems). Those offers still carry
//   the OLD jargon copy in storage. This module rebuilds the copy from the CURRENT
//   capabilities so the jargon is gone.
//
// HARD INVARIANTS (semantics never change — this ONLY re-copies)
//   • price / SKU / band / capabilityKeys / findingIds / evidence — UNTOUCHED.
//   • The offer's REAL problem statement + evidence framing (scope.problemBeingSolved)
//     is PRESERVED verbatim — we do not re-derive the deficiency, only re-word the
//     solution/included/excluded copy that is sourced from the capability registry.
//   • deliveryWindow + customerInputsRequired keep their meaning (delivery timing and
//     the access we ask for are commercial facts, not jargon copy).
//   • The offerName's DELIVERY-LABEL prefix ("24-Hour" / "48-Hour" / "5-Day") is
//     preserved; only the trailing plain-language NOUN is re-sourced from the current
//     capabilities' customerTitle (so a frozen "CTA Repair" noun becomes the plain
//     "Booking & Contact Button Repair").
//
// The composition below mirrors generateOffer()'s scope assembly in offer-engine.ts
// (uniq → flatMap includedItems/excludedItems, longest revisionPolicy, "We also
// address …" solution join, plain offerNounFor) so a regenerated scope is
// byte-shape-identical to what the live generator produces today — it is a
// translation, not a re-scoping.
//
// PURE + deterministic. Never sends, never writes, never touches the store.
// ─────────────────────────────────────────────────────────────────────────────
import type { OfferScope } from "./types";
import type { StoredOffer } from "./store";
import { capabilityByKey, type Capability } from "./capabilities";
import { assessOfferCustomerLanguage } from "./customer-language";
import { PERSUASION_POLICY_VERSION } from "./offer-readiness";

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/** Resolve the offer's capabilities in their stored order, dropping any that no
 *  longer exist in the registry (a retired SKU cannot contribute copy). */
function capabilitiesFor(offer: StoredOffer): Capability[] {
  const caps: Capability[] = [];
  for (const key of offer.capabilityKeys ?? []) {
    const cap = capabilityByKey(key);
    if (cap) caps.push(cap);
  }
  return caps;
}

/**
 * The CUSTOMER-FACING offer NOUN, composed exactly like offer-engine.ts's
 * (non-exported) offerNounFor: a single capability uses its plain customerTitle;
 * a bundle uses a plain umbrella by dominant category. Never emits `.name` (which
 * may carry acronyms like "CTA").
 */
function plainOfferNoun(caps: Capability[]): string {
  if (caps.length === 1) return caps[0].customerTitle;
  const cats = caps.flatMap((c) => c.addressesCategories);
  if (cats.includes("Customer Acquisition")) return "Get More Website Contacts";
  if (cats.includes("Brand Experience")) return "Website Improvements";
  return "Website Fix";
}

// The delivery-label prefixes the generator emits (deliveryFor). Used ONLY to
// preserve the timing prefix on the offerName while re-sourcing the noun.
const DELIVERY_LABELS = ["24-Hour", "48-Hour", "5-Day"] as const;

/** Split a stored offerName into its {deliveryLabel prefix, rest}. When the name
 *  does not start with a known delivery label (e.g. an operator-personalized name),
 *  the whole name is treated as "rest" and left untouched. */
function splitDeliveryLabel(offerName: string): { prefix: string | null } {
  for (const label of DELIVERY_LABELS) {
    if (offerName.startsWith(`${label} `)) return { prefix: label };
  }
  return { prefix: null };
}

/**
 * Rebuild the offerName's plain-language noun from the CURRENT capabilities while
 * preserving the delivery-timing prefix. If the stored name carries no recognizable
 * delivery-label prefix (an operator personalized it), we DO NOT rewrite it — we
 * must not silently change an operator-authored name; the copy gate will still flag
 * it if it contains jargon, and the operator can re-personalize.
 */
function regenerateOfferName(offer: StoredOffer, caps: Capability[]): string {
  const current = offer.scope.offerName ?? "";
  const { prefix } = splitDeliveryLabel(current);
  if (prefix == null) return current; // operator-personalized / unknown shape → keep verbatim
  return `${prefix} ${plainOfferNoun(caps)}`;
}

/**
 * Rebuild the scope's customer-facing COPY from the CURRENT capabilities for
 * `offer.capabilityKeys`, preserving the offer's real problem statement/evidence
 * framing and all commercial semantics. Returns a NEW OfferScope (does not mutate).
 *
 * If no capabilities resolve (all retired), the copy cannot be re-sourced — the
 * original scope is returned unchanged so we never blank out an offer.
 */
export function regeneratePlainScope(offer: StoredOffer): OfferScope {
  const caps = capabilitiesFor(offer);
  const prev = offer.scope;
  if (caps.length === 0) return { ...prev };

  const primary = caps[0];
  // Solution copy — single cap = its plain summary; bundle = summary + "We also address …".
  const proposedSolution =
    caps.length === 1
      ? primary.solutionSummary
      : `${primary.solutionSummary} We also address ${caps
          .slice(1)
          .map((c) => c.customerTitle.toLowerCase())
          .join(", ")}.`;

  const includedItems = uniq(caps.flatMap((c) => c.includedItems)).slice(0, 8);
  const excludedItems = uniq(caps.flatMap((c) => c.excludedItems));
  // Longest revision window among bundled capabilities (generator's rule).
  const revisionPolicy = caps.map((c) => c.revisionPolicy).sort((a, b) => b.length - a.length)[0] ?? prev.revisionPolicy;

  return {
    // Re-sourced customer copy (the frozen jargon lived here) ──────────────────
    offerName: regenerateOfferName(offer, caps),
    proposedSolution,
    includedItems,
    excludedItems,
    revisionPolicy,
    // Preserved semantics — the real deficiency framing + commercial facts ─────
    problemBeingSolved: prev.problemBeingSolved,
    deliveryWindow: prev.deliveryWindow,
    customerInputsRequired: prev.customerInputsRequired,
  };
}

export interface ScopeRegenerationNeed {
  needs: boolean;
  reasons: string[];
}

/**
 * Decide whether a stored offer needs its scope copy regenerated. True when EITHER:
 *   • its customer-facing copy currently trips the customer-language gate
 *     (assessOfferCustomerLanguage(offer).problems.length > 0), OR
 *   • it was prepared under an older persuasion-policy version than the current
 *     PERSUASION_POLICY_VERSION (so its copy predates the plain-language policy).
 * Read-only; never mutates.
 */
export function offerNeedsScopeRegeneration(offer: StoredOffer): ScopeRegenerationNeed {
  const reasons: string[] = [];

  const lang = assessOfferCustomerLanguage(offer);
  if (lang.problems.length > 0) {
    reasons.push(
      `customer-language gate: ${lang.problems.length} problem(s) — ${lang.problems.join("; ")}`,
    );
  }

  const stampedVersion = offer.persuasionPolicyVersion ?? null;
  if (stampedVersion !== PERSUASION_POLICY_VERSION) {
    reasons.push(
      `persuasion-policy stale: offer=${stampedVersion ?? "(unstamped)"} current=${PERSUASION_POLICY_VERSION}`,
    );
  }

  return { needs: reasons.length > 0, reasons };
}
