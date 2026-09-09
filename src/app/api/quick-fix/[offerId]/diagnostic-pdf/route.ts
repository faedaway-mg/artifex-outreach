import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";
import { buildEvidencePackage } from "@/lib/quick-fix/evidence-package";
import { renderDiagnosticPdf } from "@/lib/quick-fix/diagnostic-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PER-OFFER DIAGNOSTIC PDF (application/pdf). Rendered on demand, deterministically,
// from the SAME canonical evidence package the offer page and operator view read.
//
// ACCESS (mirrors how the deliverable/offer surfaces gate):
//   • The OPERATOR (authenticated session) may preview any offer's diagnostic PDF.
//   • A CUSTOMER may fetch it only inside the offer's OWN share context — i.e. the
//     URL segment is the offer's unguessable, revocable share token AND the offer is
//     approved. A raw offerId is NOT a public accessor here (that would expose an
//     arbitrary offer), so unauthenticated raw-offerId requests are refused.
//
// Renders no fabricated claim (the builder drops any finding that would), performs
// NO sends, NO charges, NO writes.
export async function GET(_req: NextRequest, { params }: { params: { offerId: string } }) {
  const seg = params.offerId;
  const operator = isAuthenticated();

  // Resolve the offer (share token OR raw offerId). Distinguish share-token access
  // so a customer link only ever reaches its own approved offer.
  const byToken = await store.getOfferByShareToken(seg);
  const offer = byToken ?? (await store.getOffer(seg));
  if (!offer) return new Response("Not found", { status: 404 });

  if (!operator) {
    // Customer path: must be the offer's own (unrevoked) share token AND approved.
    const viaShareToken = !!byToken && !byToken.shareRevoked;
    const approved = offer.approvalStatus === "approved";
    if (!viaShareToken || !approved) {
      return new Response("Not found", { status: 404 });
    }
  }

  // Build the canonical evidence package (read-only) and render on demand.
  const pkg = await buildEvidencePackage(offer);
  if (pkg.findings.length === 0) {
    // Nothing evidence-backed to present — never emit an empty/fabricated document.
    return new Response("No diagnostic evidence for this offer yet.", { status: 404 });
  }

  const buffer = await renderDiagnosticPdf(offer, pkg, offer.shareToken ?? null);

  const download = _req.nextUrl.searchParams.get("download") === "1";
  const filename = `Artifex-Diagnostic-${(offer.companyName || "offer").replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
