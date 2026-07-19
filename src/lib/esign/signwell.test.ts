import { describe, it, expect, afterEach } from "vitest";
import { getEsignProvider, resetEsignProvider } from "./provider";

afterEach(() => {
  delete process.env.SIGNWELL_API_KEY;
  resetEsignProvider();
});

describe("SignWell provider (disabled-by-default)", () => {
  it("returns the disabled no-op when no key is set, and cannot send", async () => {
    resetEsignProvider();
    const p = getEsignProvider();
    expect(p.name).toBe("disabled");
    expect(p.canSend).toBe(false);
    const res = await p.createSignatureRequest({
      agreementId: "a", agreementNumber: "AL-A-2026-001", pdfBase64: "", subject: "s", message: "m",
      signer: { name: "Dana", email: "dana@x.example" }, testMode: false,
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("disabled");
  });

  it("returns the live provider (name=signwell, canSend) when a key is present", () => {
    process.env.SIGNWELL_API_KEY = "sk_test_x";
    resetEsignProvider();
    const p = getEsignProvider();
    expect(p.name).toBe("signwell");
    expect(p.canSend).toBe(true);
    expect(p.meta.mode).toBe("live");
  });
});
