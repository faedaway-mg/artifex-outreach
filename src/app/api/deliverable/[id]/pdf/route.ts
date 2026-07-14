import { NextRequest } from "next/server";
import { getDeliverable, getLead, getSettings, updateDeliverable } from "@/lib/repo";
import { renderBriefPdf } from "@/lib/pdf/render";
import { uploadPdf, storageProvider } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const deliverable = await getDeliverable(params.id);
  if (!deliverable) return new Response("Not found", { status: 404 });
  const lead = await getLead(deliverable.leadId);
  if (!lead) return new Response("Lead not found", { status: 404 });
  const settings = await getSettings();

  const buffer = await renderBriefPdf(lead, deliverable, settings);

  // Persist to durable object storage once, when approved and storage is configured.
  if (deliverable.status !== "draft" && !deliverable.pdfKey && storageProvider() === "s3") {
    try {
      const stored = await uploadPdf(lead.id, deliverable.id, buffer);
      await updateDeliverable(deliverable.id, { pdfKey: stored.key, pdfUrl: stored.url });
    } catch {
      /* non-fatal — PDF is still served on-demand */
    }
  }

  const download = req.nextUrl.searchParams.get("download") === "1";
  const filename = `Artifex-Brief-${lead.normalizedName || "lead"}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
    },
  });
}
