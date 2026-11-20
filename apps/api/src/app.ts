import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express, type Router } from "express";
import helmet from "helmet";
import type { HealthResponse } from "@kw/shared";

/** A named dependency probe. Resolves if healthy, rejects otherwise. */
export type HealthCheck = () => Promise<unknown>;

export interface AppDeps {
  webOrigin: string;
  checks: Record<string, HealthCheck>;
  /** Mounted at /auth. Optional so health-only tests don't need a database. */
  authRouter?: Router;
}

export function createApp({ webOrigin, checks, authRouter }: AppDeps): Express {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: webOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  if (authRouter) app.use("/auth", authRouter);

  app.get("/health", async (_req, res) => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await check();
          return [name, "ok"] as const;
        } catch {
          return [name, "fail"] as const;
        }
      }),
    );
    const results = Object.fromEntries(entries);
    const healthy = entries.every(([, s]) => s === "ok");
    const body: HealthResponse = {
      service: "api",
      status: healthy ? "ok" : "degraded",
      checks: results,
    };
    res.status(healthy ? 200 : 503).json(body);
  });

  return app;
}
