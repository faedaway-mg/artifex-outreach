import { getLead, getBusinessIntelligence, allEmailSends } from "../src/lib/repo";
import { buildQuickReview } from "../src/lib/outreach/quick-review";
import { quickReviewApproved } from "../src/lib/outreach/review-approval";
import { composeReviewNarration } from "../src/lib/content-studio/client-video";
import { gateNarration } from "../src/lib/content-studio/narration-quality-gate";
import { loadTemplate, listTemplateIds } from "../src/lib/content-studio/store";
import { latestReadyShot } from "../src/lib/content-studio/screenshot-jobs";
import { resolveFrozenReviewForSend } from "../src/lib/outreach/quick-review-freeze";
import { latestProspectPackage } from "../src/lib/outreach/prospect-package-store";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
async function main(){
  const sends=await allEmailSends(); const bindings=await listScheduledBindings(); const tids=new Set(await listTemplateIds());
  const scheduled=new Set(bindings.map(b=>b.leadId)); const contacted=new Set(sends.filter(s=>s.leadId).map(s=>s.leadId as string));
  for(const id of process.argv.slice(2)){
    const lead=await getLead(id); const bi=await getBusinessIntelligence(id);
    const rev=lead?buildQuickReview(lead,(bi?.profile as any)?.businessProfile??null,null,{approved:await quickReviewApproved(id)}):null;
    const c=rev?composeReviewNarration(rev,lead?.industry??null):null;
    const g=c?gateNarration({narration:c.lines.map(l=>l.text),finding:{key:String(rev?.findings?.[0]?.id??""),observation:rev?.findings?.[0]?.observation??null},businessName:lead?.businessName??"",url:lead?.website}):null;
    const shot=await latestReadyShot(id,"mobile").catch(()=>null);
    const froze=await resolveFrozenReviewForSend(id).catch(()=>({ok:false} as any));
    const pkg=await latestProspectPackage(id);
    console.log(`\n${lead?.businessName} (${id}):`);
    console.log(`  website=${!!lead?.website} recipient=${!!lead?.publicEmail} finding=${rev?.findings?.[0]?.id} narrationGate=${c?(g?.ok?"PASS":"FAIL["+g?.reasons.join(",")+"]"):"NULL-compose"}`);
    console.log(`  screenshot=${!!shot?.outputKey} frozenPDF=${(froze as any).ok} template=${tids.has("client-"+id)} package=${pkg?.state??"none"}`);
    console.log(`  scheduled=${scheduled.has(id)} contacted=${contacted.has(id)} → BLOCKS voiceover: ${[scheduled.has(id)&&"scheduled",contacted.has(id)&&!scheduled.has(id)&&"contacted",!(c&&g?.ok)&&"narration",!(tids.has("client-"+id))&&"noTemplate",pkg?.state!=="INCOMPLETE"&&"noDraftPkg"].filter(Boolean).join(", ")||"none"}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e?.stack||e);process.exit(1);});
