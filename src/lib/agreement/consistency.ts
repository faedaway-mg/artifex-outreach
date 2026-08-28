// ─────────────────────────────────────────────────────────────────────────────
// Agreement consistency invariant. The frozen contentSnapshot is the SINGLE source
// of truth: the record's top-level metadata must never diverge from the snapshot
// it was built from. (M3 rehearsal bug: a script set the record's agreementNumber
// but left the snapshot — and therefore the rendered PDF and the SignWell document
// — on a different number. This guards that class of mismatch.)
// ─────────────────────────────────────────────────────────────────────────────
import type { Agreement } from "../types";

export function agreementConsistencyIssues(agreement: Agreement): string[] {
  const c = agreement.contentSnapshot;
  const issues: string[] = [];
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
