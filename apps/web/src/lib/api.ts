/**
 * Browser-side API client. Every call to the API goes through `apiFetch`, which
 * attaches the access token and handles refreshing it.
 *
 * Token storage: a module variable (memory), NOT localStorage — any script on the
 * page (including injected XSS) can read localStorage. Memory is wiped on reload;
 * that's fine, the httpOnly refresh cookie gets us a new token.
 */
import { RefreshResponse } from "@kw/shared";
import type { z } from "zod";

/** Refresh this long before the token actually expires, to absorb clock skew and slow requests. */
const EXPIRY_MARGIN_MS = 30_000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }
}

/** No valid session: the user must log in. */
export class NotLoggedInError extends ApiError {
  constructor() {
    super(401, "not_logged_in");
    this.name = "NotLoggedInError";
  }
}

let accessToken: string | null = null;
let expiresAt = 0;
let refreshing: Promise<string> | null = null;

/**
 * Get a fresh access token using the refresh cookie.
 *
 * Single-flight: concurrent callers share ONE request. Sending the same refresh
 * token twice would trip the server's reuse detection and log the user out.
 */
export function refreshAccessToken(): Promise<string> {
  refreshing ??= lockedRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * Tabs share the refresh cookie, so two tabs refreshing at once has the same problem.
 * The Web Locks API serializes across tabs: the second tab waits, then refreshes with
 * the cookie the first tab already rotated.
 */
async function lockedRefresh(): Promise<string> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    // `await` flattens the nested promise in the DOM typings for locks.request().
    return await navigator.locks.request("kw-token-refresh", doRefresh);
  }
  return doRefresh();
}

async function doRefresh(): Promise<string> {
  const res = await fetch("/api/auth/refresh", { method: "POST" });
  if (!res.ok) {
    clearAccessToken();
    throw new NotLoggedInError();
  }
  const { accessToken: token, expiresIn } = RefreshResponse.parse(await res.json());
  accessToken = token;
  expiresAt = Date.now() + expiresIn * 1000;
  return token;
}

function clearAccessToken() {
  accessToken = null;
  expiresAt = 0;
}

async function currentToken(): Promise<string> {
  if (accessToken && Date.now() < expiresAt - EXPIRY_MARGIN_MS) return accessToken;
  return refreshAccessToken();
}

/**
 * Call the API (path relative to /api, e.g. "/workspaces"). JSON in, JSON out.
 * Pass a zod `schema` to validate the response.
 *
 * Retries ONCE on 401: the token may have been revoked or expired mid-flight.
 * Throws NotLoggedInError if there's no session, ApiError for other failures.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
  schema?: z.ZodType<T>,
): Promise<T> {
  const send = (token: string) =>
    fetch(`/api${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  let res = await send(await currentToken());
  if (res.status === 401) res = await send(await refreshAccessToken());

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, typeof body.error === "string" ? body.error : "unknown_error");
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  return schema ? schema.parse(json) : (json as T);
}

/** End the session on the server (revokes the refresh token family) and forget the access token. */
export async function logout(): Promise<void> {
  clearAccessToken();
  await fetch("/api/auth/logout", { method: "POST" });
}

/** Login starts with a full-page navigation: the browser must visit the provider itself. */
export function loginUrl(provider: "github" | "google"): string {
  return `/api/auth/${provider}`;
}
