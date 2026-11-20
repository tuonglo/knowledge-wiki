import { Router } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import type { TokenService } from "../auth/jwt.js";
import { createTestPrisma, resetDb } from "../test/db.js";
import { createTestTokens } from "../test/tokens.js";
import { createMeRouter } from "./me.js";

const prisma = createTestPrisma();
let tokens: TokenService;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  tokens = await createTestTokens();
  app = createApp({ webOrigin: "http://web.test", checks: {}, routes: { "/me": createMeRouter({ prisma, tokens }) } });
});
beforeEach(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

const bearer = async (userId: string) => `Bearer ${await tokens.signAccessToken({ userId })}`;

describe("GET /me", () => {
  it("returns the logged-in user's profile, and only safe fields", async () => {
    const user = await prisma.user.create({
      data: { email: "ann@example.com", name: "Ann", avatarUrl: "https://a/x.png" },
    });

    const res = await request(app).get("/me").set("Authorization", await bearer(user.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: user.id, email: "ann@example.com", name: "Ann", avatarUrl: "https://a/x.png" });
    expect(res.body).not.toHaveProperty("createdAt");
  });

  it("401s without a token", async () => {
    const res = await request(app).get("/me");
    expect(res.status).toBe(401);
  });

  it("401s for a valid token whose user was deleted after it was issued", async () => {
    const user = await prisma.user.create({ data: { email: "gone@example.com" } });
    const auth = await bearer(user.id);
    await prisma.user.delete({ where: { id: user.id } });

    const res = await request(app).get("/me").set("Authorization", auth);
    expect(res.status).toBe(401);
  });
});

describe("app-level fallbacks", () => {
  it("404s as JSON for unknown routes", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("turns a crash into a plain 500 JSON, without leaking the error or stack", async () => {
    const boom = Router().get("/", async () => {
      throw new Error("secret detail: /Users/me/app/src/db.ts:42");
    });
    const crashy = createApp({ webOrigin: "http://web.test", checks: {}, routes: { "/boom": boom } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {}); // keep test output clean

    const res = await request(crashy).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal_error" });
    expect(res.text).not.toMatch(/secret detail|db\.ts/);
    expect(spy).toHaveBeenCalled(); // ...but it IS logged server-side
    spy.mockRestore();
  });
});
