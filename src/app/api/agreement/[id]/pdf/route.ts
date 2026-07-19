import { NextRequest } from "next/server";
import { getAgreement, updateAgreement } from "@/lib/repo";
import { renderAgreementPdf } from "@/lib/pdf/render-agreement";
import { uploadAgreementPdf, storageProvider } from "@/lib/storage";
import { agreementSendingEnabled } from "@/lib/esign/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Authenticated by the global middleware (this is under /api, not an allowlisted
// path). Regenerates the agreement PDF on demand from its immutable snapshot; in
// S3 mode it persists once past the draft stage. The legal-review banner is shown
// whenever production sending is disabled.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const agreement = await getAgreement(params.id);
  if (!agreement) return new Response("Not found", { status: 404 });

  const showDraftMarking = !agreementSendingEnabled();
  const buffer = await renderAgreementPdf(agreement, showDraftMarking);

  if (agreement.status !== "draft" && agreement.status !== "generated" && !agreement.pdfKey && storageProvider() === "s3") {
    try {
      const stored = await uploadAgreementPdf(agreement.leadId, agreement.id, buffer);
      await updateAgreement(agreement.id, { pdfKey: stored.key, pdfUrl: stored.url });
    } catch {
      /* non-fatal — served on-demand */
    }
  }

  const download = req.nextUrl.searchParams.get("download") === "1";
  const filename = `Artifex-Agreement-${agreement.agreementNumber}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
    },
  });
}
