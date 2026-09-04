import { getLead, getBusinessIntelligence } from "../src/lib/repo";
import { buildQuickReview } from "../src/lib/outreach/quick-review";
import { quickReviewApproved } from "../src/lib/outreach/review-approval";
import { composeReviewNarration } from "../src/lib/content-studio/client-video";
import { gateNarration } from "../src/lib/content-studio/narration-quality-gate";
async function one(id: string){
  const lead=await getLead(id); const bi=await getBusinessIntelligence(id);
  const rev=lead?buildQuickReview(lead,(bi?.profile as any)?.businessProfile??null,null,{approved:await quickReviewApproved(id)}):null;
  if(!rev){console.log(id,"no review");return;}
  const c=composeReviewNarration(rev, lead?.industry??null);
  const status=rev.status; const finding=rev.findings?.[0];
  if(!c){console.log(`${lead?.businessName}: composer→NULL | reviewStatus=${status} | topFinding=${finding?.id}:${(finding?.observation||"").slice(0,60)}`);return;}
  const v=gateNarration({narration:c.lines.map(l=>l.text),finding:{key:String(finding?.id??""),observation:finding?.observation??null},businessName:lead?.businessName??"",url:lead?.website});
  console.log(`${lead?.businessName}: composer→${c.wordCount}w/${c.lines.length}beats | gate=${v.ok?"PASS":"FAIL["+v.reasons.join(",")+"]"}`);
}
async function main(){for(const id of process.argv.slice(2))await one(id);process.exit(0);}
main().catch(e=>{console.error(e?.stack||e);process.exit(1);});
