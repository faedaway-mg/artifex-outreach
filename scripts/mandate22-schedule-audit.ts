// MANDATE 22 — read-only forensic audit of EVERY scheduled binding. Writes NOTHING; invokes no runner.
// For each binding: company, recipient(domain-redacted), package type, subject/body/PDF/video/share presence,
// frozen revision, scheduled time, validator result, and scheduling lineage (by/at/batchId). Sorted by when
// each binding was scheduled (binding.at) so the newest additions are obvious.
import { listScheduledBindings, validateScheduled } from "../src/lib/outreach/scheduled-batch";
import { latestProspectPackage } from "../src/lib/outreach/prospect-package-store";
import { classifyPackageType } from "../src/lib/outreach/dispatch-integrity";
import { getLead, allEmailSends, listAudit } from "../src/lib/repo";

const redact = (e?: string | null) => (e ? e.replace(/^[^@]+/, "***") : "—");
const laKey = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function main() {
  const [bindings, sends, audit] = await Promise.all([listScheduledBindings(), allEmailSends(), listAudit(20000)]);
  const sorted = [...bindings].sort((a, b) => (a.binding.at < b.binding.at ? -1 : 1)); // oldest scheduled first
  const rows: any[] = [];
  for (const { leadId, binding } of sorted) {
    const lead = await getLead(leadId);
    const pkg = await latestProspectPackage(leadId).catch(() => null);
    const v = await validateScheduled(leadId, binding);
    const leadSends = sends.filter((e) => e.leadId === leadId);
    const contacted = leadSends.length > 0;
    const sent = leadSends.some((e) => !!e.sentAt);
    // Scheduling lineage from the audit log (schedule.set / schedule.batch) for this lead.
    const setEvents = audit.filter((a) => (a.action === "outreach.schedule.set") && a.targetId === leadId);
    rows.push({
      company: lead?.businessName ?? leadId,
      leadId,
      recipient: redact(binding.recipient),
      pkgType: classifyPackageType(pkg),
      pkgState: pkg?.state ?? "(no package record)",
      subject: binding.subject ? "yes" : "NO",
      body: pkg?.bodyText || pkg?.bodyHtml ? "yes" : (binding.bodyDigest ? "digest-only" : "NO"),
      pdf: pkg?.review ? "bound" : (binding.pdfSha256 ? "sha-in-binding" : "none"),
      video: pkg?.video ? "bound" : "none",
      share: pkg?.share ? "yes" : "none",
      revision: (binding.revisionId ?? "").slice(0, 12),
      scheduledAt: `${binding.scheduledAt} (${laKey(binding.scheduledAt)} PT)`,
      validator: v.ok ? "OK" : `INVALID: ${v.reason}`,
      contacted, sent,
      scheduledBy: binding.by,
      scheduledAtStamp: `${binding.at} (${laKey(binding.at)} PT)`,
      batchId: binding.batchId,
      setEventCount: setEvents.length,
    });
  }
  console.log(JSON.stringify({ total: rows.length, rows }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
