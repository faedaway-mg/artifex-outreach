// Business Intelligence Engine — public surface.
// Import from "@/lib/intelligence" so internal module layout can evolve freely.
export * from "./config";
export * from "./evidence";
export * from "./providers";
export * from "./http-client";
export * from "./crawler";
export * from "./friction-taxonomy";
export * from "./opportunity-graph";
export * from "./maturity";
export * from "./evolution";
export * from "./learning";
export * from "./fusion";
export * from "./knowledge-graph";
export * from "./operator-briefing";
export * from "./enrichment-delta";
export * from "./engine";
// Enrichment providers (also self-register via ./providers/register).
export * from "./providers/register";
export { analyzeWebsitePages, websiteIntelligenceProvider } from "./providers/website-intelligence";
export { detectTechnologies, techToBusinessEvidence, techDetectionProvider } from "./providers/tech-detection";
export { analyzeReviews, reviewIntelligenceProvider } from "./providers/review-intelligence";
export { extractGrowthSignals, searchEnrichmentProvider } from "./providers/search-enrichment";
export { mapOpenCorporates, openCorporatesProvider } from "./providers/opencorporates";
export { mapNominatim, openStreetMapProvider } from "./providers/openstreetmap";
