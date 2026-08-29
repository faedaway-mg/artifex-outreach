// VERIFY-ONLY (no email, no send). Creates a SignWell test_mode DRAFT document from the
// approved agreement PDF with TWO recipients (provider = order 1, client = order 2) and
// text_tags=true, then GETs it back and prints the placed fields + recipients so we can
// confirm the {{signature:N:y}}/{{date:N:y}} tags land on the correct signer BEFORE any
// invitation is sent. draft:true ⇒ SignWell sends NO emails. Also probes whether SignWell
// accepts the SAME email on two recipients (needed for a one-email, one-person rehearsal).
// Usage: tsx scripts/signwell-verify-fields.ts <providerEmail> <clientEmail>
import "./loadEnv";
import { createHash } from "node:crypto";
import { renderAgreementPdf } from "../src/lib/pdf/render-agreement";
import { makeAgreement } from "../src/lib/agreement/test-fixtures";
import { assertAgreementConsistent } from "../src/lib/agreement/consistency";
import { agreementSignatureFields } from "../src/lib/agreement/signature-fields";

const KEY = process.env.SIGNWELL_API_KEY ?? "";
const BASE = process.env.SIGNWELL_API_BASE ?? "https://www.signwell.com";
const providerEmail = process.argv[2];
const clientEmail = process.argv[3];
const ok = (e?: string) => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

async function main() {
  if (!KEY) throw new Error("SIGNWELL_API_KEY not set");
  if (!ok(providerEmail) || !ok(clientEmail)) throw new Error("pass <providerEmail> <clientEmail>");
  if (providerEmail.toLowerCase() === clientEmail.toLowerCase()) throw new Error("emails must differ (SignWell rejects duplicates)");

  // Fresh, internally-consistent REGULAR test agreement (synthetic).
  const number = `AL-A-2026-V${String(Date.now()).slice(-4)}`;
  const a = makeAgreement({ status: "sent", esignProvider: "signwell", agreementNumber: number });
  a.contentSnapshot = {
    ...a.contentSnapshot,
    agreementNumber: number,
    clientBusinessName: "Copper & Oak (SIGNWELL TEST)",
    clientLegalName: "Copper & Oak LLC (SIGNWELL TEST)",
    clientContactName: "Dana Reyes (TEST)",
    generatedAt: new Date().toISOString(),
  };
  assertAgreementConsistent(a);

  const fields = agreementSignatureFields(a.contentSnapshot);
  const pdf = await renderAgreementPdf(a, true);
  const pdfSha256 = createHash("sha256").update(pdf).digest("hex");

  // TWO recipients, provider=1, client=2. draft:true ⇒ no email. Probe same-email support.
  const body = {
    test_mode: true,
    draft: true, // DRAFT — no emails sent
    with_signature_page: false,
    embedded_signing: false,
    allow_decline: true,
    text_tags: true,
    reminders: false,
    name: `VERIFY (draft) — Artifex PSA ${number}`,
    recipients: [
      { id: "provider", name: a.contentSnapshot.artifexSignatory, email: providerEmail, order: 1 },
      { id: "client", name: a.contentSnapshot.clientContactName, email: clientEmail, order: 2 },
    ],
    files: [{ name: `${number}.pdf`, file_base64: pdf.toString("base64") }],
    metadata: { agreementNumber: number, pdf_sha256: pdfSha256, purpose: "field-verification" },
  };

  const res = await fetch(`${BASE}/api/v1/documents/`, {
    method: "POST",
    headers: { "X-Api-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const doc = await res.json().catch(() => ({}));
  if (!res.ok || !doc.id) throw new Error(`create draft failed ${res.status}: ${JSON.stringify(doc).slice(0, 400)}`);

  console.log(`PDF sha256: ${pdfSha256}`);
  console.log(`DRAFT doc id=${doc.id} status=${doc.status} test_mode=${doc.test_mode}`);
  console.log(`expected tags:`, fields.map((f) => `${f.role}#${f.signerNumber}:${f.sigTag}/${f.dateTag}`).join("  "));

  // The uploaded PDF is processed asynchronously (text tags → fields). Poll until the
  // file reports pages > 0, then re-read the placed fields. No email is sent for a draft.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 15; i++) {
    const g = await fetch(`${BASE}/api/v1/documents/${doc.id}/`, { headers: { "X-Api-Key": KEY } });
    const gd = await g.json().catch(() => ({}));
    const pages = (gd.files ?? []).reduce((n: number, f: any) => n + (f.pages_number ?? f.pages ?? 0), 0);
    const fcount = Array.isArray(gd.fields) ? gd.fields.flat().length : 0;
    if (pages > 0 || fcount > 0) { Object.assign(doc, gd); break; }
    await sleep(2000);
  }
  console.log(`recipients:`);
  for (const r of doc.recipients ?? []) {
    console.log(`  - id=${r.id} order=${r.order} email=${(r.email || "").replace(/^[^@]+/, "***")} send_email=${r.send_email} status=${r.status}`);
  }
  // Fields may be under doc.fields or per-recipient. Print whatever placement SignWell returns.
  const flat: any[] = [];
  if (Array.isArray(doc.fields)) for (const pageArr of doc.fields) if (Array.isArray(pageArr)) flat.push(...pageArr); else flat.push(pageArr);
  console.log(`fields placed (${flat.length}):`);
  for (const f of flat) {
    console.log(`  - type=${f.type ?? f.kind} recipient=${f.recipient_id ?? f.recipient ?? f.api_id ?? "?"} page=${f.page ?? "?"} required=${f.required}`);
  }
  console.log(`\nRAW recipients: ${JSON.stringify(doc.recipients)}`);
  console.log(`RAW fields: ${JSON.stringify(doc.fields)}`);
  console.log(`RAW files: ${JSON.stringify((doc.files || []).map((f: any) => ({ name: f.name, pages: f.pages_number ?? f.pages, fields: f.fields })))}`);
  console.log(`apply_signing_order=${doc.apply_signing_order}`);

  // Clean up: DELETE the draft (no email was ever sent for a draft). Leaves the account clean.
  const del = await fetch(`${BASE}/api/v1/documents/${doc.id}/`, { method: "DELETE", headers: { "X-Api-Key": KEY } });
  console.log(`\nDRAFT deleted: ${del.status} (no email was ever sent — draft:true)`);
}
main().catch((e) => { console.error("VERIFY ERROR:", e.message); process.exit(1); });
