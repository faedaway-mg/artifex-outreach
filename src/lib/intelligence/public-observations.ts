// ─────────────────────────────────────────────────────────────────────────────
// Public-site observation layer (M3) — deeper, structure-aware discovery from the pages we already
// crawl, WITHOUT a new crawler. It notices FACTS about the public buying experience (catalog/nav
// structure, test-looking public content, duplicate taxonomy, brand/copy defects, under-surfaced
// proof) and aggregates related evidence into business-level observations with exact provenance and
// quantitative context. It never recommends anything — observation is separate from intervention.
//
// Everything here is conservative and evidence-first: a claim requires the exact affected URLs/labels
// it was formed from, and false-positive controls keep legitimate content (e.g. "Test Kitchen") out.
// Derived opportunities still pass the M2 evidence gate (Observed/Reported + basis). Bounded + pure.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import type { ModernizationOpportunity, OpportunityCategory } from "../business-intelligence/types";
import { confidence } from "../business-intelligence/confidence";

export type ObservationKind =
  | "test-content" | "duplicate-taxonomy" | "catalog-discovery-gap" | "nav-fragmentation"
  | "brand-inconsistency" | "copy-defect" | "cta-fragmentation" | "proof-underused";

export interface PublicObservation {
  kind: ObservationKind;
  label: string;
  description: string;
  affected: string[];          // exact affected URLs / labels — full provenance, retained
  basis: string[];             // provenance strings
  quantitative: string | null; // concrete count/context ("11 of 42 collections")
  customerVisible: boolean;
  severity: "high" | "moderate" | "low";
}

// ── Bounds (operationally sane; deterministic) ────────────────────────────────
const MAX_LINKS = 400, MAX_EXAMPLES = 3;

interface LinkRef { href: string; text: string; path: string }

