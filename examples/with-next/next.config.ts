import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Loaded by Node instead of bundled. Queuedash imports each queue library
  // only when a queue of that type needs it, and Bull forks child processes
  // from its own files, which Turbopack can't bundle.
  serverExternalPackages: ["@queuedash/api", "bull"],
};

export default nextConfig;
