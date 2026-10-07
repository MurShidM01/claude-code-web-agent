import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Preview hosts (and any future wildcard dev origin) must be able to load
  // /_next assets. Wildcard matching is supported by Next's CSRF origin check.
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev"],
  // Puter.js is a browser SDK. Keep it out of the server bundle.
  serverExternalPackages: ["@heyputer/puter.js"],
};

export default nextConfig;
