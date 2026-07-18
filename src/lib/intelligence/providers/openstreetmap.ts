// ─────────────────────────────────────────────────────────────────────────────
// OpenStreetMap / Nominatim Provider (Phase 6).
//
// Improves identity validation, location enrichment, and INTERNATIONAL readiness.
// Contributes only UNIQUE evidence (it does not duplicate Google data) — address
// validation, geo, category tags, country/locale. Fusion later corroborates or
// flags contradictions against other providers. Live lookups are config-gated.
// ─────────────────────────────────────────────────────────────────────────────
import { evidence, type Evidence, type ProviderResult } from "../evidence";
import type { EnrichmentProvider, EnrichmentInput } from "../providers";
import { intelligenceConfig } from "../config";

const PROVIDER_ID = "openstreetmap";

/** Normalized Nominatim record. */
export interface OsmRecord {
  displayName?: string;
  lat?: number;
  lon?: number;
  category?: string; // amenity/shop/office
  type?: string; // e.g. "dentist", "restaurant"
  countryCode?: string; // ISO-2
  country?: string;
  addressTags?: Record<string, string>;
}

/** PURE: map a normalized OSM record into unique location/identity Evidence. */
export function mapNominatim(rec: OsmRecord): Evidence[] {
  const out: Evidence[] = [];
  const mk = (kind: Evidence["kind"], field: string, value: Evidence["value"], statement: string, observationType: Evidence["observationType"] = "Directly observed fact", confidence: Evidence["confidence"] = "Likely") =>
    out.push(evidence({ id: `${PROVIDER_ID}:${field}`, providerId: PROVIDER_ID, kind, field, value, statement, observationType, confidence, sourceUrl: null }));

  if (rec.displayName) mk("identity", "osmAddress", rec.displayName, `OpenStreetMap resolves the address as: ${rec.displayName}.`);
  if (rec.lat != null && rec.lon != null) mk("identity", "geo", `${rec.lat},${rec.lon}`, `Geolocated at ${rec.lat}, ${rec.lon}.`, "Directly observed fact", "Verified");
  if (rec.type) mk("market", "osmCategory", rec.type, `Categorized on OSM as "${rec.type}"${rec.category ? ` (${rec.category})` : ""} — corroborates the industry classification.`, "Strong inference", "Likely");
  if (rec.country || rec.countryCode) mk("identity", "country", rec.country ?? rec.countryCode!, `Located in ${rec.country ?? rec.countryCode} — used for international/locale handling.`, "Directly observed fact", "Verified");
  return out;
}

export const openStreetMapProvider: EnrichmentProvider = {
  id: PROVIDER_ID,
  name: "OpenStreetMap",
  capability: { fields: ["osmAddress", "geo", "osmCategory", "country"], external: true, costUsd: 0 },
  ready: () => true, // maps supplied records offline; live lookup gated by config
  async enrich(input: EnrichmentInput): Promise<ProviderResult> {
    if (input.osmRecord) return { providerId: PROVIDER_ID, ok: true, evidence: mapNominatim(input.osmRecord as OsmRecord), notes: ["mapped supplied record"], costUsd: 0 };
    const cfg = intelligenceConfig();
    if (!cfg.openStreetMap) return { providerId: PROVIDER_ID, ok: true, evidence: [], notes: ["live OSM disabled"], costUsd: 0 };
    return { providerId: PROVIDER_ID, ok: true, evidence: [], notes: ["live lookup not performed in this build"], costUsd: 0 };
  },
};