function parseLinks(html: string, baseHost: string): LinkRef[] {
  const out: LinkRef[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < MAX_LINKS) {
    const href = m[1].trim();
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    let path = href;
    try { const u = new URL(href, `https://${baseHost}`); if (u.host && u.host !== baseHost) continue; path = u.pathname; } catch { /* relative */ }
    out.push({ href, text: stripTags(m[2]).slice(0, 80), path: path.toLowerCase() });
  }
  return out;
}
function stripTags(s: string): string { return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function textOf(html: string): string { return stripTags(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")); }
function titleOf(html: string): string { return stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ""); }
function headings(html: string): string[] { return [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map((m) => stripTags(m[1])).filter(Boolean); }

// A collection/category route (ecommerce/catalog taxonomy).
const COLLECTION_PATH = /\/(collections?|categor(y|ies)|product-category|shop|store|department)\//i;
// Clearly non-customer-facing naming. Two conservative signals, both path-anchored:
//  • strong internal markers that almost never name real retail taxonomy (staging/draft/internal/…);
//  • "test" ONLY as its own segment, or test+digit, or test+an internal suffix — so "test-kitchen"
//    and "contest" (a legitimate word/segment) are never flagged.
const INTERNAL_STRONG = /(^|[/_-])(staging|draft|temp|placeholder|internal|do-not-use|donotuse|hidden|deprecated|obsolete)([/_-]|$)/i;
const TEST_SEGMENT = /(^|\/)(test(only|ing)?|test[-_]?\d+|test[-_]?(old|copy|new|page|draft|staging|temp|dummy))(\/|$)/i;
const isTestPath = (path: string): boolean => INTERNAL_STRONG.test(path) || TEST_SEGMENT.test(path);
const FILTER_HINT = /\b(filter|sort by|sort-by|refine|facet|narrow|shop by|price range)\b/i;
const REVIEW_HINT = /\b(review|testimonial|rated|stars?|trustpilot|yelp|★|"aggregateRating")\b/i;
const CTA_WORDS = /\b(book now|book online|schedule|shop now|get a quote|request a quote|contact us|get started|order now|reserve)\b/i;
const COPY_DEFECT = /\b(lorem ipsum|your (text|content|headline) here|insert (text|headline)|placeholder text|coming soon\.\.\.|tbd\b|xxx\b|\[[^\]]*\]|edit this|sample text)\b/i;

function dedupeLabel(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(s|es)\b/g, "").trim(); }

/** Extract conservative, aggregated public observations from the crawled pages. Pure. */
export function extractPublicObservations(pages: Array<{ url: string; html: string }>, lead: Pick<Lead, "businessName" | "website" | "websiteDomain" | "rating" | "reviewCount">): PublicObservation[] {
  const obs: PublicObservation[] = [];
  if (!pages.length) return obs;
  let baseHost = (lead.websiteDomain ?? "").toLowerCase();
  try { baseHost ||= new URL(lead.website ?? "").host; } catch { /* */ }

  const allLinks: LinkRef[] = [];
  const allText: string[] = [];
  const allTitles: string[] = [];
  const allHeadings: string[] = [];
  for (const p of pages) {
    allLinks.push(...parseLinks(p.html, baseHost).map((l) => ({ ...l, href: absolutize(l.href, baseHost, p.url) })));
    allText.push(textOf(p.html));
    allTitles.push(titleOf(p.html));
    allHeadings.push(...headings(p.html));
  }
  const collectionLinks = uniqueBy(allLinks.filter((l) => COLLECTION_PATH.test(l.path)), (l) => l.path);
  const fullText = allText.join(" \n ");

  // A. Test / staging / internal-looking PUBLIC content (path-anchored, conservative, de-duped by path).
  const testLinks = uniqueBy(allLinks.filter((l) => isTestPath(l.path)), (l) => l.path);
  if (testLinks.length > 0) {
    const ex = testLinks.slice(0, MAX_EXAMPLES);
    obs.push({
      kind: "test-content", label: "Internal/test-looking pages are publicly reachable",
      description: `${testLinks.length} public link${testLinks.length === 1 ? "" : "s"} use internal/test-style naming and are reachable by customers and search engines.`,
      affected: ex.map((l) => l.href), basis: ex.map((l) => `link: ${l.href}`),
      quantitative: `${testLinks.length} such link${testLinks.length === 1 ? "" : "s"}`, customerVisible: true,
      severity: testLinks.length >= 3 ? "high" : "moderate",
    });
  }

  // B. Duplicate / near-duplicate taxonomy (collection labels/paths).
  const dupGroups = new Map<string, LinkRef[]>();
  for (const l of collectionLinks) { const k = dedupeLabel(l.text || l.path.split("/").filter(Boolean).pop() || ""); if (!k) continue; (dupGroups.get(k) ?? dupGroups.set(k, []).get(k)!).push(l); }
  const dups = [...dupGroups.values()].filter((g) => g.length > 1);
  if (dups.length > 0) {
    const ex = dups.slice(0, MAX_EXAMPLES).map((g) => g.map((l) => l.href).slice(0, 2).join("  ≈  "));
    obs.push({
      kind: "duplicate-taxonomy", label: "The catalog has duplicate or near-duplicate categories",
      description: `${dups.length} customer-facing categor${dups.length === 1 ? "y is" : "ies are"} duplicated or near-identical, so the same concept appears more than once.`,
      affected: dups.flat().map((l) => l.href).slice(0, 6), basis: ex.map((e) => `near-duplicate: ${e}`),
      quantitative: `${dups.length} duplicated categor${dups.length === 1 ? "y" : "ies"} of ${collectionLinks.length}`, customerVisible: true,
      severity: dups.length >= 3 ? "high" : "moderate",
    });
  }

  // C. Large catalog with limited discovery support (breadth vs facets).
  const hasFilters = FILTER_HINT.test(fullText);
  if (collectionLinks.length >= 15 && !hasFilters) {
    obs.push({
      kind: "catalog-discovery-gap", label: "A large catalog with limited ways to narrow it down",
      description: `The storefront exposes ${collectionLinks.length} customer-facing collections, but the crawled pages show no filtering, sorting, or faceted browsing to help a shopper narrow a big catalog.`,
      affected: collectionLinks.slice(0, MAX_EXAMPLES).map((l) => l.href), basis: [`${collectionLinks.length} collection routes`, "no filter/sort/facet controls detected"],
      quantitative: `${collectionLinks.length} collections, no filters detected`, customerVisible: true, severity: "high",
    });
  }

  // D. Over-fragmented top-level navigation.
  const topLevel = uniqueBy(allLinks.filter((l) => (l.path.match(/\//g) || []).length === 1 && l.text.length > 1 && l.text.length < 30), (l) => l.path);
  if (topLevel.length >= 12) {
    obs.push({
      kind: "nav-fragmentation", label: "The main navigation offers a lot of competing destinations",
      description: `The primary navigation exposes ${topLevel.length} top-level destinations, which spreads a first-time visitor's attention thin before they reach the one thing they came to do.`,
      affected: topLevel.slice(0, MAX_EXAMPLES).map((l) => l.text || l.href), basis: [`${topLevel.length} top-level nav items`], quantitative: `${topLevel.length} top-level destinations`, customerVisible: true, severity: "moderate",
    });
  }

  // E. Brand / naming inconsistency (business name vs title/headings), conservative.
  const brandIssue = brandInconsistency(lead.businessName, allTitles, allHeadings);
  if (brandIssue) obs.push(brandIssue);

  // F. Obvious unfinished/placeholder copy (high-confidence only).
  const copyHit = fullText.match(COPY_DEFECT);
  if (copyHit) {
    obs.push({
      kind: "copy-defect", label: "Unfinished or placeholder copy is visible on the site",
      description: `The public pages contain placeholder or template text a visitor would notice.`,
      affected: [copyHit[0].slice(0, 60)], basis: [`copy: "${copyHit[0].slice(0, 60)}"`], quantitative: null, customerVisible: true, severity: "high",
    });
  }

  // G. Competing primary calls-to-action (fragmented conversion path).
  const ctas = uniqueBy(allLinks.filter((l) => CTA_WORDS.test(l.text)), (l) => l.text.toLowerCase().replace(/[^a-z]+/g, ""));
  if (ctas.length >= 3) {
    obs.push({
      kind: "cta-fragmentation", label: "Several competing primary actions, without a clear hierarchy",
      description: `The pages present ${ctas.length} different primary calls-to-action, so a ready customer isn't pointed at one clear next step.`,
      affected: ctas.slice(0, MAX_EXAMPLES).map((l) => l.text), basis: ctas.slice(0, MAX_EXAMPLES).map((l) => `cta: "${l.text}"`), quantitative: `${ctas.length} competing CTAs`, customerVisible: true, severity: "moderate",
    });
  }

  // H. Strong external proof not surfaced on-site (evidence-gated: we actually checked the pages).
  if ((lead.rating ?? 0) >= 4.5 && (lead.reviewCount ?? 0) >= 50 && !REVIEW_HINT.test(fullText)) {
    obs.push({
      kind: "proof-underused", label: "Strong reviews the site doesn't show",
      description: `The business has ${lead.reviewCount}+ reviews at ${lead.rating}★ externally, but the crawled pages surface no comparable review or testimonial proof at the moment a visitor is deciding.`,
      affected: [`${baseHost || "the site"} (crawled pages)`], basis: [`external rating ${lead.rating}★ / ${lead.reviewCount} reviews`, "no on-site review/testimonial markup detected on crawled pages"],
      quantitative: `${lead.reviewCount}+ reviews (${lead.rating}★) not surfaced on-site`, customerVisible: true, severity: "moderate",
    });
  }

  return obs;
}

function brandInconsistency(name: string, titles: string[], headings: string[]): PublicObservation | null {
  const canon = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (canon.split(" ").length < 2) return null; // single-word names: abbreviation is not an error
  const pool = [...titles, ...headings].map((t) => t.toLowerCase());
  // A clearly different rendering: contains most of the name's words but reordered/truncated in a way
  // that changes it — conservative: require a heading that shares the first word but drops a later one.
  const words = canon.split(" ");
  const truncated = pool.find((t) => t.includes(words[0]) && words.slice(1).some((w) => w.length > 3 && !t.includes(w)) && !t.includes(canon));
  if (!truncated) return null;
  return {
    kind: "brand-inconsistency", label: "The business name is presented inconsistently",
    description: `The business name appears in more than one form across the site, which quietly weakens brand recall.`,
    affected: [name, truncated], basis: [`name: "${name}"`, `on-page: "${truncated}"`], quantitative: null, customerVisible: true, severity: "low",
  };
}

function absolutize(href: string, host: string, pageUrl: string): string {
  try { return new URL(href, host ? `https://${host}` : pageUrl).toString(); } catch { return href; }
}
function uniqueBy<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>(); const out: T[] = [];
  for (const x of arr) { const k = key(x); if (k && !seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

// ── Observation → Opportunity (the intervention layer; tight, evidence-connected) ─────────────────
const MAP: Record<ObservationKind, { category: OpportunityCategory; why: string; intervention: string }> = {
  "test-content": { category: "Brand Experience", why: "Internal-looking pages in front of customers and search engines undercut a professional first impression and dilute what search indexes.", intervention: "Take internal/test collections out of public browsing and search (redirect or no-index), and keep staging catalog structures private." },
  "duplicate-taxonomy": { category: "Customer Acquisition", why: "When the same concept appears under several categories, shoppers second-guess where to look and search engines split ranking signals across duplicates.", intervention: "Consolidate duplicate/near-duplicate categories, redirect the losers, and rebuild the taxonomy around how customers actually shop." },
  "catalog-discovery-gap": { category: "Customer Acquisition", why: "A large catalog without ways to narrow it makes shoppers work to find what they want, and most give up before they do.", intervention: "Audit how customers browse the catalog and add filters/sorting around the attributes they actually shop by (style, price, availability)." },
  "nav-fragmentation": { category: "Customer Acquisition", why: "Too many top-level choices spread attention thin and delay the one action that matters.", intervention: "Simplify the primary navigation to the few destinations customers use, and demote the rest." },
  "brand-inconsistency": { category: "Brand Experience", why: "An inconsistent name is a small thing that quietly erodes trust and recall.", intervention: "Standardize the business name across title, header, and footer." },
  "copy-defect": { category: "Brand Experience", why: "Placeholder or unfinished copy reads as neglect at the exact moment you're asking a visitor to trust you.", intervention: "Replace the placeholder/template copy with finished, on-brand content." },
  "cta-fragmentation": { category: "Customer Acquisition", why: "Competing calls-to-action without a hierarchy leave a ready customer unsure what to do next.", intervention: "Choose one primary action per page and make the secondary paths visibly secondary." },
  "proof-underused": { category: "Customer Retention", why: "The strongest trust signal the business already owns is invisible right when a new visitor is deciding whether to buy.", intervention: "Surface the best reviews on the storefront and key product/decision pages." },
};

/** Turn aggregated observations into evidence-backed Observed opportunities (they still pass the M2
 *  gate). Quantitative context goes into the observation text so the review reads as researched. */
export function observationsToOpportunities(observations: PublicObservation[]): ModernizationOpportunity[] {
  return observations.map((o) => {
    const m = MAP[o.kind];
    const impact = o.severity === "high" ? "High" : o.severity === "moderate" ? "Moderate" : "Incremental";
    return {
      id: `obs-${o.kind}`, category: m.category,
      observation: o.quantitative ? `${o.description}` : o.description,
      whyItMatters: m.why,
      estimatedImpact: { level: impact as ModernizationOpportunity["estimatedImpact"]["level"], rationale: m.intervention },
      confidence: confidence("Observed"), // directly seen in public page structure
      basis: o.basis,
    };
  });
}
