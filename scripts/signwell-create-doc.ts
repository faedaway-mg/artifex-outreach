// Create the corrected SignWell TEST document (hosted signing) with a CONSISTENT
// PDF (snapshot number == record number) and return the recipient's hosted signing
// URL. Reuses the already-registered tunnel webhook. Non-embedded → SignWell sends
// ONE signature-request email to the operator-approved recipient (test doc, not
// binding); we also return the direct signing link. Refuses non-local DB.
// Usage: tsx scripts/signwell-create-doc.ts <approvedRecipientEmail>
import "./loadEnv";
import { createHash } from "node:crypto";
import { insertLead, insertAgreement, updateAgreement } from "../src/lib/repo";
import { renderAgreementPdf } from "../src/lib/pdf/render-agreement";
import { makeAgreement } from "../src/lib/agreement/test-fixtures";
import { assertAgreementConsistent } from "../src/lib/agreement/consistency";

const KEY = process.env.SIGNWELL_API_KEY ?? "";
const BASE = "https://www.signwell.com";
const recipientEmail = process.argv[2];

function fullLeadSeed(): any {
  return {
    googlePlaceId: null, businessName: "Copper & Oak (SIGNWELL TEST)", normalizedName: "copperoaktest2", industry: "Restaurant",
    normalizedCategory: null, categoryGroup: null, address: "1", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: null, website: null, websiteDomain: null, publicEmail: null, contactFormUrl: null,
    socialLinks: [], locationsCount: null, rating: null, reviewCount: null, businessStatus: null, googleMapsUrl: null, hours: null,
    source: "signwell-rehearsal", retrievedAt: null, tier: null, leadScore: null, scoreBreakdown: null, pipelineStage: "Proposal Accepted",
    estimatedValueLow: null, estimatedValueHigh: null, recommendedService: null, recommendedAction: null, recommendationReason: null,
    opportunitySummary: null, strengths: [], acquisitionStrategy: null, acquisitionScore: null, acquisitionReason: null,
    acquisitionScoreBreakdown: null, acquisitionOverride: false, assignedTo: "jordan", assignedAt: null, assignmentReason: null,
    lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
  };
}

async function main() {
  if (!KEY) throw new Error("SIGNWELL_API_KEY not set");
  if (!recipientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail)) throw new Error("pass an approved recipient email");
  const db = process.env.DATABASE_URL ?? ""; if (!/localhost|127\.0\.0\.1/.test(db) || /prod/i.test(db)) throw new Error("REFUSING: non-local DB");

  // Agreement with a CONSISTENT, unique number on BOTH the record and the frozen
  // snapshot (the PDF renders from the snapshot), and a current generatedAt.
  const number = `AL-A-2026-${String(Date.now()).slice(-4)}`;
  const lead = await insertLead(fullLeadSeed());
  const a = makeAgreement({ status: "sent", leadId: lead.id, esignProvider: "signwell", agreementNumber: number });
  a.contentSnapshot = { ...a.contentSnapshot, agreementNumber: number, generatedAt: new Date().toISOString() };
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = a;
  const ag = await insertAgreement(rest);

  // Fail-fast: record and snapshot MUST agree before we render/upload for signature.
  assertAgreementConsistent(ag);

  const pdf = await renderAgreementPdf(ag, true);
  // Hash the EXACT bytes we upload; bind the signing request to this version.
  const pdfSha256 = createHash("sha256").update(pdf).digest("hex");

  // Direct SignWell create (hosted signing) so we can read recipient.signing_url.
  const body = {
    test_mode: true, draft: false, with_signature_page: false, embedded_signing: false, allow_decline: true, text_tags: true,
    name: `TEST — Artifex Labs Systems LLC Professional Services Agreement ${number}`,
    subject: "TEST — please review & sign (sandbox, not legally binding)",
    message: "SANDBOX TEST document for internal rehearsal. Not legally binding.",
    recipients: [{ id: "client", name: ag.contentSnapshot.clientContactName || "Test Signer", email: recipientEmail, order: 1 }],
    files: [{ name: `${number}.pdf`, file_base64: pdf.toString("base64") }],
    metadata: { agreementId: ag.id, agreementNumber: number, agreementVersion: String(ag.version), pdf_sha256: pdfSha256, rehearsal: "signwell" },
  };
  const res = await fetch(`${BASE}/api/v1/documents/`, { method: "POST", headers: { "X-Api-Key": KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const doc = await res.json().catch(() => ({}));
  if (!res.ok || !doc.id) throw new Error(`SignWell create failed ${res.status}: ${JSON.stringify(doc).slice(0, 200)}`);
  const client = (doc.recipients || []).find((r: any) => r.id === "client") || (doc.recipients || [])[0] || {};
  const signingUrl = client.signing_url ?? null;
  await updateAgreement(ag.id, { esignRequestId: String(doc.id) });

  console.log(`agreement + PDF consistent: record #${ag.agreementNumber} == snapshot #${ag.contentSnapshot.agreementNumber} (entity ${ag.contentSnapshot.artifexLegalEntity})`);
  console.log(`PDF sha256 (bound to the signing request): ${pdfSha256}`);
  console.log(`AGREEMENT_ID=${ag.id}`);
  console.log(`DOC_ID=${doc.id}  test_mode=${doc.test_mode}  status=${doc.status}`);
  console.log(`RECIPIENT=${recipientEmail}`);
  console.log(`SIGN_URL=${signingUrl ?? "(no signing_url in response — inspect recipients)"}`);
}
main().catch((e) => { console.error("SIGNWELL CREATE ERROR:", e.message); process.exit(1); });
