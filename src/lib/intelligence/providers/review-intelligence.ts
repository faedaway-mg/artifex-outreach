// ─────────────────────────────────────────────────────────────────────────────
// Review Intelligence Provider (Phase 3).
//
// Surfaces recurring THEMES from publicly available reviews already accessible via
// existing sources. Reviews are never treated as objective truth — each theme
// becomes an observed pattern with confidence, a question to validate, and a
// possible business impact. Negative themes feed Friction Analysis; positive ones
// become strengths the outreach must acknowledge.
// ─────────────────────────────────────────────────────────────────────────────
import { evidence, type Evidence, type ProviderResult } from "../evidence";
import type { EnrichmentProvider, EnrichmentInput, SuppliedReview } from "../providers";

const PROVIDER_ID = "review-intelligence";

interface ThemeDef {
  key: string;
  label: string;
  polarity: "positive" | "negative";
  keywords: RegExp;
  impact: string;
  validate: string;
}

const THEMES: ThemeDef[] = [
  { key: "slowComms", label: "Slow communication / response", polarity: "negative", keywords: /never (called|answered)|no (call|response)|didn'?t (call|respond|get back)|slow to respond|hard to reach|voicemail|unresponsive/i, impact: "May be losing inquiries to faster-responding competitors.", validate: "Is follow-up to new inquiries currently handled manually?" },
  { key: "scheduling", label: "Scheduling confusion", polarity: "negative", keywords: /(double|over)-?booked|scheduling (issue|problem|mess)|appointment (mix|mess|wrong)|reschedul|hard to (book|schedule)/i, impact: "May cause lost bookings and administrative rework.", validate: "How are appointments booked and confirmed today?" },
  { key: "longWaits", label: "Long waits", polarity: "negative", keywords: /(long|forever) wait|waited (an hour|forever|too long)|kept waiting|behind schedule/i, impact: "May reflect intake/flow bottlenecks that frustrate customers.", validate: "Where does the customer flow tend to back up?" },
  { key: "pricingConfusion", label: "Pricing confusion", polarity: "negative", keywords: /(surprise|hidden|unclear|confusing) (price|cost|fee|bill)|didn'?t know the (price|cost)|overcharged/i, impact: "May reduce trust and slow purchase decisions.", validate: "Where do customers usually need the most reassurance on price?" },
  { key: "customerConfusion", label: "Customer confusion / process unclear", polarity: "negative", keywords: /confus|didn'?t (know|understand)|no one (told|explained)|unclear (process|steps)/i, impact: "May indicate a customer journey that needs clarifying.", validate: "Where do new customers most often get confused?" },
  { key: "outstanding", label: "Outstanding service", polarity: "positive", keywords: /amazing|outstanding|exceptional|best (experience|ever)|highly recommend|went above/i, impact: "A genuine strength to build on and amplify.", validate: "" },
  { key: "friendlyStaff", label: "Friendly, caring staff", polarity: "positive", keywords: /friendly|kind|caring|welcoming|professional staff|great team/i, impact: "Strong human trust signal to preserve in any digital change.", validate: "" },
];

/** PURE: extract recurring themes from reviews into normalized Evidence. */
export function analyzeReviews(reviews: SuppliedReview[], sourceUrl: string | null = null): Evidence[] {
  if (!reviews.length) return [];
  const total = reviews.length;
  const out: Evidence[] = [];

  for (const t of THEMES) {
    const matches = reviews.filter((r) => t.keywords.test(r.text || ""));
    const count = matches.length;
    if (count < 2) continue; // one mention is noise, not a pattern
    const frequency = count / total;
    // Confidence scales with how recurrent the theme is (never "Verified" — reviews are subjective).
    const confidence: Evidence["confidence"] = frequency >= 0.25 && count >= 4 ? "Likely" : "Unknown";
    const kind = t.polarity === "negative" ? "friction" : "reputation";
    const field = t.polarity === "negative" ? `friction:review:${t.key}` : `strength:review:${t.key}`;
    const statement =
      t.polarity === "negative"
        ? `Recurring review theme: ${t.label.toLowerCase()} (${count} of ${total} reviews). ${t.impact}`
        : `Recurring positive theme: ${t.label.toLowerCase()} (${count} of ${total} reviews).`;
    out.push(
      evidence({
        id: `${PROVIDER_ID}:${t.key}`,
        providerId: PROVIDER_ID,
        kind,
        field,
        value: `${count}/${total}`,
        statement,
        observationType: "Strong inference", // pattern across reviews, not a single fact
        confidence,
        sourceUrl,
      }),
    );
    if (t.validate) {
      out.push(
        evidence({ id: `${PROVIDER_ID}:validate:${t.key}`, providerId: PROVIDER_ID, kind: "market", field: `discovery:review:${t.key}`, value: t.validate, statement: `Discovery question (from reviews): ${t.validate}`, observationType: "Open discovery question", confidence: "Unknown", sourceUrl }),
      );
    }
  }
  return out;
}

export const reviewIntelligenceProvider: EnrichmentProvider = {
  id: PROVIDER_ID,
  name: "Review Intelligence",
  capability: { fields: ["friction:review:*", "strength:review:*", "discovery:review:*"], external: false, costUsd: 0 },
  ready: () => true, // works on supplied review text; contributes nothing without it
  async enrich(input: EnrichmentInput): Promise<ProviderResult> {
    if (!input.reviews?.length) return { providerId: PROVIDER_ID, ok: true, evidence: [], notes: ["no review text supplied"], costUsd: 0 };
    const src = input.lead.googleMapsUrl;
    return { providerId: PROVIDER_ID, ok: true, evidence: analyzeReviews(input.reviews, src), notes: [`analyzed ${input.reviews.length} reviews`], costUsd: 0 };
  },
};
