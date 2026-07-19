// ─────────────────────────────────────────────────────────────────────────────
// Stable human-readable identifiers for proposals and agreements.
//
//   Proposal  → AL-P-<year>-<seq>   e.g. AL-P-2026-001
//   Agreement → AL-A-<year>-<seq>   e.g. AL-A-2026-001
//
// The sequence is per-document-kind, per-year. The generator is pure: given the
// already-issued numbers for a year it returns the next one. Callers pass the
// current set from the repo, so no hidden global counter is needed.
// ─────────────────────────────────────────────────────────────────────────────

const PROPOSAL_PREFIX = "AL-P";
const AGREEMENT_PREFIX = "AL-A";

function yearOf(iso: string): number {
  const y = new Date(iso).getUTCFullYear();
  return Number.isFinite(y) ? y : new Date().getUTCFullYear();
}

/** Highest sequence already used for a prefix+year across the given numbers. */
function maxSeq(existing: (string | null | undefined)[], prefix: string, year: number): number {
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  let max = 0;
  for (const n of existing) {
    const m = n?.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function format(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(3, "0")}`;
}

/** Next proposal number for the year `nowIso` falls in, given issued numbers. */
export function nextProposalNumber(existingNumbers: (string | null | undefined)[], nowIso: string): string {
  const year = yearOf(nowIso);
  return format(PROPOSAL_PREFIX, year, maxSeq(existingNumbers, PROPOSAL_PREFIX, year) + 1);
}

/** Next agreement number for the year `nowIso` falls in, given issued numbers. */
export function nextAgreementNumber(existingNumbers: (string | null | undefined)[], nowIso: string): string {
  const year = yearOf(nowIso);
  return format(AGREEMENT_PREFIX, year, maxSeq(existingNumbers, AGREEMENT_PREFIX, year) + 1);
}
