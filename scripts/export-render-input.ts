// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY step 1 of 2. Exports exactly the data needed to re-render Wilshire's
// introduction, so step 2 can run inside the WEB service's environment (where
// AUTH_SECRET and PUBLIC_BASE_URL live) without that environment needing database
// access, and without any secret crossing between them.
//
// Writes one local temp file. Writes nothing to the database. Sends nothing.
//
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/export-render-input.ts
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";
import { writeFileSync } from "node:fs";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

const OUT = "/tmp/artifex-render-input.json";

async function main() {
  const { listLeads, getSettings, getBusinessIntelligence, contactsForLead, emailSendsForLead } = await import("../src/lib/repo");

  const settings = await getSettings();
  const lead = (await listLeads()).find((l) => /wilshire/i.test(l.businessName));
  if (!lead) throw new Error("Wilshire not found");

  const stored = await getBusinessIntelligence(lead.id);
  const profile = stored?.profile?.businessProfile ?? null;
  if (!profile) throw new Error("Wilshire has no Business Technology Review");
  const contacts = await contactsForLead(lead.id);
  const sends = await emailSendsForLead(lead.id);

  writeFileSync(OUT, JSON.stringify({ lead, settings, profile, contacts, sentCount: sends.filter((s) => s.sentAt).length }, null, 2));
  console.log(`exported ${lead.businessName} (${lead.id}) -> ${OUT}`);
  console.log(`prior accepted sends: ${sends.filter((s) => s.sentAt).length}`);
  console.log("rows written to the database: 0 · emails sent: 0 · secrets exported: 0");
}

main().catch((e) => { console.error(e); process.exit(1); });
