// ─────────────────────────────────────────────────────────────────────────────
// NO DARK PATTERNS (PART W) — deterministic guard over CUSTOMER-FACING artifacts.
//
// Persuasion earns a decision with the TRUTH, never with a manufactured pressure or a
// concealed cost. This guard scans only the strings a prospect actually reads (subject,
// email body, offer page copy, PDF text, checkout copy) for manipulative patterns and
// reports every violation with its surface, so an operator can see exactly WHAT leaked
// and WHERE. It NEVER rewrites copy — reporting only — and it REUSES the fabrication
// guard (evidence-gate.containsFabricatedClaim) for unsupported financial claims rather
// than re-implementing that vocabulary.
//
// Pure + deterministic + read-only. No sends, no charges, no external state.
// ─────────────────────────────────────────────────────────────────────────────
import { containsFabricatedClaim } from "./evidence-gate";

export type DarkPatternKind =
  | "FAKE_COUNTDOWN"          // a ticking timer / "expires in HH:MM:SS"
  | "FAKE_SCARCITY"           // "only 2 left", "3 spots remaining", low-stock pressure
  | "FALSE_URGENCY"           // "act now", "today only", "last chance" with no real basis
  | "FAKE_SAVINGS"            // crossed-out price / "was $X now $Y" / "X% off" invented discount
  | "HIDDEN_FEES"             // "+ fees at checkout", "additional charges may apply"
  | "SURPRISE_SUBSCRIPTION"   // "auto-renews", "recurring" not disclosed as an opt-in
  | "PRECHECKED_EXTRA"        // a pre-selected add-on the customer didn't choose
  | "MISLEADING_CTA"          // a button whose label hides what it does
  | "DECEPTIVE_SUBJECT"       // subject implying a promo/urgency it isn't
  | "FALSE_INQUIRY"           // "your customer asked…", fabricated inbound
  | "FALSE_THREAD"            // fake RE:/FWD: implying a prior conversation
  | "EXAGGERATED_CLAIM";      // unsupported revenue/traffic/conversion numbers

export interface DarkPatternViolation {
  kind: DarkPatternKind;
  /** Which customer-facing surface this was found on. */
  surface: string;
  /** The exact matched fragment (evidence for the operator). */
  match: string;
  detail: string;
}

export interface DarkPatternResult {
  clean: boolean;
  violations: DarkPatternViolation[];
}

/** The customer-facing surfaces to scan. Any absent field is simply skipped. */
export interface DarkPatternSurfaces {
  subject?: string | null;
  emailBody?: string | null;
  offerPageCopy?: string | null;
  pdfText?: string | null;
  checkoutCopy?: string | null;
  /** Any other explicitly customer-facing strings, labeled. */
  extra?: Array<{ where: string; text: string | null | undefined }>;
}

