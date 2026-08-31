// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY: render the EXACT authorized Quick Review PDF a real prospect send would attach, so the
// controlled-test dry run can show its true filename + SHA-256 (not a sample). Mirrors dispatchStep's
// legacy attach path: resolveLeadBrand → quickReviewApproved → buildQuickReview → renderQuickReviewPdf,
// filename via quickReviewFilename. It ONLY reads leads/BI and renders a PDF to /tmp — it never imports
// the sender (submitCompliantDispatch/Resend) and never writes to the DB, so it cannot send anything.
//
// Usage (documented read-only prod DB access):
//   railway run --service outreach-web -- env DATABASE_URL="<public-proxy-url>" \
//     ./node_modules/.bin/tsx scripts/comms/render-authorized-qr.ts
// Prints one JSON line: { leadId, businessName, approved, filename, sha256, bytes, outPath }.
// ─────────────────────────────────────────────────────────────────────────────
import "../loadEnv";
import { writeFileSync } from "node:fs";
import { listLeads, getBusinessIntelligence } from "../../src/lib/repo";
import { buildQuickReview, resolveLeadBrand, quickReviewFilename } from "../../src/lib/outreach/quick-review";
import { quickReviewApproved } from "../../src/lib/outreach/review-approval";
import { renderQuickReviewPdf } from "../../src/lib/pdf/render";
import { sha256 } from "../../src/lib/comms/receipt";
import type { BusinessProfile } from "../../src/lib/business-intelligence/types";

async function main() {
  const leads = await listLeads();
  let lead: any = null, review: any = null, isApproved = false;
  let scanned = 0;
  const SCAN_CAP = 80; // bound the number of BI lookups over the read-only DB proxy

  for (const l of leads) {
    if (scanned >= SCAN_CAP) break;
    const bi = await getBusinessIntelligence(l.id);
    const profile = (bi?.profile?.businessProfile as BusinessProfile | undefined) ?? null;
    if (!profile || !(profile.opportunities?.length ?? 0)) continue;
    scanned++;
    try {
      const brand = await resolveLeadBrand(l);
      const approved = await quickReviewApproved(l.id);
      const r = buildQuickReview(l, profile, brand, { approved, observedAt: bi?.generatedAt ?? null });
      if (!r?.ready) continue;
      lead = l; review = r; isApproved = approved; break;   // first ready review = the authorized artifact a real send attaches
    } catch { /* skip unrenderable */ }
  }

  if (!lead || !review) { console.error("NO_READY_REVIEW: no lead with a ready Quick Review found."); process.exit(3); }

  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const pdf = await renderQuickReviewPdf(review, dateStr);
  const filename = quickReviewFilename(lead.businessName);
  const outPath = `/tmp/${filename}`;
  writeFileSync(outPath, pdf);

  console.log(JSON.stringify({
    leadId: lead.id, businessName: lead.businessName, approved: isApproved,
    filename, sha256: sha256(pdf), bytes: pdf.length, outPath,
  }));
}
main().catch((e) => { console.error("render error:", e); process.exit(1); });
