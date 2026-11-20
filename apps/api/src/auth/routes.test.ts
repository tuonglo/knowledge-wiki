import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createTestPrisma, resetDb } from "../test/db.js";
import type { OAuthProfile, OAuthProvider } from "./providers.js";
import { createAuthRouter, REFRESH_COOKIE } from "./routes.js";
import { hashToken } from "./sessions.js";

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

const WEB = "http://web.test";

/** A fake provider: no network. `profile` decides what "GitHub" says about the user. */
function fakeProvider(profile: Partial<OAuthProfile> = {}): OAuthProvider {
  return {
    name: "github",
    createAuthorizationUrl: (state) => new URL(`https://provider.test/authorize?state=${state}`),
    fetchProfile: async () => ({
      provider: "github",
      providerAccountId: "42",
      email: "ann@example.com",
      emailVerified: true,
      name: "Ann",
      avatarUrl: null,
      ...profile,
    }),
  };
}

function makeApp(provider = fakeProvider()): Express {
  return createApp({
    webOrigin: WEB,
    checks: {},
    authRouter: createAuthRouter({ prisma, providers: [provider], webOrigin: WEB, secureCookies: false }),
  });
}

/** Parse Set-Cookie headers into { name: { value, attrs } }. */
function cookiesOf(res: request.Response) {
  const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  return Object.fromEntries(
    raw.map((c) => {
      const [pair, ...attrs] = c.split("; ");
      const [name, value] = pair!.split("=");
      return [name, { value: decodeURIComponent(value ?? ""), attrs: attrs.join("; ") }];
    }),
  );
}

/** Run step 1 and return what a browser would carry into the callback. */
async function startLogin(agent: ReturnType<typeof request.agent>) {
  const res = await agent.get("/auth/github");
  const state = new URL(res.headers.location!).searchParams.get("state")!;
  return { res, state };
}

beforeEach(() => resetDb(prisma));

describe("GET /auth/:provider", () => {
  it("redirects to the provider and sets httpOnly state + verifier cookies", async () => {
    const { res, state } = await startLogin(request.agent(makeApp()));
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/provider\.test\/authorize/);

    const cookies = cookiesOf(res);
    expect(cookies.kw_oauth_state?.value).toBe(state);
    expect(cookies.kw_oauth_state?.attrs).toMatch(/HttpOnly/);
    expect(cookies.kw_oauth_verifier?.value).toBeTruthy();
  });

  it("404s for a provider that isn't configured", async () => {
    const res = await request(makeApp()).get("/auth/google");
    expect(res.status).toBe(404);
  });
});

describe("GET /auth/:provider/callback", () => {
  it("logs the user in: creates the user, starts a session, sets the refresh cookie", async () => {
    const agent = request.agent(makeApp());
    const { state } = await startLogin(agent);

    const res = await agent.get(`/auth/github/callback?code=abc&state=${state}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${WEB}/`);

    const refresh = cookiesOf(res)[REFRESH_COOKIE];
    expect(refresh?.attrs).toMatch(/HttpOnly/);
    expect(refresh?.attrs).toMatch(/Path=\/auth/);
    expect(refresh?.attrs).toMatch(/SameSite=Lax/);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "ann@example.com" } });
    const sessions = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    // The DB has the hash, never the raw token from the cookie.
    expect(sessions[0]!.tokenHash).toBe(hashToken(refresh!.value));
    expect(sessions[0]!.tokenHash).not.toBe(refresh!.value);
  });

  it("rejects a callback whose state doesn't match this browser's cookie (login CSRF)", async () => {
    const agent = request.agent(makeApp());
    await startLogin(agent);

    const res = await agent.get("/auth/github/callback?code=attackers-code&state=attackers-state");

    expect(res.status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects a callback from a browser that never started a login", async () => {
    const res = await request(makeApp()).get("/auth/github/callback?code=abc&state=xyz");
    expect(res.status).toBe(400);
  });

  it("sends the user back to the web app when they cancel on the provider", async () => {
    const agent = request.agent(makeApp());
    await startLogin(agent);
    const res = await agent.get("/auth/github/callback?error=access_denied");
    expect(res.headers.location).toBe(`${WEB}/?login_error=cancelled`);
  });

  it("refuses accounts without a verified email", async () => {
    const agent = request.agent(makeApp(fakeProvider({ emailVerified: false })));
    const { state } = await startLogin(agent);

    const res = await agent.get(`/auth/github/callback?code=abc&state=${state}`);

    expect(res.headers.location).toBe(`${WEB}/?login_error=unverified_email`);
    expect(cookiesOf(res)[REFRESH_COOKIE]).toBeUndefined();
    expect(await prisma.user.count()).toBe(0);
  });

  it("can't replay a callback: the state cookie is single-use", async () => {
    const agent = request.agent(makeApp());
    const { state } = await startLogin(agent);
    await agent.get(`/auth/github/callback?code=abc&state=${state}`);

    const replay = await agent.get(`/auth/github/callback?code=abc&state=${state}`);
    expect(replay.status).toBe(400);
  });
});
