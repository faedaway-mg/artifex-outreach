// Authoritative signer → field mapping for the agreement. Both the rendered PDF and
// any field-placement check read this ONE source, so the {{sig_*}}/{{date_*}} anchors
// can never drift from the signer they belong to. Titles are intentionally absent
// (not in the snapshot) — never invented; the PDF renders a blank Title field.
import type { AgreementContentSnapshot } from "../types";

export interface SignatureField {
  role: "provider" | "client";
  party: string; // the entity/company shown as the panel header
  signerName: string; // truthful source data (may be empty → blank line)
  sigTag: string; // SignWell text-tag anchor for this signer's signature
  dateTag: string; // SignWell text-tag anchor for this signer's date
}

export function agreementSignatureFields(c: AgreementContentSnapshot): SignatureField[] {
  return [
    { role: "provider", party: `${c.artifexLegalEntity} d/b/a Artifex Labs`, signerName: c.artifexSignatory, sigTag: "{{sig_artifex}}", dateTag: "{{date_artifex}}" },
    { role: "client", party: c.clientLegalName, signerName: c.clientContactName || "", sigTag: "{{sig_client}}", dateTag: "{{date_client}}" },
  ];
}
