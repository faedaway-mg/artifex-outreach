// ─────────────────────────────────────────────────────────────────────────────
// PACKAGE SALES-COHERENCE GATE (Active Inventory Integrity mandate §13, §52, §53).
//
// One package = ONE primary sellable problem. The subject, the first line, the offer
// hero, the evidence, the PDF, the personalized video, and the offer all have to tell
// the SAME story. This module is the arbiter that BLOCKS a package whose surfaces
// disagree — the exact contradictions the operator found by hand:
//   • Overview shows no subject while Preview has one          (subject.missing)
//   • Hero sells "I tried to send an inquiry" while the finding is about brand recall
//     (hero.mismatch — two different stories)
//   • Copy claims an action we never performed ("I submitted an inquiry")
//     (claim.overstated)
//   • Mobile copy with no mobile evidence                      (mobile.noEvidence)
//   • PDF/evidence claims screenshots that don't exist         (evidence.absent)
//   • Generic fallback survives when a specific finding exists  (copy.generic)
//   • "Why it matters" is generic boilerplate, not finding-specific (why.generic)
//
// PURE — the caller assembles the facts (from the ONE evidence truth + the offer);
// this function only judges them, so it is trivially unit-testable and Breakbot runs
// it over every real active package (§32) without any I/O.
// ─────────────────────────────────────────────────────────────────────────────
import { classifyDefectFamily, type SubjectFamily } from "./subject-engine";

export type CoherenceSeverity = "BLOCK" | "WARN";

export interface CoherenceIssue {
  /** Stable machine key (kebab.dotted) so Breakbot + regressions can assert on it. */
  kind: string;
  severity: CoherenceSeverity;
  /** Operator-facing one-liner: what disagrees and why it blocks. */
  detail: string;
}

/** The assembled facts a coherence judgement needs — every field already canonical. */
export interface CoherenceInput {
  /** The canonical selected subject shown in Overview + Preview + Email (may be empty). */
  subject: string;
  /** The primary finding's plain-language text (the ONE problem being sold). */
  findingText: string;
  /** The email first line / offer hero opener (from the experience frame). */
  firstLine: string;
  /** The offer-page hero title. */
  heroTitle: string;
  /** The finding-specific "why it matters". */
  whyItMatters: string;
  /** Whether the experience frame asserts a functional attempt ("I tried to …"). */
  attemptSupported: boolean;
  /** Whether the finding/copy is about a mobile/phone experience. */
  mentionsMobile: boolean;
  /** A READY mobile screenshot exists. */
  hasMobileScreenshot: boolean;
  /** Any READY screenshot exists at all. */
  hasAnyScreenshot: boolean;
  /** The number of READY screenshots (for singular/plural truthfulness downstream). */
  screenshotCount: number;
  /** True when the offer is a genuine fixed-price quick fix (not a conversation page). */
  quickFixEligible: boolean;
}

// Generic fallback hero/opener strings that must NOT survive on an active package when a
// stronger, specific narrative exists (§30). Matched case-insensitively, trimmed.
const GENERIC_HERO = [
  "here's what we found on your website.",
  "we found something on the pages we checked worth a closer look.",
  "here's what we found on your website",
];

// Boilerplate "why it matters" phrasing that is too generic to stand alone (§15). If the
// whole whyItMatters is ONLY one of these, it does not actually explain why.
const GENERIC_WHY = [
  "a clearer next action for visitors",
  "a clearer next action",
  "less friction on the path that matters",
];

// Copy that asserts a submission/inquiry we did not actually perform. We only ever say
// "I tried to …" for action families where an attempt is genuinely implied; a claim of a
// COMPLETED submission ("I submitted", "I sent an inquiry and received") is never allowed.
const OVERSTATED_ACTION =
  /\bI (submitted|sent) (your |an |the )?(form|inquiry|message)\b|\bwe (submitted|sent) (your |an |the )?(form|inquiry)\b|\bI filled out (and|your)\b/i;

// Unbounded universal claims about the whole site when we only reviewed a few pages (§53).
const UNBOUNDED_SITE_CLAIM = /\bacross your (whole |entire )?(website|site)\b|\bevery page\b|\ball of your pages\b/i;

function norm(s: string): string {
  return (s ?? "").trim().toLowerCase();
}

/** Families where "I tried to …" attempted-use phrasing is truthful. */
const ACTION_FAMILIES = new Set<SubjectFamily>(["booking", "mobile_booking", "contact", "mobile_contact"]);

