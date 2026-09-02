import type { Metadata } from "next";
import { resolvePublicShare } from "@/lib/outreach/prospect-package-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Never indexed — a recipient link is capability-by-signature, not a public page.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// PUBLIC recipient viewer (no operator login). Verifies the signed link, then plays the frozen package
// video streamed from /pv/<publicId>/video (Range-enabled). Does NOT expose Content Studio or any operator
// surface. A revoked / superseded / invalid link shows a neutral "not available" page.
export default async function ProspectVideoPage({ params, searchParams }: { params: { publicId: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const s = (k: string) => String(Array.isArray(searchParams[k]) ? (searchParams[k] as string[])[0] : (searchParams[k] ?? ""));
  const res = await resolvePublicShare({ publicId: params.publicId, packageId: s("p"), packageVersion: Number(s("v") || 0), keyVersion: Number(s("k") || 0), sig: s("s") });

  const qs = `p=${encodeURIComponent(s("p"))}&v=${encodeURIComponent(s("v"))}&k=${encodeURIComponent(s("k"))}&s=${encodeURIComponent(s("s"))}`;
  const videoUrl = `/pv/${encodeURIComponent(params.publicId)}/video?${qs}`;

  if (!res.ok) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0C1220", color: "#C7D0DE", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>This video is no longer available.</h1>
          <p style={{ marginTop: 8, fontSize: 14, color: "#8A96AC" }}>The link may have expired or been withdrawn. Please reply to the email you received for an updated link.</p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0C1220", color: "#EAF0F7", fontFamily: "Arial, Helvetica, sans-serif", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <p style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "#6E7B90", marginBottom: 10 }}>A short video review{res.businessName ? ` for ${res.businessName}` : ""}</p>
        <video
          src={videoUrl}
          controls
          playsInline
          preload="metadata"
          style={{ width: "100%", borderRadius: 14, border: "1px solid #26334a", background: "#000", aspectRatio: "9 / 16" }}
        />
        <p style={{ marginTop: 12, fontSize: 13, color: "#8A96AC" }}>Prepared by Artifex Labs. If this is useful, just reply to the email we sent you.</p>
      </div>
    </main>
  );
}
