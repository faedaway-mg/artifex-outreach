import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";
import { latestReadyShot, readScreenshotJob, type Viewport } from "@/lib/content-studio/screenshot-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bin = (b: Buffer): BodyInit => b as unknown as BodyInit;

// A clean, legible fallback tile (NEVER a browser broken-image icon) when no capture is ready yet. Plain
// SVG — no vignette, no fake screenshot — so the operator UI always renders something honest.
function fallback(label: string): NextResponse {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960" viewBox="0 0 540 960">
  <rect width="540" height="960" fill="#0e1524"/>
  <rect x="24" y="24" width="492" height="912" rx="18" fill="none" stroke="#23324c" stroke-width="2"/>
  <text x="270" y="470" fill="#7f8ba3" font-family="Inter,system-ui,sans-serif" font-size="26" text-anchor="middle">${label}</text>
  <text x="270" y="508" fill="#4c5straße" font-family="Inter,system-ui,sans-serif" font-size="18" text-anchor="middle" fill-opacity="0.7">Capturing the live site…</text>
</svg>`.replace("#4c5straße", "#4c5a72");
  return new NextResponse(svg, { status: 200, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store" } });
}

// GET ?business=<leadId>&viewport=mobile|desktop  OR  ?job=<id>  → the captured PNG (authenticated). The
// ETag is the image SHA-256, so when a re-capture changes the page the browser's cache is invalidated.
export async function GET(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const jobId = req.nextUrl.searchParams.get("job");
  const business = req.nextUrl.searchParams.get("business");
  const viewport: Viewport = req.nextUrl.searchParams.get("viewport") === "desktop" ? "desktop" : "mobile";

  const job = jobId ? await readScreenshotJob(jobId) : business ? await latestReadyShot(business, viewport) : null;
  if (!job || job.status !== "ready" || !job.outputKey) return fallback("Screenshot pending");

  const store = getArtifactStore();
  const meta = await store.getMeta(job.outputKey);
  if (!meta) return fallback("Screenshot pending");
  const full = await store.readFull(job.outputKey);
  if (!full) return fallback("Screenshot pending");

  const etag = `"${meta.sha256}"`;
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  return new NextResponse(bin(full), {
    status: 200,
    headers: {
      "Content-Type": meta.contentType || "image/png",
      "Content-Length": String(meta.size),
      "Cache-Control": "private, max-age=60, must-revalidate",
      ETag: etag,
      "X-Robots-Tag": "noindex",
    },
  });
}
