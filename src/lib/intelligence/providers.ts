// ─────────────────────────────────────────────────────────────────────────────
// Enrichment provider architecture.
//
// A provider turns raw business input into normalized Evidence. The engine talks
// ONLY to this interface, so integrating OpenCorporates / OpenStreetMap / tech-
// detection / review sources later means writing one adapter and registering it —
// no engine changes. This pass ships the framework + two LOCAL adapters that
// normalize data we already have (lead facts, findings). No external API is called.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Finding } from "../types";
import type { WebsiteSignals } from "../scoring";
import { observationTypeFor } from "../positioning";
import { evidence, type Evidence, type ProviderResult } from "./evidence";

/** A pre-fetched web page a provider can analyze offline (no network needed). */
export interface SuppliedPage {
  url: string;
  html: string;
  /** Optional response headers (used by tech-detection). */
  headers?: Record<string, string>;
}

/** A publicly available review, supplied from an existing source (e.g. Places). */
export interface SuppliedReview {
  text: string;
  rating?: number | null;
  date?: string | null;
}

/** A public web/news signal for search enrichment. */
export interface SuppliedSearchItem {
  title: string;
  snippet?: string;
  date?: string | null;
  url?: string;
}

/**
 * Everything a provider might be handed. Providers use what they can, ignore the
 * rest. The optional *supplied* fields let providers run fully offline on content
 * the caller already has; when absent and live enrichment is enabled, providers
 * fetch it themselves.
 */
export interface EnrichmentInput {
  lead: Lead;
  findings?: Finding[];
  signals?: WebsiteSignals;
  /** Pre-fetched pages (skips the crawler). */
  pages?: SuppliedPage[];
  /** Pre-fetched public reviews (text). */
  reviews?: SuppliedReview[];
  /** Pre-fetched public search/news items. */
  searchItems?: SuppliedSearchItem[];
  /** Pre-resolved OpenCorporates record (normalized upstream). */
  corporateRecord?: Record<string, unknown> | null;
  /** Pre-resolved OpenStreetMap/Nominatim record (normalized upstream). */
  osmRecord?: Record<string, unknown> | null;
}

export interface ProviderCapability {
  /** Evidence fields this provider can populate (for planning + gap analysis). */
  fields: string[];
  /** Whether it reaches the network (planning: rate limits, cost, offline mode). */
  external: boolean;
  /** Rough cost per business enriched, USD. */
  costUsd: number;
}

export interface EnrichmentProvider {
  id: string;
  name: string;
  capability: ProviderCapability;
  /** Is this provider wired + configured right now? Local adapters are always ready. */
  ready(): boolean;
  enrich(input: EnrichmentInput): Promise<ProviderResult>;
}

// ── Provider registry ────────────────────────────────────────────────────────
// Order = trust order used by mergeEvidence on confidence ties.
const REGISTRY: EnrichmentProvider[] = [];

export function registerProvider(p: EnrichmentProvider): void {
  const i = REGISTRY.findIndex((x) => x.id === p.id);
  if (i >= 0) REGISTRY[i] = p;
  else REGISTRY.push(p);
}
export function providers(): EnrichmentProvider[] {
  return [...REGISTRY];
}
export function readyProviders(): EnrichmentProvider[] {
  return REGISTRY.filter((p) => p.ready());
}

/** Run all ready providers for one business and collect their results. */
export async function enrich(input: EnrichmentInput): Promise<ProviderResult[]> {
  const results = await Promise.all(
    readyProviders().map(async (p) => {
      try {
        return await p.enrich(input);
      } catch (err) {
        return { providerId: p.id, ok: false, evidence: [], notes: [`error: ${(err as Error).message}`], costUsd: 0 } satisfies ProviderResult;
      }
    }),
  );
  return results;
}

