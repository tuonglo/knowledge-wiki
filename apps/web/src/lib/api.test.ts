import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// api.ts keeps the token in module state. Re-import a fresh copy for every test.
let api: typeof import("./api");
beforeEach(async () => {
  vi.resetModules();
  api = await import("./api");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * A fake server. `/api/auth/refresh` hands out token-1, token-2, ...;
 * other routes answer via `handler`. Records every call.
 */
function fakeServer(handler: (url: string, init: RequestInit) => Response = () => json(200, { ok: true })) {
  let issued = 0;
  const calls: { url: string; auth?: string }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
    calls.push({ url, auth });
    if (url === "/api/auth/refresh") return json(200, { accessToken: `token-${++issued}`, expiresIn: 900 });
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, refreshCount: () => calls.filter((c) => c.url === "/api/auth/refresh").length };
}

describe("apiFetch", () => {
  it("gets a token on first use and sends it as a Bearer header", async () => {
    const server = fakeServer();
    await api.apiFetch("/me");
    expect(server.calls.at(-1)).toEqual({ url: "/api/me", auth: "Bearer token-1" });
  });

  it("reuses the token for later calls instead of refreshing every time", async () => {
    const server = fakeServer();
    await api.apiFetch("/me");
    await api.apiFetch("/workspaces");
    expect(server.refreshCount()).toBe(1);
  });

  it("SINGLE-FLIGHT: many simultaneous calls share one refresh", async () => {
    const server = fakeServer();
    await Promise.all([api.apiFetch("/a"), api.apiFetch("/b"), api.apiFetch("/c")]);
    expect(server.refreshCount()).toBe(1); // 3 refreshes = same cookie sent 3× = reuse detection = logged out
  });

  it("refreshes ahead of expiry", async () => {
    vi.useFakeTimers();
    const server = fakeServer();
    await api.apiFetch("/me");
    vi.setSystemTime(Date.now() + 14.6 * 60 * 1000); // 15-min token, 30s margin
    await api.apiFetch("/me");
    expect(server.refreshCount()).toBe(2);
  });

  it("on 401, refreshes once and retries with the new token", async () => {
    let first = true;
    const server = fakeServer(() => {
      if (first) {
        first = false;
        return json(401, { error: "invalid_token" });
      }
      return json(200, { ok: true });
    });
    await expect(api.apiFetch("/me")).resolves.toEqual({ ok: true });
    expect(server.calls.at(-1)?.auth).toBe("Bearer token-2");
  });

  it("throws NotLoggedInError when there's no session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(401, { error: "no_session" })));
    await expect(api.apiFetch("/me")).rejects.toBeInstanceOf(api.NotLoggedInError);
  });

  it("throws ApiError with the server's error code for other failures", async () => {
    fakeServer(() => json(403, { error: "forbidden" }));
    await expect(api.apiFetch("/documents/x")).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("sends JSON bodies", async () => {
    let seen: RequestInit | undefined;
    fakeServer((_url, init) => {
      seen = init;
      return json(201, { id: "w1" });
    });
    await api.apiFetch("/workspaces", { method: "POST", body: { name: "Acme" } });
    expect(seen?.body).toBe('{"name":"Acme"}');
    expect((seen?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});

describe("logout", () => {
  it("forgets the token, so the next call has to refresh again", async () => {
    const server = fakeServer((url) => (url === "/api/auth/logout" ? json(204, null) : json(200, {})));
    await api.apiFetch("/me");
    await api.logout();
    await api.apiFetch("/me");
    expect(server.refreshCount()).toBe(2);
  });
});