// ── Pattern library ──────────────────────────────────────────────────────────
// Each entry is (kind, regex, detail). Whole-word / phrase anchored to avoid false
// positives on legitimate copy. Case-insensitive. Ordered most-specific first.
const PATTERNS: Array<{ kind: DarkPatternKind; re: RegExp; detail: string }> = [
  // Fake countdown / ticking timer.
  { kind: "FAKE_COUNTDOWN", re: /\bexpires?\s+in\s+\d/i, detail: "countdown timer creates artificial time pressure" },
  { kind: "FAKE_COUNTDOWN", re: /\b\d{1,2}:\d{2}(?::\d{2})?\s*(left|remaining|to go)\b/i, detail: "ticking clock creates artificial time pressure" },
  { kind: "FAKE_COUNTDOWN", re: /\bcountdown\b/i, detail: "countdown language creates artificial time pressure" },

  // Fake scarcity / stock counts.
  { kind: "FAKE_SCARCITY", re: /\bonly\s+\d+\s+(left|remaining|spots?|seats?|slots?|in stock)\b/i, detail: "manufactured scarcity — a specific low count with no real basis" },
  { kind: "FAKE_SCARCITY", re: /\b\d+\s+(spots?|seats?|slots?)\s+(left|remaining|available)\b/i, detail: "manufactured scarcity — limited-slot pressure" },
  { kind: "FAKE_SCARCITY", re: /\b(low|limited)\s+stock\b/i, detail: "manufactured scarcity — low-stock pressure" },
  { kind: "FAKE_SCARCITY", re: /\bselling\s+(fast|out)\b/i, detail: "manufactured scarcity — selling-fast pressure" },

  // False urgency.
  { kind: "FALSE_URGENCY", re: /\bact\s+now\b/i, detail: "false urgency — no genuine deadline" },
  { kind: "FALSE_URGENCY", re: /\btoday\s+only\b/i, detail: "false urgency — invented one-day window" },
  { kind: "FALSE_URGENCY", re: /\blast\s+chance\b/i, detail: "false urgency — invented finality" },
  { kind: "FALSE_URGENCY", re: /\bhurry\b/i, detail: "false urgency — pressure with no real basis" },
  { kind: "FALSE_URGENCY", re: /\bdon'?t\s+miss\s+out\b/i, detail: "false urgency — FOMO pressure" },
  { kind: "FALSE_URGENCY", re: /\bexpir(es|ing)\s+(soon|today|tonight)\b/i, detail: "false urgency — invented expiry" },

  // Fake savings / crossed-out price / invented discount.
  { kind: "FAKE_SAVINGS", re: /\bwas\s+\$\d[\d,]*\b.*\bnow\s+\$\d/i, detail: "invented was/now discount — no real prior price" },
  { kind: "FAKE_SAVINGS", re: /~~\s*\$\d[\d,]*\s*~~/i, detail: "crossed-out price implies a discount that isn't real" },
  { kind: "FAKE_SAVINGS", re: /\bsave\s+\d+\s?%/i, detail: "percentage-off claim with no real reference price" },
  { kind: "FAKE_SAVINGS", re: /\b\d+\s?%\s+off\b/i, detail: "percentage-off claim with no real reference price" },
  { kind: "FAKE_SAVINGS", re: /\bnormally\s+\$\d/i, detail: "invented 'normally $X' anchor price" },

  // Hidden fees.
  { kind: "HIDDEN_FEES", re: /\+\s*(fees?|taxes?|charges?)\s+(at\s+checkout|apply)\b/i, detail: "hidden fees — cost not shown before purchase" },
  { kind: "HIDDEN_FEES", re: /\badditional\s+(fees?|charges?)\s+may\s+apply\b/i, detail: "hidden fees — undisclosed additional cost" },
  { kind: "HIDDEN_FEES", re: /\b(processing|service|convenience)\s+fee\b/i, detail: "surprise fee not shown in the headline price" },

  // Surprise subscription.
  { kind: "SURPRISE_SUBSCRIPTION", re: /\bauto[-\s]?renew(s|al|ing)?\b/i, detail: "recurring charge must be an explicit opt-in, not a default" },
  { kind: "SURPRISE_SUBSCRIPTION", re: /\bbilled\s+(monthly|annually|automatically)\b/i, detail: "recurring billing must be explicitly disclosed as opt-in" },
  { kind: "SURPRISE_SUBSCRIPTION", re: /\bcancel\s+any\s?time\b/i, detail: "'cancel anytime' implies an undisclosed subscription default" },

  // Pre-checked extras.
  { kind: "PRECHECKED_EXTRA", re: /\bpre[-\s]?(checked|selected|ticked)\b/i, detail: "an add-on must be opt-in, never pre-selected" },
  { kind: "PRECHECKED_EXTRA", re: /\badded\s+(to\s+your\s+(order|cart))\s+(automatically|for you)\b/i, detail: "an extra added without the customer choosing it" },

  // Misleading CTA.
  { kind: "MISLEADING_CTA", re: /\b(no,?\s+i\s+don'?t\s+want|no thanks,?\s+i\s+(hate|don'?t))\b/i, detail: "confirmshaming CTA — guilts the customer for declining" },
  { kind: "MISLEADING_CTA", re: /\bclick\s+here\s+to\s+(continue|claim)\b.*\b(charge|subscribe|billed)\b/i, detail: "CTA hides that it charges/subscribes the customer" },

  // Deceptive subject / false inquiry / false thread. (These also apply broadly but are
  // most damaging on the subject; the scanner still catches them anywhere.)
  { kind: "FALSE_INQUIRY", re: /\b(new\s+)?(customer|client)\s+(inquiry|enquiry|request|message)\b/i, detail: "implies a real inbound inquiry that did not happen" },
  { kind: "FALSE_INQUIRY", re: /\byour\s+(customer|client)\s+(asked|wanted|tried)\b/i, detail: "fabricated customer action" },
  { kind: "FALSE_INQUIRY", re: /\bmissed\s+(appointment|call|booking)\b/i, detail: "implies a real missed event that did not happen" },
  { kind: "FALSE_THREAD", re: /^\s*(re|fwd)\s*:/i, detail: "fake reply/forward implies a prior conversation that never occurred" },
  { kind: "DECEPTIVE_SUBJECT", re: /\b(you'?ve\s+won|winner|congratulations)\b/i, detail: "deceptive prize/promo premise" },
  { kind: "DECEPTIVE_SUBJECT", re: /\b(payment|invoice|account)\s+(issue|problem|failed|overdue)\b/i, detail: "false account/payment-problem premise" },
];

/** True → this exact match is a legitimate, non-manipulative use we allow. */
function isAllowedContext(kind: DarkPatternKind, text: string, matched: string): boolean {
  // "cancel anytime" / "billed monthly" are ONLY dark when presented as a default. When
  // the surrounding copy frames recurring as an explicit, described opt-in with the price
  // shown, an honest maintenance plan may legitimately say it. We keep the guard strict
  // here (report it) so the operator consciously confirms disclosure — no allowlist carve-
  // out is applied automatically, matching the fail-closed posture of the rest of the OS.
  return false;
}

/** Scan a single surface for every dark pattern. */
function scanSurface(where: string, text: string): DarkPatternViolation[] {
  const out: DarkPatternViolation[] = [];
  const t = text ?? "";
  if (!t.trim()) return out;

  for (const p of PATTERNS) {
    const m = t.match(p.re);
    if (m && !isAllowedContext(p.kind, t, m[0])) {
      out.push({ kind: p.kind, surface: where, match: m[0].trim(), detail: p.detail });
    }
  }

  // Unsupported revenue/traffic/conversion claims — REUSE the fabrication guard rather
  // than re-listing its vocabulary. Any fabricated quantitative business claim is an
  // exaggerated/deceptive claim in a customer-facing surface.
  if (containsFabricatedClaim(t)) {
    out.push({
      kind: "EXAGGERATED_CLAIM",
      surface: where,
      match: t.slice(0, 80).trim(),
      detail: "unsupported revenue/traffic/conversion claim (evidence-gate fabrication guard)",
    });
  }

  return out;
}

/**
 * Scan all supplied customer-facing surfaces for dark patterns. Returns clean=true only
 * when EVERY surface is free of every pattern. Deterministic + read-only.
 */
export function scanDarkPatterns(surfaces: DarkPatternSurfaces): DarkPatternResult {
  const rows: Array<{ where: string; text: string }> = [];
  const push = (where: string, text: string | null | undefined) => {
    if (text && text.trim()) rows.push({ where, text });
  };
  push("subject", surfaces.subject);
  push("emailBody", surfaces.emailBody);
  push("offerPageCopy", surfaces.offerPageCopy);
  push("pdfText", surfaces.pdfText);
  push("checkoutCopy", surfaces.checkoutCopy);
  for (const x of surfaces.extra ?? []) push(x.where, x.text);

  const violations: DarkPatternViolation[] = [];
  for (const row of rows) violations.push(...scanSurface(row.where, row.text));

  return { clean: violations.length === 0, violations };
}

/** Convenience: scan one string with a surface label (for reuse by other gates). */
export function scanDarkPatternsText(where: string, text: string): DarkPatternViolation[] {
  return scanSurface(where, text);
}
