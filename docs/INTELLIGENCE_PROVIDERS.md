# Intelligence Providers — First Generation

> Extends (does not replace) the Business Intelligence Engine. Each provider feeds
> the engine normalized Evidence through the existing `EnrichmentProvider` interface,
> improving the Snapshot, Improvement Potential, Friction Analysis, Opportunity
> Graph, Maturity, Discovery Prep, and Evolution Plan.
>
> **Deployable & safe by default:** all live network calls are config-gated OFF
> (`INTELLIGENCE_LIVE_ENRICHMENT`), matching the Resend/Places pattern. Every
> provider also runs fully **offline** on caller-supplied content, so the engine is
> deterministic and provider failures degrade gracefully. 241 tests green, build green.

## Providers implemented

| # | Provider | ID | Kind | Live gate | Offline input |
|---|---|---|---|---|---|
| 1 | **Website Intelligence** | `website-intelligence` | crawl + parse | `INTELLIGENCE_WEBSITE` | `input.pages` |
| 2 | **Technology Detection** | `tech-detection` | parse | (uses pages) | `input.pages` |
| 3 | **Review Intelligence** | `review-intelligence` | analyze | none (local) | `input.reviews` |
| 4 | **Search Enrichment** | `search-enrichment` | search | `INTELLIGENCE_SEARCH` | `input.searchItems` |
| 5 | **OpenCorporates** | `opencorporates` | lookup | `OPENCORPORATES_API_TOKEN` | `input.corporateRecord` |
| 6 | **OpenStreetMap** | `openstreetmap` | lookup | `INTELLIGENCE_OSM` | `input.osmRecord` |

Plus the two local adapters from the previous pass (`lead-facts`, `findings`).

## What each produces

- **Website Intelligence (largest contributor):** business description, services, primary CTA, booking flow, lead form, contact paths, locations, pricing visibility, languages (international), trust indicators, FAQ/portal/careers/blog, structured data, policies, mobile + accessibility observations — plus **friction evidence** (no booking, no lead form, no clear CTA, no viewport, weak trust) that flows straight into the Opportunity Graph.
- **Technology Detection:** detects CMS/commerce/scheduling/CRM-form/chat/analytics/marketing/payments/hosting/framework, then **translates to business meaning** — e.g. 3+ disconnected customer systems → duplicate-data-entry friction + a discovery question; no analytics → visibility gap; active marketing → ability-to-invest signal.
- **Review Intelligence:** recurring themes (slow communication, scheduling confusion, long waits, pricing/customer confusion; outstanding service, friendly staff) as **patterns with validate-questions** — never asserted as fact (observation type = Strong inference).
- **Search Enrichment:** momentum signals (expansion, awards, hiring, new services, partnerships, funding, community, press) as growth evidence.
- **OpenCorporates:** legal name, company number, jurisdiction→country, registration status, incorporation date/longevity, previous names, related entities — strengthens identity + credibility. International-aware.
- **OpenStreetMap:** address validation, geo, category corroboration, country/locale — unique evidence only (no Google duplication).

## Infrastructure (Phases 7–11)

- **HTTP client** (`http-client.ts`): over the SSRF-guarded `safeFetch`; adds TTL caching (+ cache-hit metrics), retry-with-backoff on transient failures, per-host rate limiting, and injectable fetcher/clock for deterministic tests.
- **Respectful crawler** (`crawler.ts`): robots.txt aware, same-origin only, conservative page cap, canonical URLs, duplicate-content detection, importance-prioritized traversal, content/metadata extraction.
- **Evidence Fusion** (`fusion.ts`): merges combined provider output — corroboration raises confidence, provenance is tracked, contradictions are surfaced (never silently overwritten), and an overall confidence score is produced.
- **Knowledge Graph** (`knowledge-graph.ts`): connects Business → Services → Technologies → Locations → People → Reviews → Growth → Friction → Opportunities, with cross-linked insights (e.g. disconnected systems → data-flow friction → recommended fix).
- **Enrichment Delta** (`enrichment-delta.ts`): diffs two `BusinessIntelligence` snapshots to show the operator exactly what improved — new evidence, confidence increases, new discovery questions, maturity/opportunity/improvement/angle/relationship-value changes.
- **International readiness:** language detection (Website), jurisdiction→country (OpenCorporates), country/locale (OSM); no US-only assumptions in the providers.
- **Performance:** offline analysis is pure/synchronous; live crawling is cached, rate-limited, timeout-bounded, retried, and runs providers concurrently. One provider failure never stops the engine (`enrich()` catches per-provider and continues).

## Enabling live enrichment (ops)

```
INTELLIGENCE_LIVE_ENRICHMENT=1     # master switch
INTELLIGENCE_WEBSITE=1             # (default on when live)
INTELLIGENCE_OSM=1
INTELLIGENCE_SEARCH=1              # requires a search source adapter
OPENCORPORATES_API_TOKEN=...       # enables OC lookups
INTELLIGENCE_CRAWL_MAX_PAGES=12
INTELLIGENCE_CRAWL_MIN_DELAY_MS=1000
```

Until then, providers enrich from supplied content (e.g. pages/reviews already fetched by the existing `website.ts` / Places layer), which is the recommended first wiring.

## Recommended next integrations

1. **Wire supplied content into the live flow** — pass the existing website-analysis HTML + Places reviews into `analyzeBusiness({ pages, reviews })`. Zero new vendors; immediately makes Website + Review + Tech providers contribute.
2. **Persist `BusinessIntelligence` + surface the Operator Briefing / Enrichment Delta** on the lead page (previous pass's recommendation still #1 for operator value).
3. **Search adapter** (news/SERP) to activate Search Enrichment momentum signals.
4. **Live crawl enablement** with monitoring once robots/rate-limit behavior is observed on real domains.
5. **OpenCorporates token** for identity/credibility; **OSM live** for international leads.
