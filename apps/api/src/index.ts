import { PrismaPg } from "@prisma/adapter-pg";
import { Redis } from "ioredis";
import { createApp } from "./app.js";
import { createTokenService } from "./auth/jwt.js";
import { createGitHubProvider, createGoogleProvider, type OAuthProvider } from "./auth/providers.js";
import { createAuthRouter } from "./auth/routes.js";
import { env } from "./env.js";
import { PrismaClient } from "./generated/prisma/client.js";
import { createDocumentsRouter } from "./routes/documents.js";
import { createMeRouter } from "./routes/me.js";
import { createWorkspacesRouter } from "./routes/workspaces.js";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});
const redis = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });
const tokens = await createTokenService({
  privateKeyPem: env.JWT_PRIVATE_KEY,
  publicKeyPem: env.JWT_PUBLIC_KEY,
});

// Enable each login provider only if its credentials are configured.
const providers: OAuthProvider[] = [];
if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
  providers.push(
    createGitHubProvider({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      apiUrl: env.API_URL,
    }),
  );
}
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    createGoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      apiUrl: env.API_URL,
    }),
  );
}

const app = createApp({
  webOrigin: env.WEB_ORIGIN,
  checks: {
    postgres: () => prisma.$queryRaw`SELECT 1`,
    redis: () => redis.ping(),
  },
  routes: {
    "/auth": createAuthRouter({
      prisma,
      tokens,
      providers,
      webOrigin: env.WEB_ORIGIN,
      // `secure` cookies need HTTPS. Decide from the real URL, not NODE_ENV:
      // the Docker image runs NODE_ENV=production on plain http://localhost.
      secureCookies: env.API_URL.startsWith("https://"),
      // API_URL is the address the BROWSER uses, e.g. http://localhost:3000/api when the
      // web app proxies us under /api → cookies must be scoped to /api/auth.
      cookiePath: `${new URL(env.API_URL).pathname.replace(/\/$/, "")}/auth`,
    }),
    "/me": createMeRouter({ prisma, tokens }),
    "/workspaces": createWorkspacesRouter({ prisma, tokens }),
    "/documents": createDocumentsRouter({ prisma, tokens }),
  },
});

const server = app.listen(env.API_PORT, () => {
  const enabled = providers.map((p) => p.name).join(", ") || "none (set *_CLIENT_ID/SECRET)";
  console.log(`api listening on :${env.API_PORT} — login providers: ${enabled}`);
});

async function shutdown() {
  server.close();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
