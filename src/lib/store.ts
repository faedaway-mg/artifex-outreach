// ─────────────────────────────────────────────────────────────────────────────
// In-memory data store — the default persistence layer (mock mode).
//
// When DATABASE_URL is absent the whole app reads and writes here. A single
// process-wide singleton (pinned on globalThis so it survives Next.js HMR) holds
// one array per entity, seeded on first access. This gives a fully working,
// demonstrable MVP with zero external services. Swap to Postgres by pointing the
// repository functions below at Drizzle when a connection string is present.
// ─────────────────────────────────────────────────────────────────────────────
import { nanoid } from "nanoid";
import { ARTIFEX_IDENTITY, ARTIFEX_ADDRESS } from "./identity";
import type {
  Operator,
  Lead,
  Contact,
  Finding,
  Screenshot,
  Deliverable,
  Video,
  Outreach,
  Task,
  Meeting,
  Proposal,
  Agreement,
  AgreementEvent,
  Payment,
  Suppression,
  Settings,
  StoredBusinessIntelligence,
  RelationshipMemoryItem,
  RoadmapProgressItem,
  OutcomeReviewItem,
  EngagementSnapshotItem,
} from "./types";
import { buildSeed } from "./seed";
import { defaultCategories } from "./categories";

export interface Collections {
  operators: Operator[];
  leads: Lead[];
  contacts: Contact[];
  findings: Finding[];
  screenshots: Screenshot[];
  deliverables: Deliverable[];
  videos: Video[];
  outreach: Outreach[];
  tasks: Task[];
  meetings: Meeting[];
  proposals: Proposal[];
  agreements: Agreement[];
  agreementEvents: AgreementEvent[];
  payments: Payment[];
  suppressions: Suppression[];
  businessIntelligence: StoredBusinessIntelligence[];
  relationshipMemory: RelationshipMemoryItem[];
  roadmapProgress: RoadmapProgressItem[];
  outcomeReviews: OutcomeReviewItem[];
  engagementSnapshots: EngagementSnapshotItem[];
  settings: Settings;
  seeded: boolean;
}

const GLOBAL_KEY = "__artifex_outreach_store__";

function createEmpty(): Collections {
  return {
    operators: [],
    leads: [],
    contacts: [],
    findings: [],
    screenshots: [],
    deliverables: [],
    videos: [],
    outreach: [],
    tasks: [],
    meetings: [],
    proposals: [],
    agreements: [],
    agreementEvents: [],
    payments: [],
    suppressions: [],
    businessIntelligence: [],
    relationshipMemory: [],
    roadmapProgress: [],
    outcomeReviews: [],
    engagementSnapshots: [],
    settings: defaultSettings(),
    seeded: false,
  };
}

export function defaultSettings(): Settings {
  return {
    businessAddress: ARTIFEX_ADDRESS,
    signature: `Jordan Jackson\nFounder, Artifex Labs\n${ARTIFEX_IDENTITY.publicWebsite.replace(/^https?:\/\//, "")}`,
    calendarLink: ARTIFEX_IDENTITY.bookingUrl,
    website: ARTIFEX_IDENTITY.publicWebsite,
    contactEmail: ARTIFEX_IDENTITY.publicEmail,
    outreachSigner: "jordan",
    defaultReportLanguage: "English",
    defaultPricing: {
      "Launch Website": { low: 3500, high: 6500 },
      "Business Website System": { low: 8000, high: 18000 },
      "Automation Sprint": { low: 4000, high: 9000 },
      "AI Operations System": { low: 12000, high: 30000 },
      "Product or MVP Build": { low: 20000, high: 60000 },
      "Visual Asset System": { low: 3000, high: 8000 },
      "Product Strategy Engagement": { low: 6000, high: 15000 },
    },
    followUpTiming: [0, 3, 7, 14],
    prospecting: defaultProspecting(),
    sendingWindow: { timezone: "America/Los_Angeles", startHour: 8, endHour: 17, weekdays: [1, 2, 3, 4, 5] },
    agreementDefaults: {
      depositPercent: 50,
      defaultTimelineWeeks: 8,
      projectManagerName: "Jordan Jackson",
      governingLawState: "California",
      agreementValidityDays: 30,
    },
  };
}