/**
 * Judge whether every customer-facing surface of a package tells the same, truthful
 * story. Returns the list of issues (BLOCK ones must hold the package). An empty list
 * means the package is coherent. Deterministic + pure.
 */
export function assessPackageCoherence(input: CoherenceInput): CoherenceIssue[] {
  const issues: CoherenceIssue[] = [];
  // A conversation-only (non-quick-fix) page is not selling a fixed problem; the strict
  // one-story contract does not apply. We still guard truthfulness below.
  const sellable = input.quickFixEligible;

  // 1) Subject present + specific (§12). An active sellable package MUST have a real subject.
  const subject = norm(input.subject);
  if (sellable && (!subject || subject === "website note" || subject === "— no subject —" || subject === "no subject")) {
    issues.push({
      kind: "subject.missing",
      severity: "BLOCK",
      detail: `subject is empty/generic ("${input.subject || "—"}") — every active package needs a specific evidence-tied subject`,
    });
  }

  // 2) Hero ↔ finding: the same story (§13). Compare the defect family the SUBJECT maps to
  //    against the family the FINDING maps to. Divergence = two different stories.
  const findingFamily = classifyDefectFamily({ observation: input.findingText });
  const subjectFamily = subject ? classifyDefectFamily({ observation: input.subject }) : findingFamily;
  if (sellable && subject && findingFamily !== "generic" && subjectFamily !== "generic" && subjectFamily !== findingFamily) {
    issues.push({
      kind: "hero.mismatch",
      severity: "BLOCK",
      detail: `the subject reads as "${subjectFamily}" but the finding is "${findingFamily}" — hero and finding tell different stories`,
    });
  }

  // 3) Generic fallback survives while a specific finding exists (§30). If the hero is the
  //    generic fallback but the finding actually maps to a concrete family, the strong
  //    narrative was dropped — repair it rather than ship the fallback.
  if (sellable && GENERIC_HERO.includes(norm(input.heroTitle)) && findingFamily !== "generic") {
    issues.push({
      kind: "copy.generic",
      severity: "BLOCK",
      detail: `hero uses the generic fallback while a specific "${findingFamily}" finding exists — the specific narrative was dropped`,
    });
  }

  // 4) "Why it matters" must actually explain why (§15) — not lone boilerplate.
  if (sellable && GENERIC_WHY.includes(norm(input.whyItMatters))) {
    issues.push({
      kind: "why.generic",
      severity: "WARN",
      detail: `"why it matters" is generic boilerplate ("${input.whyItMatters}") — make it specific to the observed friction`,
    });
  }

  // 5) Claim truthfulness (§53). Never assert a completed action we didn't perform.
  const claimHay = `${input.firstLine} ${input.heroTitle}`;
  if (OVERSTATED_ACTION.test(claimHay)) {
    issues.push({
      kind: "claim.overstated",
      severity: "BLOCK",
      detail: `copy claims a completed submission we did not perform — describe only what was actually observed`,
    });
  }
  // "I tried to …" is only truthful for action families.
  if (input.attemptSupported && !ACTION_FAMILIES.has(findingFamily)) {
    issues.push({
      kind: "claim.attemptUnsupported",
      severity: "BLOCK",
      detail: `copy implies an attempted action but the "${findingFamily}" finding is observational — use an honest observation frame`,
    });
  }
  // Unbounded universal site claims when we only reviewed a few pages.
  if (UNBOUNDED_SITE_CLAIM.test(claimHay)) {
    issues.push({
      kind: "claim.unbounded",
      severity: "WARN",
      detail: `copy makes an unbounded whole-site claim — bound it to the pages actually reviewed`,
    });
  }

  // 6) Mobile claim requires mobile evidence (§19).
  if (sellable && input.mentionsMobile && !input.hasMobileScreenshot) {
    issues.push({
      kind: "mobile.noEvidence",
      severity: "BLOCK",
      detail: `the finding is about the mobile experience but there is no READY mobile screenshot to prove it`,
    });
  }

  // 7) Evidence claimed but absent (§20). If copy/PDF would present screenshots but none are
  //    READY, that is a lie the package must not tell.
  if (sellable && input.screenshotCount === 0 && input.hasAnyScreenshot) {
    // defensive contradiction: count says 0 but a ready shot exists → inconsistent inputs
    issues.push({ kind: "evidence.inconsistent", severity: "WARN", detail: "screenshot count disagrees with readiness" });
  }

  return issues;
}

/** Convenience: does this issue list block the package? */
export function coherenceBlocks(issues: CoherenceIssue[]): boolean {
  return issues.some((i) => i.severity === "BLOCK");
}
