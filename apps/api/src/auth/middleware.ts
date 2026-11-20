import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { TokenService } from "./jwt.js";

declare global {
  // Adds `req.auth` to Express's Request type, so handlers get autocomplete + type checks.
  namespace Express {
    interface Request {
      /** Set by requireAuth. Only present on routes that use it. */
      auth?: { userId: string };
    }
  }
}

/**
 * Rejects the request with 401 unless it carries a valid access token:
 *   Authorization: Bearer <jwt>
 * On success, sets `req.auth.userId` and continues.
 *
 * Only answers "who are you?" (authentication). Whether this user may touch a
 * given workspace/document (authorization → 403) is checked per route.
 */
export function requireAuth(tokens: TokenService): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.get("authorization");
    const match = header?.match(/^Bearer (\S+)$/i);

    if (!match) {
      // RFC 6750: no error code when credentials are simply missing.
      res.set("WWW-Authenticate", 'Bearer realm="kw"');
      return void res.status(401).json({ error: "unauthenticated" });
    }

    try {
      req.auth = await tokens.verifyAccessToken(match[1]!);
      next();
    } catch {
      // Expired, tampered, wrong key... the client's move is the same: refresh, then retry.
      res.set("WWW-Authenticate", 'Bearer realm="kw", error="invalid_token"');
      res.status(401).json({ error: "invalid_token" });
    }
  };
}

/** For handlers behind requireAuth: the authenticated user id (throws if misconfigured). */
export function userIdOf(req: Request): string {
  if (!req.auth) throw new Error("route is missing requireAuth middleware");
  return req.auth.userId;
}
