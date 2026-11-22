import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { AuthProvider } from "@/lib/auth";
import { QueryProvider } from "@/lib/query";

/** Render inside the app's real providers (each call gets a fresh query cache). */
export function renderWithProviders(ui: ReactElement) {
  return render(
    <QueryProvider>
      <AuthProvider>{ui}</AuthProvider>
    </QueryProvider>,
  );
}

export const testUser = { id: "u1", email: "ada@example.com", name: "Ada", avatarUrl: null };

export const workspace = (id: string, name: string, role: "OWNER" | "EDITOR" | "VIEWER" = "OWNER") => ({
  id,
  name,
  role,
  createdAt: "2026-11-22T00:00:00.000Z",
});
