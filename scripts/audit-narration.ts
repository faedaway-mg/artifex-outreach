import { getLead, getBusinessIntelligence } from "../src/lib/repo";
import { buildQuickReview } from "../src/lib/outreach/quick-review";
import { quickReviewApproved } from "../src/lib/outreach/review-approval";
import { loadTemplate } from "../src/lib/content-studio/store";
import { gateNarration } from "../src/lib/content-studio/narration-quality-gate";
async function one(id: string) {
  const lead = await getLead(id); const bi = await getBusinessIntelligence(id);
  const rev = lead ? buildQuickReview(lead, (bi?.profile as any)?.businessProfile ?? null, null, { approved: await quickReviewApproved(id) }) : null;
  const t = await loadTemplate(`client-${id}`);
  const ev = ((bi?.profile as any)?.evidence ?? []) as Array<{ field: string; value: any }>;
  const cta = ev.find(e => e.field === "primaryCTA")?.value;
  const v = gateNarration({ narration: t?.narration ?? [], finding: { key: String(rev?.findings?.[0]?.id ?? ""), observation: rev?.findings?.[0]?.observation ?? null }, domFacts: { primaryCta: cta != null ? String(cta) : null }, businessName: lead?.businessName ?? "", url: lead?.website, reviewCount: (lead as any)?.reviewCount });
  console.log(`\n${lead?.businessName} (${id}): ${v.ok ? "PASS" : "FAIL"} wc=${v.wordCount} reasons=[${v.reasons.join(", ")}]`);
}
async function main(){ for (const id of process.argv.slice(2)) await one(id); process.exit(0); }
main().catch(e=>{console.error(e?.stack||e);process.exit(1);});
