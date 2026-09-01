import { describe, it, expect, vi } from "vitest";
import { fetchMediaFile, shareOrDownloadFile } from "./media-share";

function fakeFile(name = "field-note-client-x.mp4") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "video/mp4" });
}

describe("fetchMediaFile", () => {
  it("fetches same-origin and returns a File; never returns the raw URL", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([9, 9, 9]), { status: 200, headers: { "content-type": "video/mp4" } })) as any;
    const f = await fetchMediaFile("/api/content-studio/download/client-x", "vid.mp4", "video/mp4", { fetch });
    expect(fetch).toHaveBeenCalledWith("/api/content-studio/download/client-x", { credentials: "same-origin" });
    expect(f).toBeInstanceOf(File);
    expect(f.name).toBe("vid.mp4");
  });
  it("throws on a non-OK response (failure state)", async () => {
    const fetch = vi.fn(async () => new Response("no", { status: 403 })) as any;
    await expect(fetchMediaFile("/x", "v.mp4", "video/mp4", { fetch })).rejects.toThrow(/403/);
  });
});

describe("shareOrDownloadFile — never navigates to the raw endpoint", () => {
  it("uses Web Share with a real File when the platform can share files", async () => {
    const share = vi.fn(async () => {});
    const triggerDownload = vi.fn();
    const createObjectURL = vi.fn(() => "blob:xyz");
    const r = await shareOrDownloadFile(fakeFile(), "vid.mp4", {
      navigator: { canShare: () => true, share },
      createObjectURL, revokeObjectURL: vi.fn(), triggerDownload,
    });
    expect(r.outcome).toBe("shared");
    expect(share).toHaveBeenCalledOnce();
    const arg: any = (share.mock.calls[0] as any[])[0];
    expect(arg.files[0]).toBeInstanceOf(File); // a real File, not a URL/string
    expect(triggerDownload).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("falls back to a BLOB download (never the raw media URL) and revokes the object URL", async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const downloads: Array<{ href: string; name: string }> = [];
    const timers: Array<() => void> = [];
    const r = await shareOrDownloadFile(fakeFile(), "vid.mp4", {
      navigator: {}, // no Web Share
      createObjectURL: (b) => { const u = "blob:" + created.length; created.push(u); return u; },
      revokeObjectURL: (u) => revoked.push(u),
      triggerDownload: (href, name) => downloads.push({ href, name }),
      setTimeout: (fn) => { timers.push(fn); },
      revokeAfterMs: 5000,
    });
    expect(r.outcome).toBe("downloaded");
    // the ONLY href handed to the DOM is a blob: url — NOT the /api/content-studio/... raw endpoint
    expect(downloads).toHaveLength(1);
    expect(downloads[0].href).toMatch(/^blob:/);
    expect(downloads[0].href).not.toMatch(/\/api\/content-studio\//);
    // revocation is scheduled and runs
    timers.forEach((fn) => fn());
    expect(revoked).toEqual(created);
  });

  it("reports cancellation when the user dismisses the share sheet (AbortError)", async () => {
    const share = vi.fn(async () => { const e: any = new Error("cancel"); e.name = "AbortError"; throw e; });
    const r = await shareOrDownloadFile(fakeFile(), "vid.mp4", {
      navigator: { canShare: () => true, share },
      createObjectURL: vi.fn(), revokeObjectURL: vi.fn(), triggerDownload: vi.fn(),
    });
    expect(r.outcome).toBe("cancelled");
  });

  it("does not offer Web Share when the platform cannot share files (→ download)", async () => {
    const triggerDownload = vi.fn();
    const r = await shareOrDownloadFile(fakeFile(), "vid.mp4", {
      navigator: { canShare: () => false, share: vi.fn() },
      createObjectURL: () => "blob:a", revokeObjectURL: vi.fn(), triggerDownload,
      setTimeout: () => {},
    });
    expect(r.outcome).toBe("downloaded");
    expect(triggerDownload).toHaveBeenCalledOnce();
  });
});
