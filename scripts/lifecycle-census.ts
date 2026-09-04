// READ-ONLY whole-book prospect-video artifact census (mandate part 6). For every lead that has ANY
// prospect artifact (and for the named repair targets), dumps the persisted matrix so we can see the real
// production reality BEFORE building the canonical resolver. Writes nothing.
import { listLeads, allEmailSends, getBusinessIntelligence } from "../src/lib/repo";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { listJobs, listTemplateIds, latestUpload, loadTemplate } from "../src/lib/content-studio/store";
import { latestReadyShot } from "../src/lib/content-studio/screenshot-jobs";
import { latestProspectPackage } from "../src/lib/outreach/prospect-package-store";
import { resolveFrozenReviewForSend } from "../src/lib/outreach/quick-review-freeze";

const NAMED = ["morris automotive", "we the people", "horizon roofing", "stability healthcare", "cobalt clean", "motion recruitment"];

async function main() {
  const [leads, sends, bindings, jobs, tidList] = await Promise.all([
    listLeads(), allEmailSends(), listScheduledBindings(), listJobs(), listTemplateIds().catch(() => [] as string[]),
  ]);
  const templateIds = new Set(tidList);
  const contacted = new Set(sends.filter((e) => e.leadId).map((e) => e.leadId as string));
  const scheduled = new Set(bindings.map((b) => b.leadId));
  const sentLead = new Set(sends.filter((e) => e.leadId && e.sentAt).map((e) => e.leadId as string));

  async function row(lead: any) {
    const pieceId = `client-${lead.id}`;
    const up = await latestUpload(pieceId).catch(() => null);
    const pjobs = jobs.filter((j) => j.pieceId === pieceId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const last = pjobs[pjobs.length - 1];
    const readyJob = [...pjobs].reverse().find((j) => j.status === "ready" && j.outputKey);
    const pkg = await latestProspectPackage(lead.id).catch(() => null);
    const froze = await resolveFrozenReviewForSend(lead.id).catch(() => ({ ok: false } as any));
    const shot = await latestReadyShot(lead.id, "mobile").catch(() => null);
    return {
      name: lead.businessName, id: lead.id,
      template: templateIds.has(pieceId),
      upload: up ? `yes(sha=${(up.sha256 ?? "").slice(0, 8)},${up.kind})` : "NO",
      jobs: pjobs.length ? pjobs.map((j) => `${j.status}${j.outputKey ? "+mp4" : ""}`).join(">") : "none",
      lastJob: last ? `${last.status}${last.error ? "(" + last.error.slice(0, 30) + ")" : ""}` : "none",
      verifiedMp4: !!readyJob,
      pkg: pkg ? `${pkg.state}[subj=${pkg.subject ? "y" : "N"},body=${(pkg.bodyHtml || pkg.bodyText) ? "y" : "N"},review=${pkg.review ? "y" : "N"},video=${pkg.video ? "y" : "N"},share=${pkg.share ? "y" : "N"}]` : "NONE",
      frozenPDF: (froze as any).ok,
      screenshot: !!shot?.outputKey,
      contacted: contacted.has(lead.id), scheduled: scheduled.has(lead.id), sent: sentLead.has(lead.id),
    };
  }

  console.log("\n=== NAMED REPAIR TARGETS ===");
  for (const q of NAMED) {
    const matches = leads.filter((l) => l.businessName.toLowerCase().includes(q));
    if (!matches.length) { console.log(`\n[${q}] — NOT FOUND in book`); continue; }
    for (const m of matches) console.log("\n" + JSON.stringify(await row(m), null, 0));
  }

  // Whole-book: any lead with a template OR package OR upload OR render job.
  console.log("\n\n=== WHOLE-BOOK PROSPECT-ARTIFACT LEADS ===");
  const jobPieces = new Set(jobs.map((j) => j.pieceId));
  let broken = 0, total = 0;
  const brokenRows: string[] = [];
  for (const lead of leads) {
    const pieceId = `client-${lead.id}`;
    const up = await latestUpload(pieceId).catch(() => null);
    if (!templateIds.has(pieceId) && !jobPieces.has(pieceId) && !up) {
      const pkg = await latestProspectPackage(lead.id).catch(() => null);
      if (!pkg) continue;
    }
    total += 1;
    const r = await row(lead);
    // "broken" heuristic: appears prepared but is missing a hard prereq (body or frozen PDF or template).
    const looksPrepared = r.pkg !== "NONE" || r.upload !== "NO" || r.template;
    const missing = [!r.template && "template", !r.frozenPDF && "frozenPDF", r.pkg !== "NONE" && r.pkg.includes("body=N") && "emailBody"].filter(Boolean);
    if (looksPrepared && missing.length) { broken += 1; brokenRows.push(`  • ${r.name} (${r.id}) missing:${missing.join(",")} | ${r.pkg} upload=${r.upload} lastJob=${r.lastJob} contacted=${r.contacted} scheduled=${r.scheduled}`); }
  }
  console.log(`Leads with prospect artifacts: ${total}`);
  console.log(`Leads that look prepared but are MISSING a hard prereq (template/frozenPDF/emailBody): ${broken}`);
  console.log(brokenRows.join("\n"));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
