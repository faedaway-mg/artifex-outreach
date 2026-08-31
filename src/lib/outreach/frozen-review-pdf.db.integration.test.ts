// ─────────────────────────────────────────────────────────────────────────────
// DB-backed persistence proof for the frozen Quick Review artifact (real Postgres). Gated on
// DATABASE_URL, so it SKIPS without a database. Proves the frozen bytes survive a fresh read
// (the "restart" property — bytes live durably in signed_artifact_blobs), that re-storing the
// same bytes is idempotent, and that an immutable version key refuses a different byte-sequence.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { storeFrozenReviewPdf, loadFrozenReviewPdf, frozenReviewPdfExists, frozenReviewPdfKey } from "./frozen-review-pdf";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const d = HAS_DB ? describe : describe.skip;

const b64 = (s: string) => Buffer.from(s).toString("base64");
const sha = (s: string) => createHash("sha256").update(Buffer.from(s)).digest("hex");

d("frozen-review-pdf — durable Postgres persistence", () => {
  it("stores bytes and reloads them byte-identically (survives a fresh read / restart)", async () => {
    const leadId = `lead-${randomUUID()}`;
    const bytes = `FROZEN-QR::${leadId}::${"y".repeat(128)}`;
    const stored = await storeFrozenReviewPdf(leadId, 1, b64(bytes));
    expect(stored).toBe(sha(bytes));
    expect(await frozenReviewPdfExists(leadId, 1)).toBe(true);

    // Fresh read (as after a restart) returns the exact same bytes + SHA.
    const reloaded = await loadFrozenReviewPdf(leadId, 1);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.sha256).toBe(stored);
    expect(reloaded!.byteSize).toBe(Buffer.from(bytes).byteLength);
    expect(Buffer.from(reloaded!.pdfBase64, "base64").toString()).toBe(bytes);
  });

  it("is idempotent for identical bytes and refuses a different byte-sequence under the same version key", async () => {
    const leadId = `lead-${randomUUID()}`;
    const bytes = `FROZEN-QR-IDEM::${leadId}`;
    const first = await storeFrozenReviewPdf(leadId, 1, b64(bytes));
    const again = await storeFrozenReviewPdf(leadId, 1, b64(bytes)); // idempotent no-op
    expect(again).toBe(first);
    // A DIFFERENT payload under the same immutable version key must fail closed.
    await expect(storeFrozenReviewPdf(leadId, 1, b64(bytes + "-TAMPERED"))).rejects.toThrow(/immutable|different SHA|collision/i);
    // Distinct versions coexist (reapproval-after-drift mints v2).
    const v2 = await storeFrozenReviewPdf(leadId, 2, b64(bytes + "-v2"));
    expect(v2).toBe(sha(bytes + "-v2"));
    expect(frozenReviewPdfKey(leadId, 2)).toBe(`quick-review-pdf:${leadId}:v2`);
  });
});
