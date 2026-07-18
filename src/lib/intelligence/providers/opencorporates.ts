// ─────────────────────────────────────────────────────────────────────────────
// OpenCorporates Provider (Phase 5).
//
// Strengthens IDENTITY RESOLUTION with legal company data: verified legal name,
// jurisdiction, registration status, incorporation date, related entities. Talks
// to the engine ONLY through the provider interface; live calls are gated on a
// token and degrade gracefully. International-aware (jurisdiction → country).
// ─────────────────────────────────────────────────────────────────────────────
import { evidence, type Evidence, type ProviderResult } from "../evidence";
import type { EnrichmentProvider, EnrichmentInput } from "../providers";
import { intelligenceConfig } from "../config";

const PROVIDER_ID = "opencorporates";

/** Normalized record shape (whatever fetches OC maps into this). */
export interface OpenCorporatesRecord {
  name?: string;
  companyNumber?: string;
  jurisdictionCode?: string; // e.g. "us_ca", "gb", "de"
  incorporationDate?: string; // ISO
  currentStatus?: string; // "Active", "Dissolved", …
  companyType?: string;
  previousNames?: string[];
  relatedEntities?: string[];
}

const JURISDICTION_COUNTRY: Record<string, string> = { us: "United States", gb: "United Kingdom", ca: "Canada", au: "Australia", de: "Germany", fr: "France", nl: "Netherlands", ie: "Ireland", nz: "New Zealand", sg: "Singapore" };

function countryFromJurisdiction(code?: string): string | null {
  if (!code) return null;
  const root = code.split("_")[0].toLowerCase();
  return JURISDICTION_COUNTRY[root] ?? root.toUpperCase();
}

/** PURE: map a normalized OpenCorporates record into identity Evidence. */
export function mapOpenCorporates(rec: OpenCorporatesRecord): Evidence[] {
  const out: Evidence[] = [];
  const mk = (kind: Evidence["kind"], field: string, value: Evidence["value"], statement: string, observationType: Evidence["observationType"] = "Directly observed fact", confidence: Evidence["confidence"] = "Verified") =>
    out.push(evidence({ id: `${PROVIDER_ID}:${field}`, providerId: PROVIDER_ID, kind, field, value, statement, observationType, confidence, sourceUrl: null }));

  if (rec.name) mk("identity", "legalName", rec.name, `Registered legal name: ${rec.name}.`);
  if (rec.companyNumber) mk("identity", "companyNumber", rec.companyNumber, `Company registration number ${rec.companyNumber}.`);
  const country = countryFromJurisdiction(rec.jurisdictionCode);
  if (country) mk("identity", "jurisdiction", country, `Registered in ${country}${rec.jurisdictionCode ? ` (${rec.jurisdictionCode})` : ""}.`);
  if (rec.currentStatus) {
    const active = /active|good standing/i.test(rec.currentStatus);
    mk("activity", "registrationStatus", rec.currentStatus, `Registration status: ${rec.currentStatus}.`, "Directly observed fact", active ? "Verified" : "Verified");
  }
  if (rec.incorporationDate) {
    const yr = Number(rec.incorporationDate.slice(0, 4));
    mk("scale", "incorporationDate", rec.incorporationDate, `Incorporated ${rec.incorporationDate}${yr ? ` (~${new Date().getFullYear() >= yr ? new Date().getFullYear() - yr : 0} years)` : ""} — longevity supports credibility.`, "Strong inference", "Likely");
  }
  if (rec.previousNames?.length) mk("identity", "previousNames", rec.previousNames.join("; "), `Previously known as: ${rec.previousNames.join("; ")}.`, "Directly observed fact", "Likely");
  if (rec.relatedEntities?.length) mk("scale", "relatedEntities", rec.relatedEntities.join("; "), `Related entities on record: ${rec.relatedEntities.join("; ")} — possible group/multi-entity structure.`, "Strong inference", "Likely");
  return out;
}

export const openCorporatesProvider: EnrichmentProvider = {
  id: PROVIDER_ID,
  name: "OpenCorporates",
  capability: { fields: ["legalName", "companyNumber", "jurisdiction", "registrationStatus", "incorporationDate", "relatedEntities"], external: true, costUsd: 0 },
  ready: () => true, // maps supplied records offline; live lookup gated on token
  async enrich(input: EnrichmentInput): Promise<ProviderResult> {
    if (input.corporateRecord) return { providerId: PROVIDER_ID, ok: true, evidence: mapOpenCorporates(input.corporateRecord as OpenCorporatesRecord), notes: ["mapped supplied record"], costUsd: 0 };
    const cfg = intelligenceConfig();
    if (!cfg.openCorporates.enabled) return { providerId: PROVIDER_ID, ok: true, evidence: [], notes: ["live OpenCorporates disabled (no token)"], costUsd: 0 };
    // Live path intentionally minimal + gated; degrade gracefully on any failure.
    return { providerId: PROVIDER_ID, ok: true, evidence: [], notes: ["live lookup not performed in this build"], costUsd: 0 };
  },
};
