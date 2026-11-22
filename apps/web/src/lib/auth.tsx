"use client";

import { Me } from "@kw/shared";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch, logout as apiLogout, NotLoggedInError } from "./api";

export type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: Me }
  | { status: "error"; message: string };

interface AuthContextValue {
  state: AuthState;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * On load, asks the API "who am I?". The first apiFetch triggers a refresh, so this
 * also turns the refresh cookie into an access token. No cookie → anonymous.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    apiFetch("/me", {}, Me)
      .then((user) => !cancelled && setState({ status: "authenticated", user }))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof NotLoggedInError) setState({ status: "anonymous" });
        else setState({ status: "error", message: "Couldn't reach the server. Try reloading." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const queryClient = useQueryClient();
  const logout = useCallback(async () => {
    await apiLogout();
    // Drop every cached API response, so the next user on this tab never sees ours.
    queryClient.clear();
    setState({ status: "anonymous" });
  }, [queryClient]);

  return <AuthContext.Provider value={{ state, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
