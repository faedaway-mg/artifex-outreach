/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output for a small, self-contained Docker image on Railway.
  output: "standalone",
  experimental: {
    instrumentationHook: true,
    // @react-pdf/renderer ships its own font/canvas helpers; keep it external on the server.
    serverComponentsExternalPackages: ["@react-pdf/renderer", "postgres"],
  },
};

export default nextConfig;
