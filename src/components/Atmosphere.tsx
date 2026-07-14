// Abstract "Quiet Horizon" atmosphere — fixed, behind all content, non-interactive.
// Soft distant silhouettes + topographic contours at very low opacity. Pure SVG,
// no paid assets. The gentle drift respects prefers-reduced-motion (see globals).
export function Atmosphere() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* faint routing / topographic grid, upper region */}
      <svg className="absolute inset-x-0 top-0 h-[52vh] w-full opacity-[0.5]" preserveAspectRatio="none" viewBox="0 0 1440 600">
        <defs>
          <linearGradient id="topo" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5E93F7" stopOpacity="0.12" />
            <stop offset="1" stopColor="#5E93F7" stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: 7 }).map((_, i) => (
          <path
            key={i}
            d={`M-40 ${80 + i * 62} C 320 ${40 + i * 62}, 620 ${150 + i * 62}, 900 ${90 + i * 62} S 1480 ${60 + i * 62}, 1520 ${110 + i * 62}`}
            fill="none"
            stroke="url(#topo)"
            strokeWidth="1"
          />
        ))}
      </svg>

      {/* distant horizon silhouettes, lower region, drifting slowly */}
      <svg className="absolute bottom-0 left-0 h-[46vh] w-full animate-drift-slow opacity-[0.7]" preserveAspectRatio="none" viewBox="0 0 1440 480">
        <defs>
          <linearGradient id="ridgeA" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#18202F" stopOpacity="0.55" />
            <stop offset="1" stopColor="#0B0F16" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ridgeB" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#212B3D" stopOpacity="0.4" />
            <stop offset="1" stopColor="#0B0F16" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="dawn" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6D6FE0" stopOpacity="0.06" />
            <stop offset="0.6" stopColor="#5E93F7" stopOpacity="0.05" />
            <stop offset="1" stopColor="#E89B3B" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <rect x="0" y="150" width="1440" height="330" fill="url(#dawn)" />
        <path d="M0 300 C 240 250, 420 330, 700 290 S 1180 250, 1440 300 L1440 480 L0 480 Z" fill="url(#ridgeB)" />
        <path d="M0 360 C 300 320, 560 400, 860 356 S 1260 330, 1440 372 L1440 480 L0 480 Z" fill="url(#ridgeA)" />
      </svg>

      {/* very soft top vignette to seat content */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,transparent_55%,rgba(4,6,10,0.5)_100%)]" />
    </div>
  );
}
