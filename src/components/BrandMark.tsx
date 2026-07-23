// The single Artifex Labs brand mark — the constellation "A" (matches the favicon at
// src/app/icon.svg). One mark, used everywhere (login, sidebar, mobile bar, drawer,
// home-screen icon) so the product reads as one coherent identity. `size` is the tile
// edge in px; the glyph scales with it.
export function BrandMark({ size = 36, className = "", rounded = "rounded-xl" }: { size?: number; className?: string; rounded?: string }) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center ${rounded} ${className}`}
      style={{ width: size, height: size, background: "#0B0A09" }}
      aria-hidden
    >
      <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 32 32" fill="none">
        <path d="M16 4 L27 27 M16 4 L5 27 M9.5 19 L22.5 19" fill="none" stroke="#F7F6F4" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="4" r="2.7" fill="#F7F6F4" />
        <circle cx="5" cy="27" r="2.5" fill="#F7F6F4" />
        <circle cx="27" cy="27" r="2.5" fill="#F5B95C" />
      </svg>
    </span>
  );
}
