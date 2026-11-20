import { generateCodeVerifier, generateState } from "arctic";
import { type CookieOptions, type Response, Router } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { TokenService } from "./jwt.js";
import type { OAuthProvider } from "./providers.js";
import {
  endSession,
  InvalidSessionError,
  REFRESH_TOKEN_TTL_MS,
  rotateSession,
  type Session,
  startSession,
  TokenReuseError,
} from "./sessions.js";
import { findOrCreateUser, UnverifiedEmailError } from "./users.js";

export const REFRESH_COOKIE = "kw_refresh";
const STATE_COOKIE = "kw_oauth_state";
const VERIFIER_COOKIE = "kw_oauth_verifier";
const OAUTH_COOKIE_TTL_MS = 10 * 60 * 1000; // the user has 10 minutes to finish logging in

export interface AuthRouterDeps {
  prisma: PrismaClient;
  tokens: TokenService;
  /** Only configured providers are listed; others 404. */
  providers: OAuthProvider[];
  /** Where to send the browser after login, e.g. http://localhost:3000 */
  webOrigin: string;
  /** true in production (HTTPS). Browsers drop `secure` cookies on plain http://localhost. */
  secureCookies: boolean;
  /**
   * Path the browser sees for these routes. "/auth" when called directly; "/api/auth"
   * when the web app proxies the API under /api. Cookies are scoped to it.
   */
  cookiePath?: string;
}

export function createAuthRouter({
  prisma,
  tokens,
  providers,
  webOrigin,
  secureCookies,
  cookiePath = "/auth",
}: AuthRouterDeps): Router {
  const router = Router();
  const byName = new Map(providers.map((p) => [p.name, p]));

  const cookieBase: CookieOptions = {
    httpOnly: true, // JS can't read it → XSS can't steal it
    secure: secureCookies,
    sameSite: "lax", // sent on top-level redirects back from GitHub/Google, not on cross-site background requests
    path: cookiePath, // only sent to the auth routes, not every API call
  };

  const setRefreshCookie = (res: Response, session: Session) =>
    res.cookie(REFRESH_COOKIE, session.token, { ...cookieBase, maxAge: REFRESH_TOKEN_TTL_MS });

  // ---- session endpoints (called by the web app with `credentials: "include"`) ----
  // Declared before /:provider so "refresh"/"logout" aren't mistaken for provider names.

  // Exchange the refresh cookie for a short-lived access token + a rotated cookie.
  router.post("/refresh", async (req, res) => {
    const raw: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof raw !== "string") return void res.status(401).json({ error: "no_session" });

    try {
      const session = await rotateSession(prisma, raw);
      setRefreshCookie(res, session);
      const accessToken = await tokens.signAccessToken({ userId: session.userId });
      res.json({ accessToken, expiresIn: tokens.accessTokenTtlSeconds });
    } catch (err) {
      if (!(err instanceof InvalidSessionError)) throw err;
      if (err instanceof TokenReuseError) {
        // Worth alerting on in production: it means a refresh token leaked.
        console.warn(`refresh token reuse detected, revoked family ${err.familyId}`);
      }
      res.clearCookie(REFRESH_COOKIE, cookieBase);
      res.status(401).json({ error: "invalid_session" });
    }
  });

  router.post("/logout", async (req, res) => {
    const raw: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof raw === "string") await endSession(prisma, raw);
    res.clearCookie(REFRESH_COOKIE, cookieBase);
    res.status(204).end();
  });

  // ---- OAuth login ----

  /** Send the browser back to the web app, optionally with an error code it can show. */
  const backToWeb = (error?: string) => {
    if (!error) return new URL("/", webOrigin).toString();
    const url = new URL("/login", webOrigin); // the login page explains what went wrong
    url.searchParams.set("error", error);
    return url.toString();
  };

  // Step 1: start login → redirect to the provider.
  router.get("/:provider", (req, res) => {
    const provider = byName.get(req.params.provider as OAuthProvider["name"]);
    if (!provider) return void res.status(404).json({ error: "unknown_provider" });

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const tmp = { ...cookieBase, maxAge: OAUTH_COOKIE_TTL_MS };
    res.cookie(STATE_COOKIE, state, tmp);
    res.cookie(VERIFIER_COOKIE, codeVerifier, tmp);
    res.redirect(provider.createAuthorizationUrl(state, codeVerifier).toString());
  });

  // Step 2: provider sends the user back here with ?code=…&state=…
  router.get("/:provider/callback", async (req, res) => {
    const provider = byName.get(req.params.provider as OAuthProvider["name"]);
    if (!provider) return void res.status(404).json({ error: "unknown_provider" });

    const { code, state, error } = req.query;
    const expectedState: unknown = req.cookies?.[STATE_COOKIE];
    const codeVerifier: unknown = req.cookies?.[VERIFIER_COOKIE];

    // One-time values: clear them whatever happens next.
    res.clearCookie(STATE_COOKIE, cookieBase);
    res.clearCookie(VERIFIER_COOKIE, cookieBase);

    // The user clicked "Cancel" on the provider's consent screen.
    if (typeof error === "string") return res.redirect(backToWeb("cancelled"));

    // CSRF check: this browser must be the one that started the login.
    if (
      typeof code !== "string" ||
      typeof state !== "string" ||
      typeof expectedState !== "string" ||
      typeof codeVerifier !== "string" ||
      state !== expectedState
    ) {
      return void res.status(400).json({ error: "invalid_oauth_state" });
    }

    try {
      const profile = await provider.fetchProfile(code, codeVerifier);
      const user = await findOrCreateUser(prisma, profile);
      setRefreshCookie(res, await startSession(prisma, user.id));
      return res.redirect(backToWeb());
    } catch (err) {
      if (err instanceof UnverifiedEmailError) return res.redirect(backToWeb("unverified_email"));
      console.error(`${provider.name} login failed`, err);
      return res.redirect(backToWeb("login_failed"));
    }
  });

  return router;
}
