import { NextRequest } from "next/server";
import { getLead, getBusinessIntelligence } from "@/lib/repo";
import { renderQuickReviewPdf } from "@/lib/pdf/render";
import { buildQuickReview, resolveLeadBrand, quickReviewFilename } from "@/lib/outreach/quick-review";
import { quickReviewApproved } from "@/lib/outreach/review-approval";
import { contentDisposition } from "@/lib/http";
import type { BusinessProfile } from "@/lib/business-intelligence/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator preview of the exact one-page Artifex Quick Review the send attaches. Rendered
// on-demand from the SAME stored lead + BI + cached brand (WYSIWYS). Behind app auth like
// every lead-scoped route. Failures return a CONTROLLED text response — never a blank PDF.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  try {
    const lead = await getLead(params.id);
    if (!lead) return text("Not found", 404);
    const bi = await getBusinessIntelligence(lead.id);
    const profile = (bi?.profile?.businessProfile as BusinessProfile | undefined) ?? null;
    const brand = await resolveLeadBrand(lead); // resolves + caches once; deterministic thereafter
    const approved = await quickReviewApproved(lead.id);
    const review = buildQuickReview(lead, profile, brand, { approved, observedAt: bi?.generatedAt ?? null });
    // Preview is allowed for SENDABLE and NEEDS_REVIEW (so the operator can inspect before approving);
    // only INSUFFICIENT_EVIDENCE (nothing credible to show) is blocked. Attachment/send is gated on
    // approval elsewhere — previewing never sends.
    if (review.status === "INSUFFICIENT_EVIDENCE") return text("Review needs attention — no credible findings yet.", 409);

    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const buffer = await renderQuickReviewPdf(review, dateStr);
    const download = req.nextUrl.searchParams.get("download") === "1";
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        // The filename contains an em dash (U+2014); a raw HTTP header value must be Latin1,
        // so encode per RFC 5987 (ASCII fallback + UTF-8 filename*). A raw non-ASCII filename
        // makes `new Response` throw a ByteString error → a blank 500. This is that fix.
        "Content-Disposition": contentDisposition(quickReviewFilename(lead.businessName), download ? "attachment" : "inline"),
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return text("Could not render the review right now — please try again.", 503);
  }
}
