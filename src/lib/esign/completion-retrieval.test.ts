import { describe, it, expect } from "vitest";
import { SignwellCompletionFetcher, RetrievalError } from "./completion-retrieval";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"

function mockFetch(handlers: Record<string, () => Response>) {
  return async (url: string | URL | Request) => {
    const u = String(url);
    for (const [frag, h] of Object.entries(handlers)) if (u.includes(frag)) return h();
    return new Response("not found", { status: 404 });
  };
}
const jsonRes = (obj: any) => new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
const pdfRes = (bytes: Uint8Array) => new Response(bytes as any, { status: 200, headers: { "content-type": "application/pdf" } });

describe("SignwellCompletionFetcher (Gate 8)", () => {
  it("fetches the completed PDF for signed_pdf and audit-page variant for the certificate", async () => {
    const f = new SignwellCompletionFetcher({
      apiKey: "sk", fetchImpl: mockFetch({
        "completed_pdf/?url_only=true&audit_page=true": () => jsonRes({ file_url: "https://x/audit.pdf?audit_page=true" }),
        "completed_pdf/?url_only=true": () => jsonRes({ file_url: "https://x/signed.pdf" }),
        "signed.pdf": () => pdfRes(PDF),
        "audit.pdf": () => pdfRes(PDF),
      }) as any,
    });
    const signed = await f.fetch("doc_1", "signed_pdf");
    expect(signed.bytes.length).toBe(PDF.length);
    const cert = await f.fetch("doc_1", "audit_certificate");
    expect(cert.bytes.length).toBe(PDF.length);
    expect(f.auditPageIncluded).toBe(true);
  });

  it("rejects a non-PDF and an empty document (no false retention)", async () => {
    const bad = new SignwellCompletionFetcher({ apiKey: "sk", fetchImpl: mockFetch({ "completed_pdf": () => jsonRes({ file_url: "https://x/x.pdf" }), "x.pdf": () => new Response(new Uint8Array([1, 2, 3]) as any, { status: 200 }) }) as any });
    await expect(bad.fetch("d", "signed_pdf")).rejects.toBeInstanceOf(RetrievalError);
    const empty = new SignwellCompletionFetcher({ apiKey: "sk", fetchImpl: mockFetch({ "completed_pdf": () => jsonRes({ file_url: "https://x/e.pdf" }), "e.pdf": () => new Response(new Uint8Array([]) as any, { status: 200 }) }) as any });
    await expect(empty.fetch("d", "signed_pdf")).rejects.toBeInstanceOf(RetrievalError);
  });

  it("does not retry on auth failure and refuses without a key", async () => {
    let calls = 0;
    const authFail = new SignwellCompletionFetcher({ apiKey: "sk", maxRetries: 3, fetchImpl: (async () => { calls++; return new Response("no", { status: 401 }); }) as any });
    await expect(authFail.fetch("d", "signed_pdf")).rejects.toMatchObject({ code: "auth" });
    expect(calls).toBe(1);
    const noKey = new SignwellCompletionFetcher({ apiKey: "", fetchImpl: (async () => new Response("", { status: 200 })) as any });
    await expect(noKey.fetch("d", "signed_pdf")).rejects.toMatchObject({ code: "auth" });
  });
});
