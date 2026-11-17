import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal self-contained server bundle for the Docker image.
  output: "standalone",
  // @kw/shared ships TypeScript source.
  transpilePackages: ["@kw/shared"],
  cacheComponents: true,
  partialPrefetching: true,
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
