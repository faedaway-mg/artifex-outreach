/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output for a small, self-contained Docker image on Railway.
  output: "standalone",
  // The in-`next build` type-check runs `tsc` over the whole project and OOMs on the constrained Alpine
  // builder as the codebase grows (it dies silently right after "Compiled successfully"). Type-checking and
  // linting are ALREADY enforced elsewhere — `tsc --noEmit`, `next lint`, and the full vitest suite all run
  // before every deploy — so skipping the redundant in-image pass loses no safety and keeps prod builds
  // reliable. (Belt-and-suspenders: the Dockerfile also raises the Node heap.)
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    instrumentationHook: true,
    // @react-pdf/renderer ships its own font/canvas helpers; keep it external on the server.
    serverComponentsExternalPackages: ["@react-pdf/renderer", "postgres"],
  },
};

export default nextConfig;
