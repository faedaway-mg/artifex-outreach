import type { Config } from "tailwindcss";

// ─────────────────────────────────────────────────────────────────────────────
// Artifex Outreach — "Quiet Horizon" design tokens.
// Deep charcoal-navy depth, refined glass, restrained azure/indigo/amber with
// teal (success) and coral (destructive) semantics. Calm, premium, editorial.
// ─────────────────────────────────────────────────────────────────────────────
const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces — charcoal with a navy undertone
        ink: {
          975: "#06080C",
          950: "#080B11",
          900: "#0B0F16",
          850: "#0E131B",
          800: "#121826",
          700: "#18202F",
          600: "#212B3D",
          500: "#2C384D",
        },
        // Soft off-white → cool slate typography ladder
        chalk: {
          50: "#F6F8FC",
          100: "#E9EDF5",
          200: "#D2D9E6",
          300: "#AEB8CB",
          400: "#8590A6",
          500: "#616C82",
          600: "#434E63",
        },
        azure: { 300: "#93B8FF", 400: "#5E93F7", 500: "#3E75E6", 600: "#2C5AC4" },
        indigo: { 300: "#AEB0FF", 400: "#8B8DF4", 500: "#6D6FE0", 600: "#5457C4" },
        amber: { 300: "#FBD79A", 400: "#F5BC63", 500: "#E89B3B" },
        teal: { 300: "#7FE3C7", 400: "#42C9A6", 500: "#2AA98A" },
        coral: { 300: "#FFB3A7", 400: "#F58E7C", 500: "#E56A55" },
        tierA: "#F5BC63",
        tierB: "#8B8DF4",
        tierC: "#616C82",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "metric-lg": ["2.6rem", { lineHeight: "1.0", letterSpacing: "-0.03em" }],
        metric: ["2rem", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
      },
      maxWidth: { container: "1320px" },
      borderRadius: { "4xl": "1.75rem", "5xl": "2.25rem" },
      boxShadow: {
        // Glass material depth levels
        "glass-1": "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -14px rgba(0,0,0,0.7)",
        "glass-2": "0 1px 0 0 rgba(255,255,255,0.05) inset, 0 20px 48px -26px rgba(0,0,0,0.85)",
        "glass-3":
          "0 1px 0 0 rgba(255,255,255,0.08) inset, 0 30px 70px -30px rgba(0,0,0,0.9), 0 0 0 1px rgba(94,147,247,0.10)",
        lift: "0 30px 80px -32px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06)",
        "glow-azure": "0 10px 30px -12px rgba(62,117,230,0.55)",
        "glow-amber": "0 10px 30px -12px rgba(232,155,59,0.4)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(255,255,255,0.022) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.022) 1px, transparent 1px)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: { "0%": { backgroundPosition: "200% 0" }, "100%": { backgroundPosition: "-200% 0" } },
        "drift-slow": {
          "0%,100%": { transform: "translate3d(0,0,0)" },
          "50%": { transform: "translate3d(0,-1.5%,0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.55s cubic-bezier(0.16,1,0.3,1) both",
        "fade-in": "fade-in 0.5s ease both",
        "scale-in": "scale-in 0.32s cubic-bezier(0.16,1,0.3,1) both",
        shimmer: "shimmer 2.5s linear infinite",
        "drift-slow": "drift-slow 24s ease-in-out infinite",
      },
      transitionTimingFunction: { premium: "cubic-bezier(0.16, 1, 0.3, 1)" },
    },
  },
  plugins: [],
};

export default config;
