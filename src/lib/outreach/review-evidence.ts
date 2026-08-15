// ─────────────────────────────────────────────────────────────────────────────
// Evidence-first Quick Review selection.
//
// Governing principle: if Artifex cannot point to the EXACT public evidence supporting a finding,
// the finding does not belong in the Quick Review. We never imply knowledge of internal operations
// we do not possess. So a finding is only sendable when it is:
//   • directly OBSERVED in public data, or REPORTED by third parties (reviews) — not inferred;
//   • backed by non-empty provenance (basis);
//   • about something PUBLICLY OBSERVABLE (not internal reporting/ops/analytics we can't see);
//   • written concretely — no hedging/inference language ("may", "look developing", "little sign").
//
// From the BI opportunity pool we grade candidates, drop the speculative ones, rank the survivors,
// and keep the best 2–3 (fewer when the evidence is thin). A weak review is NOT silently sendable.
// ─────────────────────────────────────────────────────────────────────────────
import type { ModernizationOpportunity, OpportunityCategory } from "../business-intelligence/types";
import type { ConfidenceLabel } from "../business-intelligence/confidence";

// Only directly-seen or third-party-reported evidence grounds a client-facing claim.
const STRONG_EVIDENCE = new Set<ConfidenceLabel>(["Observed", "Reported"]);

// Categories that describe INTERNAL state we cannot observe from public information. A public
// website cannot reveal internal reporting, dashboards, or cross-location workflow — so findings in
// these categories are inference, and inference does not go in front of a prospect as fact.
const NON_OBSERVABLE_CATEGORIES = new Set<OpportunityCategory>(["Operations", "Internal Workflow", "Reporting", "Analytics"]);

// Hedging / internal-inference language — the tells of a generic, unsupported claim.
const SPECULATIVE_RX = /\b(may|might|could|probably|likely|perhaps|possibly|seems?|appears?|look(?:s|ing)?\s+(?:developing|thin|limited|basic)|little sign|from the outside|behind the scenes|we (?:think|suspect|believe)|internal|back[\s-]?office|manual(?:ly)?|repetitive)\b/i;

/** Normalize a URL for CLIENT-FACING display: no protocol, no tracking/query, no trailing slash.
 *  The original stays intact upstream; this is only what the prospect sees on the PDF. */
export function displayUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u = url.trim();
  try {
    const parsed = new URL(u.startsWith("http") ? u : `https://${u}`);
    u = parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname); // drop protocol, query, hash, utm
  } catch {
    u = u.replace(/^https?:\/\//i, "").replace(/[?#].*$/, "");
  }
  return u.replace(/\/$/, "") || null;
}

export type ReviewStatus = "SENDABLE" | "NEEDS_REVIEW" | "INSUFFICIENT_EVIDENCE";

export type EvidenceSourceType = "website" | "google-business" | "reviews" | "listing" | "search" | "other";

/**
 * Exact provenance for a finding. Two layers: INTERNAL (basis + sourceUrl, kept for audit/debug,
 * never collapsed to a mere tag) and CLIENT-FACING (displayLabel, clean + normalized). The system
 * can always answer "where exactly did this come from?" from basis + sourceUrl.
 */
export interface FindingEvidence {
  confidence: ConfidenceLabel;
  sourceType: EvidenceSourceType;
  /** The exact underlying public source (with original path/query) — INTERNAL, never shown raw. */
  sourceUrl: string | null;
  /** Clean, human-readable source for the PDF, e.g. "urbanamericana.com · Collections". */
  displayLabel: string;
  /** The exact provenance strings the claim was formed from — INTERNAL, retained in full. */
  basis: string[];
  /** When the evidence was observed (BI generatedAt), if the architecture supplies it. */
  observedAt: string | null;
  /** A reference to a captured screenshot for this finding, when one exists (else null). */
  screenshotRef: string | null;
}

export interface ReviewFinding {
  /** Stable id carried from the source opportunity — lets the starting point reference its finding. */
  id: string;
  category: OpportunityCategory;
  /** The semantic topic (mobile/catalog/reviews/…) — the specific problem, finer than category. */
  topic: TopicKey;
  /** A specific, factual finding title (topic-driven, unique per finding, not consulting fluff). */
  title: string;
  /** What we actually found — the concrete observation. */
  observation: string;
  /** Exact + client-facing provenance behind the finding. */
  evidence: FindingEvidence;
  /** Why it matters commercially — the CONSEQUENCE (never an action). 1–2 sentences. */
  whyItMatters: string;
  /** The concrete Artifex intervention — the ACTION (never an impact statement). */
  whatWedDo: string;
  /** Internal rank score (higher = stronger/more valuable). Not shown. */
  score: number;
}

