// SignWell rehearsal SETUP (test mode). Registers a TEST webhook at the tunnel,
// writes the webhook id to .env.local as SIGNWELL_WEBHOOK_SECRET (never printed),
// creates a synthetic signed-pending agreement + a REAL SignWell test document with
// embedded signing (test_mode:true, NO email), and prints the signing URL. Refuses
// non-local DB. Usage: tsx scripts/signwell-setup.ts <tunnelBaseUrl>
import "./loadEnv";
import fs from "fs";
import { insertLead, insertAgreement, updateAgreement } from "../src/lib/repo";
import { getEsignProvider } from "../src/lib/esign/provider";
import { renderAgreementPdf } from "../src/lib/pdf/render-agreement";
import { makeAgreement } from "../src/lib/agreement/test-fixtures";

const KEY = process.env.SIGNWELL_API_KEY ?? "";
const BASE = "https://www.signwell.com";
const tunnel = process.argv[2];

function fullLeadSeed(): any {
  return {
    googlePlaceId: null, businessName: "Copper & Oak (SIGNWELL TEST)", normalizedName: "copperoaktest", industry: "Restaurant",
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
  if (!KEY) throw new Error("SIGNWELL_API_KEY not set in .env.local");
  if (!tunnel || !/^https:\/\//.test(tunnel)) throw new Error("pass the https tunnel base url");
  const db = process.env.DATABASE_URL ?? ""; if (!/localhost|127\.0\.0\.1/.test(db) || /prod/i.test(db)) throw new Error("REFUSING: non-local DB");

  // 1) Register a TEST webhook at the tunnel; capture the webhook id (the HMAC key).
  const callback = `${tunnel.replace(/\/$/, "")}/api/webhooks/signwell`;
  const hookRes = await fetch(`${BASE}/api/v1/hooks/`, { method: "POST", headers: { "X-Api-Key": KEY, "Content-Type": "application/json" }, body: JSON.stringify({ callback_url: callback }) });
  const hook = await hookRes.json().catch(() => ({}));
  if (!hookRes.ok || !hook.id) throw new Error(`webhook register failed ${hookRes.status}: ${JSON.stringify(hook).slice(0, 200)}`);
  const webhookId = String(hook.id);
  // Write the webhook id to .env.local (it's the HMAC key). Never printed.
  const env = fs.readFileSync(".env.local", "utf8");
  const next = env.match(/^SIGNWELL_WEBHOOK_SECRET=.*$/m)
    ? env.replace(/^SIGNWELL_WEBHOOK_SECRET=.*$/m, `SIGNWELL_WEBHOOK_SECRET=${webhookId}`)
    : env.trimEnd() + `\nSIGNWELL_WEBHOOK_SECRET=${webhookId}\n`;
  fs.writeFileSync(".env.local", next); fs.chmodSync(".env.local", 0o600);
  console.log(`1) SignWell TEST webhook registered at the tunnel; webhook id stored locally as SIGNWELL_WEBHOOK_SECRET (not printed). callback=${callback}`);

  // 2) Synthetic agreement (status "sent" so deposit stays BLOCKED until signed).
  const lead = await insertLead(fullLeadSeed());
  const a = makeAgreement({ status: "sent", leadId: lead.id, esignProvider: "signwell", agreementNumber: `AL-A-SW${Date.now()}` });
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = a;
  const ag = await insertAgreement(rest);
  console.log(`2) synthetic agreement (${ag.contentSnapshot.artifexLegalEntity}) #${ag.agreementNumber} v${ag.version} status=sent (deposit blocked pre-signature)`);

  // 3) Create the REAL SignWell test document — embedded (no email), test_mode.
  const pdf = await renderAgreementPdf(ag, true);
  const provider = getEsignProvider();
  const res = await provider.createSignatureRequest({
    agreementId: ag.id, agreementNumber: ag.agreementNumber, pdfBase64: pdf.toString("base64"),
    subject: "TEST — Artifex Labs Systems LLC Professional Services Agreement",
    message: "SANDBOX TEST document. Not legally binding.",
    signer: { name: ag.contentSnapshot.clientContactName || "Test Signer", email: ag.contentSnapshot.clientEmail || "synthetic+signer@example.com" },
    testMode: true, embedded: true,
  });
  if (!res.ok || !res.requestId) throw new Error("SignWell create failed: " + res.error);
  await updateAgreement(ag.id, { esignRequestId: res.requestId });
  console.log(`3) SignWell TEST document created: ${res.requestId} (test_mode, embedded, no email).`);
  console.log(`\nAGREEMENT_ID=${ag.id}`);
  console.log(`DOC_ID=${res.requestId}`);
  console.log(`SIGN_URL=${res.signingUrl ?? "(none returned — check embedded_signing_url)"}`);
}
main().catch((e) => { console.error("SIGNWELL SETUP ERROR:", e.message); process.exit(1); });
