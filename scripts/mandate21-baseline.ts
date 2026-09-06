// MANDATE 21 — read-only production fingerprint. Records the exact counts + binding hash BEFORE and AFTER
// the Reject/Stop-future-outreach work so we can prove production was never mutated. Writes NOTHING.
// Run against prod via: railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" \
//   CS_STORAGE_PROVIDER=postgres CS_DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx scripts/mandate21-baseline.ts'
import { createHash } from "node:crypto";
import { listLeads, allEmailSends, listAudit } from "../src/lib/repo";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { outreachPausedNow } from "../src/lib/outreach/outreach-pause";
import { PROSPECT_PACKAGE_ACTION } from "../src/lib/outreach/prospect-package-store";
import { REVIEW_APPROVED_ACTION } from "../src/lib/outreach/review-approval";

async function main() {
  const [leads, sends, bindings, audit, paused] = await Promise.all([
    listLeads(), allEmailSends(), listScheduledBindings(), listAudit(20000), outreachPausedNow(),
  ]);
  // Stable fingerprint of every binding (order-independent): leadId|scheduledAt|revisionId.
  const bindHash = createHash("sha256")
    .update(bindings.map((b) => `${b.leadId}|${b.binding.scheduledAt}|${b.binding.revisionId ?? ""}`).sort().join("\n"))
    .digest("hex").slice(0, 16);
  const packages = audit.filter((a) => a.action === PROSPECT_PACKAGE_ACTION).length;
  const approvals = audit.filter((a) => a.action === REVIEW_APPROVED_ACTION).length;
  const breakbotInProd = leads.filter((l) => /breakbot/i.test(l.source ?? "") || /@example\.invalid$/i.test(l.publicEmail ?? "")).length;
  // Any rejection audit events already present (0 before this mandate ships).
  const rejects = audit.filter((a) => a.action === "lead.rejected").length;

  const fp = { leads: leads.length, sends: sends.length, bindings: bindings.length, bindHash, packages, approvals, rejects, breakbotInProd, paused };
  console.log(JSON.stringify(fp, null, 2));
  if (breakbotInProd > 0) console.error(`\n⚠️  ${breakbotInProd} breakbot/example.invalid rows found in this store — NOT clean.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
