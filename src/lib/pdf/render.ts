import { renderToBuffer } from "@react-pdf/renderer";
import { BriefDocument } from "./BriefDocument";
import type { Lead, Deliverable, Settings } from "@/lib/types";

/** Render a Modernization Brief / Quick Snapshot to a PDF Buffer (Node runtime). */
export async function renderBriefPdf(lead: Lead, deliverable: Deliverable, settings: Settings): Promise<Buffer> {
  return renderToBuffer(BriefDocument({ lead, deliverable, settings }) as any);
}
