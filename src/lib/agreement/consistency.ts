// ─────────────────────────────────────────────────────────────────────────────
// Agreement consistency invariant. The frozen contentSnapshot is the SINGLE source
// of truth: the record's top-level metadata must never diverge from the snapshot
// it was built from. (M3 rehearsal bug: a script set the record's agreementNumber
// but left the snapshot — and therefore the rendered PDF and the SignWell document
// — on a different number. This guards that class of mismatch.)
// ─────────────────────────────────────────────────────────────────────────────
import type { Agreement, AgreementContentSnapshot } from "../types";

/**
 * The commercial terms must agree internally, using the SAME integer-cents rounding
 * policy the snapshot builder uses: deposit = round(total × pct / 100), and
 * deposit + balance = total. A percentage/amount disagreement (e.g. amounts that are
 * 30% while the label says 50%) is a hard error — we never silently pick a winner.
 */
export function commercialConsistencyIssues(c: Pick<AgreementContentSnapshot, "totalPriceCents" | "depositPercent" | "depositAmountCents" | "remainingBalanceCents">): string[] {
  const issues: string[] = [];
  const ints = [c.totalPriceCents, c.depositPercent, c.depositAmountCents, c.remainingBalanceCents];
  if (ints.some((n) => !Number.isInteger(n))) issues.push("commercial amounts must be integers (minor units / whole percent)");
  if (c.totalPriceCents <= 0) issues.push("totalPriceCents must be positive");
  if (c.depositPercent < 0 || c.depositPercent > 100) issues.push(`depositPercent out of range: ${c.depositPercent}`);
  const expectedDeposit = Math.round((c.totalPriceCents * c.depositPercent) / 100);
  if (c.depositAmountCents !== expectedDeposit) {
    const impliedPct = c.totalPriceCents ? Math.round((c.depositAmountCents / c.totalPriceCents) * 100) : 0;
    issues.push(`deposit percentage/amount disagree: label ${c.depositPercent}% expects ${expectedDeposit} but amount is ${c.depositAmountCents} (~${impliedPct}%)`);
  }
  if (c.depositAmountCents + c.remainingBalanceCents !== c.totalPriceCents) {
    issues.push(`deposit (${c.depositAmountCents}) + balance (${c.remainingBalanceCents}) != total (${c.totalPriceCents})`);
  }
  return issues;
}

export function agreementConsistencyIssues(agreement: Agreement): string[] {
  const c = agreement.contentSnapshot;
  const issues: string[] = [...commercialConsistencyIssues(c)];
  if (agreement.agreementNumber !== c.agreementNumber) {
    issues.push(`agreementNumber mismatch: record="${agreement.agreementNumber}" vs snapshot="${c.agreementNumber}"`);
  }
  if (agreement.version !== c.version) {
    issues.push(`version mismatch: record=${agreement.version} vs snapshot=${c.version}`);
  }
  if (agreement.proposalId !== c.proposalId) {
    issues.push(`proposalId mismatch: record="${agreement.proposalId}" vs snapshot="${c.proposalId}"`);
  }
  if (agreement.templateVersion !== c.templateVersion) {
    issues.push(`templateVersion mismatch: record="${agreement.templateVersion}" vs snapshot="${c.templateVersion}"`);
  }
  return issues;
}

export function isAgreementConsistent(agreement: Agreement): boolean {
  return agreementConsistencyIssues(agreement).length === 0;
}

export class AgreementInconsistencyError extends Error {
  constructor(public issues: string[]) {
    super(`Agreement record/snapshot inconsistent: ${issues.join("; ")}`);
    this.name = "AgreementInconsistencyError";
  }
}

/** Fail-fast guard to call BEFORE rendering/uploading a document for signature. */
export function assertAgreementConsistent(agreement: Agreement): void {
  const issues = agreementConsistencyIssues(agreement);
  if (issues.length) throw new AgreementInconsistencyError(issues);
}
