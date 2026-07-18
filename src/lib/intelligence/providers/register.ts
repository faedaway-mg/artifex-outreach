// Registers the first-generation intelligence providers into the shared registry.
// Imported for its side effect by the engine. Local adapters (lead-facts, findings)
// self-register in providers.ts; these are the enrichment providers.
import { registerProvider } from "../providers";
import { websiteIntelligenceProvider } from "./website-intelligence";
import { techDetectionProvider } from "./tech-detection";
import { reviewIntelligenceProvider } from "./review-intelligence";
import { searchEnrichmentProvider } from "./search-enrichment";
import { openCorporatesProvider } from "./opencorporates";
import { openStreetMapProvider } from "./openstreetmap";

registerProvider(websiteIntelligenceProvider);
registerProvider(techDetectionProvider);
registerProvider(reviewIntelligenceProvider);
registerProvider(searchEnrichmentProvider);
registerProvider(openCorporatesProvider);
registerProvider(openStreetMapProvider);

export const FIRST_GEN_PROVIDER_IDS = [
  "website-intelligence",
  "tech-detection",
  "review-intelligence",
  "search-enrichment",
  "opencorporates",
  "openstreetmap",
] as const;
