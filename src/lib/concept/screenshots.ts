// ─────────────────────────────────────────────────────────────────────────────
// Concept preview screenshots. Deterministic desktop/mobile/tablet captures come
// from a dedicated headless-browser worker (never run inside the web service).
//
//   • SCREENSHOT_WORKER_URL set → POST the rendered HTML + viewports; the worker
//     renders, screenshots, stores via the S3/R2 bucket, and returns stable paths.
//   • Not set → returns null paths. The live /share/previews page is the primary
//     output and always works; screenshots are a secondary export.
//
// Required to finish permanence: SCREENSHOT_WORKER_URL (+ SCREENSHOT_WORKER_TOKEN)
// and the storage vars (STORAGE_PROVIDER=s3 + S3_*). See docs/DEPLOYMENT.md.
// ─────────────────────────────────────────────────────────────────────────────
export interface ConceptShots {
  desktop: string | null;
  mobile: string | null;
  tablet: string | null;
}

export async function captureConceptScreenshots(previewId: string, versionNumber: number, html: string): Promise<ConceptShots> {
  const worker = process.env.SCREENSHOT_WORKER_URL;
  if (!worker) return { desktop: null, mobile: null, tablet: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${worker.replace(/\/$/, "")}/capture-concept`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SCREENSHOT_WORKER_TOKEN ?? ""}` },
      body: JSON.stringify({ previewId, versionNumber, html, viewports: ["desktop", "mobile", "tablet"] }),
    });
    if (!res.ok) throw new Error(`worker ${res.status}`);
    const data = (await res.json()) as ConceptShots;
    return { desktop: data.desktop ?? null, mobile: data.mobile ?? null, tablet: data.tablet ?? null };
  } catch {
    return { desktop: null, mobile: null, tablet: null };
  } finally {
    clearTimeout(timer);
  }
}
