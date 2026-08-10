import { NextRequest } from "next/server";
import { getLead, getBusinessIntelligence } from "@/lib/repo";
import { renderQuickReviewPdf } from "@/lib/pdf/render";
import { buildQuickReview, resolveLeadBrand, quickReviewFilename } from "@/lib/outreach/quick-review";
import type { BusinessProfile } from "@/lib/business-intelligence/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator preview of the exact one-page Artifex Quick Review that will be attached to the
// email. Rendered on-demand from the SAME stored lead + BI + cached brand the send uses, so
// preview == sent (WYSIWYS). Behind the app's auth like every other lead-scoped route.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) return new Response("Not found", { status: 404 });
  const bi = await getBusinessIntelligence(lead.id);
  const profile = (bi?.profile?.businessProfile as BusinessProfile | undefined) ?? null;
  const brand = await resolveLeadBrand(lead); // resolves + caches once; deterministic thereafter
  const review = buildQuickReview(lead, profile, brand);
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const buffer = await renderQuickReviewPdf(review, dateStr);
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${quickReviewFilename(lead.businessName)}"`,
    },
  });
}
