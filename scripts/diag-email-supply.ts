/**
 * READ-ONLY email-supply diagnostic (Gate 1). Answers precisely why the
 * email-first queue is starved: how many leads lack an email, how many of THOSE
 * have a website we could still crawl, how many have already been analyzed, and
 * whether the email-prep sweep has ever run in this environment.
 *
 * No writes. No crawl. No sends. Run: pnpm exec tsx scripts/diag-email-supply.ts
 */
import "./loadEnv";
import { listLeads, listAudit } from "../src/lib/repo";
import { isValidEmail } from "../src/lib/outreach/contact-strategy";

function isInternal(l: any): boolean {
  const v = `${l.industry ?? ""} ${l.normalizedCategory ?? ""} ${l.categoryGroup ?? ""}`.toLowerCase();
  return v.includes("internal");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set — refusing to run.");
  const [leadsAll, audit] = await Promise.all([listLeads(), listAudit(5000)]);
  const leads = leadsAll.filter((l) => !isInternal(l));
  // "analyzed" derived from the audit log (avoids the BI table, whose surface_package
  // column is a PENDING migration on prod). A lead counts as analyzed once a website
  // analysis / BI generation / email-harvest event has fired for it.
  const ANALYZE_ACTIONS = new Set(["lead.analyze", "lead.bi_regenerate", "lead.email.harvest", "lead.email.discovered"]);
  const analyzed = new Set(
    audit.filter((a) => ANALYZE_ACTIONS.has(a.action) && a.targetId).map((a) => a.targetId as string),
  );
  const TERMINAL = new Set(["Won", "Lost", "Disqualified"]);

  const withEmail = leads.filter((l) => isValidEmail(l.publicEmail));
  const noEmail = leads.filter((l) => !isValidEmail(l.publicEmail));
  const noEmailActive = noEmail.filter((l) => !TERMINAL.has(l.pipelineStage) && (l as any).acquisitionStrategy !== "Do Not Contact");
  const noEmail_hasSite = noEmailActive.filter((l) => !!l.website);
  const noEmail_hasSite_unanalyzed = noEmail_hasSite.filter((l) => !analyzed.has(l.id)); // crawl can still help
  const noEmail_hasSite_analyzed = noEmail_hasSite.filter((l) => analyzed.has(l.id));     // crawled, no same-domain email
  const noEmail_noSite = noEmailActive.filter((l) => !l.website);                          // phone-first is correct

  const prepSamples = audit.filter((a) => a.action === "email.prep.sample");
  const harvests = audit.filter((a) => a.action === "lead.email.harvest");
  const harvestHits = harvests.filter((a) => (a.meta as any)?.method && (a.meta as any).method !== "none");

  console.log("──────── EMAIL-SUPPLY FUNNEL (read-only) ────────");
  console.log(`Real leads:                         ${leads.length}`);
  console.log(`  with valid email (email-first):   ${withEmail.length}`);
  console.log(`  NO email:                          ${noEmail.length}`);
  console.log(`    …active (non-terminal, contactable): ${noEmailActive.length}`);
  console.log(`      has website, NOT yet analyzed:      ${noEmail_hasSite_unanalyzed.length}  ← crawl should harvest email`);
  console.log(`      has website, already analyzed:      ${noEmail_hasSite_analyzed.length}  ← crawled, no same-domain email (phone-first is correct)`);
  console.log(`      NO website:                          ${noEmail_noSite.length}  ← phone-first is correct`);
  console.log("");
  console.log("──────── EMAIL-PREP SWEEP HISTORY (has it ever run here?) ────────");
  console.log(`  email.prep.sample audits (sweep ran):  ${prepSamples.length}`);
  if (prepSamples.length) {
    const last = prepSamples[0] as any;
    console.log(`    most recent: ${JSON.stringify(last.meta)}`);
  }
  console.log(`  lead.email.harvest audits (per-lead crawl): ${harvests.length}  (found an email: ${harvestHits.length})`);
  console.log("");
  const yield_ = noEmail_hasSite_unanalyzed.length;
  console.log("──────── PROJECTION ────────");
  console.log(`If we enrich the ${yield_} unanalyzed-with-site leads, at the observed same-domain yield`);
  console.log(`we expect to flip a fraction of them to email-first and refill the 10/day email queue.`);
  console.log(`EMAIL_PREP_ENABLED must be "1" for the daily cron to do this automatically.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
