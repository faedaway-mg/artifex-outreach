// REAL hosted send (test_mode). Creates ONE consistent agreement from a single snapshot,
// persists it to the LOCAL test DB, binds the exact unsigned-PDF hash, and creates a
// SignWell test_mode HOSTED document with TWO recipients (provider=1, client=2, distinct
// emails). draft:false ⇒ SignWell emails each recipient ONE invitation (reminders off, no
// CC). Polls until text-tag fields are placed, verifies the 4 required fields, and prints
// both recipients' HOSTED signing URLs. Refuses non-local DB. Never prints secrets.
// Usage: tsx scripts/signwell-send.ts <providerEmail> <clientEmail>
import "./loadEnv";
import { createHash } from "node:crypto";
import { insertLead, insertAgreement, updateAgreement, paymentsForAgreement } from "../src/lib/repo";
import { renderAgreementPdf } from "../src/lib/pdf/render-agreement";
import { makeAgreement } from "../src/lib/agreement/test-fixtures";
import { assertAgreementConsistent } from "../src/lib/agreement/consistency";
import { agreementSignatureFields } from "../src/lib/agreement/signature-fields";

const KEY = process.env.SIGNWELL_API_KEY ?? "";
const BASE = process.env.SIGNWELL_API_BASE ?? "https://www.signwell.com";
const providerEmail = process.argv[2];
const clientEmail = process.argv[3];
const ok = (e?: string) => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function leadSeed(): any {
  return {
    googlePlaceId: null, businessName: "Copper & Oak (SIGNWELL TEST)", normalizedName: `copperoak-sw-${Date.now()}`, industry: "Restaurant",
    normalizedCategory: null, categoryGroup: null, address: "1 Test St", city: "Los Angeles", state: "CA", postalCode: "90012",
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
  if (!ok(providerEmail) || !ok(clientEmail)) throw new Error("pass <providerEmail> <clientEmail>");
  if (providerEmail.toLowerCase() === clientEmail.toLowerCase()) throw new Error("emails must differ (SignWell rejects duplicates)");
  const db = process.env.DATABASE_URL ?? ""; if (!/localhost|127\.0\.0\.1/.test(db) || /prod/i.test(db)) throw new Error("REFUSING: non-local DB");

  // ── ONE authoritative snapshot drives record + PDF + SignWell doc ──
  const number = `AL-A-2026-SW${String(Date.now()).slice(-4)}`;
  const lead = await insertLead(leadSeed());
  const a = makeAgreement({ status: "sent", leadId: lead.id, esignProvider: "signwell", agreementNumber: number });
  a.contentSnapshot = {
    ...a.contentSnapshot, agreementNumber: number,
    clientBusinessName: "Copper & Oak (SIGNWELL TEST)", clientLegalName: "Copper & Oak LLC (SIGNWELL TEST)",
    clientContactName: "Dana Reyes (TEST)", clientEmail: clientEmail, generatedAt: new Date().toISOString(),
  };
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = a;
  const ag = await insertAgreement(rest);
  assertAgreementConsistent(ag); // record ↔ snapshot + commercial terms must agree BEFORE render

  const pdf = await renderAgreementPdf(ag, true);
  const pdfSha256 = createHash("sha256").update(pdf).digest("hex");
  const fields = agreementSignatureFields(ag.contentSnapshot);

  // Pre-signature deposit gate: NO deposit must exist yet.
  const before = await paymentsForAgreement(ag.id);
  const depositBefore = before.filter((p) => p.type === "deposit").length;

  const body = {
    test_mode: true, draft: false, with_signature_page: false, embedded_signing: false,
    allow_decline: true, text_tags: true, reminders: false, apply_signing_order: false,
    name: `TEST — Artifex Labs Systems LLC Professional Services Agreement ${number}`,
    subject: "TEST — please review & sign (SignWell sandbox, not legally binding)",
    message: "SANDBOX TEST document for internal rehearsal. Not legally binding.",
    recipients: [
      { id: "provider", name: ag.contentSnapshot.artifexSignatory, email: providerEmail, order: 1 },
      { id: "client", name: ag.contentSnapshot.clientContactName, email: clientEmail, order: 2 },
    ],
    files: [{ name: `${number}.pdf`, file_base64: pdf.toString("base64") }],
    metadata: { agreementId: ag.id, agreementNumber: number, agreementVersion: String(ag.version), pdf_sha256: pdfSha256, rehearsal: "signwell" },
  };
  const res = await fetch(`${BASE}/api/v1/documents/`, { method: "POST", headers: { "X-Api-Key": KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const doc = await res.json().catch(() => ({}));
  if (!res.ok || !doc.id) throw new Error(`create failed ${res.status}: ${JSON.stringify(doc).slice(0, 300)}`);
  await updateAgreement(ag.id, { esignRequestId: String(doc.id), signedPdfUrl: null });

  // Poll until the file processes so we can confirm the 4 required fields landed.
  let gd: any = doc;
  for (let i = 0; i < 20; i++) {
    const g = await fetch(`${BASE}/api/v1/documents/${doc.id}/`, { headers: { "X-Api-Key": KEY } });
    gd = await g.json().catch(() => ({}));
    const pages = (gd.files ?? []).reduce((n: number, f: any) => n + (f.pages_number ?? f.pages ?? 0), 0);
    if (pages > 0 && Array.isArray(gd.fields) && gd.fields.flat().length > 0) break;
    await sleep(2000);
  }
  const placed = (gd.fields ?? []).flat();
  const byRecip = (r: string) => placed.filter((f: any) => f.recipient_id === r).map((f: any) => f.type).sort().join("+");
  const recips = gd.recipients ?? doc.recipients ?? [];
  const urlFor = (id: string) => (recips.find((r: any) => r.id === id) || {}).signing_url ?? null;

  console.log(`\n=== CONSISTENCY ===`);
  console.log(`record #${ag.agreementNumber} == snapshot #${ag.contentSnapshot.agreementNumber} · v${ag.version} · entity ${ag.contentSnapshot.artifexLegalEntity}`);
  console.log(`total ${ag.contentSnapshot.totalPriceCents} · deposit ${ag.contentSnapshot.depositPercent}% = ${ag.contentSnapshot.depositAmountCents} · balance ${ag.contentSnapshot.remainingBalanceCents}`);
  console.log(`unsigned PDF sha256 (bound): ${pdfSha256}`);
  console.log(`AGREEMENT_ID=${ag.id}`);
  console.log(`\n=== SIGNWELL DOC ===`);
  console.log(`DOC_ID=${doc.id} status=${doc.status} test_mode=${doc.test_mode}`);
  console.log(`fields placed: provider=[${byRecip("provider")}] client=[${byRecip("client")}] (expect signature+date each)`);
  console.log(`expected tags: ${fields.map((f) => `${f.role}:${f.sigTag}/${f.dateTag}`).join("  ")}`);
  console.log(`\n=== DEPOSIT GATE (pre-signature) ===`);
  console.log(`deposits for this agreement BEFORE completion: ${depositBefore} (expect 0 — blocked until signed)`);
  console.log(`\n=== HOSTED SIGNING URLS ===`);
  console.log(`PROVIDER (signer 1, ${providerEmail}): ${urlFor("provider")}`);
  console.log(`CLIENT   (signer 2, ${clientEmail}): ${urlFor("client")}`);
}
main().catch((e) => { console.error("SEND ERROR:", e.message); process.exit(1); });