/** The single, internally-coherent starting point. Its title, intervention, and rationale ALL derive
 *  from one source finding, so the label can never disagree with the reason underneath it. */
export interface StartingPoint {
  /** The finding this recommendation is built from — the coherence anchor. */
  sourceFindingId: string;
  /** The engagement label (what we'd start with). */
  label: string;
  /** The concrete first intervention (from the source finding's whatWedDo). */
  intervention: string;
  /** Why this, and why first — 1–2 sentences, drawn from the SAME finding. */
  why: string;
  /** The receipt this move rests on — the source finding's client-facing evidence label. */
  proofReference: string;
}

/** The real attachment gate. A NEEDS_REVIEW review can be attached ONLY after an explicit operator
 *  approval; INSUFFICIENT_EVIDENCE can never be attached and cannot be waved through. Pure. */
export function isAttachable(status: ReviewStatus, approved: boolean): boolean {
  if (status === "SENDABLE") return true;
  if (status === "NEEDS_REVIEW") return approved === true;
  return false;
}

const CONF_WEIGHT: Record<ConfidenceLabel, number> = { Observed: 1, Reported: 0.75, Likely: 0.5, Inferred: 0.3, Unknown: 0.1 };
const IMPACT_WEIGHT: Record<string, number> = { Foundational: 1, High: 0.9, Moderate: 0.6, Incremental: 0.4 };

// ── Editorial layer (M3.1) ─────────────────────────────────────────────────────
// Titles, interventions, and the starting-point label are keyed by the finding's SEMANTIC TOPIC, not
// its broad category. Category is too coarse: "mobile" and "catalog" are both Customer Acquisition, so
// a category-keyed title gave two different findings the SAME headline, and a category-keyed start
// label disagreed with a topic-specific rationale. Topic-keyed copy makes every title unique and keeps
// the three roles distinct: OBSERVATION (what we saw) · WHY IT MATTERS (consequence) · WHAT WE'D DO
// (action). Generalized — derived from the observation, never from a business name.
export type TopicKey =
  | "catalog" | "test-content" | "duplicate" | "mobile" | "cta" | "booking" | "reviews" | "trust"
  | "speed" | "navigation" | "contact" | "brand" | "copy" | "presence" | "general";

// A short, unique headline per topic. A function so quantitative context from the observation (a
// collection count, a review count) can strengthen the title when it's present.
const TOPIC_TITLE: Record<TopicKey, (obs: string) => string> = {
  catalog: (o) => { const n = numFrom(o, /\b(\d{2,})\s+(?:customer-facing\s+)?(?:collections?|categor)/i); return n ? `Make ${n} collections easier to shop` : "Make the catalog easier to shop"; },
  reviews: (o) => { const n = numFrom(o, /\b(\d[\d,]{1,})\+?\s*(?:reviews?|ratings?)/i); return n ? `Put ${n}+ customer reviews to work` : "Put strong reviews to work"; },
  "test-content": () => "Take internal-looking pages out of public view",
  duplicate: () => "Consolidate duplicate catalog categories",
  mobile: () => "Make the first mobile visit easier to act on",
  cta: () => "Point visitors to one clear next step",
  booking: () => "Let customers book without calling",
  trust: () => "Make trust signals visible before the decision",
  speed: () => "Speed up a slow-loading site",
  navigation: () => "Simplify a crowded main navigation",
  contact: () => "Make it easier to get in touch",
  brand: () => "Present the business name consistently",
  copy: () => "Replace unfinished placeholder copy",
  presence: () => "Establish an owned home base online",
  general: (o) => titleFromObservation(o),
};

