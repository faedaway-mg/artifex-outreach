// READ-ONLY: validate the canonical company snapshot against prod. No writes, no sends.
import { buildCompanySnapshot } from "../src/lib/outreach/company-snapshot";
async function main() {
const s = await buildCompanySnapshot(new Date());
console.log("COUNTS:", JSON.stringify(s.counts, null, 0));
console.log("scheduled IDs:", s.scheduled.map((r) => r.leadId).join(", "));
console.log("ready IDs:", s.ready.map((r) => r.leadId).join(", "));
console.log("needsVoiceover IDs:", s.needsVoiceover.map((r) => r.leadId).join(", "));
console.log("blocked buckets:");
for (const b of s.blocked) console.log(`  ${b.count.toString().padStart(3)}  ${b.label}  (retry=${b.companies.filter((c) => c.willRetry).length})`);
console.log("blocked TOTAL:", s.counts.blocked, "| focusQueue length:", s.focusQueueIds.length, "| replies:", s.counts.replies);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.stack || e); process.exit(1); });
