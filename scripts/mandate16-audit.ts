// PHASE 0 — READ-ONLY package-integrity audit (mandate 16). Classifies every READY_TO_APPROVE / SCHEDULED
// item, detects placeholder/test content, resolves the named companies, lists Sept-7 bindings, and explains
// the 13-vs-12 first-touch discrepancy from the audit trail. Writes nothing.
import { listLeads, allEmailSends, listAudit } from "../src/lib/repo";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { latestProspectPackage } from "../src/lib/outreach/prospect-package-store";
import { resolveFrozenReviewForSend } from "../src/lib/outreach/quick-review-freeze";

const redact = (e?: string | null) => (e ? e.replace(/^[^@]+/, "***") : "—");
const NAMED = ["motion recruitment", "silver in the city", "a to z", "alpha one", "morris automotive", "purple"];

// Placeholder / synthetic / test-content detection.
function isPlaceholder(subject?: string | null, body?: string | null | undefined, business?: string | null): string | null {
  const s = (subject ?? "").trim(), n = (business ?? "").trim();
  if (/breakbot|test\b|fixture|placeholder|lorem|canary|synthetic/i.test(s)) return `subject="${s.slice(0, 40)}"`;
  // Only apply the body-length check when a body was actually supplied (bindings carry only a digest).
  if (body != null) { const b = body.replace(/<[^>]+>/g, "").trim(); if (b.length <= 3) return `body too short ("${b}")`; }
  if (/breakbot|fixture|canary|synthetic|test-only/i.test(n)) return `business="${n}"`;
  return null;
}
function pkgType(pkg: any): string {
  if (!pkg) return "NONE";
  if (pkg.video) return "EMAIL_VIDEO";
  if (pkg.review) return "EMAIL_PDF";
  return "EMAIL_ONLY";
}

async function main() {
  const [leads, sends, bindings, audit] = await Promise.all([listLeads(), allEmailSends(), listScheduledBindings(), listAudit(5000)]);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const contacted = new Set(sends.filter((e) => e.leadId).map((e) => e.leadId as string));

  // ── READY_TO_APPROVE prospect packages (video packages awaiting approval) ─────────────────────────
  console.log("=== READY_TO_APPROVE / prospect packages ===");
  for (const lead of leads) {
    const pkg = await latestProspectPackage(lead.id).catch(() => null);
    if (!pkg || !["READY_TO_APPROVE", "FROZEN"].includes(pkg.state)) continue;
    const ph = isPlaceholder(pkg.subject, pkg.bodyText || pkg.bodyHtml, lead.businessName);
    const froze = await resolveFrozenReviewForSend(lead.id).catch(() => ({ ok: false } as any));
    console.log(`  ${lead.businessName} (${lead.id}) type=${pkgType(pkg)} state=${pkg.state} v${pkg.packageVersion} recip=${redact(pkg.recipientEmail)}`);
    console.log(`     subject="${(pkg.subject ?? "").slice(0, 50)}" body="${(pkg.bodyText ?? "").replace(/\s+/g, " ").slice(0, 40)}" video=${!!pkg.video} share=${!!pkg.share} frozenPDF=${(froze as any).ok} contacted=${contacted.has(lead.id)}`);
    console.log(`     PLACEHOLDER/TEST: ${ph ? "⚠️  " + ph : "no"}`);
  }

  // ── SCHEDULED bindings — classify each ────────────────────────────────────────────────────────────
  console.log("\n=== SCHEDULED bindings (classification) ===");
  const tally: Record<string, number> = {};
  const SEP7 = (iso: string) => iso >= "2026-09-07T00:00:00Z" && iso < "2026-09-08T00:00:00Z";
  let sep7 = 0;
  for (const { leadId, binding } of bindings.sort((a, b) => (a.binding.scheduledAt < b.binding.scheduledAt ? -1 : 1))) {
    const lead = leadById.get(leadId);
    const froze = await resolveFrozenReviewForSend(leadId).catch(() => ({ ok: false } as any));
    const pkg = await latestProspectPackage(leadId).catch(() => null);
    const ph = isPlaceholder(binding.subject, null, lead?.businessName);
    let cls: string;
    if (ph) cls = "INVALID_PLACEHOLDER_CONTENT";
    else if (!binding.recipient || !/@/.test(binding.recipient)) cls = "INVALID_RECIPIENT_OR_ELIGIBILITY";
    else if (binding.pdfSha256 && !(froze as any).ok) cls = "INVALID_MISSING_REQUIRED_ARTIFACT(pdf unresolved)";
    else if (pkg?.video) cls = "COMPLETE_EMAIL_VIDEO";
    else if (binding.pdfSha256 && (froze as any).ok) cls = "COMPLETE_EMAIL_PDF";
    else cls = "COMPLETE_EMAIL_ONLY";
    tally[cls] = (tally[cls] ?? 0) + 1;
    if (SEP7(binding.scheduledAt)) sep7 += 1;
    console.log(`  ${binding.scheduledAt} ${cls.padEnd(38)} ${redact(binding.recipient)} rev=${(binding.revisionId ?? "").slice(0, 14)} pdf=${String(binding.pdfSha256 ?? "").slice(0, 8)} ${lead?.businessName ?? leadId}`);
  }
  console.log("BINDING CLASSIFICATION TALLY:", JSON.stringify(tally), "| Sept-7:", sep7);

  // ── Named companies ───────────────────────────────────────────────────────────────────────────────
  console.log("\n=== NAMED COMPANIES ===");
  for (const q of NAMED) {
    const ms = leads.filter((l) => l.businessName.toLowerCase().includes(q));
    if (!ms.length) { console.log(`  [${q}] NOT FOUND`); continue; }
    for (const l of ms) {
      const pkg = await latestProspectPackage(l.id).catch(() => null);
      const ph = isPlaceholder(pkg?.subject, pkg?.bodyText, l.businessName);
      const scheduled = bindings.find((b) => b.leadId === l.id);
      console.log(`  ${l.businessName} (${l.id}) pkg=${pkg?.state ?? "NONE"} type=${pkgType(pkg)} v${pkg?.packageVersion ?? "-"} contacted=${contacted.has(l.id)} scheduledAt=${scheduled?.binding.scheduledAt ?? "—"} placeholder=${ph ?? "no"}`);
    }
  }

  // ── 13-vs-12 explanation ────────────────────────────────────────────────────────────────────────
  console.log("\n=== 13-vs-12 FIRST-TOUCH DISCREPANCY (from reconcile audit) ===");
  const recon = (audit as any[]).filter((a) => a.action === "outreach.schedule.reconcile").slice(0, 8);
  for (const a of recon) console.log(`  ${a.createdAt} ${JSON.stringify(a.meta)}`);
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
