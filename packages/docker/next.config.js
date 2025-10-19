const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@queuedash/api", "@queuedash/ui"],
  webpack: (config) => {
    config.node = {
      ...config.node,
      __dirname: true,
    };
    return config;
  },
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

module.exports = nextConfig;
