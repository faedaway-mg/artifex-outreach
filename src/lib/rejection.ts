// ─────────────────────────────────────────────────────────────────────────────
// Operator lead rejection — the "Reject Lead / Not a Fit" vocabulary + pure
// helpers. Rejection reasons are aggregated to improve qualification over time,
// so they are a small controlled set (not free text). The doctrine's disqualifier
// buckets map 1:1 to these so the reconciliation and the operator speak the same
// language.
// ─────────────────────────────────────────────────────────────────────────────

export const REJECTION_CATEGORIES = [
  "wrong-geography",       // outside the active Lead Sprint pods (incl. retired CA)
  "closed",                // business is closed/defunct
  "wrong-icp",             // national chain / franchise / not our buyer
  "no-material-problem",   // site works; nothing worth paying to fix
  "problem-disproven",     // live counter-test disproved the hypothesis
  "needs-more-evidence",   // couldn't reproduce; not confident enough to keep
  "weak-value",            // real but too small to justify the offer
  "duplicate",             // duplicate of another lead
  "functional-site",       // shitty-looking but works — does not qualify
  "unreachable",           // no verifiable contact channel
  "other",
] as const;
export type RejectionCategory = (typeof REJECTION_CATEGORIES)[number];

export function isRejectionCategory(x: string): x is RejectionCategory {
  return (REJECTION_CATEGORIES as readonly string[]).includes(x);
}

export const REJECTION_LABELS: Record<RejectionCategory, string> = {
  "wrong-geography": "Wrong geography",
  closed: "Closed / defunct",
  "wrong-icp": "Wrong ICP (chain/franchise)",
  "no-material-problem": "No material problem",
  "problem-disproven": "Problem disproven (counter-test)",
  "needs-more-evidence": "Needs more evidence",
  "weak-value": "Weak value",
  duplicate: "Duplicate",
  "functional-site": "Functional site (works)",
  unreachable: "No reachable channel",
  other: "Other",
};

export interface RejectionCount { category: RejectionCategory; label: string; count: number }

/** Aggregate rejection reasons (pure) — highest first — to steer qualification. */
export function aggregateRejections(rows: Array<{ rejectionCategory?: string | null }>): RejectionCount[] {
  const counts = new Map<RejectionCategory, number>();
  for (const r of rows) {
    const c = r.rejectionCategory && isRejectionCategory(r.rejectionCategory) ? r.rejectionCategory : null;
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, label: REJECTION_LABELS[category], count }))
    .sort((a, b) => b.count - a.count);
}

/** A stable "Open Google Profile / Maps" URL for a lead whose identity is resolved. */
export function googleProfileUrl(lead: {
  googleMapsUrl?: string | null; googlePlaceId?: string | null;
  businessName?: string | null; city?: string | null; state?: string | null;
}): string | null {
  if (lead.googleMapsUrl && /^https?:\/\//.test(lead.googleMapsUrl)) return lead.googleMapsUrl;
  if (lead.googlePlaceId) return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(lead.googlePlaceId)}`;
  const parts = [lead.businessName, lead.city, lead.state].filter(Boolean).join(" ");
  if (parts.trim()) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts)}`;
  return null;
}
