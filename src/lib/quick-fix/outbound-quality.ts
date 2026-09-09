// ─────────────────────────────────────────────────────────────────────────────
// OUTBOUND QUALITY CHECK — before an offer is cold-send eligible, the message must
// answer, within ~15 seconds of reading: (1) why THIS business, (2) what we actually
// found, (3) what exactly we can fix, (4) the fixed price, (5) the delivery
// expectation, (6) the next action. Generic capability-first pitches are rejected —
// that's the outreach model we're replacing. No fake urgency, no fabricated metrics,
// no invented "AI agency" positioning.
// ─────────────────────────────────────────────────────────────────────────────

export interface OutboundDraft {
  whyThisBusiness?: string | null; // specific, observed reason (not "you exist + have email")
  whatWeFound?: string | null;     // the concrete observed issue
  whatWeFix?: string | null;       // the specific scope
  priceCents?: number | null;      // fixed price
  turnaround?: string | null;      // delivery expectation
  nextAction?: string | null;      // what the recipient should do
  body?: string | null;            // full rendered body (scanned for generic / forbidden patterns)
}

export interface OutboundQuality {
  passes: boolean;
  missing: string[];  // which of the six answers are absent/empty
  problems: string[]; // generic messaging / fake urgency / fabricated claims / AI positioning
}

// Generic capability-first phrasing we are explicitly replacing.
const GENERIC_PATTERNS: RegExp[] = [
  /\bweb development, apps?, ai,? and software\b/i,
  /\bwould you be open to (a )?(conversation|chat|call)\b/i,
  /\bwould you like to book a call\b/i,
  /\bwe provide (web|software|app|digital) /i,
  /\bwe are an? (ai|digital|software|web) (agency|company|studio)\b/i,
  /\blet's hop on a (quick )?call\b/i,
];
// Fabricated performance / fake urgency / unsupported superlatives.
const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bact now\b/i, /\blimited time\b/i, /\bdon'?t miss out\b/i, /\burgent\b/i,
  /\bguarantee(d)?\b/i, /\b#1\b/, /\bbest in\b/i, /\baward[- ]winning\b/i,
  /\bincrease (your )?(revenue|sales|traffic|conversions?) by \d/i,
  /\b\d+% more (revenue|sales|leads|traffic|conversions?)\b/i,
  /\bpowered by ai\b/i, /\bai[- ]driven\b/i,
];

function present(v: string | null | undefined): boolean { return !!v && v.trim().length > 0; }

/**
 * Judge whether an outbound draft is cold-send eligible. Pure + deterministic.
 * passes only when all six answers are present AND no generic/forbidden pattern is
 * found in the body.
 */
export function assessOutboundQuality(d: OutboundDraft): OutboundQuality {
  const missing: string[] = [];
  if (!present(d.whyThisBusiness)) missing.push("whyThisBusiness");
  if (!present(d.whatWeFound)) missing.push("whatWeFound");
  if (!present(d.whatWeFix)) missing.push("whatWeFix");
  if (d.priceCents == null || d.priceCents <= 0) missing.push("price");
  if (!present(d.turnaround)) missing.push("turnaround");
  if (!present(d.nextAction)) missing.push("nextAction");

  const problems: string[] = [];
  const body = `${d.body ?? ""} ${d.whyThisBusiness ?? ""} ${d.whatWeFound ?? ""} ${d.whatWeFix ?? ""} ${d.nextAction ?? ""}`;
  for (const re of GENERIC_PATTERNS) if (re.test(body)) problems.push(`generic capability-first phrasing: ${re.source}`);
  for (const re of FORBIDDEN_PATTERNS) if (re.test(body)) problems.push(`fabricated/urgency/AI-positioning phrasing: ${re.source}`);

  return { passes: missing.length === 0 && problems.length === 0, missing, problems };
}
