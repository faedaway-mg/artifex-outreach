import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-static";

// Hosted avatar for Jordan's email signature. This is a tasteful PLACEHOLDER (a warm
// neutral disc, no fabricated face) so the signature renders with an avatar today.
// Replace it with Jordan's real headshot: host the photo and point the signature's
// headshot URL at it, or swap this route's output. 128px, cache-immutable.
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "linear-gradient(145deg, #2A2620 0%, #14110C 70%)",
        }}
      >
        {/* a single warm constellation node — a quiet placeholder, not a face */}
        <div style={{ width: 26, height: 26, borderRadius: 26, background: "#E8A24A", display: "flex" }} />
      </div>
    ),
    { width: 128, height: 128, headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
  );
}
