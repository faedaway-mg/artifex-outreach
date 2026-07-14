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
import type {
  User,
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
  Suppression,
  Settings,
} from "./types";
import { buildSeed } from "./seed";

export interface Collections {
  users: User[];
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
  suppressions: Suppression[];
  settings: Settings;
  seeded: boolean;
}

const GLOBAL_KEY = "__artifex_outreach_store__";

function createEmpty(): Collections {
  return {
    users: [],
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
    suppressions: [],
    settings: defaultSettings(),
    seeded: false,
  };
}

export function defaultSettings(): Settings {
  return {
    businessAddress: "Artifex Labs · Los Angeles, CA",
    signature: "Jordan Jackson\nFounder, Artifex Labs\nartifexlabs.tech",
    calendarLink: "https://cal.com/artifexlabs/discovery",
    website: "https://artifexlabs.tech",
    contactEmail: "jordan@artifexlabs.tech",
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
