// ─────────────────────────────────────────────────────────────────────────────
// Shared voice helpers for the outreach kit.
//
// The voice is a calm consultant who has looked closely and has nothing to prove.
// Technology is never the subject — the business is. These helpers keep every
// generated surface grounded, human, and deterministic.
// ─────────────────────────────────────────────────────────────────────────────
import type { BusinessProfile, ModernizationOpportunity } from "../business-intelligence/types";

// Deterministic FNV-1a hash so the same lead always yields the same wording,
// while different leads vary. (Same approach the conversation engine uses.)
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function pick<T>(pool: T[], seed: string, salt: number): T {
  return pool[hash(`${seed}#${salt}`) % pool.length];
}

// What the business's customers are called — so we speak in their language.
export function audienceNoun(industry: string): string {
  const i = (industry || "").toLowerCase();
  if (/dental|dentist|orthodon|medical|clinic|physician|doctor|health|therapy|chiro/.test(i)) return "patients";
  if (/law|attorney|legal|account|cpa|bookkeep|advisor|advisory|consult|financial|insurance/.test(i)) return "clients";
  if (/hotel|motel|restaurant|cafe|bar\b|dining|bakery|salon|spa|barber|hair|event|catering|wedding/.test(i)) return "guests";
  return "customers";
}

// The natural spoken noun for the business itself.
export function tradeNoun(industry: string): string {
  const i = (industry || "").toLowerCase();
  if (/dental|dentist|orthodon|medical|clinic|physician|doctor|chiro|therapy/.test(i)) return "practice";
  if (/law|attorney|legal|account|cpa|bookkeep|advisor|advisory|consult/.test(i)) return "firm";
  if (/restaurant|cafe|coffee|bakery|dining|bar\b/.test(i)) return "spot";
  if (/salon|hair|barber|spa|massage|wellness|studio|gym|fitness|yoga|pilates/.test(i)) return "studio";
  if (/salon|hair|barber|retail|boutique|store|shop|auto|mechanic|detail/.test(i)) return "shop";
  return "business";
}

// The first name only, for a warm but professional address. Falls back cleanly.
export function firstName(full: string | null | undefined): string | null {
  const n = (full || "").trim();
  if (!n) return null;
  const first = n.split(/\s+/)[0];
  // Skip a leading honorific if present.
  if (/^(dr|mr|mrs|ms|mx)\.?$/i.test(first)) {
    const rest = n.split(/\s+/).slice(1);
    return rest[0] ?? null;
  }
  return first;
}

// A dentist named "Jane Smith" is "Dr. Smith"; otherwise use the first name.
export function addressName(full: string | null | undefined, industry: string): string | null {
  const n = (full || "").trim();
  if (!n) return null;
  const parts = n.split(/\s+/);
  const isClinical = /dental|dentist|orthodon|medical|clinic|physician|doctor|chiro|therapy|vet/.test((industry || "").toLowerCase());
  if (isClinical && parts.length >= 2 && !/^(dr|mr|mrs|ms|mx)\.?$/i.test(parts[0])) {
    return `Dr. ${parts[parts.length - 1]}`;
  }
  return firstName(n);
}

// The strongest genuine strength to acknowledge first — earns the right to observe.
export function leadStrength(profile: BusinessProfile): string | null {
  const s = profile.strengths.find((x) => x && x.trim());
  return s ? s.replace(/\.$/, "") : null;
}

// A warm, human acknowledgement of what's working — never a statistics dump.
// "4.8★ across 921 reviews" becomes "You've clearly built something people trust."
export function humanStrength(rating: number | null | undefined, reviewCount: number | null | undefined, hasStrength: boolean, seed: string): string | null {
  const r = rating ?? 0;
  const n = reviewCount ?? 0;
  const strong = [
    "You've clearly built something people trust",
    "It's obvious a lot of people have had a good experience with you",
    "You've earned real trust — that's the hard part",
  ];
  const solid = ["You've built a good reputation", "People clearly think well of you"];
  if (r >= 4.5 && n >= 40) return pick(strong, seed, 3);
  if (r >= 4 || (hasStrength && n >= 10)) return pick(solid, seed, 4);
  if (hasStrength) return "There's clearly something here worth building on";
  return null;
}

