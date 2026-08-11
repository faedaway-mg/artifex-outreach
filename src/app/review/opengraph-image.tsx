import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Business Technology Review — Artifex Labs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The social/link-preview card for /review. Reuses the canonical constellation mark and the
// Quiet Horizon palette (ink/chalk/azure) so the inbound front door looks like Artifex
// everywhere it's shared (LinkedIn, iMessage, X). Static — no PII, no prospect data.
export default function OgImage() {
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 32 32"><path d="M16 4 L27 27 M16 4 L5 27 M9.5 19 L22.5 19" fill="none" stroke="#F7F6F4" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="4" r="2.7" fill="#F7F6F4"/><circle cx="5" cy="27" r="2.5" fill="#F7F6F4"/><circle cx="27" cy="27" r="2.5" fill="#F5B95C"/></svg>`;
  const markUrl = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "linear-gradient(135deg, #06080C 0%, #0C1220 60%, #101a2e 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 68, height: 68, borderRadius: "50%", background: "#0B0A09", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={markUrl} width={44} height={44} alt="" />
          </div>
          <div style={{ color: "#93B8FF", fontSize: 26, letterSpacing: 4, fontWeight: 600 }}>ARTIFEX LABS</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ color: "#F6F8FC", fontSize: 68, fontWeight: 700, lineHeight: 1.05, maxWidth: 900 }}>Let us look at your business.</div>
          <div style={{ color: "#AEBBD0", fontSize: 30, maxWidth: 860 }}>A Business Technology Review — the specific places technology would remove real friction. One page. No cost.</div>
        </div>
        <div style={{ color: "#7FE3C7", fontSize: 26, fontWeight: 600 }}>Request yours → outreach.artifexlabs.tech/review</div>
      </div>
    ),
    size,
  );
}
