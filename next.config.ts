import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen depends on the employee session. Cache Components would
  // freeze or reject those per-request reads, so the dashboard stays dynamic.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
