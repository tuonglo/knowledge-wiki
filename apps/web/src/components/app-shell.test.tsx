import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, NotLoggedInError } from "@/lib/api";
import { renderWithProviders, testUser, workspace } from "@/test/render";
import { AppShell } from "./app-shell";

const replace = vi.fn();
let params = { workspaceId: "a" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useParams: () => params,
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: vi.fn(),
}));
const api = vi.mocked(apiFetch);

function serve(me: unknown) {
  api.mockImplementation(async (path) => {
    if (path === "/me") {
      if (me instanceof Error) throw me;
      return me;
    }
    if (path === "/workspaces") return [workspace("a", "Alpha"), workspace("b", "Beta", "VIEWER")];
    if (path === "/workspaces/a/documents") return [];
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  replace.mockReset();
  localStorage.clear();
  params = { workspaceId: "a" };
});

describe("AppShell", () => {
  it("shows the workspace, the user, and the page content", async () => {
    serve(testUser);
    renderWithProviders(<AppShell>page content</AppShell>);
    expect(await screen.findByText("page content")).toBeInTheDocument();
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(localStorage.getItem("kw:lastWorkspace")).toBe("a");
  });

  it("hides content for a workspace you're not in", async () => {
    serve(testUser);
    params = { workspaceId: "someone-elses" };
    renderWithProviders(<AppShell>secret content</AppShell>);
    expect(await screen.findByText(/doesn't exist, or you don't have access/)).toBeInTheDocument();
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  it("sends anonymous visitors to /login", async () => {
    serve(new NotLoggedInError());
    renderWithProviders(<AppShell>secret content</AppShell>);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });
});
