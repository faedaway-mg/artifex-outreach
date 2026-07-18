// ─────────────────────────────────────────────────────────────────────────────
// Intelligence configuration — decides which live providers may reach the network.
//
// Mirrors the repo's established pattern (Resend/Places are inert without a key).
// By DEFAULT every network provider is OFF, so the engine is deterministic,
// offline-safe, and deployable. Providers still run on caller-supplied content
// (pages / reviews / records) regardless of these flags — only outbound fetches
// are gated. Read PER CALL from process.env, never memoized at module load.
// ─────────────────────────────────────────────────────────────────────────────

export interface IntelligenceConfig {
  /** Master switch: allow any live outbound enrichment fetch. */
  liveEnrichment: boolean;
  /** Per-provider live gates (each also requires liveEnrichment). */
  website: boolean;
  techDetection: boolean;
  searchEnrichment: boolean;
  openCorporates: { enabled: boolean; token: string | null };
  openStreetMap: boolean;
  /** Crawler politeness. */
  crawl: { maxPages: number; perRequestTimeoutMs: number; minDelayMs: number; maxRetries: number; userAgent: string };
  /** Cache TTL for fetched resources (ms). */
  cacheTtlMs: number;
}

function bool(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

export function intelligenceConfig(): IntelligenceConfig {
  const env = process.env;
  const live = bool(env.INTELLIGENCE_LIVE_ENRICHMENT);
  return {
    liveEnrichment: live,
    website: live && env.INTELLIGENCE_WEBSITE !== "0",
    techDetection: live && env.INTELLIGENCE_TECH_DETECTION !== "0",
    searchEnrichment: live && bool(env.INTELLIGENCE_SEARCH),
    openCorporates: { enabled: live && !!env.OPENCORPORATES_API_TOKEN, token: env.OPENCORPORATES_API_TOKEN ?? null },
    openStreetMap: live && env.INTELLIGENCE_OSM !== "0",
    crawl: {
      maxPages: Number(env.INTELLIGENCE_CRAWL_MAX_PAGES ?? 12),
      perRequestTimeoutMs: Number(env.INTELLIGENCE_CRAWL_TIMEOUT_MS ?? 8000),
      minDelayMs: Number(env.INTELLIGENCE_CRAWL_MIN_DELAY_MS ?? 1000), // conservative
      maxRetries: Number(env.INTELLIGENCE_CRAWL_MAX_RETRIES ?? 2),
      userAgent: env.INTELLIGENCE_USER_AGENT ?? "ArtifexIntelligenceBot/1.0 (+https://artifexlabs.tech/bot)",
    },
    cacheTtlMs: Number(env.INTELLIGENCE_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000), // 24h
  };
}
