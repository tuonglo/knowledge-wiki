import type { NextConfig } from "next";

// Where the Next.js SERVER reaches the backends (not the browser — it only ever sees /api and /ai).
// Local dev: localhost ports. Docker: service names (set as build args in apps/web/Dockerfile).
// Rewrites are fixed at build time, so the Docker image bakes these in.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
const AI_INTERNAL_URL = process.env.AI_INTERNAL_URL ?? "http://localhost:8000";

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

  // One origin for the browser: /api/* → Express API, /ai/* → FastAPI. Same-origin means
  // cookies just work and no CORS. Same shape as production behind a reverse proxy.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_INTERNAL_URL}/:path*` },
      { source: "/ai/:path*", destination: `${AI_INTERNAL_URL}/:path*` },
    ];
  },
};

export default nextConfig;
