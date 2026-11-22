"use client";

/**
 * Server state lives in TanStack Query: it caches API responses, dedupes identical
 * requests, tracks loading/error, and refetches after changes. Components never
 * store API data in useState themselves.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { ApiError } from "./api";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data counts as fresh for 30 s: switching pages back and forth won't refetch.
        staleTime: 30_000,
        // Retrying a 4xx won't help (404, 403, 401 are answers, not glitches). Retry
        // network errors and 5xx up to twice.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status < 500) && failureCount < 2,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  // One client per browser tab. useState (not a module variable) so each test render
  // and each server render gets its own cache.
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
