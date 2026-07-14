import { NextRequest } from "next/server";

// Generates a calm SVG placeholder standing in for a captured website screenshot.
// Real screenshots (Playwright) would replace these storage URLs.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const w = Math.min(2000, Math.max(100, Number(searchParams.get("w") ?? 1280)));
  const h = Math.min(2000, Math.max(100, Number(searchParams.get("h") ?? 800)));
  const label = (searchParams.get("label") ?? "Screenshot").slice(0, 120);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0D0F13"/>
      <stop offset="1" stop-color="#171B21"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <rect x="0" y="0" width="${w}" height="52" fill="#0A0C0F"/>
  <circle cx="24" cy="26" r="5" fill="#2A2F39"/>
  <circle cx="42" cy="26" r="5" fill="#2A2F39"/>
  <circle cx="60" cy="26" r="5" fill="#2A2F39"/>
  <rect x="${w * 0.08}" y="${h * 0.22}" width="${w * 0.5}" height="20" rx="6" fill="#232833"/>
  <rect x="${w * 0.08}" y="${h * 0.30}" width="${w * 0.72}" height="12" rx="6" fill="#1A1E25"/>
  <rect x="${w * 0.08}" y="${h * 0.35}" width="${w * 0.66}" height="12" rx="6" fill="#1A1E25"/>
  <rect x="${w * 0.08}" y="${h * 0.46}" width="${w * 0.32}" height="40" rx="10" fill="#2C5AC4" opacity="0.55"/>
  <text x="${w / 2}" y="${h * 0.82}" font-family="ui-sans-serif, system-ui" font-size="${Math.max(13, w * 0.016)}" fill="#646B79" text-anchor="middle">${escapeXml(label)}</text>
</svg>`;

  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
  });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}
