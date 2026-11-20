import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler, type Express, type Router } from "express";
import helmet from "helmet";
import type { HealthResponse } from "@kw/shared";

/** A named dependency probe. Resolves if healthy, rejects otherwise. */
export type HealthCheck = () => Promise<unknown>;

export interface AppDeps {
  webOrigin: string;
  checks: Record<string, HealthCheck>;
  /** Routers by mount path, e.g. { "/auth": authRouter, "/me": meRouter }. */
  routes?: Record<string, Router>;
}

export function createApp({ webOrigin, checks, routes = {} }: AppDeps): Express {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: webOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

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

  for (const [path, router] of Object.entries(routes)) app.use(path, router);

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // Last: anything a route threw. Log the details here; send the client nothing internal
  // (stack traces leak file paths and library versions).
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: "internal_error" });
  };
  app.use(onError);

  return app;
}
