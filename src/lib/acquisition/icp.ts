// ─────────────────────────────────────────────────────────────────────────────
// ICP fit — reject national chains / franchises / multi-location SaaS that are not
// our buyer, BEFORE spending an expensive live counter-test on them. We sell to
// owner-operated local businesses; a franchise location or a national brand has no
// local decision-maker who would buy a website fix. Pure + testable.
// ─────────────────────────────────────────────────────────────────────────────

// Known national chains / franchises / SaaS brands seen in the current inventory
// and common in the approved pods. Substring match on the normalized name.
const CHAIN_BRANDS = [
  "liberty tax", "h&r block", "hr block", "jackson hewitt", "tax1099", "zenwork",
  "job impulse", "employpro", "express employment", "labor finders", "manpower", "adecco",
  "robert half", "kelly services", "randstad", "aerotek", "spherion",
  "caliber collision", "maaco", "midas", "jiffy lube", "meineke", "aamco",
  "great clips", "supercuts", "sport clips", "european wax", "massage envy", "hand & stone",
  "anytime fitness", "planet fitness", "orangetheory", "crunch fitness", "gold's gym", "la fitness",
  "subway", "mcdonald", "starbucks", "domino", "papa john", "little caesars",
  "state farm", "allstate", "geico", "edward jones", "h and r block",
  "ups store", "fedex office", "postal annex", "servpro", "servicemaster", "molly maid",
  "merry maids", "two men and a truck", "1-800", "1800",
];

export interface IcpResult { fit: boolean; reason: string }

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** True when the business looks like a national chain / franchise / SaaS brand. */
export function isChainOrFranchise(lead: { businessName?: string | null; normalizedName?: string | null; locationsCount?: number | null; website?: string | null }): boolean {
  const name = norm(lead.normalizedName || lead.businessName);
  if (CHAIN_BRANDS.some((b) => name.includes(b))) return true;
  // Many locations ⇒ not a single owner-operated buyer.
  if ((lead.locationsCount ?? 0) >= 5) return true;
  // Franchise-y suffixes like "#18369" / "- 04521" in the name.
  if (/\b#?\d{4,6}\b/.test(name)) return true;
  return false;
}

/** ICP gate: fit only for owner-operated local businesses in our service lines. */
export function icpFit(lead: { businessName?: string | null; normalizedName?: string | null; locationsCount?: number | null; website?: string | null }): IcpResult {
  if (isChainOrFranchise(lead)) return { fit: false, reason: "national chain / franchise / multi-location — no local decision-maker to buy a fix" };
  return { fit: true, reason: "owner-operated local business" };
}
