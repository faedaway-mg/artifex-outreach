import type { MetadataRoute } from "next";

// PWA manifest — so "Add to Home Screen" installs a branded Artifex Labs app,
// not a generic web shortcut. Mobile-first identity.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Artifex Labs",
    short_name: "Artifex",
    description: "A relationship operating system for thoughtful business conversations.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0A09",
    theme_color: "#0B0A09",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
