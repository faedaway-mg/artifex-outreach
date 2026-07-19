import { renderToBuffer } from "@react-pdf/renderer";
import { AgreementDocument } from "./AgreementDocument";
import type { Agreement } from "@/lib/types";

// Same Helvetica (WinAnsi) glyph constraint as the brief renderer: strip symbols
// the standard PDF font cannot draw so nothing renders as a broken box.
function sanitizeText(str: string): string {
  return str
    .replace(/(\d(?:\.\d+)?)\s*[★⭐✦✪]/g, "$1 / 5")
    .replace(/[★☆⭐✦✪✔✓➔➜]/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

function deepSanitize<T>(value: T): T {
  if (typeof value === "string") return sanitizeText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepSanitize(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepSanitize(v);
    return out as T;
  }
  return value;
}

/**
 * Render a client agreement to a PDF Buffer (Node runtime). `showDraftMarking`
 * prints the legal-review banner — the caller passes !agreementSendingEnabled().
 */
export async function renderAgreementPdf(agreement: Agreement, showDraftMarking: boolean): Promise<Buffer> {
  const safe = deepSanitize(agreement);
  return renderToBuffer(AgreementDocument({ agreement: safe, showDraftMarking }) as any);
}