// ── Built-in LOCAL adapter #1: lead facts (Google Places–sourced fields we hold) ─
export const leadFactsProvider: EnrichmentProvider = {
  id: "lead-facts",
  name: "Lead Facts (local)",
  capability: {
    fields: ["businessName", "industry", "rating", "reviewCount", "locationsCount", "hasWebsite", "hasPublicEmail", "hasPhone", "hasBooking", "entityStatus"],
    external: false,
    costUsd: 0,
  },
  ready: () => true,
  async enrich({ lead }): Promise<ProviderResult> {
    const ev: Evidence[] = [];
    const add = (kind: Evidence["kind"], field: string, value: Evidence["value"], statement: string, confidence: Evidence["confidence"] = "Verified") =>
      ev.push(evidence({ id: `lead-facts:${field}`, providerId: "lead-facts", kind, field, value, statement, observationType: observationTypeFor("Verified fact", confidence), confidence, sourceUrl: lead.googleMapsUrl }));

    add("identity", "businessName", lead.businessName, `Business name is ${lead.businessName}.`);
    add("market", "industry", lead.industry, `Operates as a ${lead.industry.toLowerCase()}.`, "Likely");
    if (lead.rating != null) add("reputation", "rating", lead.rating, `Public rating is ${lead.rating}★.`);
    if (lead.reviewCount != null) add("scale", "reviewCount", lead.reviewCount, `${lead.reviewCount} public reviews.`);
    add("scale", "locationsCount", lead.locationsCount ?? 1, `${lead.locationsCount ?? 1} known location(s).`, "Likely");
    add("channel", "hasWebsite", !!lead.website, lead.website ? "Has a website." : "No website found.");
    add("channel", "hasPublicEmail", !!lead.publicEmail, lead.publicEmail ? "Public email available." : "No public email.");
    add("channel", "hasPhone", !!lead.phone, lead.phone ? "Public phone available." : "No public phone.");
    add("activity", "entityStatus", lead.businessStatus ?? "UNKNOWN", `Operating status: ${lead.businessStatus ?? "unknown"}.`, lead.businessStatus ? "Verified" : "Unknown");
    return { providerId: "lead-facts", ok: true, evidence: ev, notes: [], costUsd: 0 };
  },
};

// ── Built-in LOCAL adapter #2: website signals + findings → friction evidence ────
export const findingsProvider: EnrichmentProvider = {
  id: "findings",
  name: "Website Signals & Findings (local)",
  capability: { fields: ["mobileFriendly", "slowLoad", "hasBooking", "hasLeadForm", "friction:*"], external: false, costUsd: 0 },
  ready: () => true,
  async enrich({ lead, findings = [], signals }): Promise<ProviderResult> {
    const ev: Evidence[] = [];
    if (signals) {
      const sig = (field: string, value: boolean, statement: string) =>
        ev.push(evidence({ id: `findings:${field}`, providerId: "findings", kind: "technology", field, value, statement, observationType: "Directly observed fact", confidence: "Verified", sourceUrl: lead.website }));
      sig("mobileFriendly", signals.mobileFriendly, signals.mobileFriendly ? "Site is mobile-friendly." : "Site is not mobile-friendly.");
      sig("slowLoad", signals.slowLoad, signals.slowLoad ? "Site loads slowly." : "Site load is acceptable.");
      sig("hasBooking", signals.hasOnlineBooking, signals.hasOnlineBooking ? "Online booking present." : "No online booking.");
      sig("hasLeadForm", signals.hasLeadForm, signals.hasLeadForm ? "Lead form present." : "No lead form.");
    }
    for (const f of findings) {
      ev.push(
        evidence({
          id: `findings:friction:${f.id}`,
          providerId: "findings",
          kind: "friction",
          field: `friction:${f.category}`,
          value: f.observation,
          statement: f.observation,
          observationType: observationTypeFor(f.findingType, f.confidence),
          confidence: f.confidence as Evidence["confidence"],
          sourceUrl: f.sourceUrl,
        }),
      );
    }
    return { providerId: "findings", ok: true, evidence: ev, notes: findings.length ? [] : ["no findings yet"], costUsd: 0 };
  },
};

// ── Future providers (declared, NOT implemented this pass) ────────────────────
// These document the roadmap and let the operator UI show coverage gaps. `ready()`
// returns false so `enrich()` skips them until an adapter + credentials land.
export function futureProvider(id: string, name: string, fields: string[], costUsd = 0): EnrichmentProvider {
  return {
    id,
    name,
    capability: { fields, external: true, costUsd },
    ready: () => false,
    async enrich(): Promise<ProviderResult> {
      return { providerId: id, ok: false, evidence: [], notes: ["not yet implemented"], costUsd: 0 };
    },
  };
}

export const PLANNED_PROVIDERS: EnrichmentProvider[] = [
  futureProvider("openstreetmap", "OpenStreetMap / Nominatim", ["address", "geo", "categoryTags"], 0),
  futureProvider("opencorporates", "OpenCorporates", ["entityName", "registrationStatus", "incorporationDate", "officers"], 0),
  futureProvider("tech-detect", "Website Technology Detection", ["cms", "analytics", "bookingTool", "ecommerce", "integrations"], 0),
  futureProvider("review-intel", "Review Intelligence", ["sentimentThemes", "complaintPatterns", "responseLatency"], 0),
  futureProvider("foursquare", "Foursquare Places", ["popularity", "categories", "hoursAccuracy"], 0),
  futureProvider("search-enrichment", "Search Enrichment", ["competitors", "brandedDemand", "serviceKeywords"], 0),
];

// Register the local adapters so the engine works out of the box, offline.
registerProvider(leadFactsProvider);
registerProvider(findingsProvider);
