// Read-only: list every email send NOT in a terminal state (queued/sending), with the
// lead behind it, so we can confirm nothing unintended would fire when sending is enabled.
import "../loadEnv";
import { allEmailSends, getLead } from "../../src/lib/repo";

async function main() {
  const sends = await allEmailSends();
  const open = sends.filter((s) => s.status === "queued" || s.status === "sending");
  console.log(`\nOpen (queued/sending) email sends: ${open.length}\n`);
  for (const s of open) {
    const lead = s.leadId ? await getLead(s.leadId) : null;
    console.log(`- send ${s.id} · status=${s.status} · attempts=${s.attempts} · nextAttemptAt=${s.nextAttemptAt ?? "—"}`);
    console.log(`    lead ${s.leadId} · "${lead?.businessName ?? "??"}" · ${lead?.publicEmail ?? "no email"} · source=${lead?.source ?? "?"}`);
  }
  if (open.length === 0) console.log("(nothing open — the queue is clean)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
