// ─────────────────────────────────────────────────────────────────────────────
// EXISTING-NARRATION AUDIT (mandate 25 §B7). Deterministic, read-only audit of every existing PROPOSAL
// video's narration. Grades quality (evaluateNarrationQuality), runs cross-company similarity across the
// whole set (each script compared against all the others), and — for ELIGIBLE unapproved videos classified
// TOO_SHORT or GENERIC — produces AT MOST ONE evidence-backed expansion CANDIDATE, left unaccepted in draft
// review. It uploads no audio, starts no render, creates no approval/schedule, and sends nothing. When the
// evidence is insufficient it produces no candidate and reports the blocker (never fabricates filler).
// ─────────────────────────────────────────────────────────────────────────────
import { evaluateNarrationQuality, type NarrationQuality } from "./narration-quality";
import { expandAndPersonalize, type EvidenceFinding, type ExpansionResult } from "./narration-expansion";

export interface AuditInputRow {
  leadId: string;
  businessName: string;
  narration: string;
  findings: string[];              // verified finding observations (for quality grading + similarity context)
  hasScreenshot: boolean;
  hasApprovedRecommendation?: boolean;
  frozen: boolean;                 // FROZEN/SCHEDULED/SENT → immutable, ineligible for candidate creation
  approved: boolean;               // approved → ineligible for candidate creation
  scheduled: boolean;
  sent: boolean;
  evidenceFindings?: EvidenceFinding[]; // richer evidence (with ids) used ONLY to compose a candidate
}

export interface AuditRow {
  leadId: string;
  businessName: string;
  script: string;
  wordCount: number;
  estimatedSeconds: number;
  classification: NarrationQuality;
  evidenceSpecific: boolean;
  similarity: { maxSimilarity: number; similarTo: string | null; tooSimilar: boolean };
  unsupportedClaims: string[];
  status: { frozen: boolean; approved: boolean; scheduled: boolean; sent: boolean };
  eligibleForExpansion: boolean;
  recommendedAction: string;
  candidate: ExpansionResult | null;    // present only when a candidate was created (eligible + short/generic)
  candidateBlocker: string | null;      // set when eligible but expansion could not be grounded
}

export interface AuditReport {
  rows: AuditRow[];
  totals: { total: number; byClassification: Record<string, number>; candidatesCreated: number; tooSimilarPairs: number };
}

const words = (s: string) => (s.trim().match(/[A-Za-z0-9']+/g) ?? []).length;

function recommend(row: AuditInputRow, cls: NarrationQuality, tooSimilar: boolean): string {
  if (row.frozen) return "Frozen package — immutable; no change";
  if (row.approved) return "Approved — leave as-is (create a new revision only if re-opened)";
  if (cls === "UNSUPPORTED_CLAIMS") return "Remove unsupported claims before use";
  if (cls === "INSUFFICIENT_EVIDENCE") return "Gather verified evidence before narrating";
  if (tooSimilar || cls === "TOO_SIMILAR") return "Rewrite to be company-specific (too similar to another script)";
  if (cls === "TOO_SHORT" || cls === "GENERIC") return "Expand & personalize using company evidence";
  if (cls === "NEEDS_REVIEW") return "Review specificity / structure / duration";
  return "No change needed";
}

/** Audit every proposal narration. Deterministic and side-effect-free. */
export function auditProposalNarrations(input: AuditInputRow[]): AuditReport {
  const rows: AuditRow[] = input.map((row) => {
    const others = input.filter((o) => o.leadId !== row.leadId).map((o) => ({ leadId: o.leadId, narration: o.narration }));
    const q = evaluateNarrationQuality({
      narration: row.narration,
      evidence: { businessName: row.businessName, findings: row.findings, hasScreenshot: row.hasScreenshot, hasApprovedRecommendation: row.hasApprovedRecommendation },
      otherScripts: others,
    });
    const tooSimilar = q.classification === "TOO_SIMILAR";
    const eligible = !row.frozen && !row.approved && !row.scheduled && !row.sent &&
      (q.classification === "TOO_SHORT" || q.classification === "GENERIC");

    let candidate: ExpansionResult | null = null;
    let candidateBlocker: string | null = null;
    if (eligible) {
      const ev = row.evidenceFindings && row.evidenceFindings.length
        ? row.evidenceFindings
        : row.findings.map((f, i) => ({ id: `${row.leadId}:f${i}`, observation: f }));
      const exp = expandAndPersonalize({ businessName: row.businessName, findings: ev, hasScreenshot: row.hasScreenshot, hasApprovedRecommendation: row.hasApprovedRecommendation });
      if (exp.available) candidate = exp; else candidateBlocker = exp.blocker;
    }

    return {
      leadId: row.leadId, businessName: row.businessName, script: row.narration,
      wordCount: words(row.narration), estimatedSeconds: q.estimatedSeconds, classification: q.classification,
      evidenceSpecific: q.signals.companySpecific,
      similarity: { maxSimilarity: q.signals.maxSimilarity, similarTo: q.signals.similarTo, tooSimilar },
      unsupportedClaims: q.signals.unsupportedClaims,
      status: { frozen: row.frozen, approved: row.approved, scheduled: row.scheduled, sent: row.sent },
      eligibleForExpansion: eligible,
      recommendedAction: recommend(row, q.classification, tooSimilar),
      candidate, candidateBlocker,
    };
  });

  const byClassification: Record<string, number> = {};
  for (const r of rows) byClassification[r.classification] = (byClassification[r.classification] ?? 0) + 1;
  return {
    rows,
    totals: {
      total: rows.length, byClassification,
      candidatesCreated: rows.filter((r) => r.candidate).length,
      tooSimilarPairs: rows.filter((r) => r.similarity.tooSimilar).length,
    },
  };
}
