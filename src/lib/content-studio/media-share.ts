// Content Studio — mobile share/download core (section I addendum). The original defect: "Download"
// navigated the browser to the raw media endpoint, which mobile Safari opened as a page the owner could
// not exit. The fix: NEVER navigate to the raw endpoint. Fetch the authenticated media as a Blob, then
// either hand a real File to the Web Share sheet (Content Studio stays mounted underneath) or trigger a
// download from a Blob object URL — and always revoke the object URL. This module is pure + dependency-
// injected so the behaviour (crucially: no window.location, no raw-URL open) is unit-testable.

export type ShareOutcome = "shared" | "downloaded" | "cancelled";

export interface FetchDeps {
  fetch: typeof fetch;
  onProgress?: (pct: number) => void; // 0..100 when a content-length is available
}

// Fetch the authenticated media (same-origin cookie) into a File. Throws on a non-OK response so the caller
// can show a failure state. Streams for progress when the server sends a content-length.
export async function fetchMediaFile(url: string, filename: string, mimeType: string, deps: FetchDeps): Promise<File> {
  const res = await deps.fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Could not fetch media (${res.status})`);
  const total = Number(res.headers.get("content-length") || 0);
  if (deps.onProgress && total > 0 && res.body && (res.body as any).getReader) {
    const reader = (res.body as any).getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      deps.onProgress(Math.min(100, Math.round((got / total) * 100)));
    }
    return new File([new Blob(chunks as BlobPart[], { type: mimeType })], filename, { type: mimeType });
  }
  const blob = await res.blob();
  deps.onProgress?.(100);
  return new File([blob], filename, { type: mimeType });
}

export interface ShareDeps {
  navigator: { canShare?: (d: any) => boolean; share?: (d: any) => Promise<void> };
  createObjectURL: (b: Blob) => string;
  revokeObjectURL: (u: string) => void;
  // Injected DOM download trigger (creates a transient <a download>, clicks it). Given the BLOB url — never
  // the raw endpoint. Returns the href it used so tests can assert it is a blob: url, not the media route.
  triggerDownload: (href: string, filename: string) => void;
  // How long to wait before revoking the object URL (so the browser finishes the download). Injectable.
  revokeAfterMs?: number;
  setTimeout?: (fn: () => void, ms: number) => void;
}

// Share the File via the Web Share API when the platform can share files; otherwise download it from a Blob
// object URL. Always ends by scheduling revocation of any object URL it created. NEVER touches window.location
// and never opens the raw media URL.
export async function shareOrDownloadFile(file: File, filename: string, deps: ShareDeps): Promise<{ outcome: ShareOutcome; objectUrl: string | null }> {
  const nav = deps.navigator;
  if (nav && nav.canShare && nav.share && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return { outcome: "shared", objectUrl: null };
    } catch (e: any) {
      if (e && (e.name === "AbortError" || e.code === 20)) return { outcome: "cancelled", objectUrl: null };
      throw e;
    }
  }
  // Fallback: reliable download from a blob URL (not the raw endpoint), then revoke.
  const objectUrl = deps.createObjectURL(file);
  deps.triggerDownload(objectUrl, filename);
  const schedule = deps.setTimeout || ((fn: () => void, ms: number) => setTimeout(fn, ms));
  schedule(() => deps.revokeObjectURL(objectUrl), deps.revokeAfterMs ?? 10_000);
  return { outcome: "downloaded", objectUrl };
}
