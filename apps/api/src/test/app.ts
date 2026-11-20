import type { Express } from "express";
import { createApp } from "../app.js";
import type { TokenService } from "../auth/jwt.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createDocumentsRouter } from "../routes/documents.js";
import { createMeRouter } from "../routes/me.js";
import { createWorkspacesRouter } from "../routes/workspaces.js";

/** The real app with every protected router, wired to the test DB and test keys. */
export function createTestApp(prisma: PrismaClient, tokens: TokenService): Express {
  return createApp({
    webOrigin: "http://web.test",
    checks: {},
    routes: {
      "/me": createMeRouter({ prisma, tokens }),
      "/workspaces": createWorkspacesRouter({ prisma, tokens }),
      "/documents": createDocumentsRouter({ prisma, tokens }),
    },
  });
}

/** `Authorization` header value for acting as a user: `.set("Authorization", await as(id))`. */
export function bearerFor(tokens: TokenService) {
  return async (userId: string) => `Bearer ${await tokens.signAccessToken({ userId })}`;
}
