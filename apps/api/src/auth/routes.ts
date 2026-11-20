import { generateCodeVerifier, generateState } from "arctic";
import { type CookieOptions, Router } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { OAuthProvider } from "./providers.js";
import { REFRESH_TOKEN_TTL_MS, startSession } from "./sessions.js";
import { findOrCreateUser, UnverifiedEmailError } from "./users.js";

export const REFRESH_COOKIE = "kw_refresh";
const STATE_COOKIE = "kw_oauth_state";
const VERIFIER_COOKIE = "kw_oauth_verifier";
const OAUTH_COOKIE_TTL_MS = 10 * 60 * 1000; // the user has 10 minutes to finish logging in

export interface AuthRouterDeps {
  prisma: PrismaClient;
  /** Only configured providers are listed; others 404. */
  providers: OAuthProvider[];
  /** Where to send the browser after login, e.g. http://localhost:3000 */
  webOrigin: string;
  /** true in production (HTTPS). Browsers drop `secure` cookies on plain http://localhost. */
  secureCookies: boolean;
}

export function createAuthRouter({ prisma, providers, webOrigin, secureCookies }: AuthRouterDeps): Router {
  const router = Router();
  const byName = new Map(providers.map((p) => [p.name, p]));

  const cookieBase: CookieOptions = {
    httpOnly: true, // JS can't read it → XSS can't steal it
    secure: secureCookies,
    sameSite: "lax", // sent on top-level redirects back from GitHub/Google, not on cross-site background requests
    path: "/auth", // only sent to /auth/*, not every API call
  };

  /** Send the browser back to the web app, optionally with an error code it can show. */
  const backToWeb = (error?: string) => {
    const url = new URL("/", webOrigin);
    if (error) url.searchParams.set("login_error", error);
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
      const session = await startSession(prisma, user.id);
      res.cookie(REFRESH_COOKIE, session.token, { ...cookieBase, maxAge: REFRESH_TOKEN_TTL_MS });
      return res.redirect(backToWeb());
    } catch (err) {
      if (err instanceof UnverifiedEmailError) return res.redirect(backToWeb("unverified_email"));
      console.error(`${provider.name} login failed`, err);
      return res.redirect(backToWeb("login_failed"));
    }
  });

  return router;
}
