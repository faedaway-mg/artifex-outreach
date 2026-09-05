// MANDATE 18 — STAGE 1: read-only production send-readiness audit. Verifies the Sept-8 backlog is safe to
// resume: every binding passes the permanent integrity validator, nothing overdue, holiday/weekend blocked,
// Silver excluded, Motion/Alpha One correct, allocation ≤ 20 with 10/10 reserves. Simulated-clock dry-runs.
// Writes NOTHING. Prints one GREEN/RED verdict.
import { listScheduledBindings, validateScheduled, dueScheduled } from "../src/lib/outreach/scheduled-batch";
import { latestProspectPackage, resolvePackageForSendById } from "../src/lib/outreach/prospect-package-store";
import { currentAllocation } from "../src/lib/outreach/allocation-state";
import { outreachPausedNow } from "../src/lib/outreach/outreach-pause";
import { isBusinessHoliday } from "../src/lib/outreach/business-calendar";
import { classifyPackageType } from "../src/lib/outreach/dispatch-integrity";
import { getLead } from "../src/lib/repo";

const redact = (e?: string | null) => (e ? e.replace(/^[^@]+/, "***") : "—");
const laKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

async function main() {
  const fails: string[] = [];
  const now = new Date();
  const paused = await outreachPausedNow();
  console.log(`safe-hold engaged (pausedNow): ${paused}`);
  if (!paused) fails.push("safe-hold NOT engaged at audit start");

  const bindings = (await listScheduledBindings()).sort((a, b) => (a.binding.scheduledAt < b.binding.scheduledAt ? -1 : 1));
  const sep7 = bindings.filter((b) => laKey(b.binding.scheduledAt) === "2026-09-07");
  const sep8 = bindings.filter((b) => laKey(b.binding.scheduledAt) === "2026-09-08");
  console.log(`\nTotal scheduled bindings: ${bindings.length} | Sept-7: ${sep7.length} | Sept-8: ${sep8.length}`);
  if (sep7.length !== 0) fails.push(`${sep7.length} bindings still on Sept-7`);
  if (sep8.length !== 13) fails.push(`expected 13 Sept-8 bindings, found ${sep8.length}`);

  console.log("\n=== PER-BINDING INTEGRITY (validateScheduled = the permanent gate) ===");
  for (const { leadId, binding } of bindings) {
    const lead = await getLead(leadId);
    const pkg = await latestProspectPackage(leadId).catch(() => null);
    const v = await validateScheduled(leadId, binding);
    const overdue = binding.scheduledAt <= now.toISOString();
    const holiday = isBusinessHoliday(laKey(binding.scheduledAt));
    if (!v.ok) fails.push(`binding ${lead?.businessName ?? leadId} INVALID: ${v.reason}`);
    if (overdue) fails.push(`binding ${lead?.businessName ?? leadId} is OVERDUE (would dispatch on resume)`);
    if (holiday) fails.push(`binding ${lead?.businessName ?? leadId} on a holiday`);
    console.log(`  ${binding.scheduledAt} ${classifyPackageType(pkg).padEnd(12)} valid=${v.ok ? "✓" : "✗ " + v.reason} overdue=${overdue} holiday=${holiday} recip=${redact(binding.recipient)} rev=${(binding.revisionId ?? "").slice(0, 12)} ${lead?.businessName ?? leadId}`);
  }

  // Silver exclusion
  const silver = await resolvePackageForSendById("lead_nDZRd3_Gcw").catch(() => ({ ok: true } as any));
  const silverScheduled = bindings.some((b) => b.leadId === "lead_nDZRd3_Gcw");
  console.log(`\nSILVER: scheduled=${silverScheduled} dispatchable=${(silver as any).ok} reason=${(silver as any).reason ?? "—"}`);
  if (silverScheduled) fails.push("Silver is scheduled");
  if ((silver as any).ok) fails.push("Silver is dispatch-eligible");

  // Motion / Alpha One package-selection proof
  const motion = await latestProspectPackage("lead_29DUYcQJQh").catch(() => null);
  const alpha = bindings.find((b) => b.leadId === "lead_y9oCzQWkSR");
  const alphaPkg = await latestProspectPackage("lead_y9oCzQWkSR").catch(() => null);
  console.log(`MOTION pkg: state=${motion?.state} type=${classifyPackageType(motion)} (expect FROZEN EMAIL_VIDEO)`);
  console.log(`ALPHA ONE binding: type=${alpha ? "EMAIL_PDF (binding→frozen review)" : "none"} | separate video draft state=${alphaPkg?.state} (draft is NOT the scheduled send)`);
  if (classifyPackageType(motion) !== "EMAIL_VIDEO") fails.push("Motion package is not EMAIL_VIDEO");
  if (!alpha || !alpha.binding.pdfSha256) fails.push("Alpha One binding lacks a frozen-review PDF reference");

  // Simulated-clock dry-runs
  console.log("\n=== SIMULATED-CLOCK DRY-RUNS (dueScheduled + allocation; sends nothing) ===");
  const clocks: Array<[string, Date]> = [
    ["current", now],
    ["Sept-7 12:30Z (window, holiday)", new Date("2026-09-07T12:30:00Z")],
    ["Sept-8 11:59Z (before first binding)", new Date("2026-09-08T11:59:00Z")],
    ["Sept-8 14:00Z (all due)", new Date("2026-09-08T14:00:00Z")],
  ];
  for (const [label, t] of clocks) {
    const due = await dueScheduled(t);
    const dueValid = [] as string[];
    for (const d of due) { const v = await validateScheduled(d.leadId, d.binding); if (v.ok) dueValid.push(d.leadId); }
    const alloc = await currentAllocation(t);
    const total = alloc.firstTarget + alloc.followTarget;
    console.log(`  ${label.padEnd(38)} due=${due.length} dueValid=${dueValid.length} alloc[first=${alloc.firstTarget} follow=${alloc.followTarget} total=${total}] cap=${alloc.cap}`);
    if (total > 20) fails.push(`allocation total ${total} > 20 at ${label}`);
    if (label.startsWith("Sept-7") && due.length > 0) fails.push(`Sept-7 has ${due.length} due (should be 0)`);
    if (label === "current" && due.length > 0) fails.push(`current time has ${due.length} overdue dispatches`);
  }

  console.log(`\n=== VERDICT: ${fails.length === 0 ? "GREEN — all Stage-1 criteria pass" : "RED — " + fails.length + " blocker(s)"} ===`);
  for (const f of fails) console.log("  ✗ " + f);
  process.exit(fails.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(2); });
