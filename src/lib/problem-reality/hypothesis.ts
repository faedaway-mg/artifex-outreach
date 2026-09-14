// ─────────────────────────────────────────────────────────────────────────────
// Hypothesis derivation — turn a finding (or a business's expected primary
// customer action) into a falsifiable claim the counter-test will try to DISPROVE.
// Pure and browser-free so it is trivially testable.
// ─────────────────────────────────────────────────────────────────────────────
import type { ProblemHypothesis, PrimaryCustomerAction } from "./types";

const BROWSER_DEPENDENT: ReadonlySet<PrimaryCustomerAction> = new Set([
  "booking", "appointment", "contact", "quote", "navigation",
  "mobile-interaction", "forms", "service-location-selection", "cta-availability",
]);

export function isBrowserDependent(a: PrimaryCustomerAction): boolean {
  return BROWSER_DEPENDENT.has(a);
}

/** Best-effort mapping of free text (finding title/observation/category) to the
 *  customer action it concerns. Deterministic keyword match — order matters. */
export function classifyAction(text: string): PrimaryCustomerAction {
  const t = text.toLowerCase();
  if (/\b(book|booking|reserve|reservation)\b/.test(t)) return "booking";
  if (/\b(appointment|schedule|scheduling|consult|consultation)\b/.test(t)) return "appointment";
  if (/\b(quote|estimate|pricing request|request a quote|get a quote)\b/.test(t)) return "quote";
  if (/\b(contact|get in touch|reach us|message us|email us|phone)\b/.test(t)) return "contact";
  if (/\b(location|postal|zip|service area|choose (a )?location|select location)\b/.test(t)) return "service-location-selection";
  if (/\b(form|submit|field|input)\b/.test(t)) return "forms";
  if (/\b(mobile|responsive|small screen|touch)\b/.test(t)) return "mobile-interaction";
  if (/\b(menu|navigation|navbar|header|nav)\b/.test(t)) return "navigation";
  if (/\b(cta|call to action|button)\b/.test(t)) return "cta-availability";
  if (/\b(https|ssl|secure|certificate|page ?speed|performance|seo|search visibility|meta)\b/.test(t)) return "non-interactive";
  return "cta-availability";
}

/** The action a customer of this kind of business most needs to complete. Used to
 *  form a default hypothesis when there is no specific finding to counter-test. */
export function expectedPrimaryAction(industry: string): PrimaryCustomerAction {
  const i = (industry || "").toLowerCase();
  if (/(spa|salon|medspa|dental|dentist|clinic|aesthet|barber|massage|wellness|chiro|derm)/.test(i)) return "booking";
  if (/(restaurant|cafe|bar|hotel|motel|venue|event)/.test(i)) return "booking";
  if (/(law|attorney|legal|accounting|tax|insurance|financial|consult|staffing|recruit|agency)/.test(i)) return "contact";
  if (/(plumb|hvac|roof|contractor|construction|repair|auto|cleaning|landscap|electric)/.test(i)) return "quote";
  return "contact";
}

const CLAIM_BY_ACTION: Record<PrimaryCustomerAction, string> = {
  booking: "No usable online booking path for a customer",
  appointment: "No usable way to book/schedule an appointment",
  contact: "No usable way for a customer to make contact",
  quote: "No usable way to request a quote/estimate",
  navigation: "Primary navigation is broken or unusable",
  "mobile-interaction": "Core action is unusable on mobile",
  forms: "The primary form is broken/unusable",
  "service-location-selection": "Customer cannot select their service location",
  "cta-availability": "No clear primary call-to-action to convert a visitor",
  "non-interactive": "A technical issue degrades the site (non-click-path)",
};

let counter = 0;
function nextId(seed: string): string {
  counter += 1;
  return `pr_${seed.replace(/[^a-z0-9]+/gi, "").slice(0, 10).toLowerCase()}_${counter}`;
}

/** Derive hypotheses for a lead. If findings exist, one per browser-relevant
 *  finding; otherwise a single default hypothesis on the expected primary action. */
export function deriveHypotheses(
  lead: { id: string; industry: string; website?: string | null },
  findings: Array<{ id: string; title: string; observation?: string; category?: string }> = [],
): ProblemHypothesis[] {
  const url = lead.website ?? "";
  const out: ProblemHypothesis[] = [];
  for (const f of findings) {
    const action = classifyAction(`${f.category ?? ""} ${f.title} ${f.observation ?? ""}`);
    out.push({
      id: nextId(f.id),
      claim: CLAIM_BY_ACTION[action],
      primaryCustomerAction: action,
      browserDependent: isBrowserDependent(action),
      sourceFindingId: f.id,
      url,
    });
  }
  if (out.length === 0) {
    const action = expectedPrimaryAction(lead.industry);
    out.push({
      id: nextId(lead.id),
      claim: CLAIM_BY_ACTION[action],
      primaryCustomerAction: action,
      browserDependent: isBrowserDependent(action),
      url,
    });
  }
  // De-dupe by (action) so we don't run the same counter-test many times.
  const seen = new Set<string>();
  return out.filter((h) => (seen.has(h.primaryCustomerAction) ? false : (seen.add(h.primaryCustomerAction), true)));
}
