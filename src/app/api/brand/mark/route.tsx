import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-static";

// The official Artifex Labs constellation mark, rasterized to a PNG so it renders in
// email clients that block SVG (Gmail, Outlook). This is the PRIMARY brand mark for
// email; the CSS box in email-render.ts is only the graceful fallback. Cache-immutable.
export async function GET() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 32 32"><path d="M16 4 L27 27 M16 4 L5 27 M9.5 19 L22.5 19" fill="none" stroke="#F7F6F4" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="4" r="2.7" fill="#F7F6F4"/><circle cx="5" cy="27" r="2.5" fill="#F7F6F4"/><circle cx="27" cy="27" r="2.5" fill="#F5B95C"/></svg>`;
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0B0A09" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} width={80} height={80} alt="Artifex Labs" />
      </div>
    ),
    { width: 120, height: 120, headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
  );
}
