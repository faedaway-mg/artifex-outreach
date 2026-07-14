/**
 * Persistence test. Each invocation is a FRESH process (new DB connection) — the
 * equivalent of a server restart. Run the steps in sequence:
 *   tsx scripts/persist-test.ts create   # insert a probe lead
 *   tsx scripts/persist-test.ts check     # (fresh process) confirm it persists
 *   tsx scripts/persist-test.ts update    # (fresh process) change its stage
 *   tsx scripts/persist-test.ts check     # (fresh process) confirm the update
 *   tsx scripts/persist-test.ts cleanup   # remove the probe lead
 */
import "./loadEnv";
import fs from "fs";
import { insertLead, getLead, updateLead } from "../src/lib/repo";
import { normalizeName } from "../src/lib/store";

const ID_FILE = "/tmp/artifex-probe-id.txt";
const step = process.argv[2];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required for persistence test.");
    process.exit(1);
  }

  if (step === "create") {
    const lead = await insertLead({
      googlePlaceId: null,
      businessName: "Persistence Probe Co",
      normalizedName: normalizeName("Persistence Probe Co"),
      industry: "Professional consultant",
      normalizedCategory: "business-consultants",
      categoryGroup: "Professional Services",
      address: "1 Test Way",
      city: "Testville",
      state: "CA",
      postalCode: "90000",
      latitude: null,
      longitude: null,
      phone: null,
      website: null,
      websiteDomain: null,
      publicEmail: null,
      contactFormUrl: null,
      socialLinks: [],
      locationsCount: null,
      rating: null,
      reviewCount: null,
      businessStatus: "OPERATIONAL",
      googleMapsUrl: null,
      hours: null,
      source: "Persistence test",
      retrievedAt: new Date().toISOString(),
      tier: null,
      leadScore: null,
      scoreBreakdown: null,
      pipelineStage: "Discovered",
      estimatedValueLow: null,
      estimatedValueHigh: null,
      recommendedService: null,
      recommendedAction: null,
      recommendationReason: null,
      opportunitySummary: null,
      strengths: [],
      assignedTo: "jordan",
      note: null,
      lastContactAt: null,
      nextFollowUpAt: null,
    });
    fs.writeFileSync(ID_FILE, lead.id);
    console.log(`CREATED ${lead.id} stage=${lead.pipelineStage}`);
  } else if (step === "check") {
    const id = fs.readFileSync(ID_FILE, "utf8").trim();
    const lead = await getLead(id);
    console.log(lead ? `FOUND ${lead.id} name="${lead.businessName}" stage=${lead.pipelineStage}` : `MISSING ${id}`);
  } else if (step === "update") {
    const id = fs.readFileSync(ID_FILE, "utf8").trim();
    await updateLead(id, { pipelineStage: "Qualified" });
    console.log(`UPDATED ${id} -> Qualified`);
  } else if (step === "cleanup") {
    const id = fs.readFileSync(ID_FILE, "utf8").trim();
    const { getDb } = await import("../src/db/client");
    const { leads } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    await getDb().delete(leads).where(eq(leads.id, id));
    console.log(`CLEANED ${id}`);
  } else {
    console.error("unknown step");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
