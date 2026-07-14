import type { Config } from "tailwindcss";

// Brand tokens mirror the Artifex Labs marketing site so Outreach feels like the
// same family: dark charcoal foundation, soft off-white type, restrained blue/indigo
// accents, subtle amber highlights.
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
        ink: {
          950: "#08090B",
          900: "#0A0C0F",
          850: "#0D0F13",
          800: "#111419",
          700: "#171B21",
          600: "#1E232B",
          500: "#2A2F39",
        },
        chalk: {
          50: "#F7F8FA",
          100: "#EDEFF3",
          200: "#D7DBE2",
          300: "#B4BAC6",
          400: "#8A909E",
          500: "#646B79",
        },
        azure: {
          300: "#8FB6FF",
          400: "#5E93F7",
          500: "#3E75E6",
          600: "#2C5AC4",
        },
        indigo: {
          300: "#A6A8FF",
          400: "#8688F0",
          500: "#6D6FE0",
          600: "#5457C4",
        },
        amber: {
          300: "#FBD38D",
          400: "#F5B95C",
          500: "#E89B3B",
        },
        // Semantic tiers
        tierA: "#F5B95C",
        tierB: "#8688F0",
        tierC: "#646B79",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      maxWidth: {
        container: "1240px",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 24px 48px -28px rgba(0,0,0,0.8)",
        lift: "0 30px 70px -30px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)",
        "radial-hero":
          "radial-gradient(1000px 500px at 20% -10%, rgba(62,117,230,0.12), transparent 60%)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.16,1,0.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
