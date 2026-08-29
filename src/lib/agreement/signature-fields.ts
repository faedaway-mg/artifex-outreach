// Authoritative signer → field mapping for the agreement. Both the rendered PDF and
// any field-placement check read this ONE source, so the signature/date anchors can
// never drift from the signer they belong to. Titles are intentionally absent (not in
// the snapshot) — never invented; the PDF renders a blank Title field.
//
// The anchors are VALID SignWell text tags (developers.signwell.com/reference/
// text-tag-options): `{{fieldtype:signer:required}}` where `signer` is the recipient's
// ORDER NUMBER in the API request. Provider is recipient 1, client is recipient 2, so
// with text_tags=true SignWell auto-places each field on the correct signer. (Earlier
// `{{sig_client}}`-style tokens were NOT valid SignWell tags — text_tags placed no
// fields, producing an unsignable document.)
import type { AgreementContentSnapshot } from "../types";

export interface SignatureField {
  role: "provider" | "client";
  signerNumber: number; // SignWell recipient order this field is assigned to (1-based)
  party: string; // the entity/company shown as the panel header
  signerName: string; // truthful source data (may be empty → blank line)
  sigTag: string; // valid SignWell text tag: {{signature:N:y}}
  dateTag: string; // valid SignWell text tag: {{date:N:y}}
}

/** A required signature field for SignWell recipient number `n`. */
export function signwellSigTag(n: number): string {
  return `{{signature:${n}:y}}`;
}
/** A required date field for SignWell recipient number `n`. */
export function signwellDateTag(n: number): string {
  return `{{date:${n}:y}}`;
}

export function agreementSignatureFields(c: AgreementContentSnapshot): SignatureField[] {
  return [
    { role: "provider", signerNumber: 1, party: `${c.artifexLegalEntity} d/b/a Artifex Labs`, signerName: c.artifexSignatory, sigTag: signwellSigTag(1), dateTag: signwellDateTag(1) },
    { role: "client", signerNumber: 2, party: c.clientLegalName, signerName: c.clientContactName || "", sigTag: signwellSigTag(2), dateTag: signwellDateTag(2) },
  ];
}