// The concrete Artifex ACTION per topic — always intervention-shaped (starts with a verb).
const TOPIC_INTERVENTION: Record<TopicKey, string> = {
  catalog: "Audit how customers browse the catalog and add filtering and sorting around the attributes they shop by.",
  reviews: "Surface the strongest customer reviews on the storefront and the pages where people decide.",
  "test-content": "Remove internal and test pages from public browsing and search, redirecting or no-indexing them.",
  duplicate: "Consolidate the duplicate categories, redirect the extras, and rebuild the taxonomy around how customers shop.",
  mobile: "Rework the mobile layout so the primary action appears first and promotional content doesn't bury it.",
  cta: "Choose one primary action per page and make the secondary paths visibly secondary.",
  booking: "Add online booking so customers can reserve outside business hours.",
  trust: "Surface credentials, guarantees, and testimonials at the point of decision.",
  speed: "Profile the site and cut the largest sources of load time.",
  navigation: "Simplify the primary navigation to the few destinations customers actually use.",
  contact: "Add a clear, consistent way to get in touch on every key page.",
  brand: "Standardize the business name across the title, header, and footer.",
  copy: "Replace the placeholder copy with finished, on-brand content.",
  presence: "Stand up an owned website as the home base other improvements build on.",
  general: "Audit the specifics and prioritize the single highest-leverage fix.",
};

// The engagement label for "Where we'd start" per topic — coherent with the same finding's rationale.
const TOPIC_START_LABEL: Record<TopicKey, string> = {
  catalog: "Catalog discovery & navigation pass", reviews: "On-site proof & reviews pass",
  "test-content": "Public-hygiene cleanup", duplicate: "Catalog taxonomy cleanup",
  mobile: "Mobile conversion pass", cta: "Primary-action clarity pass", booking: "Online booking setup",
  trust: "Trust-signal pass", speed: "Performance pass", navigation: "Navigation simplification pass",
  contact: "Contact & lead-capture pass", brand: "Brand consistency pass", copy: "Content finish pass",
  presence: "Owned-presence foundation", general: "Conversion QA pass",
};

// Verbs that make a sentence read as an ACTION (used to validate whatWedDo is intervention-shaped).
const INTERVENTION_VERBS = /\b(audit|restructure|simplify|surface|consolidate|reorganize|redesign|clarify|remove|redirect|add|prioriti[sz]e|map|improve|rebuild|test|instrument|rework|choose|replace|standardi[sz]e|stand up|profile|cut|set up)\b/i;

function numFrom(s: string, re: RegExp): string | null { const m = s.match(re); return m ? m[1].replace(/,/g, "") : null; }

