// READ-ONLY live send-window forensics (mandate 13 part 7). Reconciles the Sept-4 scheduled bindings
// against the canonical email ledger + Resend receipt fields (providerMessageId, deliveredAt, bouncedAt)
// and the outreach cron's actual audit trail. Recipients are REDACTED (domain only). Writes nothing.
import { allEmailSends, listAudit } from "../src/lib/repo";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";

const redact = (e?: string | null) => (e ? e.replace(/^[^@]+/, "***") : "—");
// LA (PDT, UTC-7) Sept 4 window.
const DAY_START = "2026-09-04T07:00:00Z", DAY_END = "2026-09-05T07:00:00Z";
const inSept4 = (iso?: string | null) => !!iso && iso >= DAY_START && iso < DAY_END;

async function main() {
  const nowIso = new Date().toISOString();
  const [sends, bindings, audit] = await Promise.all([allEmailSends(), listScheduledBindings(), listAudit(5000)]);

  // Ledger indexed by lead.
  const byLead = new Map<string, any[]>();
  for (const s of sends) { if (!s.leadId) continue; (byLead.get(s.leadId) ?? byLead.set(s.leadId, []).get(s.leadId)!).push(s); }

  console.log("=== SCHEDULED BINDINGS (current) ===");
  const tally: Record<string, number> = {};
  for (const { leadId, binding } of bindings) {
    const pastDue = binding.scheduledAt < nowIso;
    const ledger = (byLead.get(leadId) ?? []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const latest = ledger[0];
    const accepted = ledger.find((s) => s.providerMessageId && (s.sentAt || s.status === "sent" || s.status === "delivered"));
    let outcome: string;
    if (accepted) outcome = accepted.deliveredAt ? "DELIVERED" : accepted.bouncedAt ? "BOUNCED" : "ACCEPTED(sent)";
    else if (binding.status === "delivery-blocked") outcome = "BLOCKED(binding)";
    else if (binding.status === "held") outcome = "HELD";
    else if (binding.status === "cancelled") outcome = "CANCELLED";
    else if (latest?.status === "failed") outcome = "FAILED";
    else if (pastDue) outcome = "PAST-DUE(unsent)";
    else outcome = "STILL-SCHEDULED";
    tally[outcome] = (tally[outcome] ?? 0) + 1;
    console.log(`  ${binding.scheduledAt} sched=${binding.status} → ${outcome} | ${redact(binding.recipient)} lead=${leadId}` +
      (latest ? ` | ledger=${latest.status} pmid=${latest.providerMessageId ? "yes" : "no"} sentAt=${latest.sentAt ?? "—"} delivered=${latest.deliveredAt ?? "—"} bounced=${latest.bouncedAt ?? "—"}${latest.lastError ? " err=" + String(latest.lastError).slice(0, 40) : ""}` : " | ledger=NONE"));
  }
  console.log("BINDING OUTCOME TALLY:", JSON.stringify(tally));

  console.log("\n=== EMAIL LEDGER — SEPT 4 (queued or sent that day) ===");
  const sept4 = sends.filter((s) => inSept4(s.sentAt) || inSept4(s.queuedAt) || inSept4(s.sendingAt));
  const rtally: Record<string, number> = {};
  for (const s of sept4.sort((a, b) => ((a.sentAt ?? a.queuedAt ?? "") < (b.sentAt ?? b.queuedAt ?? "") ? -1 : 1))) {
    const state = s.deliveredAt ? "delivered" : s.bouncedAt ? "bounced" : s.status;
    rtally[state] = (rtally[state] ?? 0) + 1;
    console.log(`  ${s.sentAt ?? s.queuedAt} ${state.padEnd(10)} pmid=${s.providerMessageId ? s.providerMessageId.slice(0, 14) : "—"} to=${redact(s.toAddr)} step=${s.stepId ?? "—"}${s.lastError ? " err=" + String(s.lastError).slice(0, 50) : ""}`);
  }
  console.log(`SEPT-4 LEDGER TALLY: ${JSON.stringify(rtally)} (total ${sept4.length})`);

  console.log("\n=== OUTREACH CRON AUDIT TRAIL (recent) ===");
  const wanted = new Set(["outreach.runner.dispatched", "outreach.sent", "email.send.blocked", "comms.scheduler", "outreach.schedule.reconcile"]);
  const rows = (audit as any[]).filter((a) => wanted.has(a.action)).slice(0, 25);
  for (const a of rows) console.log(`  ${a.createdAt} ${a.action} ${JSON.stringify(a.meta).slice(0, 160)}`);
  const blockedReasons = (audit as any[]).filter((a) => a.action === "email.send.blocked").map((a) => (a.meta?.reason ?? a.meta?.blockReason ?? JSON.stringify(a.meta)));
  console.log("\nBLOCK REASONS (email.send.blocked):", JSON.stringify([...new Set(blockedReasons)].slice(0, 10)));
  const lastDispatch = (audit as any[]).find((a) => a.action === "outreach.runner.dispatched");
  console.log("LAST outreach.runner.dispatched:", lastDispatch ? lastDispatch.createdAt : "NEVER");
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