export function defaultProspecting() {
  return {
    enabled: true,
    positioning:
      "Artifex Labs is a Business Technology Partner. We find friction in how a business attracts customers, serves them, and operates — then prioritize and implement the highest-value improvements over time. We do not sell a predetermined website, app, or automation; we recommend the smallest, highest-impact change first, including a simpler existing tool when that is the better answer.",
    services: [
      { name: "Customer Growth & Experience", description: "Make it easier for customers to find, choose, and reach the business — a clearer customer journey, focused landing experiences, better intake and follow-up.", priceLow: 1500, priceHigh: 8000 },
      { name: "Custom Software", description: "Web apps, dashboards, customer portals, SaaS platforms, integrations.", priceLow: 5000, priceHigh: 30000 },
      { name: "Operational Efficiency", description: "Remove repetitive manual work — workflow + CRM automation, intake/follow-up systems, internal tools, reporting.", priceLow: 2000, priceHigh: 15000 },
      { name: "Product Strategy", description: "MVP planning, roadmaps, UX + technical architecture, startup advisory.", priceLow: 2000, priceHigh: 12000 },
      { name: "Visual Systems", description: "Brand + design systems, UI libraries, product & adaptive interfaces.", priceLow: 2000, priceHigh: 15000 },
      { name: "Asset Factory", description: "Production-ready visual assets, icons, illustrations, interface asset systems.", priceLow: 1500, priceHigh: 10000 },
    ],
    industries: [
      "Dental practice",
      "Law firm",
      "Fitness studio",
      "Home-service company",
      "Professional consultant",
      "Specialty retailer",
    ],
    excludedIndustries: ["Financial services"],
    territories: [
      { city: "Los Angeles", state: "CA" },
      { city: "Pasadena", state: "CA" },
      { city: "Glendale", state: "CA" },
      { city: "Burbank", state: "CA" },
      { city: "Santa Monica", state: "CA" },
      { city: "Culver City", state: "CA" },
      { city: "Beverly Hills", state: "CA" },
      { city: "Long Beach", state: "CA" },
    ],
    radiusMiles: 10,
    minRating: 4.0,
    minReviews: 20,
    requireWebsite: false,
    requirePhone: false,
    dailyQueueSize: 8,
    callDailyTarget: 10,
    videoDailyTarget: 3,
    emailDailyTarget: 10,
    runTime: "05:30",
    weekdays: [1, 2, 3, 4, 5],
    tierTargetA: 3,
    tierTargetB: 3,
    exclusionKeywords: ["payday", "loan", "cannabis", "dispensary", "vape", "smoke shop"],
    coolingOffDays: 30,
    lastRunAt: null,
    categories: defaultCategories(),
    preset: "Balanced Portfolio" as const,
    maxPerCategoryPerRun: 2,
    minDistinctCategories: 4,
    dailyRequestBudget: 40,
    weeklyRequestBudget: 150,
    maxDailyCostUsd: 2.0,
    maxCategoriesPerRun: 10,
    maxTerritoriesPerCategory: 1,
    maxExaminedPerRun: 200,
    maxNewLeadsPerRun: 8,
    lastScheduledRunDate: null,
  };
}

export function db(): Collections {
  const g = globalThis as unknown as Record<string, Collections | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createEmpty();
  }
  const store = g[GLOBAL_KEY]!;
  if (!store.seeded) {
    buildSeed(store);
    store.seeded = true;
  }
  return store;
}

// Reset + reseed. Used by the seed script and the "reset demo data" settings action.
export function reseed(): void {
  const g = globalThis as unknown as Record<string, Collections | undefined>;
  const fresh = createEmpty();
  buildSeed(fresh);
  fresh.seeded = true;
  g[GLOBAL_KEY] = fresh;
}

// Test-only: replace the store with a clean, un-seeded slate (no demo data, no
// dynamically-added collections). Keeps scheduler/dispatch tests isolated since
// they scan the whole store rather than a single record.
export function __resetStoreForTests(): void {
  const g = globalThis as unknown as Record<string, Collections | undefined>;
  const fresh = createEmpty();
  fresh.seeded = true; // skip demo seeding
  g[GLOBAL_KEY] = fresh;
}

export const nowIso = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${nanoid(10)}`;

// ── Normalization helpers used for dedupe ────────────────────────────────────
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|co|company|corp|ltd|the|and|&)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length ? digits.slice(-10) : null;
}