// A concrete title from the observation itself (fallback for the rare "general" topic) — the first
// clause, trimmed to a headline length and sentence-cased. Never a generic consulting phrase.
function titleFromObservation(observation: string): string {
  const first = observation.split(/[.,—–]/)[0].trim().replace(/^the\s+/i, "");
  const words = first.split(/\s+/).slice(0, 8).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isSendable(o: ModernizationOpportunity): boolean {
  if (!STRONG_EVIDENCE.has(o.confidence.label)) return false;   // inferred/guessed → out
  if (!(o.basis && o.basis.length > 0)) return false;           // no provenance → out
  if (NON_OBSERVABLE_CATEGORIES.has(o.category)) return false;  // internal state we can't see → out
  if (SPECULATIVE_RX.test(o.observation)) return false;         // hedging/generic language → out
  return true;
}

/** The public source that grounds a finding — derived from its exact provenance strings. */
function sourceTypeOf(basis: string[], category: OpportunityCategory): EvidenceSourceType {
  const b = basis.join(" ").toLowerCase();
  if (/google business|gbp|listing|places/.test(b)) return "google-business";
  if (/review/.test(b)) return "reviews";
  if (/search|serp/.test(b)) return "search";
  if (/html|site|website|storefront|sitemap|page|mobile|render/.test(b)) return "website";
  if (category === "Customer Retention") return "reviews";
  return "website";
}

// A clean client-facing section label per TOPIC, so evidence reads "domain · Section" and the section
// matches the specific finding (a mobile finding says "Mobile", not its broad category's label).
const SECTION_BY_TOPIC: Record<TopicKey, string | null> = {
  catalog: "Catalog & navigation", duplicate: "Catalog & navigation", navigation: "Navigation",
  mobile: "Mobile experience", cta: "Homepage", booking: "Booking", contact: "Contact",
  reviews: "Reviews", trust: "Trust signals", "test-content": "Site hygiene", copy: "Site content",
  brand: "Brand", speed: "Performance", presence: "Online presence", general: null,
};

function toFinding(o: ModernizationOpportunity, ctx: { website?: string | null; observedAt?: string | null }): ReviewFinding {
  const specificity = Math.min(1, o.observation.trim().split(/\s+/).length / 18); // longer/concrete ranks higher
  const basis = o.basis ?? [];
  const sourceType = sourceTypeOf(basis, o.category);
  const domain = displayUrl(ctx.website ?? null);
  const topic = classifyTopic(o.observation);
  const section = sourceType === "google-business" ? "Google Business Profile"
    : sourceType === "reviews" ? "Reviews"
    : SECTION_BY_TOPIC[topic] ?? null;
  const displayLabel = sourceType === "google-business"
    ? "Google Business Profile"
    : [domain, section].filter(Boolean).join(" · ") || "Public online presence";
  // whatWedDo comes from the topic's intervention map (always action-shaped), NOT from the
  // opportunity's estimatedImpact.rationale — which for some engine rules is an IMPACT statement, not
  // an action (the M3.1 "What we'd do" defect). For the rare "general" topic, fall back to the
  // opportunity's own rationale only if it already reads as an action.
  const intervention = topic !== "general"
    ? TOPIC_INTERVENTION[topic]
    : (INTERVENTION_VERBS.test(o.estimatedImpact?.rationale ?? "") ? o.estimatedImpact!.rationale : TOPIC_INTERVENTION.general);
  return {
    id: o.id,
    category: o.category,
    topic,
    title: TOPIC_TITLE[topic](o.observation),
    observation: o.observation,
    evidence: {
      confidence: o.confidence.label,
      sourceType,
      sourceUrl: sourceType === "website" ? (ctx.website ?? null) : null, // exact, internal
      displayLabel,
      basis, // exact provenance retained in full
      observedAt: ctx.observedAt ?? null,
      screenshotRef: null, // structurally ready; populated when a real capture exists
    },
    whyItMatters: o.whyItMatters,
    whatWedDo: intervention,
    score: CONF_WEIGHT[o.confidence.label] * (IMPACT_WEIGHT[o.estimatedImpact?.level] ?? 0.5) * (0.6 + 0.4 * specificity),
  };
}

// Semantic TOPIC of a finding — the customer problem it's about, independent of its broad category.
// Two findings with the same topic are duplicates; two different topics in the SAME category (e.g.
// "mobile CTA" vs "catalog taxonomy", both Customer Acquisition) are materially distinct and coexist.
const TOPICS: Array<[TopicKey, RegExp]> = [
  ["catalog", /catalog|collection|categor|taxonom|inventory|product (page|line)|browse|filter|facet|discover/i],
  ["test-content", /\btest\b|staging|internal|draft|placeholder|sample|temp\b|dev\b/i],
  ["duplicate", /duplicat|near-identical|redundant|same (collection|category|page)/i],
  // "phone" alone is too greedy — "phone call" is a booking/contact cue, not a mobile one. Anchor to
  // mobile-specific phrasing so a booking finding never misclassifies as mobile.
  ["mobile", /mobile|viewport|above the fold|off[- ]screen|on a phone|smartphone|small screen|phone screen/i],
  ["cta", /call to action|call-to-action|\bcta\b|primary (action|button)|what to do next/i],
  ["booking", /book|schedul|appointment|reservation|reserve/i],
  ["reviews", /review|testimonial|proof|reputation|star/i],
  ["trust", /trust|credential|guarantee|certificat|award/i],
  ["speed", /speed|load|performance|lcp/i],
  ["navigation", /navigation|menu|nav\b|information architecture|top-level|route/i],
  ["contact", /contact|form|email|phone number|inquir/i],
  ["brand", /brand|inconsistent|spelled|naming|legacy name|truncat/i],
  ["copy", /lorem|placeholder text|unfinished|typo|malformed|template text/i],
  ["presence", /owned website|no website|google listing|home base/i],
];
/** The finding's semantic topic (finer than category) — drives titles, interventions, and the start. */
function classifyTopic(observation: string): TopicKey {
  const hit = TOPICS.find(([, re]) => re.test(observation));
  return (hit ? (hit[0] as TopicKey) : "general");
}
// Dedupe key is the TOPIC ALONE: title, hook, and intervention are all topic-keyed now, so two
// findings of the same topic are true duplicates even across categories (e.g. a "mobile" opportunity
// filed under Customer Acquisition and another under Brand Experience). Distinct topics in one
// category (mobile vs catalog, both Customer Acquisition) still coexist — that was the M3 requirement.
function topicOf(observation: string, _category: OpportunityCategory): string {
  return classifyTopic(observation);
}

/** Select the best evidence-backed findings (max 3), dropping speculative/unobservable/duplicate
 *  ones. Fewer findings is fine — quality over quantity, never filler. Pure + deterministic.
 *  `ctx` supplies the exact source (website URL) + observedAt so provenance survives into the model. */
export function selectReviewFindings(
  opportunities: ModernizationOpportunity[],
  max = 3,
  ctx: { website?: string | null; observedAt?: string | null } = {},
): ReviewFinding[] {
  const seenTopic = new Set<string>();
  const seenObs = new Set<string>();
  const findings: ReviewFinding[] = [];
  for (const o of opportunities.filter(isSendable).map((o) => toFinding(o, ctx)).sort((a, b) => b.score - a.score)) {
    const obsKey = o.observation.trim().toLowerCase().replace(/\s+/g, " ");
    const topic = topicOf(o.observation, o.category);
    // Dedupe by SEMANTIC TOPIC (not broad category) so distinct problems in one category survive,
    // while repetitive findings collapse.
    if (seenTopic.has(topic) || seenObs.has(obsKey)) continue;
    seenTopic.add(topic); seenObs.add(obsKey);
    findings.push(o);
    if (findings.length >= max) break;
  }
  return findings;
}

/** The review's sendability. ≥2 strong findings = SENDABLE; exactly 1 = NEEDS_REVIEW (operator
 *  should eyeball it); 0 = INSUFFICIENT_EVIDENCE (must not silently become an attachment). */
export function reviewStatus(findings: ReviewFinding[]): ReviewStatus {
  if (findings.length >= 2) return "SENDABLE";
  if (findings.length === 1) return "NEEDS_REVIEW";
  return "INSUFFICIENT_EVIDENCE";
}

/** The single highest-leverage starting point — built ENTIRELY from the top finding, so its label,
 *  intervention, and rationale can never disagree (the M3.1 coherence defect). Null when no findings.
 *  Answers: what we'd start with (label/intervention), why this, and why first — from the same finding. */
export function startHere(findings: ReviewFinding[]): StartingPoint | null {
  const top = findings[0];
  if (!top) return null;
  const n = findings.length;
  const firstReason = n > 1 ? `Of the ${n === 2 ? "two" : "three"} findings, it's the clearest to evidence and the fastest to show a result` : "It's the clearest to evidence and the fastest to show a result";
  return {
    sourceFindingId: top.id,
    label: TOPIC_START_LABEL[top.topic],
    intervention: top.whatWedDo,                                 // the concrete first action, same finding
    why: `${top.whyItMatters.replace(/\.$/, "")}. ${firstReason}, so we'd start here.`,
    proofReference: top.evidence.displayLabel,                   // the receipt, from the same finding
  };
}

/** Deterministic editorial coherence check on a fully-assembled review. It does NOT re-decide
 *  sendability (M2 owns that) — it catches structurally-malformed copy before it renders: duplicate
 *  titles, a missing/mis-typed role, or a starting point that doesn't match its source finding.
 *  Returns the list of problems (empty = clean). Pure. */
export function validateReviewEditorial(findings: ReviewFinding[], start: StartingPoint | null): string[] {
  const problems: string[] = [];
  const titles = findings.map((f) => f.title.trim().toLowerCase());
  if (new Set(titles).size !== titles.length) problems.push("duplicate finding titles");
  for (const f of findings) {
    if (!f.observation.trim()) problems.push(`finding ${f.id}: empty observation`);
    if (!f.whyItMatters.trim()) problems.push(`finding ${f.id}: empty whyItMatters`);
    if (!f.whatWedDo.trim()) problems.push(`finding ${f.id}: empty whatWedDo`);
    else if (!INTERVENTION_VERBS.test(f.whatWedDo)) problems.push(`finding ${f.id}: whatWedDo is not intervention-shaped`);
    if (!f.evidence.basis.length) problems.push(`finding ${f.id}: no evidence basis`);
  }
  if (start && findings.length) {
    const src = findings.find((f) => f.id === start.sourceFindingId);
    if (!src) problems.push("starting point references no real finding");
    else {
      if (start.label !== TOPIC_START_LABEL[src.topic]) problems.push("starting point label does not match its source finding");
      if (start.intervention !== src.whatWedDo) problems.push("starting point intervention does not match its source finding");
    }
  }
  return problems;
}
