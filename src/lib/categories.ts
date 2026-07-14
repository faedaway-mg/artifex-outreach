// ─────────────────────────────────────────────────────────────────────────────
// Artifex category portfolio: the default structured targets, normalization, and
// industry → category/group mapping used by the diversified lead engine.
// ─────────────────────────────────────────────────────────────────────────────
import type { ProspectCategoryTarget, CategoryGroup, CategoryPriority, CategoryPreset } from "./types";

export function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// group → [label, priority][]
const PORTFOLIO: Record<CategoryGroup, Array<[string, CategoryPriority]>> = {
  "Professional Services": [
    ["Law firms", "high"],
    ["Business consultants", "high"],
    ["Executive coaches", "high"],
    ["Recruiting and staffing firms", "high"],
    ["Accounting firms", "high"],
    ["Tax professionals", "high"],
    ["Insurance agencies", "medium"],
    ["Financial advisory firms", "medium"],
    ["Architecture firms", "medium"],
    ["Engineering consultancies", "medium"],
  ],
  "Health and Wellness": [
    ["Dental practices", "medium"],
    ["Orthodontists", "medium"],
    ["Physical therapy practices", "medium"],
    ["Chiropractic practices", "medium"],
    ["Fitness studios", "medium"],
    ["Personal training studios", "medium"],
    ["Wellness clinics", "medium"],
    ["Med spas", "medium"],
    ["Salons", "medium"],
    ["Barbershops", "medium"],
    ["Massage studios", "medium"],
  ],
  "Home and Property Services": [
    ["HVAC companies", "high"],
    ["Plumbing companies", "high"],
    ["Electrical contractors", "high"],
    ["Roofing companies", "high"],
    ["Landscaping companies", "high"],
    ["Cleaning companies", "high"],
    ["Pest control companies", "high"],
    ["General contractors", "high"],
    ["Restoration companies", "high"],
    ["Property management companies", "high"],
    ["Interior design firms", "medium"],
    ["Pool service companies", "medium"],
  ],
  "Hospitality and Experiences": [
    ["Boutique hotels", "medium"],
    ["Event venues", "medium"],
    ["Catering companies", "medium"],
    ["Wedding services", "medium"],
    ["Private clubs", "medium"],
    ["Multi-location restaurants", "medium"],
  ],
  "Specialty Retail and Local Commerce": [
    ["Specialty retailers", "high"],
    ["Furniture stores", "high"],
    ["Jewelry stores", "high"],
    ["Home design showrooms", "high"],
    ["Premium apparel stores", "high"],
    ["Specialty food businesses", "medium"],
  ],
  "Automotive Services": [
    ["Auto detailing companies", "medium"],
    ["Specialty auto repair shops", "medium"],
    ["Collision centers", "medium"],
    ["Tire and service centers", "medium"],
    ["Vehicle wrap businesses", "medium"],
  ],
  "Education and Training": [
    ["Tutoring companies", "medium"],
    ["Vocational training", "medium"],
    ["Music schools", "medium"],
    ["Language schools", "medium"],
    ["Private learning centers", "medium"],
  ],
  "Growth-Stage Businesses": [
    ["Business coaches", "high"],
    ["Membership businesses", "high"],
  ],
};

function mkCat(label: string, group: CategoryGroup, priority: CategoryPriority): ProspectCategoryTarget {
  return {
    id: slug(label),
    label,
    normalizedCategory: slug(label),
    group,
    enabled: true,
    priority,
    dailyNewLeadCap: 2,
    weeklyNewLeadCap: 6,
    pausedUntil: null,
    searchQueries: [label],
    excludedKeywords: [],
    minRatingOverride: null,
    minReviewsOverride: null,
    requireWebsiteOverride: null,
    requirePhoneOverride: null,
    lastSearchedAt: null,
    searchesThisWeek: 0,
    leadsFoundThisWeek: 0,
    leadsQualifiedThisWeek: 0,
    weekAnchor: null,
    notes: "",
  };
}

export function defaultCategories(): ProspectCategoryTarget[] {
  const out: ProspectCategoryTarget[] = [];
  for (const group of Object.keys(PORTFOLIO) as CategoryGroup[]) {
    for (const [label, priority] of PORTFOLIO[group]) out.push(mkCat(label, group, priority));
  }
  return out;
}

// Map a legacy Lead.industry string → { normalizedCategory, group } for backfill.
const INDUSTRY_ALIASES: Record<string, { normalizedCategory: string; group: CategoryGroup }> = {
  "Dental practice": { normalizedCategory: "dental-practices", group: "Health and Wellness" },
  "Law firm": { normalizedCategory: "law-firms", group: "Professional Services" },
  "Fitness studio": { normalizedCategory: "fitness-studios", group: "Health and Wellness" },
  "Home-service company": { normalizedCategory: "home-services", group: "Home and Property Services" },
  "Professional consultant": { normalizedCategory: "business-consultants", group: "Professional Services" },
  "Specialty retailer": { normalizedCategory: "specialty-retailers", group: "Specialty Retail and Local Commerce" },
  "Financial services": { normalizedCategory: "financial-advisory-firms", group: "Professional Services" },
};

export function categoryMetaForIndustry(industry: string): { normalizedCategory: string; group: CategoryGroup } {
  if (INDUSTRY_ALIASES[industry]) return INDUSTRY_ALIASES[industry];
  const s = slug(industry);
  const all = defaultCategories();
  const hit = all.find((c) => c.normalizedCategory === s || c.normalizedCategory.startsWith(s) || s.startsWith(c.normalizedCategory));
  return hit ? { normalizedCategory: hit.normalizedCategory, group: hit.group } : { normalizedCategory: s || "other", group: "Professional Services" };
}

export function categoryGroupOf(normalizedCategory: string | null): CategoryGroup | "Other" {
  if (!normalizedCategory) return "Other";
  const hit = defaultCategories().find((c) => c.normalizedCategory === normalizedCategory);
  return hit?.group ?? "Other";
}

// Presets adjust which categories are enabled / prioritized.
export function applyPreset(preset: CategoryPreset, categories: ProspectCategoryTarget[]): ProspectCategoryTarget[] {
  const groupsFor: Record<CategoryPreset, CategoryGroup[] | "all"> = {
    "Balanced Portfolio": "all",
    "Professional Services": ["Professional Services", "Growth-Stage Businesses"],
    "Home Services": ["Home and Property Services"],
    "Health and Wellness": ["Health and Wellness"],
    "Retail and Hospitality": ["Specialty Retail and Local Commerce", "Hospitality and Experiences"],
    "High-Ticket Local Services": ["Home and Property Services", "Professional Services", "Specialty Retail and Local Commerce"],
    "Custom Mix": "all",
  };
  const target = groupsFor[preset];
  if (target === "all" || preset === "Custom Mix") {
    return categories.map((c) => ({ ...c, enabled: preset === "Custom Mix" ? c.enabled : true }));
  }
  return categories.map((c) => ({ ...c, enabled: (target as CategoryGroup[]).includes(c.group) }));
}
