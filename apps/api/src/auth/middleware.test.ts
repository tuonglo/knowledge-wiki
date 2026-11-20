import express from "express";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestTokens } from "../test/tokens.js";
import type { TokenService } from "./jwt.js";
import { requireAuth } from "./middleware.js";

let tokens: TokenService;
let app: express.Express;

beforeAll(async () => {
  tokens = await createTestTokens();
  // A tiny app with one protected route that echoes who it thinks you are.
  app = express();
  app.get("/protected", requireAuth(tokens), (req, res) => {
    res.json({ userId: req.auth?.userId });
  });
});

afterEach(() => vi.useRealTimers());

describe("requireAuth", () => {
  it("lets a valid token through and exposes the user id", async () => {
    const token = await tokens.signAccessToken({ userId: "user_1" });
    const res = await request(app).get("/protected").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: "user_1" });
  });

  it("401s with no Authorization header, without an error code", async () => {
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
    expect(res.headers["www-authenticate"]).toBe('Bearer realm="kw"');
  });

  it("401s on a non-Bearer scheme", async () => {
    const res = await request(app).get("/protected").set("Authorization", "Basic dXNlcjpwYXNz");
    expect(res.status).toBe(401);
  });

  it('401s with error="invalid_token" on an expired token, so the client knows to refresh', async () => {
    const token = await tokens.signAccessToken({ userId: "user_1" });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);

    const res = await request(app).get("/protected").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_token" });
    expect(res.headers["www-authenticate"]).toMatch(/error="invalid_token"/);
  });

  it("401s on a token signed with someone else's key", async () => {
    const forger = await createTestTokens();
    const token = await forger.signAccessToken({ userId: "admin" });
    const res = await request(app).get("/protected").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("401s on garbage", async () => {
    const res = await request(app).get("/protected").set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
  });
});
