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
};

module.exports = nextConfig;
