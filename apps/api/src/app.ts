import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler, type Express, type Router } from "express";
import helmet from "helmet";
import type { HealthResponse } from "@kw/shared";
import { HttpError } from "./http.js";

/** Requests whose route parses its own (larger) body; the global parser leaves them alone. */
function ownsBodyParsing(req: { method?: string; url?: string }): boolean {
  return req.method === "PUT" && /^\/documents\/[^/?]+\/content(\?|$)/.test(req.url ?? "");
}

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
  // JSON bodies up to the default 100 kB. Routes that need more (page content) parse their
  // own body AFTER checking auth, so anonymous requests can't make us read megabytes.
  app.use(express.json({ type: (req) => Boolean(req.headers["content-type"]?.includes("json")) && !ownsBodyParsing(req) }));
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
    if (res.headersSent) return;
    // Expected errors thrown on purpose by routes (403, 404, 409...): send as-is.
    if (err instanceof HttpError) {
      return void res.status(err.status).json({ error: err.code, ...(err.details ? { details: err.details } : {}) });
    }
    // Malformed JSON body from express.json().
    if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "invalid_json" });
    if (err?.type === "entity.too.large") return void res.status(413).json({ error: "payload_too_large" });
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  };
  app.use(onError);

  return app;
}