// The top opportunities, phrased as things we *noticed*, never as prescriptions.
export function topOpportunities(profile: BusinessProfile, n: number): ModernizationOpportunity[] {
  return profile.opportunities.slice(0, n);
}

// Clean customer-experience phrasing per opportunity category — used when the
// raw observation is too thin or too analyst-flavored to say to an owner.
const CATEGORY_PHRASE: Record<string, (audience: string) => string> = {
  "Customer Acquisition": (a) => `how new ${a} first find and choose you`,
  "Customer Retention": (a) => `how you keep ${a} coming back`,
  Scheduling: () => `how someone books a first appointment`,
  Communication: (a) => `how you stay in touch with ${a} after the first contact`,
  Automation: () => `how much still runs by hand behind the scenes`,
  Reporting: () => `how clearly you can see what's actually working`,
  Operations: () => `how smoothly the day-to-day runs`,
  "Brand Experience": () => `the first impression someone forms of you online`,
  Analytics: (a) => `how well you can tell what's bringing in new ${a}`,
  "Internal Workflow": () => `how much repeat work lands on your team`,
};

// Strip analyst meta-commentary and leaked internal labels from an observation
// so it reads like a person describing what they saw — not a report.
export function cleanObservation(o: ModernizationOpportunity): string {
  let s = (o.observation || "").trim();
  // Drop "confirm this" analyst tails — the operator confirms live, not the reader.
  s = s.replace(/\s*[—–-]\s*(whether|and whether|the thing)\b.*$/i, "");
  s = s.replace(/\b(is|are)\s+(the thing|worth)\b.*confirm.*$/i, "");
  s = s.replace(/\bthe thing to confirm\b.*$/i, "");
  // Remove leaked maturity labels ("looks Developing", "appears Emerging").
  s = s.replace(/\b(looks?|appears?|seems?)\s+(developing|emerging|nascent|established|mature|strong|limited|basic)\b/gi, "");
  s = s.replace(/\s{2,}/g, " ").replace(/\s*[—–-]\s*$/, "").replace(/[;,]\s*$/, "").replace(/\.$/, "").trim();
  return s;
}

// Soften an observation into first-person, customer's-eye language. Falls back to
// a clean category phrasing when the raw observation is too thin to state well.
export function noticed(o: ModernizationOpportunity, audience: string): string {
  const c = cleanObservation(o);
  if (c.split(/\s+/).filter(Boolean).length < 5) {
    return (CATEGORY_PHRASE[o.category]?.(audience) ?? c) || `how a new ${audience.replace(/s$/, "")} takes the next step`;
  }
  const body = /[A-Z]/.test(c.charAt(1)) ? c : c.charAt(0).toLowerCase() + c.slice(1);
  return body;
}

// Tighten a noticed phrase for email/video: drop a generic "this is a…" lead-in
// and keep the concrete, customer-facing clause. Keeps the writing crisp.
export function trimNoticed(p: string): string {
  const parts = p.split(/\s+—\s+/);
  let s = parts.length > 1 && /^(this is an?|it'?s an?)\b/i.test(parts[0].trim()) ? parts.slice(1).join(" — ") : parts[0];
  s = s.replace(/^(this is an?|it'?s an?)\s+/i, "").trim();
  return s;
}

// Dedupe observation phrasings while preserving order.
export function uniqueNoticed(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = x.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Lowercase, comma-safe join with an Oxford "and".
export function naturalList(items: string[]): string {
  const xs = items.map((x) => x.trim()).filter(Boolean);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
}

export function estimateSpeakingSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  // ~150 words/min conversational = 2.5 words/sec, plus a beat for pauses.
  return Math.round((words / 2.5) * 10) / 10 < 1 ? 0 : Math.round(words / 2.5);
}
