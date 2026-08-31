// ─────────────────────────────────────────────────────────────────────────────
// COMPILE-TIME + RUNTIME bypass guard proof. The cold assembler (buildColdDispatchFromEmail) accepts
// ONLY a branded FrozenAttachment, which can be minted solely by toFrozenAttachment() from resolved
// frozen bytes. This file FAILS TYPECHECK if a future caller could pass arbitrary bytes (the negative
// type-assertion directive below would become unused), so the guard is enforced by tsc + the suite.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildColdDispatchFromEmail, toFrozenAttachment } from "./outreach-transport";

describe("frozen-attachment bypass guard", () => {
  it("COMPILE-TIME: arbitrary/un-frozen attachment bytes are rejected at the assembler boundary", () => {
    const args = {
      leadId: "L", recipient: "a@b.co", subject: "s", bodyText: "t", bodyHtml: "<p>t</p>",
      classification: "COLD_OUTREACH" as any, idempotencyKey: "k",
      pdf: { base64: "AAAA", filename: "x.pdf" }, // NOT a FrozenAttachment (no brand, no verified SHA)
    };
    // @ts-expect-error — args.pdf is not a FrozenAttachment; only toFrozenAttachment can produce one.
    const build = () => buildColdDispatchFromEmail(args);
    expect(typeof build).toBe("function"); // never invoked; the proof is that the line above must error
  });

  it("RUNTIME: toFrozenAttachment refuses bytes that do not hash to the claimed frozen SHA", () => {
    expect(() => toFrozenAttachment({ pdfBase64: Buffer.from("real bytes").toString("base64"), filename: "x.pdf", sha256: "0".repeat(64) })).toThrow(/integrity/i);
    // The only valid path: bytes whose SHA matches — mints a usable branded attachment.
    const bytes = Buffer.from("frozen bytes");
    const ok = toFrozenAttachment({ pdfBase64: bytes.toString("base64"), filename: "x.pdf", sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(ok.filename).toBe("x.pdf");
  });
});
