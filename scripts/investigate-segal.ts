import { getBusinessIntelligence, getLead } from "../src/lib/repo";
import { buildQuickReview } from "../src/lib/outreach/quick-review";
import { quickReviewApproved } from "../src/lib/outreach/review-approval";
import { loadTemplate } from "../src/lib/content-studio/store";
async function main() {
  const id = process.argv[2] || "lead_6Rv7pVgf2a";
  const lead = await getLead(id); const bi = await getBusinessIntelligence(id);
  const ev = ((bi?.profile as any)?.evidence ?? []) as Array<{ field: string; value: any }>;
  console.log("LEAD:", lead?.businessName, "|", lead?.website);
  console.log("primaryCTA evidence:", JSON.stringify(ev.filter(e => /cta|contact|book|primary/i.test(e.field)).map(e => ({ f: e.field, v: e.value }))));
  console.log("friction:noClearCTA present:", ev.some(e => e.field === "friction:noClearCTA" || String(e.value).includes("noClearCTA")));
  console.log("all friction fields:", ev.filter(e => e.field.startsWith("friction:")).map(e => e.field));
  const review = lead ? buildQuickReview(lead, (bi?.profile as any)?.businessProfile ?? null, null, { approved: await quickReviewApproved(id) }) : null;
  console.log("top finding:", review?.findings?.[0]?.id, "|", review?.findings?.[0]?.observation);
  const t = await loadTemplate(`client-${id}`);
  console.log("current narration:\n", (t?.narration ?? []).map((l,i)=>`  ${i+1}. ${l}`).join("\n"));
  process.exit(0);
}
main().catch(e => { console.error(e?.stack||e); process.exit(1); });
