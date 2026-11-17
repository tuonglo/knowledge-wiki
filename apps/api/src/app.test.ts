import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const ok = () => Promise.resolve();
const fail = () => Promise.reject(new Error("down"));

describe("GET /health", () => {
  it("returns 200 when all checks pass", async () => {
    const app = createApp({ webOrigin: "http://x", checks: { postgres: ok, redis: ok } });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      service: "api",
      status: "ok",
      checks: { postgres: "ok", redis: "ok" },
    });
  });

  it("returns 503 and names the failing dependency", async () => {
    const app = createApp({ webOrigin: "http://x", checks: { postgres: ok, redis: fail } });
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.redis).toBe("fail");
  });
});
