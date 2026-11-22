"use client";

import type { Me } from "@kw/shared";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Centered } from "./centered";

/**
 * Renders `children(user)` only when logged in; sends anonymous visitors to /login.
 *
 * This is a UX guard, not security: the API checks the token on every request. A
 * user who bypasses this only sees an empty shell, because every data call returns 401.
 */
export function RequireAuth({ children }: { children: (user: Me) => ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
  }, [state.status, router]);

  if (state.status === "error") return <Centered>{state.message}</Centered>;
  if (state.status !== "authenticated") return <Centered>Loading…</Centered>;
  return children(state.user);
}
