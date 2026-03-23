import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@queuedash/api", "@queuedash/ui"],
  serverExternalPackages: ["bee-queue", "bullmq", "bull"],
};

export default nextConfig;
